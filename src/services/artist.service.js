const { getDb } = require("../core/db/db");
const { getTableColumns } = require("../core/db/schemaCache");

const isUuid = (value) => {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
};

const findByHandle = async (handle) => {
  const db = getDb();
  const columns = await getTableColumns(db, "artists");
  const hasProfilePhotoUrl = Object.prototype.hasOwnProperty.call(columns, "profile_photo_url");
  const hasStatus = Object.prototype.hasOwnProperty.call(columns, "status");
  const hasStory = Object.prototype.hasOwnProperty.call(columns, "story");
  const hasBio = Object.prototype.hasOwnProperty.call(columns, "bio");

  const selectColumns = ["id", "handle", "name", "theme_json"];
  if (hasProfilePhotoUrl) selectColumns.push("profile_photo_url");
  if (hasStatus) selectColumns.push("status");
  if (hasStory) selectColumns.push("story");
  if (hasBio) selectColumns.push("bio");

  const query = db("artists").select(selectColumns);
  if (isUuid(handle)) {
    query.where("id", handle);
  } else {
    query.where("handle", handle);
  }
  return query.first();
};

const listArtists = async ({ featured = false } = {}) => {
  const db = getDb();
  const columns = await getTableColumns(db, "artists");
  const hasProfilePhotoUrl = Object.prototype.hasOwnProperty.call(columns, "profile_photo_url");
  const hasStatus = Object.prototype.hasOwnProperty.call(columns, "status");

  const selectColumns = ["id", "handle", "name", "theme_json", "created_at"];
  if (hasProfilePhotoUrl) selectColumns.push("profile_photo_url");
  if (hasStatus) selectColumns.push("status");

  let query = db("artists").select(selectColumns).orderBy("created_at", "desc");

  if (featured) {
    const hasFeatured = Object.prototype.hasOwnProperty.call(columns, "is_featured");
    if (!hasFeatured) {
      return [];
    }
    query = query.where("is_featured", true).limit(6);
  }

  return query;
};

const listFeaturedArtists = async () => {
  const db = getDb();
  const columns = await getTableColumns(db, "artists");
  const hasFeatured = Object.prototype.hasOwnProperty.call(columns, "is_featured");
  if (!hasFeatured) {
    return [];
  }
  const hasProfilePhotoUrl = Object.prototype.hasOwnProperty.call(columns, "profile_photo_url");
  const hasStatus = Object.prototype.hasOwnProperty.call(columns, "status");
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
