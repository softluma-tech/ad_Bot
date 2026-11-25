const { createHash, randomUUID } = require('node:crypto');

function buildMetaEvent(conversion, attribution, channel) {
  const userData = {
    external_id: [createHash('sha256').update(`telegram:${channel}:${conversion.userId}`).digest('hex')],
  };
  if (attribution.fbp) userData.fbp = attribution.fbp;
  if (attribution.fbc) userData.fbc = attribution.fbc;
  if (attribution.clientIpAddress) userData.client_ip_address = attribution.clientIpAddress;
  if (attribution.clientUserAgent) userData.client_user_agent = attribution.clientUserAgent;
  return {
    event_name: 'Subscribe',
    event_id: conversion.eventId,
    event_time: Math.floor(new Date(conversion.joinedAt).getTime() / 1000),
    action_source: 'chat',
    user_data: userData,
    custom_data: { content_name: 'Telegram Channel Join', content_category: channel },
  };
}

function createDeliveryService({ Conversion, Attribution, config, fetch = globalThis.fetch, getSettings = async () => config }) {
  async function deliverOne(now = new Date()) {
    const settings = await getSettings();
    if (settings.enabled === false || !settings.metaPixelId || !settings.metaAccessToken) return false;
    const leaseToken = randomUUID();
    const conversion = await Conversion.findOneAndUpdate({
      status: { $in: ['pending', 'sending'] }, nextAttemptAt: { $lte: now }, lockedUntil: { $lte: now },
    }, {
      $set: { status: 'sending', leaseToken, lockedUntil: new Date(now.getTime() + 60000) },
      $inc: { attempts: 1 },
    }, { new: true, sort: { nextAttemptAt: 1 } });
    if (!conversion) return false;
    const filter = { _id: conversion._id, leaseToken };
    if (now.getTime() - new Date(conversion.joinedAt).getTime() >= 7 * 86400000) {
      await Conversion.updateOne(filter, { $set: { status: 'expired', lastError: 'event older than Meta 7-day limit' } });
      return true;
    }
    try {
      const attribution = await Attribution.findOne({ trackingId: conversion.attributionId, telegramUserId: conversion.userId });
      if (!attribution) throw new Error('attribution unavailable');
      const body = { data: [buildMetaEvent(conversion, attribution, config.channelId || config.channelUsername)] };
      if (settings.metaTestEventCode) body.test_event_code = settings.metaTestEventCode;
      const response = await fetch(`https://graph.facebook.com/${config.metaApiVersion}/${encodeURIComponent(settings.metaPixelId)}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.metaAccessToken}` },
        body: JSON.stringify(body), signal: globalThis.AbortSignal.timeout(10000),
      });
      // Never log response bodies: they may echo identifiers or credentials.
      if (!response.ok) throw new Error(`Meta HTTP ${response.status}`);
      const result = await response.json();
      if (!(result.events_received >= 1)) throw new Error('Meta did not acknowledge event');
      await Conversion.updateOne(filter, { $set: { status: 'sent', sentAt: new Date(), lastError: '', lockedUntil: new Date(0) } });
    } catch (err) {
      const delay = Math.min(3600000, 30000 * 2 ** Math.min(conversion.attempts - 1, 7));
      await Conversion.updateOne(filter, { $set: {
        status: 'pending', lockedUntil: new Date(0), nextAttemptAt: new Date(now.getTime() + delay),
        lastError: /^Meta |^attribution unavailable$/.test(err.message) ? err.message : 'delivery failed',
      } });
    }
    return true;
  }
  return { deliverOne };
}

module.exports = { buildMetaEvent, createDeliveryService };
