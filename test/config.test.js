const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const CONFIG = path.join(__dirname, '..', 'src', 'config.js');

function loadConfig(overrides = {}) {
  const env = {
    PATH: process.env.PATH,
    NODE_ENV: 'staging',
    BOT_TOKEN: '123:abc',
    MONGO_URI: 'mongodb://127.0.0.1:27017/test',
    ADMIN_IDS: '11, 22 , ,33',
    WEBHOOK_SECRET: 's3cret',
    WEBHOOK_PATH: '/hook',
    ...overrides,
  };
  const script = `process.stdout.write(JSON.stringify(require(${JSON.stringify(CONFIG)})))`;
  const res = spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(res.stderr);
  return JSON.parse(res.stdout);
}

test('parses admin ids (trim, drop empties, coerce to numbers)', () => {
  assert.deepEqual(loadConfig().adminIds, [11, 22, 33]);
});

test('isProduction follows NODE_ENV', () => {
  assert.equal(loadConfig().isProduction, false);
  assert.equal(loadConfig({ NODE_ENV: 'production' }).isProduction, true);
});

test('webhook url has trailing slashes stripped', () => {
  assert.equal(loadConfig({ WEBHOOK_URL: 'https://x.app/' }).webhookUrl, 'https://x.app');
});

test('webhook url falls back to railway public domain', () => {
  const cfg = loadConfig({ RAILWAY_PUBLIC_DOMAIN: 'bot.up.railway.app' });
  assert.equal(cfg.webhookUrl, 'https://bot.up.railway.app');
});

test('port defaults to 3000', () => {
  assert.equal(loadConfig({ PORT: undefined }).port, 3000);
});

test('port is parsed from env', () => {
  assert.equal(loadConfig({ PORT: '8080' }).port, 8080);
});

test('webhook secret and path come from env', () => {
  const cfg = loadConfig();
  assert.equal(cfg.webhookSecret, 's3cret');
  assert.equal(cfg.webhookPath, '/hook');
});

test('channelUsername trims whitespace and strips leading @', () => {
  assert.equal(loadConfig({ CHANNEL_USERNAME: '  @BfssTamil  ' }).channelUsername, 'BfssTamil');
});

test('channelUsername falls back to the default when empty', () => {
  assert.equal(loadConfig({ CHANNEL_USERNAME: '' }).channelUsername, 'bfsstamil');
});

test('recheck hours are parsed from env', () => {
  const cfg = loadConfig({ CHANNEL_RECHECK_HOURS: '6' });
  assert.equal(cfg.channelRecheckHours, 6);
  assert.equal(cfg.channelRecheckMs, 6 * 60 * 60 * 1000);
});

test('recheck hours 0 disables the window (re-check everyone)', () => {
  const cfg = loadConfig({ CHANNEL_RECHECK_HOURS: '0' });
  assert.equal(cfg.channelRecheckHours, 0);
  assert.equal(cfg.channelRecheckMs, 0);
});

test('recheck hours fall back to 24 when invalid', () => {
  const cfg = loadConfig({ CHANNEL_RECHECK_HOURS: 'abc' });
  assert.equal(cfg.channelRecheckHours, 24);
  assert.equal(cfg.channelRecheckMs, 24 * 60 * 60 * 1000);
});