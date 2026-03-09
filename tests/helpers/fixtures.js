"use strict";

const withDefaults = (base, overrides = {}) => ({
  ...base,
  ...overrides,
  password_hash: overrides.password_hash || base.password_hash || "hash",
});

const buildAdminFixture = (overrides = {}) =>
  withDefaults(
    {
      id: "admin-id",
      email: "admin@example.com",
      role: "admin",
      password_hash: "hash",
    },
    overrides
  );

const buildBuyerFixture = (overrides = {}) =>
  withDefaults(
    {
      id: "buyer-id",
      email: "buyer@example.com",
      role: "buyer",
      password_hash: "hash",
    },
    overrides
  );

const buildLabelFixture = (overrides = {}) =>
  withDefaults(
    {
      id: "label-id",
      email: "label@example.com",
      role: "label",
      password_hash: "hash",
    },
    overrides
  );

const buildRequesterFixture = (overrides = {}) =>
  withDefaults(
    {
      id: "requester-id",
      email: "requester@example.com",
      role: "fan",
      password_hash: "hash",
    },
    overrides
  );

const credentialsFor = (fixture, password = "password") => ({
  email: fixture?.email,
  password,
});

module.exports = {
  buildAdminFixture,
  buildBuyerFixture,
  buildLabelFixture,
  buildRequesterFixture,
  credentialsFor,
};
