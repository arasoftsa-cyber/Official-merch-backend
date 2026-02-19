const { randomUUID } = require("crypto");
const { getDb } = require("../../config/db");

const BAD_REQUEST = { error: "bad_request" };

const requireFields = (fields, body) => {
  for (const field of fields) {
    if (!body || !body[field]) {
      return false;
    }
  }
  return true;
};

const linkArtistUser = async (req, res) => {
  const { artistId, userId } = req.body || {};
  if (!requireFields(["artistId", "userId"], req.body)) {
    return res.status(400).json(BAD_REQUEST);
  }

  const db = getDb();
  await db("artist_user_map")
    .insert({
      id: randomUUID(),
      artist_id: artistId,
      user_id: userId,
    })
    .onConflict(["artist_id", "user_id"])
    .ignore();

  return res.json({ ok: true });
};

const linkLabelArtist = async (req, res) => {
  if (!requireFields(["labelId", "artistId"], req.body)) {
    return res.status(400).json(BAD_REQUEST);
  }

  const { labelId, artistId } = req.body;
  const db = getDb();
  await db("label_artist_map")
    .insert({
      id: randomUUID(),
      label_id: labelId,
      artist_id: artistId,
    })
    .onConflict(["label_id", "artist_id"])
    .ignore();

  return res.json({ ok: true });
};

const unlinkLabelArtist = async (req, res) => {
  if (!requireFields(["labelId", "artistId"], req.body)) {
    return res.status(400).json(BAD_REQUEST);
  }

  const { labelId, artistId } = req.body;
  const db = getDb();
  await db("label_artist_map")
    .where({
      label_id: labelId,
      artist_id: artistId,
    })
    .del();

  return res.json({ ok: true });
};

const ARTIST_HANDLE_EXISTS = { error: "artist_handle_exists" };
const LABEL_HANDLE_EXISTS = { error: "label_handle_exists" };

const createArtist = async (req, res) => {
  const { handle, name, theme } = req.body || {};
  if (!requireFields(["handle", "name"], req.body)) {
    return res.status(400).json(BAD_REQUEST);
  }

  const db = getDb();
  const existing = await db("artists").where({ handle }).first();
  if (existing) {
    return res.status(409).json({
      ...ARTIST_HANDLE_EXISTS,
      artist: {
        id: existing.id,
        handle: existing.handle,
        name: existing.name,
      },
    });
  }

  const themeObj = theme && typeof theme === "object" ? theme : {};

  const [row] = await db("artists")
    .insert({
      id: randomUUID(),
      handle,
      name,
      theme_json: themeObj,
    })
    .returning(["id", "handle", "name"]);

  return res.json({ ok: true, artist: row });
};

const createLabel = async (req, res) => {
  const { handle, name } = req.body || {};
  if (!requireFields(["handle", "name"], req.body)) {
    return res.status(400).json(BAD_REQUEST);
  }

  const db = getDb();
  const existing = await db("labels").where({ handle }).first();
  if (existing) {
    return res.status(409).json({
      ...LABEL_HANDLE_EXISTS,
      label: {
        id: existing.id,
        handle: existing.handle,
        name: existing.name,
      },
    });
  }

  const [row] = await db("labels")
    .insert({
      id: randomUUID(),
      handle,
      name,
    })
    .returning(["id", "handle", "name"]);

  return res.json({ ok: true, label: row });
};

module.exports = {
  linkArtistUser,
  linkLabelArtist,
  unlinkLabelArtist,
  createArtist,
  createLabel,
};
