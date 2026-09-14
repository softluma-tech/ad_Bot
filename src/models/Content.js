const mongoose = require('mongoose');

const contentSchema = new mongoose.Schema({
  key: { type: String, default: 'default', unique: true },
  imageFileId: { type: String, default: '' },
});

const Content = mongoose.model('Content', contentSchema);

async function getContent() {
  let content = await Content.findOne({ key: 'default' });
  if (!content) content = await Content.create({ key: 'default' });
  return content;
}

module.exports = Content;
module.exports.getContent = getContent;