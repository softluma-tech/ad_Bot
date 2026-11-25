const mongoose = require('mongoose');

// Also records observed joins before /start, when no User document exists yet.
const schema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  joinedAt: { type: Date, required: true },
});
schema.index({ joinedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
module.exports = mongoose.model('ChannelJoin', schema);
