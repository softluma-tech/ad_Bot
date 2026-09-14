const config = require("./config");
const { connectDB } = require("./db");
const bot = require("./bot/bot");

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
  console.log(`[app] mode: ${config.env}`);
  console.log(`[app] admins: ${config.adminIds.join(", ") || "(none)"}`);

  const useWebhook = config.isProduction && config.webhookUrl;

  if (useWebhook) {
    const express = require("express");
    const app = express();
    app.get("/", (_req, res) => res.type("text").send("☑️ Ad Bot is running"));
    app.get("/health", (_req, res) => res.json({ ok: true }));
    app.use(
      bot.webhookCallback(
        config.webhookPath,
        config.webhookSecret ? { secretToken: config.webhookSecret } : {},
      ),
    );
    app.listen(config.port, () =>
      console.log(`[webhook] listening on port ${config.port}`),
    );

    await bot.telegram.setWebhook(`${config.webhookUrl}${config.webhookPath}`, {
      secret_token: config.webhookSecret || undefined,
      allowed_updates: ["message", "callback_query"],
    });
    console.log(
      `[bot] webhook set → ${config.webhookUrl}${config.webhookPath}`,
    );
  } else {
    await bot.telegram.deleteWebhook().catch(() => {});
    await bot.launch();
    console.log("[bot] polling started (development mode)");
  }
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});

async function shutdown(signal) {
  console.log(`[app] ${signal} received, shutting down…`);
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
