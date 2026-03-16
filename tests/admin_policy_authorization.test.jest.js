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
  const adminUser = { role: "admin", id: "admin-1" };

  it("allows declared admin action/resource pairs", async () => {
    await expect(
      Promise.resolve(
        can(
          adminUser,
          "admin_dashboard:write",
          "artist_access_requests"
        )
      )
    ).resolves.toBe(true);
  });

  it("allows the explicit admin route resources migrated to centralized policy checks", async () => {
    const allowedPairs = [
      ["admin_dashboard:read", "dashboard"],
      ["admin_dashboard:read", "orders"],
      ["admin_dashboard:write", "orders"],
      ["admin_dashboard:read", "payments"],
      ["admin_dashboard:read", "abuse_flags"],
      ["admin_dashboard:read", "artists"],
      ["admin_dashboard:write", "artists"],
      ["admin_dashboard:read", "product_variants"],
      ["admin_dashboard:write", "product_variants"],
      ["admin_dashboard:read", "inventory_skus"],
      ["admin_dashboard:write", "inventory_skus"],
      ["admin_dashboard:write", "test_support"],
    ];

    for (const [action, resource] of allowedPairs) {
      // eslint-disable-next-line no-await-in-loop
      await expect(Promise.resolve(can(adminUser, action, resource))).resolves.toBe(true);
    }
  });

  it("denies unspecified admin action/resource pairs", async () => {
    await expect(
      Promise.resolve(can(adminUser, "admin_dashboard:write", "self"))
    ).resolves.toBe(false);
  });

  it("keeps deny-by-default behavior for undeclared admin resource/action pairs", async () => {
    const deniedPairs = [
      ["admin_dashboard:write", "dashboard"],
      ["admin_dashboard:write", "payments"],
      ["admin_dashboard:read", "test_support"],
      ["admin_dashboard:write", "abuse_flags"],
      ["admin_dashboard:delete", "orders"],
    ];

    for (const [action, resource] of deniedPairs) {
      // eslint-disable-next-line no-await-in-loop
      await expect(Promise.resolve(can(adminUser, action, resource))).resolves.toBe(false);
    }
  });

  it("denies unknown admin action/resource pairs safely", async () => {
    await expect(
      Promise.resolve(can(adminUser, "admin_dashboard:delete", "drops"))
    ).resolves.toBe(false);
    await expect(
      Promise.resolve(can(adminUser, "admin_dashboard:read", "unknown"))
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

  it("policy middleware allows migrated admin permissions for admins", async () => {
    const req = { user: adminUser };
    const res = createMockResponse();
    const next = jest.fn();

    await requirePolicy("admin_dashboard:write", "artists")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBeNull();
  });

  it("policy middleware denies migrated admin permissions for non-admin users", async () => {
    const req = { user: { role: "artist", id: "artist-1" } };
    const res = createMockResponse();
    const next = jest.fn();

    await requirePolicy("admin_dashboard:read", "orders")(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "forbidden" });
    expect(next).not.toHaveBeenCalled();
  });

  it("policy middleware denies unknown admin permissions without leaking policy internals", async () => {
    const req = { user: adminUser };
    const res = createMockResponse();
    const next = jest.fn();

    await requirePolicy("admin_dashboard:delete", "drops")(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "forbidden" });
    expect(next).not.toHaveBeenCalled();
  });

  it("policy middleware denies undeclared migrated admin pairs without leaking policy internals", async () => {
    const req = { user: adminUser };
    const res = createMockResponse();
    const next = jest.fn();

    await requirePolicy("admin_dashboard:write", "payments")(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "forbidden" });
    expect(next).not.toHaveBeenCalled();
  });
});
