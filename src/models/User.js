const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  username: { type: String, default: null },
  firstName: { type: String, default: '' },
  lastName: { type: String, default: '' },
  isBlocked: { type: Boolean, default: false },
  cid: { type: String, default: null },
  inChannel: { type: Boolean, default: null },
  channelCheckedAt: { type: Date, default: null },
  firstSeen: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now },
});

userSchema.index({ channelCheckedAt: 1 });
userSchema.index({ firstSeen: -1 });
userSchema.index({ lastSeen: -1 });

module.exports = mongoose.model('User', userSchema);