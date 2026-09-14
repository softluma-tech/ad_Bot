require('dotenv').config();

const env = process.env.NODE_ENV || 'development';
const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN || '';

const config = {
  env,
  isProduction: env === 'production',
  botToken: process.env.BOT_TOKEN,
  mongoUri: process.env.MONGO_URI,
  adminIds: (process.env.ADMIN_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .map(Number),
  webhookUrl: (process.env.WEBHOOK_URL || (railwayDomain ? `https://${railwayDomain}` : '')).replace(/\/+$/, ''),
  webhookPath: process.env.WEBHOOK_PATH || '/webhook',
  webhookSecret: process.env.WEBHOOK_SECRET || '',
  port: Number(process.env.PORT) || 3000,
  channelUsername: process.env.CHANNEL_USERNAME || 'bfsstamil',
};

module.exports = config;