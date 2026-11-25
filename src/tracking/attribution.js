const { randomBytes, timingSafeEqual } = require('node:crypto');
const { isIP } = require('node:net');
const { URL } = require('node:url');

function string(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;
}

function validSecret(actual, secret) {
  if (!secret || typeof actual !== 'string') return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(actual);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function parseAttribution(body, now = Date.now()) {
  if (!body || typeof body !== 'object' || body.version !== 1) return null;
  const capturedAt = new Date(body.captured_at);
  if (!Number.isFinite(capturedAt.getTime()) || capturedAt.getTime() > now + 60000 || capturedAt.getTime() < now - 10 * 60000) return null;
  const landingUrl = string(body.landing_url, 4096);
  const source = string(body.source, 100);
  try {
    if (!landingUrl || !source || !['http:', 'https:'].includes(new URL(landingUrl).protocol)) return null;
  } catch { return null; }
  const attribution = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'cid']) {
    const value = string(body.attribution?.[key], 2048);
    if (value) attribution[key] = value;
  }
  const ip = string(body.client_ip_address, 100);
  return {
    capturedAt, attribution, landingUrl, source,
    fbp: string(body.fbp, 1024), fbc: string(body.fbc, 4096),
    clientUserAgent: string(body.client_user_agent, 2048),
    clientIpAddress: ip && isIP(ip) ? ip : undefined,
    isAutoRedirect: body.is_auto_redirect === true,
  };
}

function createAttributionRouter({ Attribution, secret }) {
  const express = require('express');
  const router = express.Router();
  router.use((req, res, next) => {
    if (!secret) return res.status(503).json({ error: 'attribution disabled' });
    if (!validSecret(req.get('authorization'), secret)) return res.status(401).json({ error: 'unauthorized' });
    next();
  });
  router.use(express.json({ limit: '16kb' }));
  router.post('/', async (req, res) => {
    const data = parseAttribution(req.body);
    if (!data) return res.status(400).json({ error: 'invalid attribution' });
    try {
      const trackingId = randomBytes(18).toString('base64url');
      await Attribution.create({ trackingId, ...data });
      res.set('Cache-Control', 'no-store').json({ tracking_id: trackingId });
    } catch {
      res.status(503).json({ error: 'storage unavailable' });
    }
  });
  return router;
}

module.exports = { validSecret, parseAttribution, createAttributionRouter };
