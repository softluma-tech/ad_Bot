const mongoose = require('mongoose');
const config = require('./config');

async function connectDB() {
  if (!config.mongoUri) throw new Error('MONGO_URI is required (set it in .env or Railway env vars)');
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
  console.log(`[db] connected (${config.env} mode)`);
}


module.exports = { connectDB };
