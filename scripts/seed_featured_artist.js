const { getDb } = require("../src/config/db");

const API_BASE = process.env.API_BASE || "http://76.13.241.27:3000";

async function main() {
  const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@test.com", password: "admin123" }),
  });
  if (loginRes.status !== 200) {
    throw new Error(`admin login failed (${loginRes.status})`);
  }
  const loginJson = await loginRes.json();
  const token = loginJson?.accessToken;
  if (!token) {
    throw new Error("missing admin token");
  }

  const handle = "taalpatar-shepai";
  const res = await fetch(`${API_BASE}/api/onboarding/create-artist`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      handle,
      name: "Taalpatar Shepai",
      theme: {},
    }),
  });
  let artistId = null;
  if (res.status === 200) {
    artistId = res.json?.artist?.id;
  } else if (res.status === 409) {
    const body = await res.json().catch(() => ({}));
    artistId = body?.artist?.id;
  }
  if (!artistId) {
    const lookup = await fetch(`${API_BASE}/api/artists/${handle}`);
    if (lookup.status === 200) {
      const data = await lookup.json();
      artistId = data?.artist?.id;
    }
  }
  if (!artistId) {
    throw new Error("unable to resolve artist id");
  }

  const db = getDb();
  await db("artists").where({ id: artistId }).update({ is_featured: true });

  console.log("Seeded featured artist:", { id: artistId, handle });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
