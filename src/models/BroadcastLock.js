const mongoose = require('mongoose');

const lockSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  locked: { type: Boolean, default: false },
  acquiredAt: { type: Date, default: null },
});

const Lock = mongoose.model('BroadcastLock', lockSchema);

const KEY = 'broadcast';
const STEAL_AFTER_MS = 10 * 60 * 1000;

async function ensureLock() {
  try {
    await Lock.updateOne(
      { key: KEY },
      { $setOnInsert: { locked: false, acquiredAt: null } },
      { upsert: true },
    );
  } catch (err) {
    if (err && err.code !== 11000) throw err;
  }
}

async function acquireBroadcastLock() {
  await ensureLock();
  const doc = await Lock.findOneAndUpdate(
    {
      key: KEY,
      $or: [
        { locked: { $ne: true } },
        { acquiredAt: { $lt: new Date(Date.now() - STEAL_AFTER_MS) } },
      ],
    },
    { $set: { locked: true, acquiredAt: new Date() } },
    { new: true },
  );
  return !!doc;
}

async function isBroadcasting() {
  const doc = await Lock.findOne({ key: KEY });
  if (!doc || !doc.locked) return false;
  if (doc.acquiredAt && Date.now() - doc.acquiredAt.getTime() > STEAL_AFTER_MS)
    return false;
  return true;
}

async function releaseBroadcastLock() {
  return Lock.updateOne({ key: KEY }, { $set: { locked: false, acquiredAt: null } });
}

module.exports = { acquireBroadcastLock, releaseBroadcastLock, isBroadcasting };