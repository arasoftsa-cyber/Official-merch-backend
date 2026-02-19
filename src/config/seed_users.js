const { getDb } = require("./db");
const { hashPassword } = require("../utils/password");

const usersToSeed = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    email: "admin@test.com",
    password: "admin123",
    role: "admin",
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    email: "buyer@test.com",
    password: "buyer123",
    role: "buyer",
  },
  {
    id: "00000000-0000-0000-0000-000000000003",
    email: "artist@test.com",
    password: "artist123",
    role: "artist",
  },
  {
    id: "00000000-0000-0000-0000-000000000004",
    email: "label@test.com",
    password: "label123",
    role: "label",
  },
];

const seedUsers = async () => {
  const db = getDb();

  for (const user of usersToSeed) {
    const exists = await db("users").where({ email: user.email }).first();
    if (exists) {
      console.log(`exists ${user.email}`);
      continue;
    }

    const passwordHash = await hashPassword(user.password);
    await db("users")
      .insert({
        id: user.id,
        email: user.email,
        password_hash: passwordHash,
        role: user.role,
      })
      .onConflict("email")
      .ignore();

    console.log(`seeded ${user.email}`);
  }

  await db.destroy();
};

seedUsers().catch((err) => {
  console.error("failed to seed users", err);
  process.exit(1);
});
