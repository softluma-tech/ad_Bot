const mongoose = require('mongoose');
const config = require('../config');

const schema = new mongoose.Schema({
  _id: { type: String, default: 'meta' },
  pixelId: String,
  accessToken: { type: String, select: false },
  testEventCode: String,
  enabled: { type: Boolean, default: true },
  updatedBy: Number,
}, { timestamps: true });

const MetaSettings = mongoose.model('MetaSettings', schema);

async function getMetaSettings() {
  const saved = await MetaSettings.findById('meta').select('+accessToken').lean();
  return {
    metaPixelId: saved?.pixelId ?? config.metaPixelId,
    metaAccessToken: saved?.accessToken ?? config.metaAccessToken,
    metaTestEventCode: saved?.testEventCode ?? config.metaTestEventCode,
    enabled: saved?.enabled !== false,
  };
}

async function saveMetaSettings(values, adminId) {
  await MetaSettings.updateOne({ _id: 'meta' }, {
    $set: { ...values, updatedBy: adminId },
  }, { upsert: true, runValidators: true });
}

module.exports = { MetaSettings, getMetaSettings, saveMetaSettings };
