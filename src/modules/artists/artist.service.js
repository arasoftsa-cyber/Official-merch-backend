const { getDb } = require("../../config/db");

const isUuid = (value) => {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
};

const findByHandle = async (handle) => {
  const db = getDb();
  const query = db("artists").select("id", "handle", "name", "theme_json");
  if (isUuid(handle)) {
    query.where("id", handle);
  } else {
    query.where("handle", handle);
  }
  return query.first();
};

const listArtists = async ({ featured = false } = {}) => {
  const db = getDb();
  const hasProfilePhotoUrl = await db.schema.hasColumn("artists", "profile_photo_url");
  const hasStatus = await db.schema.hasColumn("artists", "status");

  const selectColumns = ["id", "handle", "name", "theme_json", "created_at"];
  if (hasProfilePhotoUrl) selectColumns.push("profile_photo_url");
  if (hasStatus) selectColumns.push("status");

  let query = db("artists").select(selectColumns).orderBy("created_at", "desc");

  if (featured) {
    const hasFeatured = await db.schema.hasColumn("artists", "is_featured");
    if (!hasFeatured) {
      return [];
    }
    query = query.where("is_featured", true).limit(6);
  }

  return query;
};

const listFeaturedArtists = async () => {
  const db = getDb();
  const hasFeatured = await db.schema.hasColumn("artists", "is_featured");
  if (!hasFeatured) {
    return [];
  }
  const hasProfilePhotoUrl = await db.schema.hasColumn("artists", "profile_photo_url");
  const hasStatus = await db.schema.hasColumn("artists", "status");
  const selectColumns = ["id", "handle", "name", "theme_json", "created_at"];
  if (hasProfilePhotoUrl) selectColumns.push("profile_photo_url");
  if (hasStatus) selectColumns.push("status");
  return db("artists")
    .select(selectColumns)
    .where("is_featured", true)
    .orderBy("created_at", "desc")
    .limit(12);
};

module.exports = { findByHandle, listArtists, listFeaturedArtists };
