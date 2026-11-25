const { createHash } = require('node:crypto');

function isMember(member) {
  return ['member', 'administrator', 'creator'].includes(member?.status) ||
    (member?.status === 'restricted' && member.is_member === true);
}

function isTargetChannel(chat, config) {
  if (config.channelId) return String(chat?.id) === String(config.channelId);
  return Boolean(chat?.username && config.channelUsername &&
    chat.username.toLowerCase() === config.channelUsername.toLowerCase());
}

function canConfirmJoin(user, observation, attribution) {
  if (!user?.acquisitionEligible) return false;
  if (user.initialMembership === 'outside') return true;
  // An already-member first start is eligible only with an observed join after
  // the website handoff. A first membership check by itself is never enough.
  const seconds = (date) => Math.floor(new Date(date).getTime() / 1000);
  return Boolean(observation && attribution &&
    seconds(observation.joinedAt) >= seconds(attribution.capturedAt) &&
    (user.initialMembership !== 'existing' || (user.initialMembershipCheckedAt &&
      seconds(observation.joinedAt) <= seconds(user.initialMembershipCheckedAt))));
}

function createSubscriptionService({ User, Attribution, ChannelJoin, Conversion, config }) {
  async function bindAttribution(userId, startPayload) {
    const match = /^ref_([A-Za-z0-9_-]{1,60})$/.exec(startPayload || '');
    if (!match) return null;
    const user = await User.findOne({ userId });
    // A later ad click must not turn an existing bot user into a new acquisition.
    if (!user?.acquisitionEligible || user.firstStartPayload !== startPayload) return null;
    const record = await Attribution.findOneAndUpdate({
      trackingId: match[1],
      $or: [{ telegramUserId: null }, { telegramUserId: userId }],
    }, { $set: { telegramUserId: userId } }, { new: true });
    if (!record) return null;
    // Preserve the first bound visit so later campaigns cannot overwrite a join.
    await User.updateOne({ userId, attributionId: null }, { $set: { attributionId: record.trackingId } });
    const campaign = record.attribution?.get ? record.attribution.get('cid') : record.attribution?.cid;
    return campaign || null;
  }

  async function queue(user) {
    if (!user.acquisitionEligible || !user.subscriptionJoinedAt || !user.attributionId) return;
    const attribution = await Attribution.findOne({ trackingId: user.attributionId, telegramUserId: user.userId });
    if (!attribution || Math.floor(new Date(attribution.capturedAt).getTime() / 1000) > Math.floor(new Date(user.subscriptionJoinedAt).getTime() / 1000)) return;
    const eventId = createHash('sha256').update(`Subscribe:${config.channelId || config.channelUsername}:${user.userId}`).digest('hex');
    await Conversion.updateOne({ userId: user.userId }, { $setOnInsert: {
      userId: user.userId, attributionId: user.attributionId, eventId,
      joinedAt: user.subscriptionJoinedAt,
    } }, { upsert: true });
    await User.updateOne({ userId: user.userId }, { $set: { subscriptionQueued: true } });
  }

  async function observeMembership(userId, result, checkedAt = new Date()) {
    if (!result.ok) {
      await User.updateOne({ userId, acquisitionEligible: true }, { $set: { channelCheckedAt: checkedAt } });
      return;
    }
    let user = await User.findOne({ userId });
    if (!user?.acquisitionEligible) return;
    if (user.subscriptionJoinedAt) return queue(user);
    if (!result.isInChannel) {
      await User.updateOne({ userId, initialMembership: 'unknown' }, { $set: { initialMembership: 'outside', initialMembershipCheckedAt: checkedAt } });
      await User.updateOne({ userId }, { $set: { inChannel: false, channelCheckedAt: checkedAt } });
      return;
    }
    const observation = await ChannelJoin.findOne({ userId });
    const attribution = user.attributionId ? await Attribution.findOne({ trackingId: user.attributionId }) : null;
    if (!canConfirmJoin(user, observation, attribution)) {
      await User.updateOne({ userId, initialMembership: 'unknown' }, { $set: { initialMembership: 'existing', initialMembershipCheckedAt: checkedAt, inChannel: true, channelCheckedAt: checkedAt } });
      return;
    }
    const observedAt = observation && (!attribution || Math.floor(new Date(observation.joinedAt).getTime() / 1000) >= Math.floor(new Date(attribution.capturedAt).getTime() / 1000))
      ? observation.joinedAt : checkedAt;
    user = await User.findOneAndUpdate({ userId, subscriptionJoinedAt: null }, {
      $set: { subscriptionJoinedAt: observedAt, inChannel: true, channelCheckedAt: checkedAt },
    }, { new: true });
    if (user) await queue(user);
  }

  async function handleChatMember(update) {
    if (!isTargetChannel(update.chat, config) || isMember(update.old_chat_member) || !isMember(update.new_chat_member)) return;
    const userId = update.new_chat_member.user.id;
    const joinedAt = new Date(update.date * 1000);
    // Telegram dates have second precision; preserve ordering against millisecond captures.
    await ChannelJoin.updateOne({ userId }, { $max: { joinedAt } }, { upsert: true });
    const user = await User.findOne({ userId });
    if (!user?.trackingInitialized) return;
    await observeMembership(userId, { ok: true, isInChannel: true }, joinedAt);
  }

  return { bindAttribution, observeMembership, handleChatMember, queue };
}

module.exports = { isMember, isTargetChannel, canConfirmJoin, createSubscriptionService };
