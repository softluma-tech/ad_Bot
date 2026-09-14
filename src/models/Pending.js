const mongoose = require('mongoose');

const pendingSchema = new mongoose.Schema({
  chatId: { type: Number, required: true, unique: true },
  action: { type: String, required: true },
  payload: mongoose.Schema.Types.Mixed,
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
});

const Pending = mongoose.model('Pending', pendingSchema);

const TTL_MS = 30 * 60 * 1000;

function setPending(chatId, action, payload, ttlMs = TTL_MS) {
  return Pending.updateOne(
    { chatId },
    { $set: { action, payload, expiresAt: new Date(Date.now() + ttlMs) } },
    { upsert: true },
  );
}

async function getPending(chatId) {
  const doc = await Pending.findOne({ chatId, expiresAt: { $gt: new Date() } });
  if (!doc) return null;
  return { action: doc.action, payload: doc.payload };
}

function clearPending(chatId) {
  return Pending.deleteOne({ chatId });
}

module.exports = { setPending, getPending, clearPending };
module.exports.Pending = Pending;