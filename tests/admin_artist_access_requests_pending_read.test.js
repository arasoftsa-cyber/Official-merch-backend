const assert = require("node:assert/strict");
const path = require("node:path");
const { describe, test } = require("node:test");

const ROUTE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/modules/artistAccessRequests/artistAccessRequests.admin.routes.js"
);

describe("admin pending requests response", () => {
  test("pending requests include requested_plan_type field", () => {
    const routeModule = require(ROUTE_MODULE_PATH);
    const { mapRow, ADMIN_REQUEST_LIST_COLUMNS } = routeModule.__test;

    assert.ok(ADMIN_REQUEST_LIST_COLUMNS.includes("requested_plan_type"));

    const mapped = mapRow({
      id: "r1",
      status: "pending",
      requested_plan_type: "advanced",
    });

    assert.equal(mapped.requested_plan_type, "advanced");
  });
});
