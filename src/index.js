const config = require("./config");
const { connectDB } = require("./db");
const bot = require("./bot/bot");
const Attribution = require('./models/Attribution');
const ChannelJoin = require('./models/ChannelJoin');
const Conversion = require('./models/Conversion');
const User = require('./models/User');
const { createAttributionRouter } = require('./tracking/attribution');
const { startTrackingWorker } = require('./tracking');
const { isUserInChannel } = require('./bot/helpers');
const { getMetaSettings } = require('./models/MetaSettings');

let stopTracking = () => {};
let server;

async function main() {
  if (!config.botToken)
    throw new Error(
      "BOT_TOKEN is required (set it in .env or Railway env vars)",
    );
  if (!config.adminIds.length)
    console.warn(
      "[warn] ADMIN_IDS is empty — /admin panel will not work for anyone",
    );

  await connectDB();
  // Unique indexes underpin reference ownership and conversion deduplication.
  await Promise.all([Attribution.init(), ChannelJoin.init(), Conversion.init(), User.init()]);
  console.log(`[app] mode: ${config.env}`);
  console.log(`[app] admins: ${config.adminIds.join(", ") || "(none)"}`);

  const useWebhook = config.isProduction && config.webhookUrl;

  if (useWebhook || config.attributionSecret) {
    const express = require("express");
    const app = express();
    app.get("/", (_req, res) => res.type("text").send("☑️ Ad Bot is running"));
    app.get("/health", (_req, res) => res.json({ ok: true }));
    app.use('/api/attribution', createAttributionRouter({ Attribution, secret: config.attributionSecret }));
    if (useWebhook) app.use(
      bot.webhookCallback(
        config.webhookPath,
        config.webhookSecret ? { secretToken: config.webhookSecret } : {},
      ),
    );
    server = app.listen(config.port, () =>
      console.log(`[webhook] listening on port ${config.port}`),
    );

  }

  const allowedUpdates = ['message', 'callback_query', 'chat_member'];
  stopTracking = startTrackingWorker(bot.telegram, isUserInChannel);
  const meta = await getMetaSettings();
  if (!meta.metaPixelId || !meta.metaAccessToken) {
    console.warn('[tracking] Configure Pixel ID and CAPI token in /admin → Meta Tracking to enable delivery');
  }
  if (useWebhook) {
    await bot.telegram.setWebhook(`${config.webhookUrl}${config.webhookPath}`, {
      secret_token: config.webhookSecret || undefined,
      allowed_updates: allowedUpdates,
    });
    console.log(
      `[bot] webhook set → ${config.webhookUrl}${config.webhookPath}`,
    );
  } else {
    await bot.telegram.deleteWebhook().catch(() => {});
    await bot.launch({ allowedUpdates });
    console.log("[bot] polling started (development mode)");
  }
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});

async function shutdown(signal) {
  console.log(`[app] ${signal} received, shutting down…`);
  stopTracking();
  if (server) server.close();
  try {
    await bot.stop(signal);
  } catch {}
  try {
    await require("mongoose").disconnect();
  } catch {}
  process.exit(0);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
