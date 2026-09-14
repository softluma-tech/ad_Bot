const TTL_DEFAULT = 30 * 60 * 1000;
const states = new Map();

const setState = (chatId, value, ttlMs = TTL_DEFAULT) =>
  states.set(chatId, { value, expiresAt: Date.now() + ttlMs });
const getState = (chatId) => {
  const entry = states.get(chatId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    states.delete(chatId);
    return null;
  }
  return entry.value;
};
const clearState = (chatId) => states.delete(chatId);

module.exports = { setState, getState, clearState };