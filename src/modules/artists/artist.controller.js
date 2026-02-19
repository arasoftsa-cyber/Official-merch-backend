const artistService = require("./artist.service");
const { getDb } = require("../../config/db");

const NOT_FOUND = { error: "artist_not_found" };

const formatArtist = (row) => {
  if (!row) return null;
  const { id, handle, name, theme_json } = row;
  return {
    id,
    handle,
    name,
    theme: theme_json,
  };
};

const loadCoverUrlMap = async (entityType, entityIds) => {
  if (!entityType || !Array.isArray(entityIds) || entityIds.length === 0) {
    return new Map();
  }

  const db = getDb();
  const dedupedIds = Array.from(new Set(entityIds.filter(Boolean)));
  if (dedupedIds.length === 0) {
    return new Map();
  }

  try {
    const hasMediaAssets = await db.schema.hasTable("media_assets");
    const hasEntityLinks = await db.schema.hasTable("entity_media_links");
    if (!hasMediaAssets || !hasEntityLinks) {
      return new Map();
    }

    const rows = await db("entity_media_links as eml")
      .join("media_assets as ma", "ma.id", "eml.media_asset_id")
      .select("eml.entity_id as entityId", "ma.public_url as publicUrl")
      .where("eml.entity_type", entityType)
      .andWhere("eml.role", "cover")
      .whereIn("eml.entity_id", dedupedIds)
      .orderBy("eml.sort_order", "asc")
      .orderBy("eml.created_at", "asc");

    const map = new Map();
    for (const row of rows) {
      if (row?.entityId && !map.has(row.entityId)) {
        map.set(row.entityId, row.publicUrl || null);
      }
    }
    return map;
  } catch {
    return new Map();
  }
};

const getArtist = async (req, res) => {
  const { handle } = req.params;
  const row = await artistService.findByHandle(handle);
  if (!row) {
    return res.status(404).json(NOT_FOUND);
  }

  return res.json({
    artist: formatArtist(row),
    shelf: [],
  });
};

const getShelf = async (req, res) => {
  const { handle } = req.params;
  const row = await artistService.findByHandle(handle);
  if (!row) {
    return res.status(404).json(NOT_FOUND);
  }

  const db = getDb();
  const shelfRows = await db("products as p")
    .where("p.artist_id", row.id)
    .andWhere("p.is_active", true)
    .select(
      "p.id",
      "p.title",
      "p.artist_id",
      "p.is_active",
      db.raw(
        "(select min(price_cents) from product_variants pv where pv.product_id = p.id) as price_cents"
      )
    )
    .orderBy("p.created_at", "desc");

  const items = shelfRows.map((item) => ({
    id: item.id,
    title: item.title,
    artistId: item.artist_id,
    isActive: item.is_active,
    priceCents: item.price_cents == null ? null : Number(item.price_cents),
  }));

  return res.json({
    artistHandle: row.handle,
    shelf: items,
    items,
  });
};

const getArtists = async (req, res) => {
  const featured = req.query.featured === "1" || req.query.featured === "true";
  const rows = await artistService.listArtists({ featured });
  const formatted = rows.map((row) => formatArtist(row)).filter(Boolean);
  const coverMap = await loadCoverUrlMap(
    "artist",
    formatted.map((artist) => artist.id)
  );
  const withCover = formatted.map((artist) => ({
    ...artist,
    coverUrl: coverMap.get(artist.id) || null,
  }));
  res.json({
    artists: withCover,
  });
};

const getFeaturedArtists = async (req, res) => {
  const db = getDb();
  const rows = await db("artists")
    .select("id", "handle", "name", "theme_json")
    .where("is_featured", true)
    .orderBy("created_at", "desc")
    .limit(12);

  res.status(200).json(rows);
};

module.exports = { getArtist, getShelf, getArtists, getFeaturedArtists };
