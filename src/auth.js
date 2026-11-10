'use strict';

const crypto = require('crypto');
const config = require('./config');
const { getSessionSecret } = require('./db');

const COOKIE_NAME = 'echo_session';
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const attempts = new Map();

function hmac(value) {
  return crypto.createHmac('sha256', getSessionSecret()).update(value).digest('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function pinMatches(candidate) {
  const expected = crypto.createHash('sha256').update(String(config.appPin)).digest();
  const received = crypto.createHash('sha256').update(String(candidate)).digest();
  return crypto.timingSafeEqual(expected, received);
}

function createSessionToken() {
  const expires = Date.now() + config.sessionDays * 24 * 60 * 60 * 1000;
  const nonce = crypto.randomBytes(12).toString('base64url');
  const payload = `${expires}.${nonce}`;
  return `${payload}.${hmac(payload)}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [expiresRaw, nonce, signature] = parts;
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;
  const payload = `${expiresRaw}.${nonce}`;
  return safeEqual(signature, hmac(payload));
}

function parseCookies(header = '') {
  return header.split(';').reduce((acc, pair) => {
    const index = pair.indexOf('=');
    if (index === -1) return acc;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key) acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  if (verifySessionToken(cookies[COOKIE_NAME])) return true;
  const header = req.headers['x-session-token'];
  if (header && verifySessionToken(String(header))) return true;
  return false;
}

function sessionCookie(req) {
  const token = createSessionToken();
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${config.sessionDays * 24 * 60 * 60}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function requireAuth(req, res, next) {
  if (getSessionFromRequest(req)) return next();
  return res.status(401).json({ error: 'unauthorized', message: 'Sesión no válida o caducada.' });
}

function isRateLimited(ip) {
  const entry = attempts.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    attempts.delete(ip);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function registerFailure(ip) {
  const entry = attempts.get(ip);
  if (!entry || Date.now() > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: Date.now() + ATTEMPT_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

function clearFailures(ip) {
  attempts.delete(ip);
}

function extractApiToken(req) {
  const header = req.headers['x-api-token'];
  if (header) return String(header).trim();
  const auth = req.headers.authorization || '';
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  if (typeof req.query.token === 'string') return req.query.token.trim();
  return '';
}

function hasValidApiToken(req) {
  if (!config.apiToken) return false;
  const provided = extractApiToken(req);
  if (!provided) return false;
  return safeEqual(provided, config.apiToken);
}

module.exports = {
  COOKIE_NAME,
  pinMatches,
  sessionCookie,
  clearCookie,
  getSessionFromRequest,
  requireAuth,
  isRateLimited,
  registerFailure,
  clearFailures,
  hasValidApiToken,
};
