const { randomUUID } = require("crypto");
const { getDb } = require("../../config/db");
const { toAbsolutePublicUrl } = require("../../utils/publicUrl");
const {
  HOMEPAGE_ENTITY_TYPE,
  HOMEPAGE_ENTITY_ID,
  ROLE_HERO_CAROUSEL,
  DEFAULT_HOMEPAGE_BANNER_SORT_ORDER,
} = require("./homepage.constants");

const HOMEPAGE_BANNER_SELECT = [
  "eml.id as link_id",
  "eml.media_asset_id",
  "ma.public_url",
  "eml.sort_order",
];

const listHomepageBanners = async () => {
  const db = getDb();
  const rows = await db("entity_media_links as eml")
    .join("media_assets as ma", "ma.id", "eml.media_asset_id")
    .select(HOMEPAGE_BANNER_SELECT)
    .where("eml.entity_type", HOMEPAGE_ENTITY_TYPE)
    .andWhere("eml.entity_id", HOMEPAGE_ENTITY_ID)
    .andWhere("eml.role", ROLE_HERO_CAROUSEL)
    .orderBy("eml.sort_order", "asc")
    .orderBy("eml.created_at", "desc");

  return rows.map((row) => ({
    link_id: row.link_id,
    media_asset_id: row.media_asset_id,
    public_url: toAbsolutePublicUrl(row.public_url),
    sort_order: Number(row.sort_order ?? 0),
  }));
};

const createHomepageBanner = async ({ publicUrl, sortOrder }) => {
  const db = getDb();
  const normalizedPublicUrl = toAbsolutePublicUrl(publicUrl);

  return db.transaction(async (trx) => {
    const mediaAssetId = randomUUID();
    const linkId = randomUUID();

    await trx("media_assets").insert({
      id: mediaAssetId,
      public_url: normalizedPublicUrl,
      created_at: trx.fn.now(),
    });

    await trx("entity_media_links").insert({
      id: linkId,
      media_asset_id: mediaAssetId,
      entity_type: HOMEPAGE_ENTITY_TYPE,
      entity_id: HOMEPAGE_ENTITY_ID,
      role: ROLE_HERO_CAROUSEL,
      sort_order:
        typeof sortOrder === "number"
          ? sortOrder
          : DEFAULT_HOMEPAGE_BANNER_SORT_ORDER,
      created_at: trx.fn.now(),
    });

    const [row] = await trx("entity_media_links as eml")
      .join("media_assets as ma", "ma.id", "eml.media_asset_id")
      .select(HOMEPAGE_BANNER_SELECT)
      .where("eml.id", linkId);

    return {
      link_id: row.link_id,
      media_asset_id: row.media_asset_id,
      public_url: toAbsolutePublicUrl(row.public_url),
      sort_order: Number(row.sort_order ?? 0),
    };
  });
};

const createHomepageBannerFromStoredPublicUrl = async ({ publicUrl, sortOrder }) => {
  const db = getDb();
  return db.transaction(async (trx) => {
    const linkId = randomUUID();
    const [mediaAssetRow] = await trx("media_assets")
      .insert({
        public_url: publicUrl,
        created_at: trx.fn.now(),
      })
      .returning(["id"]);

    await trx("entity_media_links").insert({
      id: linkId,
      media_asset_id: mediaAssetRow.id,
      entity_type: HOMEPAGE_ENTITY_TYPE,
      entity_id: HOMEPAGE_ENTITY_ID,
      role: ROLE_HERO_CAROUSEL,
      sort_order:
        typeof sortOrder === "number"
          ? sortOrder
          : DEFAULT_HOMEPAGE_BANNER_SORT_ORDER,
      created_at: trx.fn.now(),
    });

    const [row] = await trx("entity_media_links as eml")
      .join("media_assets as ma", "ma.id", "eml.media_asset_id")
      .select(HOMEPAGE_BANNER_SELECT)
      .where("eml.id", linkId);

    return {
      link_id: row.link_id,
      media_asset_id: row.media_asset_id,
      public_url: row.public_url,
      sort_order: Number(row.sort_order ?? 0),
    };
  });
};

const updateHomepageBannerSortOrder = async ({ linkId, sortOrder }) => {
  const db = getDb();
  const updatedRows = await db("entity_media_links as eml")
    .where("eml.id", linkId)
    .andWhere("eml.entity_type", HOMEPAGE_ENTITY_TYPE)
    .andWhere("eml.entity_id", HOMEPAGE_ENTITY_ID)
    .andWhere("eml.role", ROLE_HERO_CAROUSEL)
    .update({ sort_order: sortOrder })
    .returning(["id"]);

  if (!updatedRows?.length) {
    return null;
  }

  const [row] = await db("entity_media_links as eml")
    .join("media_assets as ma", "ma.id", "eml.media_asset_id")
    .select(HOMEPAGE_BANNER_SELECT)
    .where("eml.id", linkId);

  if (!row) return null;

  return {
    link_id: row.link_id,
    media_asset_id: row.media_asset_id,
    public_url: toAbsolutePublicUrl(row.public_url),
    sort_order: Number(row.sort_order ?? 0),
  };
};

const deleteHomepageBannerLink = async ({ linkId }) => {
  const db = getDb();
  const deletedCount = await db("entity_media_links")
    .where({
      id: linkId,
      entity_type: HOMEPAGE_ENTITY_TYPE,
      entity_id: HOMEPAGE_ENTITY_ID,
      role: ROLE_HERO_CAROUSEL,
    })
    .delete();

  return Number(deletedCount) > 0;
};

module.exports = {
  listHomepageBanners,
  createHomepageBanner,
  createHomepageBannerFromStoredPublicUrl,
  updateHomepageBannerSortOrder,
  deleteHomepageBannerLink,
};
