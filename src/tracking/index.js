const config = require('../config');
const User = require('../models/User');
const Attribution = require('../models/Attribution');
const ChannelJoin = require('../models/ChannelJoin');
const Conversion = require('../models/Conversion');
const { createSubscriptionService } = require('./subscriptions');
const { createDeliveryService } = require('./delivery');
const { getMetaSettings } = require('../models/MetaSettings');

const subscriptions = createSubscriptionService({ User, Attribution, ChannelJoin, Conversion, config });
const delivery = createDeliveryService({ Conversion, Attribution, config, getSettings: getMetaSettings });

// Tracking errors must not interrupt the bot's existing user flow.
async function safelyObserve(userId, result) {
  try { await subscriptions.observeMembership(userId, result); }
  catch (err) { console.error('[tracking] membership persistence failed:', err.name); }
}

function startTrackingWorker(telegram, checkMembership) {
  let stopped = false;
  let timer;
  async function run() {
    try {
      // Recover checks/queue creation after process restarts, including failed
      // first checks. Existing users and known existing members are excluded.
      const users = await User.find({
        acquisitionEligible: true, trackingInitialized: true, attributionId: { $ne: null }, subscriptionQueued: { $ne: true },
        $and: [
          { $or: [{ initialMembership: { $ne: 'existing' } }, { subscriptionJoinedAt: { $ne: null } }] },
          { $or: [{ channelCheckedAt: null }, { channelCheckedAt: { $lt: new Date(Date.now() - 60000) } }] },
        ],
      }).sort({ channelCheckedAt: 1 }).limit(10);
      for (const user of users) {
        if (stopped) break;
        if (user.subscriptionJoinedAt) {
          await subscriptions.queue(user);
          await User.updateOne({ userId: user.userId }, { $set: { channelCheckedAt: new Date() } });
        } else {
          await safelyObserve(user.userId, await checkMembership(telegram, user.userId, { quiet: true }));
        }
        await new Promise((resolve) => setTimeout(resolve, config.channelCheckIntervalMs));
      }
      for (let i = 0; i < 20 && !stopped; i++) {
        if (!await delivery.deliverOne()) break;
      }
    } catch (err) {
      console.error('[tracking] worker failed:', err.name);
    }
    if (!stopped) { timer = setTimeout(run, 15000); timer.unref(); }
  }
  timer = setTimeout(run, 1000);
  timer.unref();
  return () => { stopped = true; clearTimeout(timer); };
}

module.exports = { ...subscriptions, safelyObserve, startTrackingWorker };
