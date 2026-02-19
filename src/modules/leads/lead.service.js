const { randomUUID } = require("crypto");
const { getDb } = require("../../config/db");

const createLead = async ({
  source,
  dropHandle,
  artistHandle,
  name,
  phone,
  email,
  answers,
}) => {
  const db = getDb();
  const id = randomUUID();
  const [row] = await db("leads")
    .insert({
      id,
      source,
      drop_handle: dropHandle,
      artist_handle: artistHandle,
      name,
      phone,
      email,
      answers_json: answers,
    })
    .returning(["id", "created_at"]);

  return row;
};

module.exports = { createLead };
