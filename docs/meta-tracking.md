# Landing → Telegram → Meta Subscribe

## Setup

1. Set `BOT_ATTRIBUTION_SECRET` on the bot deployment to a long random value.
2. Set these server variables on the landing deployment:

   ```dotenv
   BOT_ATTRIBUTION_URL=https://your-bot-host/api/attribution
   BOT_ATTRIBUTION_SECRET=the-same-shared-secret
   NEXT_PUBLIC_TELEGRAM_URL=https://t.me/YourBotUsername
   ```

3. Set the target channel's numeric `CHANNEL_ID` on the bot, especially for a
   private channel. Without it, updates are matched against `CHANNEL_USERNAME`.
   Make the bot an administrator of the target channel so Telegram delivers
   `chat_member` updates. Existing membership checks use `CHANNEL_ID` when set.
4. In a **private chat**, open `/admin` → **📈 Meta Tracking**:
   - **Set Pixel ID**: the same Pixel/dataset ID as the landing page's
     `NEXT_PUBLIC_META_PIXEL_ID`.
   - **Set CAPI Token**: the Conversions API access token from Meta Events Manager.
   - **Test Event Code**: optional code for Meta Test Events; send `OFF` for live events.
   - **Pause Delivery / Enable Delivery**: controls sending; pending events remain stored.

Pixel ID, token, test code and pause state are saved in the `metasettings` MongoDB
collection. Admin settings override optional `META_PIXEL_ID`, `META_ACCESS_TOKEN`
and `META_TEST_EVENT_CODE` environment fallbacks. Changes are picked up by the
worker without a restart. The token is excluded from ordinary model queries,
never displayed in the panel, and the bot attempts to delete the token input
message. The token is stored as a server-side database secret, not in a public URL.

`META_API_VERSION` defaults to `v25.0` and remains an environment setting.
The CAPI token and attribution shared secret serve different purposes.

## Database flow

- `POST /api/attribution` authenticates `Authorization: Bearer <shared-secret>`,
  validates a bounded JSON body and saves an `Attribution` record. It returns
  `{ "tracking_id": "..." }` only after storage succeeds. Its contract matches
  the landing project's `docs/bot-attribution.md`.
- The landing opens `?start=ref_<tracking-id>`.
- The first `/start` atomically inserts a User. Only non-admin users whose first
  Start contains a tracking reference are acquisition candidates. Legacy users,
  users first seen through organic/legacy links, and subsequent ad visits do not
  become new acquisitions. Legacy `cid` links continue to work for reporting.
- The reference is claimed by one Telegram user only. The original `cid` is
  stored separately; the reference is not used as a campaign label.
- The bot stores the first successful membership result. Failed checks leave
  membership unknown rather than treating the user as outside the channel.
- Channel join transitions are also recorded before Start in `channeljoins`.
  These observations expire after 30 days. Telegram transition times have second
  precision, so ordering against attribution timestamps is compared by second.

## Subscribe eligibility

| Situation | Subscribe |
| --- | --- |
| User already existed before this tracking flow | Never |
| Existing bot user clicks a new ad/reference | Never |
| New attributed bot user is confirmed outside, then verified inside | Once |
| New attributed user is already a member at first check, with no observed new join | No |
| Observed join after website capture and at/before first member check, even if Start happens later | Once |
| Already-member user leaves and rejoins after first membership check | No |
| Failed/unverifiable membership check | No; retry verification |
| Repeated starts, repeated checks, duplicate updates, later rejoins | No additional event |

An existing-member first check can be reconciled by a delayed Telegram update
only when its timestamp proves the join happened after attribution and before
that check. The bot cannot reconstruct historical joins that Telegram did not
deliver. It conservatively excludes unproven joins.

Membership is observed on Start, the 15-second reminder, Get Free Signal, admin
channel scans, and `chat_member` updates. A bounded background worker rechecks
eligible pending users and recovers queued delivery after restarts.

## Delivery and deduplication

Confirmed joins create a durable `conversions` outbox record unique per Telegram
user. Meta receives standard `Subscribe`, `action_source: chat`, the confirmed
join time, a stable event ID, available original `fbp`/`fbc`, browser context,
and a SHA-256 hashed external identifier. Raw Telegram IDs and tokens are not
included in event parameters. The browser itself never sends `Subscribe`.

The worker uses conditional MongoDB leases to prevent concurrent sends across
instances. A response must acknowledge `events_received` before the record is
marked sent. Failures use bounded exponential backoff and the same event ID/time.
An expired lease can be recovered after a process crash. Events older than Meta's
seven-day event-age limit are marked `expired` instead of changing the event time.

Pending events wait when credentials are missing or delivery is paused. Test-mode
events are also acknowledged as sent: use test users for verification, then turn
test mode off before acquiring real users. Switching modes does not replay events
already acknowledged by Meta.

The collections and unique indexes are initialized on startup. No migration marks
old users eligible. Keep the existing User database when deploying; deleting it
would remove the history used to distinguish returning users.

## Verification

Run `npm test` and `npm run lint`.

For deployment verification, use Meta Test Events with a new Telegram test user:

1. Open the landing page through a tagged ad/test link and click Telegram.
2. Confirm a stored attribution record and `ref_...` start parameter.
3. Press Start while outside the target channel, then join.
4. Confirm one `Subscribe` in Meta Test Events and one `sent` outbox record.
5. Repeat Start and membership checks; verify no extra subscription is queued.
6. Verify an existing bot user and an unproven existing channel member are excluded.

Local polling can serve `/api/attribution` too: setting the shared secret starts
the HTTP server on `PORT` (default 3000), while Telegram continues to use polling.
Production registers `message`, `callback_query`, and `chat_member` webhook updates.
