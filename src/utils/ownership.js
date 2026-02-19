const isLabelLinkedToArtist = async (db, labelId, artistId) => {
  if (!db || !labelId || !artistId) {
    return false;
  }

  try {
    const row = await db("label_artist_map")
      .select("id")
      .where({ label_id: labelId, artist_id: artistId })
      .first();
    return !!row;
  } catch (error) {
    return false;
  }
};

const isUserLinkedToArtist = async (db, userId, artistId) => {
  if (!db || !userId || !artistId) {
    return false;
  }

  try {
    const row = await db("artist_user_map")
      .select("id")
      .where({ user_id: userId, artist_id: artistId })
      .first();
    return !!row;
  } catch (error) {
    return false;
  }
};

const doesUserOwnLabel = async (db, userId, labelId) => {
  if (!db || !userId || !labelId) {
    return false;
  }

  try {
    const labelRow = await db("label_users_map")
      .select("id")
      .where({ user_id: userId, label_id: labelId })
      .first();

    if (labelRow) {
      return true;
    }

    const userRow = await db("users")
      .select("label_id")
      .where({ id: userId })
      .first();

    return userRow?.label_id === labelId;
  } catch (error) {
    return false;
  }
};

module.exports = { isLabelLinkedToArtist, isUserLinkedToArtist, doesUserOwnLabel };
