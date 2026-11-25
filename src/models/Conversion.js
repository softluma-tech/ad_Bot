const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  attributionId: { type: String, required: true },
  eventId: { type: String, required: true, unique: true },
  joinedAt: { type: Date, required: true },
  status: { type: String, enum: ['pending', 'sending', 'sent', 'expired'], default: 'pending' },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  lockedUntil: { type: Date, default: () => new Date(0) },
  leaseToken: String,
  sentAt: Date,
  lastError: String,
});
schema.index({ status: 1, nextAttemptAt: 1, lockedUntil: 1 });
module.exports = mongoose.model('Conversion', schema);
