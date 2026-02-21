require("dotenv").config();

const { randomUUID } = require("crypto");
const { getDb } = require("../src/config/db");

const normalizeHandle = (value) =>
  String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const hasText = (value) => typeof value === "string" && value.trim().length > 0;

const isEmptyValue = (value) => {
  if (value == null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
};

const firstNonEmpty = (...values) => {
  for (const value of values) {
    if (!isEmptyValue(value)) return value;
  }
  return null;
};

async function main() {
  if ((process.env.NODE_ENV || "development") !== "development") {
    console.error(
      "[dev_backfill_artists_from_requests] Refusing to run outside development."
    );
    process.exit(1);
  }

  const db = getDb();

  try {
    const hasArtists = await db.schema.hasTable("artists");
    const hasRequests = await db.schema.hasTable("artist_access_requests");
    if (!hasArtists || !hasRequests) {
      console.log(
        "[dev_backfill_artists_from_requests] Nothing to do (missing artists or artist_access_requests table)."
      );
      return;
    }

    const artistColumns = await db("artists").columnInfo();
    const hasArtistUserMap = await db.schema.hasTable("artist_user_map");
    const hasUsers = await db.schema.hasTable("users");
    const hasEntityMediaLinks = await db.schema.hasTable("entity_media_links");

    const artists = await db("artists").select("id", "handle", "name", ...Object.keys(artistColumns));
    const approvedRequests = await db("artist_access_requests")
      .whereRaw("lower(status) = 'approved'")
      .orderBy("created_at", "desc")
      .select(
        "id",
        "handle",
        "email",
        "contact_email",
        "phone",
        "contact_phone",
        "about_me",
        "pitch",
        "message_for_fans",
        "socials"
      );

    const requestByHandle = new Map();
    const requestByEmail = new Map();
    for (const req of approvedRequests) {
      const keyHandle = normalizeHandle(req.handle);
      const keyEmail = normalizeEmail(req.email || req.contact_email);
      if (keyHandle && !requestByHandle.has(keyHandle)) requestByHandle.set(keyHandle, req);
      if (keyEmail && !requestByEmail.has(keyEmail)) requestByEmail.set(keyEmail, req);
    }

    const artistEmails = new Map();
    if (hasArtistUserMap && hasUsers) {
      const emailRows = await db("artist_user_map as aum")
        .leftJoin("users as u", "u.id", "aum.user_id")
        .select("aum.artist_id", "u.email");
      for (const row of emailRows) {
        const email = normalizeEmail(row.email);
        if (!email) continue;
        if (!artistEmails.has(row.artist_id)) artistEmails.set(row.artist_id, email);
      }
    }

    const requestPhotoAssetByRequestId = new Map();
    const artistHasPhoto = new Set();
    let entityMediaColumns = null;
    if (hasEntityMediaLinks) {
      entityMediaColumns = await db("entity_media_links").columnInfo();
      const requestPhotoRows = await db("entity_media_links")
        .where({ entity_type: "artist_access_request", role: "profile_photo" })
        .orderBy("entity_id", "asc")
        .orderBy("sort_order", "asc")
        .select("entity_id", "media_asset_id");
      for (const row of requestPhotoRows) {
        if (!requestPhotoAssetByRequestId.has(row.entity_id)) {
          requestPhotoAssetByRequestId.set(row.entity_id, row.media_asset_id);
        }
      }

      const artistPhotoRows = await db("entity_media_links")
        .where({ entity_type: "artist", role: "profile_photo" })
        .select("entity_id");
      for (const row of artistPhotoRows) artistHasPhoto.add(row.entity_id);
    }

    let artistsTouched = 0;
    let fieldsUpdated = 0;
    let photosLinked = 0;

    for (const artist of artists) {
      const handleKey = normalizeHandle(artist.handle);
      const emailKey =
        normalizeEmail(artist.email) || normalizeEmail(artistEmails.get(artist.id));
      const request = requestByHandle.get(handleKey) || requestByEmail.get(emailKey);
      if (!request) continue;

      const updates = {};
      if (Object.prototype.hasOwnProperty.call(artistColumns, "phone")) {
        if (isEmptyValue(artist.phone)) {
          const nextPhone = firstNonEmpty(request.phone, request.contact_phone);
          if (!isEmptyValue(nextPhone)) updates.phone = nextPhone;
        }
      }

      if (Object.prototype.hasOwnProperty.call(artistColumns, "about_me")) {
        if (isEmptyValue(artist.about_me)) {
          const nextAbout = firstNonEmpty(request.about_me, request.pitch);
          if (!isEmptyValue(nextAbout)) updates.about_me = nextAbout;
        }
      }

      if (Object.prototype.hasOwnProperty.call(artistColumns, "message_for_fans")) {
        if (isEmptyValue(artist.message_for_fans)) {
          const nextMessage = firstNonEmpty(request.message_for_fans);
          if (!isEmptyValue(nextMessage)) updates.message_for_fans = nextMessage;
        }
      }

      if (Object.prototype.hasOwnProperty.call(artistColumns, "socials")) {
        if (isEmptyValue(artist.socials)) {
          const nextSocials = firstNonEmpty(request.socials);
          if (!isEmptyValue(nextSocials)) updates.socials = nextSocials;
        }
      }

      if (Object.prototype.hasOwnProperty.call(artistColumns, "updated_at")) {
        if (Object.keys(updates).length > 0) updates.updated_at = db.fn.now();
      }

      if (Object.keys(updates).length > 0) {
        await db("artists").where({ id: artist.id }).update(updates);
        artistsTouched += 1;
        fieldsUpdated += Object.keys(updates).filter((k) => k !== "updated_at").length;
      }

      if (hasEntityMediaLinks && entityMediaColumns) {
        if (!artistHasPhoto.has(artist.id)) {
          const mediaAssetId = requestPhotoAssetByRequestId.get(request.id);
          if (hasText(mediaAssetId)) {
            const linkInsert = {
              id: randomUUID(),
              media_asset_id: mediaAssetId,
              entity_type: "artist",
              entity_id: artist.id,
              role: "profile_photo",
              sort_order: 0,
            };
            if (Object.prototype.hasOwnProperty.call(entityMediaColumns, "created_at")) {
              linkInsert.created_at = db.fn.now();
            }
            await db("entity_media_links").insert(linkInsert);
            artistHasPhoto.add(artist.id);
            photosLinked += 1;
          }
        }
      }
    }

    console.log(
      `[dev_backfill_artists_from_requests] complete artistsTouched=${artistsTouched} fieldsUpdated=${fieldsUpdated} photosLinked=${photosLinked}`
    );
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error("[dev_backfill_artists_from_requests] failed", err);
  process.exit(1);
});
