const MAX_FLAGS = 200;

const flags = [];

const recordFlag = ({ type, key, reason, metadata }) => {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    key,
    reason,
    metadata: metadata || null,
    timestamp: new Date().toISOString(),
  };
  flags.push(entry);
  if (flags.length > MAX_FLAGS) {
    flags.shift();
  }
  return entry;
};

const listFlags = () => [...flags].reverse();

module.exports = { recordFlag, listFlags };
