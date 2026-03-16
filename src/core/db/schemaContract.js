"use strict";

const {
  hasTableCached,
  getTableColumns,
  __clearSchemaCacheForTests,
} = require("./schemaCache");

const contractCache = new Map();

const ORDER_ITEM_SNAPSHOT_COLUMNS = Object.freeze([
  "id",
  "order_id",
  "product_id",
  "product_variant_id",
  "quantity",
  "price_cents",
  "inventory_sku_id",
  "supplier_sku",
  "merch_type",
  "quality_tier",
  "size",
  "color",
  "selling_price_cents",
  "vendor_payout_cents",
  "royalty_cents",
  "our_share_cents",
  "created_at",
]);

const MEDIA_ASSET_WRITE_COLUMNS = Object.freeze([
  "id",
  "public_url",
  "created_at",
  "status",
  "storage_key",
  "provider",
  "mime_type",
  "size_bytes",
  "original_filename",
]);

const ADMIN_ARTIST_DIRECTORY_TABLES = Object.freeze({
  artists: [
    "id",
    "name",
    "handle",
    "created_at",
    "email",
    "status",
    "phone",
    "about_me",
    "message_for_fans",
    "socials",
    "profile_photo_url",
    "is_featured",
  ],
  artist_user_map: ["id", "artist_id", "user_id"],
  users: ["id", "email", "role"],
  artist_access_requests: [
    "handle",
    "email",
    "phone",
    "socials",
    "about_me",
    "message_for_fans",
    "status",
    "created_at",
  ],
  entity_media_links: [
    "id",
    "media_asset_id",
    "entity_type",
    "entity_id",
    "role",
    "sort_order",
    "created_at",
  ],
  media_assets: ["id", "public_url"],
});

const ADMIN_ARTIST_SUBSCRIPTION_TABLES = Object.freeze({
  artists: ["id"],
  artist_subscriptions: [
    "id",
    "artist_id",
    "requested_plan_type",
    "approved_plan_type",
    "start_date",
    "end_date",
    "payment_mode",
    "transaction_id",
    "approved_by_admin_id",
    "approved_at",
    "status",
    "created_at",
    "updated_at",
  ],
});

const ARTIST_ACCESS_REQUEST_SUBMISSION_TABLES = Object.freeze({
  artist_access_requests: [
    "id",
    "artist_name",
    "handle",
    "email",
    "phone",
    "socials",
    "about_me",
    "message_for_fans",
    "status",
    "created_at",
    "updated_at",
    "requested_plan_type",
    "requestor_user_id",
  ],
  artists: ["id", "handle"],
  users: ["id", "email"],
});

const ARTIST_ACCESS_REQUEST_ADMIN_TABLES = Object.freeze({
  artist_access_requests: [
    "id",
    "artist_name",
    "handle",
    "email",
    "phone",
    "socials",
    "about_me",
    "message_for_fans",
    "status",
    "created_at",
    "updated_at",
    "requested_plan_type",
    "approved_plan_type",
    "rejection_comment",
  ],
  artists: [
    "id",
    "name",
    "handle",
    "created_at",
    "email",
    "phone",
    "about_me",
    "message_for_fans",
    "socials",
    "profile_photo_url",
  ],
  users: ["id", "email", "role"],
  artist_subscriptions: [
    "id",
    "artist_id",
    "requested_plan_type",
    "approved_plan_type",
    "start_date",
    "end_date",
    "payment_mode",
    "transaction_id",
    "approved_by_admin_id",
    "approved_at",
    "status",
    "created_at",
    "updated_at",
  ],
});

const ARTIST_ACCESS_REQUEST_MEDIA_TABLES = Object.freeze({
  entity_media_links: [
    "id",
    "media_asset_id",
    "entity_type",
    "entity_id",
    "role",
    "sort_order",
    "created_at",
  ],
  media_assets: ["id", "public_url"],
});

const ADMIN_LEAD_READ_TABLES = Object.freeze({
  leads: [
    "id",
    "source",
    "drop_handle",
    "artist_handle",
    "name",
    "phone",
    "email",
    "answers_json",
    "status",
    "admin_note",
    "created_at",
    "updated_at",
  ],
});

const CATALOG_PRODUCT_MUTATION_TABLES = Object.freeze({
  products: [
    "id",
    "artist_id",
    "title",
    "description",
    "is_active",
    "created_at",
    "updated_at",
    "status",
    "rejection_reason",
    "merch_story",
    "merch_type",
    "colors",
    "mrp_cents",
    "selling_price_cents",
    "vendor_payout_cents",
    "our_share_cents",
    "royalty_cents",
    "listing_photos",
    "sku_types",
  ],
  product_variants: [
    "id",
    "product_id",
    "inventory_sku_id",
    "sku",
    "size",
    "color",
    "price_cents",
    "created_at",
    "updated_at",
    "stock",
    "is_listed",
    "selling_price_cents",
    "vendor_payout_cents",
    "royalty_cents",
    "our_share_cents",
  ],
  inventory_skus: [
    "id",
    "supplier_sku",
    "merch_type",
    "quality_tier",
    "size",
    "color",
    "stock",
    "is_active",
    "supplier_cost_cents",
    "mrp_cents",
    "metadata",
    "created_at",
    "updated_at",
  ],
});

const ENTITY_MEDIA_READ_TABLES = Object.freeze({
  entity_media_links: [
    "id",
    "media_asset_id",
    "entity_type",
    "entity_id",
    "role",
    "sort_order",
    "created_at",
  ],
  media_assets: ["id", "public_url"],
});

const DROP_WRITE_COMPATIBILITY_TABLES = Object.freeze({
  drops: ["id", "updated_at"],
});

const getCacheKey = (name) => String(name || "").trim().toLowerCase();

const missingColumnsFor = (columns, requiredColumns = []) =>
  requiredColumns.filter(
    (columnName) => !Object.prototype.hasOwnProperty.call(columns || {}, columnName)
  );

const createSchemaContractError = (contractName, details = []) => {
  const err = new Error(`required schema contract is not ready: ${contractName}`);
  err.code = "SCHEMA_CONTRACT_MISSING";
  err.statusCode = 500;
  err.details = details;
  return err;
};

const getCachedContract = (name, loader) => {
  const cacheKey = getCacheKey(name);
  if (!cacheKey) {
    return Promise.reject(createSchemaContractError("unknown", ["missing contract cache key"]));
  }
  if (!contractCache.has(cacheKey)) {
    contractCache.set(
      cacheKey,
      Promise.resolve()
        .then(loader)
        .catch((error) => {
          contractCache.delete(cacheKey);
          throw error;
        })
    );
  }
  return contractCache.get(cacheKey);
};

const assertTableContract = async (db, contractName, tableName, requiredColumns) => {
  const exists = await hasTableCached(db, tableName);
  if (!exists) {
    throw createSchemaContractError(contractName, [`missing required table: ${tableName}`]);
  }

  const columns = await getTableColumns(db, tableName);
  const missingColumns = missingColumnsFor(columns, requiredColumns);
  if (missingColumns.length > 0) {
    throw createSchemaContractError(
      contractName,
      missingColumns.map((columnName) => `${tableName}.${columnName}`)
    );
  }

  return columns;
};

const assertOrderItemSnapshotSchema = async (db) =>
  getCachedContract("orders.order_item_snapshot", async () =>
    assertTableContract(db, "orders.order_item_snapshot", "order_items", ORDER_ITEM_SNAPSHOT_COLUMNS)
  );

const assertMediaAssetWriteSchema = async (db) =>
  getCachedContract("media_assets.write", async () =>
    assertTableContract(db, "media_assets.write", "media_assets", MEDIA_ASSET_WRITE_COLUMNS)
  );

const assertAdminArtistDirectorySchema = async (db) =>
  getCachedContract("admin_artist.directory", async () => {
    const tables = {};
    for (const [tableName, requiredColumns] of Object.entries(ADMIN_ARTIST_DIRECTORY_TABLES)) {
      tables[tableName] = await assertTableContract(
        db,
        "admin_artist.directory",
        tableName,
        requiredColumns
      );
    }
    return tables;
  });

const assertAdminArtistSubscriptionSchema = async (db) =>
  getCachedContract("admin_artist.subscription", async () => {
    const tables = {};
    for (const [tableName, requiredColumns] of Object.entries(ADMIN_ARTIST_SUBSCRIPTION_TABLES)) {
      tables[tableName] = await assertTableContract(
        db,
        "admin_artist.subscription",
        tableName,
        requiredColumns
      );
    }
    return tables;
  });

const assertArtistAccessRequestSubmissionSchema = async (db) =>
  getCachedContract("artist_access_requests.submission", async () => {
    const tables = {};
    for (const [tableName, requiredColumns] of Object.entries(
      ARTIST_ACCESS_REQUEST_SUBMISSION_TABLES
    )) {
      tables[tableName] = await assertTableContract(
        db,
        "artist_access_requests.submission",
        tableName,
        requiredColumns
      );
    }
    return {
      requestColumns: tables.artist_access_requests,
      artistColumns: tables.artists,
      userColumns: tables.users,
    };
  });

const assertArtistAccessRequestAdminSchema = async (db) =>
  getCachedContract("artist_access_requests.admin", async () => {
    const tables = {};
    for (const [tableName, requiredColumns] of Object.entries(ARTIST_ACCESS_REQUEST_ADMIN_TABLES)) {
      tables[tableName] = await assertTableContract(
        db,
        "artist_access_requests.admin",
        tableName,
        requiredColumns
      );
    }
    return {
      requestColumns: tables.artist_access_requests,
      artistColumns: tables.artists,
      userColumns: tables.users,
      subscriptionColumns: tables.artist_subscriptions,
    };
  });

const assertArtistAccessRequestMediaSchema = async (db) =>
  getCachedContract("artist_access_requests.media", async () => {
    const tables = {};
    for (const [tableName, requiredColumns] of Object.entries(ARTIST_ACCESS_REQUEST_MEDIA_TABLES)) {
      tables[tableName] = await assertTableContract(
        db,
        "artist_access_requests.media",
        tableName,
        requiredColumns
      );
    }
    return {
      entityMediaLinkColumns: tables.entity_media_links,
      mediaAssetColumns: tables.media_assets,
    };
  });

const assertAdminLeadReadSchema = async (db) =>
  getCachedContract("admin.leads.read", async () => {
    const tables = {};
    for (const [tableName, requiredColumns] of Object.entries(ADMIN_LEAD_READ_TABLES)) {
      tables[tableName] = await assertTableContract(db, "admin.leads.read", tableName, requiredColumns);
    }
    return {
      leadColumns: tables.leads,
    };
  });

const assertCatalogProductMutationSchema = async (db) =>
  getCachedContract("catalog.product_mutations", async () => {
    const tables = {};
    for (const [tableName, requiredColumns] of Object.entries(CATALOG_PRODUCT_MUTATION_TABLES)) {
      tables[tableName] = await assertTableContract(
        db,
        "catalog.product_mutations",
        tableName,
        requiredColumns
      );
    }
    return {
      productColumns: tables.products,
      variantColumns: tables.product_variants,
      inventorySkuColumns: tables.inventory_skus,
    };
  });

const assertEntityMediaReadSchema = async (db) =>
  getCachedContract("entity_media.read", async () => {
    const tables = {};
    for (const [tableName, requiredColumns] of Object.entries(ENTITY_MEDIA_READ_TABLES)) {
      tables[tableName] = await assertTableContract(db, "entity_media.read", tableName, requiredColumns);
    }
    return {
      entityMediaLinkColumns: tables.entity_media_links,
      mediaAssetColumns: tables.media_assets,
    };
  });

const resolveDropWriteCompatibilitySchema = async (db) =>
  getCachedContract("drops.write_compatibility", async () => {
    const tables = {};
    for (const [tableName, requiredColumns] of Object.entries(DROP_WRITE_COMPATIBILITY_TABLES)) {
      tables[tableName] = await assertTableContract(
        db,
        "drops.write_compatibility",
        tableName,
        requiredColumns
      );
    }
    return {
      dropColumns: tables.drops,
      hasLegacyHeroImageUrl: Object.prototype.hasOwnProperty.call(
        tables.drops,
        "hero_image_url"
      ),
    };
  });

const clearSchemaContractCacheForTests = () => {
  contractCache.clear();
  if (typeof __clearSchemaCacheForTests === "function") {
    __clearSchemaCacheForTests();
  }
};

module.exports = {
  ORDER_ITEM_SNAPSHOT_COLUMNS,
  MEDIA_ASSET_WRITE_COLUMNS,
  assertOrderItemSnapshotSchema,
  assertMediaAssetWriteSchema,
  assertAdminArtistDirectorySchema,
  assertAdminArtistSubscriptionSchema,
  assertArtistAccessRequestSubmissionSchema,
  assertArtistAccessRequestAdminSchema,
  assertArtistAccessRequestMediaSchema,
  assertAdminLeadReadSchema,
  assertCatalogProductMutationSchema,
  assertEntityMediaReadSchema,
  resolveDropWriteCompatibilitySchema,
  __clearSchemaContractCacheForTests: clearSchemaContractCacheForTests,
};
