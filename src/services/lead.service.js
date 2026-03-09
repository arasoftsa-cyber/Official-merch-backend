const { randomUUID } = require("crypto");
const { getDb } = require("../core/db/db");

const ADMIN_LEAD_COLUMNS = [
  "id",
  "source",
  "drop_handle",
  "artist_handle",
  "name",
  "phone",
  "email",
  "answers_json",
  "status",
  "pipeline_stage",
  "notes",
  "created_at",
  "updated_at",
];

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
  const hasLeadsTable = await db.schema.hasTable("leads");
  if (!hasLeadsTable) return [];

  const leadColumnInfo = await db("leads").columnInfo();
  const hasColumn = (name) => Object.prototype.hasOwnProperty.call(leadColumnInfo, name);
  const selectColumns = ADMIN_LEAD_COLUMNS.filter((column) => hasColumn(column));
  const orderColumn = hasColumn("created_at") ? "created_at" : hasColumn("id") ? "id" : null;

  const query = db("leads");
  if (selectColumns.length > 0) {
    query.select(selectColumns);
  } else {
    query.select("*");
  }
  if (orderColumn) {
    query.orderBy(orderColumn, "desc");
  }
  return query;
};

module.exports = { createLead, listAdminLeads };
