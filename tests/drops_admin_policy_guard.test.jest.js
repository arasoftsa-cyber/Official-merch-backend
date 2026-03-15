const request = require("supertest");
const {
  createDropsRuntimeHarness,
  authHeadersFor,
} = require("./helpers/dropsRuntimeHarness");

describe("drops admin policy guard", () => {
  it("allows admin patch mutations through the explicit drops policy", async () => {
    const { app, state } = createDropsRuntimeHarness({ useRealPolicy: true });
    const adminHeaders = authHeadersFor("admin", "admin-user");

    const createResponse = await request(app)
      .post("/api/admin/drops")
      .set(adminHeaders)
      .send({ title: "Guarded Admin Drop", artistId: state.artists[0].id });

    expect(createResponse.status).toBe(201);

    const patchResponse = await request(app)
      .patch(`/api/admin/drops/${createResponse.body.drop.id}`)
      .set(adminHeaders)
      .send({ title: "Guarded Admin Drop Updated" });

    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body?.drop?.title).toBe("Guarded Admin Drop Updated");
  });

  it("rejects non-admin drop mutations through policy middleware", async () => {
    const { app, state } = createDropsRuntimeHarness({ useRealPolicy: true });
    const adminHeaders = authHeadersFor("admin", "admin-user");
    const buyerHeaders = authHeadersFor("buyer", "buyer-user");

    const createResponse = await request(app)
      .post("/api/admin/drops")
      .set(adminHeaders)
      .send({ title: "Guarded Drop", artistId: state.artists[0].id });

    expect(createResponse.status).toBe(201);

    const patchResponse = await request(app)
      .patch(`/api/admin/drops/${createResponse.body.drop.id}`)
      .set(buyerHeaders)
      .send({ title: "Should Fail" });

    expect(patchResponse.status).toBe(403);
    expect(patchResponse.body).toEqual({ error: "forbidden" });
  });
});
