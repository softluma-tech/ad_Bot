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
  channelUsername: (process.env.CHANNEL_USERNAME || 'bfsstamil').trim().replace(/^@+/, ''),
  channelInvite: process.env.CHANNEL_INVITE || 'https://t.me/+7RP9Zro49OA4M2Rl',
  joinLogChannelId: Number(process.env.JOIN_LOG_CHANNEL_ID) || -1003902452318,
  channelCheckIntervalMs: Number(process.env.CHANNEL_CHECK_INTERVAL_MS) || 400,
  channelScanMaxMs: Number(process.env.CHANNEL_SCAN_MAX_MS) || 0,
};

{
  const hours = Number(process.env.CHANNEL_RECHECK_HOURS);
  config.channelRecheckHours =
    Number.isFinite(hours) && hours >= 0 ? hours : 24;
  config.channelRecheckMs = config.channelRecheckHours * 60 * 60 * 1000;
}

module.exports = config;