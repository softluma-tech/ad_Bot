const mongoose = require('mongoose');

const DEFAULT_VIP_URL = 'https://t.me/Bfssfreevipbot';

const contentSchema = new mongoose.Schema({
  key: { type: String, default: 'default', unique: true },
  imageFileId: { type: String, default: '' },
  voiceFileId: { type: String, default: '' },
  vipUrl: { type: String, default: DEFAULT_VIP_URL },
});

const Content = mongoose.model('Content', contentSchema);

async function getContent() {
  let content = await Content.findOne({ key: 'default' });
  if (!content) content = await Content.create({ key: 'default' });
  return content;
}

module.exports = Content;
module.exports.getContent = getContent;
module.exports.DEFAULT_VIP_URL = DEFAULT_VIP_URL;