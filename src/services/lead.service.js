const { randomUUID } = require("crypto");
const { getDb } = require("../core/db/db");
const { assertAdminLeadReadSchema } = require("../core/db/schemaContract");

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

const listAdminLeads = async () => {
  const db = getDb();
  await assertAdminLeadReadSchema(db);
  return db("leads")
    .select(
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
      "updated_at"
    )
    .orderBy("created_at", "desc");
};

module.exports = { createLead, listAdminLeads };
