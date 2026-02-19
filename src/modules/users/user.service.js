const { getDb } = require("../../config/db");
const { toSafeDto } = require("./user.model");
const { randomUUID } = require("crypto");

const createUser = async ({ email, passwordHash, role }) => {
  const db = getDb();
  const id = randomUUID();
  const [row] = await db("users")
    .insert({
      id,
      email,
      password_hash: passwordHash,
      role,
      created_at: db.fn.now(),
    })
    .returning("*");
  return toSafeDto(row);
};

const findByEmail = async (email) => {
  const db = getDb();
  const row = await db("users").where({ email }).first();
  return row;
};

const findById = async (id) => {
  const db = getDb();
  const row = await db("users").where({ id }).first();
  return toSafeDto(row);
};

module.exports = { createUser, findByEmail, findById };
