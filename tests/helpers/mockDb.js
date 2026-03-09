"use strict";

const createMockQueryBuilder = () => ({
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  join: jest.fn().mockReturnThis(),
  leftJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  whereIn: jest.fn().mockReturnThis(),
  whereRaw: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderByRaw: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  count: jest.fn().mockReturnThis(),
  sum: jest.fn().mockReturnThis(),
  pluck: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  first: jest.fn(),
  insert: jest.fn().mockReturnThis(),
  returning: jest.fn(),
  raw: jest.fn(),
  clone: jest.fn().mockReturnThis(),
  toSQL: jest.fn().mockReturnThis(),
  toNative: jest.fn().mockReturnValue({ sql: "", bindings: [] }),
  columnInfo: jest.fn().mockResolvedValue({
    about_me: {},
    message_for_fans: {},
    about: {},
    contact_email: {},
    contact_phone: {},
    pitch: {},
    status: {},
    requested_plan_type: {},
    created_at: {},
    updated_at: {},
    profile_photo_path: {},
    profile_photo_url: {},
    id: {},
    handle: {},
    email: {},
  }),
  then: jest.fn(function (resolve) {
    const result = this._mockResolveValue === undefined ? [] : this._mockResolveValue;
    resolve(result);
  }),
  _mockResolveValue: undefined,
});

const setupMockDb = (getDbMock, queryBuilder = createMockQueryBuilder()) => {
  const mockDb = jest.fn(() => queryBuilder);
  mockDb.fn = { now: jest.fn() };
  mockDb.raw = jest.fn();
  mockDb.schema = { hasTable: jest.fn().mockResolvedValue(true) };
  mockDb.transaction = jest.fn(async (callback) => callback(mockDb));
  getDbMock.mockReturnValue(mockDb);
  return { mockDb, mockQueryBuilder: queryBuilder };
};

module.exports = {
  createMockQueryBuilder,
  setupMockDb,
};
