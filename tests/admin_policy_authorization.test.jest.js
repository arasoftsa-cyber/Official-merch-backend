const { can } = require("../src/core/rbac");
const { requirePolicy } = require("../src/core/http/policy.middleware");

const createMockResponse = () => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
};

describe("admin policy authorization", () => {
  it("allows declared admin action/resource pairs", async () => {
    await expect(
      Promise.resolve(
        can(
          { role: "admin", id: "admin-1" },
          "admin_dashboard:write",
          "artist_access_requests"
        )
      )
    ).resolves.toBe(true);
  });

  it("denies unspecified admin action/resource pairs", async () => {
    await expect(
      Promise.resolve(can({ role: "admin", id: "admin-1" }, "admin_dashboard:write", "self"))
    ).resolves.toBe(false);
  });

  it("denies unknown admin action/resource pairs safely", async () => {
    await expect(
      Promise.resolve(can({ role: "admin", id: "admin-1" }, "admin_dashboard:delete", "drops"))
    ).resolves.toBe(false);
    await expect(
      Promise.resolve(can({ role: "admin", id: "admin-1" }, "admin_dashboard:read", "unknown"))
    ).resolves.toBe(false);
  });

  it("policy middleware fails closed when misconfigured", async () => {
    const req = { user: { role: "admin", id: "admin-1" } };
    const res = createMockResponse();
    const next = jest.fn();

    await requirePolicy("", "system")(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "forbidden" });
    expect(next).not.toHaveBeenCalled();

    const badCtxRes = createMockResponse();
    await requirePolicy("admin:probe", "system", {})(req, badCtxRes, next);
    expect(badCtxRes.statusCode).toBe(403);
    expect(badCtxRes.body).toEqual({ error: "forbidden" });
  });

  it("policy middleware denies unknown admin permissions without leaking policy internals", async () => {
    const req = { user: { role: "admin", id: "admin-1" } };
    const res = createMockResponse();
    const next = jest.fn();

    await requirePolicy("admin_dashboard:delete", "drops")(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "forbidden" });
    expect(next).not.toHaveBeenCalled();
  });
});
