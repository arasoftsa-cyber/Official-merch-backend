"use strict";

const {
  assertOrderItemSnapshotSchema,
  assertMediaAssetWriteSchema,
  assertAdminArtistDirectorySchema,
  __clearSchemaContractCacheForTests,
} = require("../src/core/db/schemaContract");

const makeDb = ({ tables = {} } = {}) => {
  const counters = {
    hasTable: {},
    columnInfo: {},
  };

  const db = (tableName) => ({
    columnInfo: async () => {
      const key = String(tableName || "").trim();
      counters.columnInfo[key] = (counters.columnInfo[key] || 0) + 1;
      return tables[key]?.columns || {};
    },
  });

  db.schema = {
    hasTable: async (tableName) => {
      const key = String(tableName || "").trim();
      counters.hasTable[key] = (counters.hasTable[key] || 0) + 1;
      return Boolean(tables[key]?.exists);
    },
  };

  db.__counters = counters;
  return db;
};

describe("schema contract runtime guards", () => {
  beforeEach(() => {
    __clearSchemaContractCacheForTests();
  });

  it("caches canonical schema checks after the first successful assertion", async () => {
    const db = makeDb({
      tables: {
        order_items: {
          exists: true,
          columns: {
            id: {},
            order_id: {},
            product_id: {},
            product_variant_id: {},
            quantity: {},
            price_cents: {},
            inventory_sku_id: {},
            supplier_sku: {},
            merch_type: {},
            quality_tier: {},
            size: {},
            color: {},
            selling_price_cents: {},
            vendor_payout_cents: {},
            royalty_cents: {},
            our_share_cents: {},
            created_at: {},
          },
        },
      },
    });

    await assertOrderItemSnapshotSchema(db);
    await assertOrderItemSnapshotSchema(db);

    expect(db.__counters.hasTable.order_items).toBe(1);
    expect(db.__counters.columnInfo.order_items).toBe(1);
  });

  it("fails clearly when required media_assets columns are missing", async () => {
    const db = makeDb({
      tables: {
        media_assets: {
          exists: true,
          columns: {
            id: {},
            public_url: {},
            created_at: {},
          },
        },
      },
    });

    await expect(assertMediaAssetWriteSchema(db)).rejects.toMatchObject({
      code: "SCHEMA_CONTRACT_MISSING",
      statusCode: 500,
      details: expect.arrayContaining(["media_assets.status", "media_assets.storage_key"]),
    });
  });

  it("asserts the admin artist directory contract as a single explicit dependency set", async () => {
    const db = makeDb({
      tables: {
        artists: {
          exists: true,
          columns: {
            id: {},
            name: {},
            handle: {},
            created_at: {},
            email: {},
            status: {},
            phone: {},
            about_me: {},
            message_for_fans: {},
            socials: {},
            profile_photo_url: {},
            is_featured: {},
          },
        },
        artist_user_map: {
          exists: true,
          columns: { id: {}, artist_id: {}, user_id: {} },
        },
        users: {
          exists: true,
          columns: { id: {}, email: {}, role: {} },
        },
        artist_access_requests: {
          exists: true,
          columns: {
            handle: {},
            email: {},
            phone: {},
            socials: {},
            about_me: {},
            message_for_fans: {},
            status: {},
            created_at: {},
          },
        },
        entity_media_links: {
          exists: true,
          columns: {
            id: {},
            media_asset_id: {},
            entity_type: {},
            entity_id: {},
            role: {},
            sort_order: {},
            created_at: {},
          },
        },
        media_assets: {
          exists: true,
          columns: { id: {}, public_url: {} },
        },
      },
    });

    await expect(assertAdminArtistDirectorySchema(db)).resolves.toBeTruthy();
  });
});
