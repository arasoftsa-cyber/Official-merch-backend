"use strict";

const {
  assertOrderItemSnapshotSchema,
  assertMediaAssetWriteSchema,
  assertAdminArtistDirectorySchema,
  assertArtistAccessRequestSubmissionSchema,
  assertArtistAccessRequestAdminSchema,
  assertAdminLeadReadSchema,
  assertCatalogProductMutationSchema,
  assertEntityMediaReadSchema,
  resolveDropWriteCompatibilitySchema,
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

  it("caches artist access request submission compatibility lookups once per process", async () => {
    const db = makeDb({
      tables: {
        artist_access_requests: {
          exists: true,
          columns: {
            id: {},
            artist_name: {},
            handle: {},
            email: {},
            phone: {},
            socials: {},
            about_me: {},
            message_for_fans: {},
            status: {},
            created_at: {},
            updated_at: {},
            requested_plan_type: {},
            requestor_user_id: {},
            contact_email: {},
            contact_phone: {},
            pitch: {},
            profile_photo_path: {},
            profile_photo_url: {},
          },
        },
        artists: {
          exists: true,
          columns: { id: {}, handle: {} },
        },
        users: {
          exists: true,
          columns: { id: {}, email: {} },
        },
      },
    });

    await assertArtistAccessRequestSubmissionSchema(db);
    await assertArtistAccessRequestSubmissionSchema(db);

    expect(db.__counters.hasTable.artist_access_requests).toBe(1);
    expect(db.__counters.columnInfo.artist_access_requests).toBe(1);
    expect(db.__counters.hasTable.artists).toBe(1);
    expect(db.__counters.columnInfo.artists).toBe(1);
    expect(db.__counters.hasTable.users).toBe(1);
    expect(db.__counters.columnInfo.users).toBe(1);
  });

  it("fails clearly when the admin artist access request contract is incomplete", async () => {
    const db = makeDb({
      tables: {
        artist_access_requests: {
          exists: true,
          columns: {
            id: {},
            artist_name: {},
            handle: {},
            email: {},
            phone: {},
            socials: {},
            about_me: {},
            message_for_fans: {},
            status: {},
            created_at: {},
            updated_at: {},
            requested_plan_type: {},
            rejection_comment: {},
          },
        },
        artists: {
          exists: true,
          columns: {
            id: {},
            name: {},
            handle: {},
            created_at: {},
            email: {},
            phone: {},
            about_me: {},
            message_for_fans: {},
            socials: {},
            profile_photo_url: {},
          },
        },
        users: {
          exists: true,
          columns: { id: {}, email: {}, role: {} },
        },
        artist_subscriptions: {
          exists: true,
          columns: {
            id: {},
            artist_id: {},
            requested_plan_type: {},
            start_date: {},
            end_date: {},
            payment_mode: {},
            transaction_id: {},
            approved_by_admin_id: {},
            approved_at: {},
            status: {},
            created_at: {},
            updated_at: {},
          },
        },
      },
    });

    await expect(assertArtistAccessRequestAdminSchema(db)).rejects.toMatchObject({
      code: "SCHEMA_CONTRACT_MISSING",
      details: expect.arrayContaining(["artist_access_requests.approved_plan_type"]),
    });
  });

  it("asserts the catalog product mutation contract once and reuses the cached result", async () => {
    const db = makeDb({
      tables: {
        products: {
          exists: true,
          columns: {
            id: {},
            artist_id: {},
            title: {},
            description: {},
            is_active: {},
            created_at: {},
            updated_at: {},
            status: {},
            rejection_reason: {},
            merch_story: {},
            merch_type: {},
            colors: {},
            mrp_cents: {},
            selling_price_cents: {},
            vendor_payout_cents: {},
            our_share_cents: {},
            royalty_cents: {},
            listing_photos: {},
            sku_types: {},
          },
        },
        product_variants: {
          exists: true,
          columns: {
            id: {},
            product_id: {},
            inventory_sku_id: {},
            sku: {},
            size: {},
            color: {},
            price_cents: {},
            created_at: {},
            updated_at: {},
            stock: {},
            is_listed: {},
            selling_price_cents: {},
            vendor_payout_cents: {},
            royalty_cents: {},
            our_share_cents: {},
          },
        },
        inventory_skus: {
          exists: true,
          columns: {
            id: {},
            supplier_sku: {},
            merch_type: {},
            quality_tier: {},
            size: {},
            color: {},
            stock: {},
            is_active: {},
            supplier_cost_cents: {},
            mrp_cents: {},
            metadata: {},
            created_at: {},
            updated_at: {},
          },
        },
      },
    });

    await assertCatalogProductMutationSchema(db);
    await assertCatalogProductMutationSchema(db);

    expect(db.__counters.columnInfo.products).toBe(1);
    expect(db.__counters.columnInfo.product_variants).toBe(1);
    expect(db.__counters.columnInfo.inventory_skus).toBe(1);
  });

  it("asserts admin leads and entity media read contracts explicitly", async () => {
    const db = makeDb({
      tables: {
        leads: {
          exists: true,
          columns: {
            id: {},
            source: {},
            drop_handle: {},
            artist_handle: {},
            name: {},
            phone: {},
            email: {},
            answers_json: {},
            status: {},
            admin_note: {},
            created_at: {},
            updated_at: {},
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

    await expect(assertAdminLeadReadSchema(db)).resolves.toEqual({
      leadColumns: expect.objectContaining({ admin_note: {} }),
    });
    await expect(assertEntityMediaReadSchema(db)).resolves.toEqual({
      entityMediaLinkColumns: expect.objectContaining({ media_asset_id: {} }),
      mediaAssetColumns: expect.objectContaining({ public_url: {} }),
    });
  });

  it("caches the legacy drop hero image compatibility flag", async () => {
    const db = makeDb({
      tables: {
        drops: {
          exists: true,
          columns: {
            id: {},
            updated_at: {},
            hero_image_url: {},
          },
        },
      },
    });

    await expect(resolveDropWriteCompatibilitySchema(db)).resolves.toEqual({
      dropColumns: expect.objectContaining({ hero_image_url: {} }),
      hasLegacyHeroImageUrl: true,
    });
    await resolveDropWriteCompatibilitySchema(db);

    expect(db.__counters.columnInfo.drops).toBe(1);
  });
});
