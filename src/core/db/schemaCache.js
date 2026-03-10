const tableExistsCache = new Map();
const tableColumnsCache = new Map();

const getCacheKey = (tableName) => String(tableName || "").trim().toLowerCase();

const getCachedPromise = (cache, key, producer) => {
  if (!key) return Promise.resolve(null);
  if (!cache.has(key)) {
    cache.set(
      key,
      Promise.resolve()
        .then(producer)
        .catch((error) => {
          cache.delete(key);
          throw error;
        })
    );
  }
  return cache.get(key);
};

const hasTableCached = async (db, tableName) => {
  const cacheKey = getCacheKey(tableName);
  if (!cacheKey) return false;
  return Boolean(
    await getCachedPromise(tableExistsCache, cacheKey, () => db.schema.hasTable(tableName))
  );
};

const getTableColumns = async (db, tableName) => {
  const cacheKey = getCacheKey(tableName);
  if (!cacheKey) return {};
  return (
    (await getCachedPromise(tableColumnsCache, cacheKey, () =>
      db(tableName)
        .columnInfo()
        .catch(() => ({}))
    )) || {}
  );
};

const hasColumnCached = async (db, tableName, columnName) => {
  const columns = await getTableColumns(db, tableName);
  return Boolean(
    columns &&
      Object.prototype.hasOwnProperty.call(columns, String(columnName || "").trim())
  );
};

const clearSchemaCacheForTests = () => {
  tableExistsCache.clear();
  tableColumnsCache.clear();
};

module.exports = {
  hasTableCached,
  getTableColumns,
  hasColumnCached,
  __clearSchemaCacheForTests: clearSchemaCacheForTests,
};
