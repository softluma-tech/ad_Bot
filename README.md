# Ad Bot — Telegram Ad Bot (Telegraf + MongoDB)

Telegram bot that shows an ad (image + caption + inline buttons) to every user who starts it,
with a full admin panel: stats, content management and broadcasting.

## Features

- **User flow**: `/start` → admin gets a "new user" notification → bot sends image + text + inline buttons → 15s later: non-members get a reminder ("Public Session Start in 5 Minutes" + invite link), members are logged to the join-log channel (`JOIN_LOG_CHANNEL_ID`)
- **Admin panel** (`/admin`):
  - 📊 Stats — total / new / active / blocked users + content status
  - 🖼 Change image, 📝 Edit caption, 👁 Live preview of the ad
  - 🔗 Buttons management — add (text + link), edit, reorder (⬆️⬇️), enable/disable, delete (with confirmation)
  - 📢 Broadcast — all media types (photo, video, GIF, audio, voice, document, video note, sticker, text) with caption support, live progress and final report
  - ⛔ Broadcast (Not in Channel) — two-step: fresh channel check of **all** users, then broadcast only to those found outside the channel
- **Modes**: development (polling) and production (webhook) — Railway ready
- **Emoji**: premium emoji IDs are hardcoded inline in every message text via Telegram HTML (`<tg-emoji emoji-id="…">` + `<b>`, sent with `parse_mode: HTML`). Falls back to standard emojis without Premium (`src/bot/emoji.js`)
- **Reliability**: broadcast state is persisted in MongoDB (survives restarts), a DB-backed lock prevents double broadcasts across instances, and sends are globally paced with retry/backoff on Telegram 429 rate limits
- **Quality**: unit tests (`node --test`) and ESLint (`npm run lint`)

## Project structure

```
├── railway.json              # Railway config
├── package.json
├── eslint.config.js          # ESLint flat config
├── .env.example              # copy to .env for local dev
├── test/                     # unit tests (node --test)
└── src/
    ├── index.js              # entry — picks polling (dev) or webhook (prod)
    ├── config.js             # env config
    ├── db.js                 # MongoDB connection
    ├── models/               # User, Content (image + caption + buttons),
    │                         # Pending (persisted broadcast state),
    │                         # BroadcastLock (cross-instance broadcast lock)
    └── bot/
        ├── bot.js            # Telegraf instance, commands, state machine
        ├── helpers.js        # sendAd, admin notification, utils
        ├── state.js          # in-memory multi-step input state
        ├── throttle.js       # global send-pacing rate limiter
        ├── joinReminder.js   # 15s "join channel" nudge after /start
        ├── startMessage.js   # hardcoded /start caption + buttons
        ├── admin.js          # admin panel, stats, image, preview
        └── broadcast.js      # broadcast with progress + report
```

## Local development (development mode)

1. Install [Node.js](https://nodejs.org) ≥ 18 and MongoDB (local or [MongoDB Atlas](https://www.mongodb.com/atlas)).
2. Create a bot with [@BotFather](https://t.me/BotFather) and copy the token.
3. Get your Telegram user ID (e.g. [@userinfobot](https://t.me/userinfobot)).
4. Setup:

```bash
cp .env.example .env   # then edit .env
npm install
```

`.env`:

```
BOT_TOKEN=123456:ABC...
NODE_ENV=development
ADMIN_IDS=123456789,987654321
MONGO_URI=mongodb://127.0.0.1:27017/adbot
```

5. Run:

```bash
npm start
```

In development the bot uses **polling** — no public URL needed.

### Tests & Lint

```bash
npm test        # run unit tests (node --test)
npm run lint    # check code with ESLint
```

## Production on Railway

1. Push this project to a GitHub repo and create a new Railway project from it.
2. Add a **MongoDB** plugin (Railway → New → Database → MongoDB) and copy its connection string.
3. Add env variables (Project → Variables):

| Variable       | Value                                                                 |
| -------------- | --------------------------------------------------------------------- |
| `BOT_TOKEN`    | token from @BotFather                                                  |
| `NODE_ENV`     | `production`                                                           |
| `ADMIN_IDS`    | your Telegram user IDs, comma separated                                |
| `MONGO_URI`    | MongoDB connection string (from Railway or Atlas)                      |
| `WEBHOOK_URL`  | optional — auto-detected from `RAILWAY_PUBLIC_DOMAIN`, e.g. `https://mybot.up.railway.app` |
| `WEBHOOK_SECRET` | optional — random string for webhook security                        |

4. Deploy. In production the bot runs an HTTP server (webhook mode, `POST /webhook` + `/health` for Railway health checks) and registers the webhook with Telegram on every start.

> **Note**: `NODE_ENV` must be exactly `production` for webhook mode.
> Without it (or without a public domain) the bot falls back to polling.

## Emoji

Premium emoji IDs are hardcoded directly in the message text using Telegram's HTML parse mode. Format:

```html
<tg-emoji emoji-id="5935933089866846598">👑</tg-emoji> <b>BFSS VIP SIGNAL</b>
```

- The `emoji-id` is the custom emoji ID from the pack (real IDs are mapped by name in `src/bot/emoji.js`, e.g. `${EMOJIS.crown}`).
- The character inside the tag (`👑`) is the fallback shown when premium emoji aren't available.
- Requirements: the bot owner needs a Telegram Premium subscription (Bot API 9.4+) or a Fragment username assigned to the bot. Otherwise the standard emoji characters are shown instead — the bot keeps working.
- All messages are sent with `parse_mode: "HTML"`; on a Telegram 400 error the bot strips the tags and resends as plain text, so nothing breaks.

## Usage

- **Users**: send `/start` → see the ad (image + text + buttons).
- **Admins**: send `/admin` to open the panel.

Admin panel:

```
🎛 Admin Panel
🖇 Image: ✅ set
💬 Caption: hardcoded
🔗 Buttons: 2 (hardcoded)

[📊 Stats] [📊 Report]
[📅 Day Report]
[🖇 Change Image] [👥 Channel Members]
[🗣 Broadcast] [⛔ Broadcast (Not in Channel)]
[👁 Preview Ad] [❌ Close]
```

- **Change image**: tap the button, then send a photo to the bot.
- **Caption & buttons**: hardcoded in `src/bot/startMessage.js` (`START_CAPTION` + `START_BUTTONS`) — edit there, no admin UI.
- **Broadcast**: tap the button, send any media (with optional caption) or text, confirm — the bot sends it to all users and reports ✅ sent / 🚫 blocked / ❌ failed.
- **Broadcast (Not in Channel)**: tap the button — the bot first re-checks **every** user against the channel (background, live progress, `/cancel` works). When the check finishes it shows how many users are not in the channel and asks for the media/text; the broadcast then goes **only** to those non-members. Requires the bot to be a channel admin with *Read channel members* permission.
- **Stats**: total users, new 24h/7d, active 24h, blocked, content status.
- Use `/cancel` at any time to abort an ongoing action.

## Environment variables

| Variable       | Required | Default | Description                                  |
| -------------- | -------- | ------- | -------------------------------------------- |
| `BOT_TOKEN`    | yes      | —       | Telegram bot token                           |
| `MONGO_URI`    | yes      | —       | MongoDB connection string                    |
| `ADMIN_IDS`    | yes      | —       | Comma-separated admin Telegram IDs           |
| `NODE_ENV`     | no       | development | `production` enables webhook mode         |
| `WEBHOOK_URL`  | no       | auto    | Public URL (falls back to `RAILWAY_PUBLIC_DOMAIN`) |
| `WEBHOOK_PATH` | no       | /webhook| Webhook path                                  |
| `WEBHOOK_SECRET`| no      | —       | Webhook secret token                         |
| `PORT`         | no       | 3000    | HTTP port (Railway sets this automatically)  |
| `JOIN_LOG_CHANNEL_ID` | no | -1003902452318 | Channel that receives "user joined" logs (bot must be admin there) |