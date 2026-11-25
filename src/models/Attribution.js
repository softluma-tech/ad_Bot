const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  trackingId: { type: String, required: true, unique: true },
  capturedAt: { type: Date, required: true },
  attribution: { type: Map, of: String },
  fbp: String,
  fbc: String,
  landingUrl: String,
  source: String,
  isAutoRedirect: Boolean,
  clientUserAgent: String,
  clientIpAddress: String,
  telegramUserId: { type: Number, default: null },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Attribution', schema);
