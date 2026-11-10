'use strict';

const crypto = require('crypto');
const config = require('./config');
const { getSessionSecret } = require('./db');

const COOKIE_NAME = 'echo_session';
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const attempts = new Map();

/**
 * Dos perfiles:
 * - admin_pin (administrador): configuración, señales y API.
 * - app_pin (usuario): calendario, estudio, historial y fecha del examen.
 * Si no se define admin_pin, el PIN de APP_PIN actúa como administrador
 * (compatibilidad con instalaciones de un solo PIN).
 */
function pinHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function pinEquals(candidate, expected) {
  if (!expected) return false;
  return crypto.timingSafeEqual(pinHash(candidate), pinHash(expected));
}

function resolveRole(pin) {
  const value = String(pin || '').trim();
  if (!value) return null;
  if (pinEquals(value, config.adminPin)) return 'admin';
  if (pinEquals(value, config.appPin)) {
    // Un solo PIN configurado: ese PIN manda.
    return config.adminPin && config.adminPin !== config.appPin ? 'user' : 'admin';
  }
  return null;
}

function hmac(value) {
  return crypto.createHmac('sha256', getSessionSecret()).update(value).digest('base64url');
}

function createSessionToken(role) {
  const expires = Date.now() + config.sessionDays * 24 * 60 * 60 * 1000;
  const nonce = crypto.randomBytes(12).toString('base64url');
  const payload = `${expires}.${role}.${nonce}`;
  return `${payload}.${hmac(payload)}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [expiresRaw, role, nonce, signature] = parts;
  if (!['admin', 'user'].includes(role)) return null;
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires < Date.now()) return null;
  const payload = `${expiresRaw}.${role}.${nonce}`;
  return safeEqual(signature, hmac(payload)) ? { role } : null;
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
  const fromCookie = verifySessionToken(cookies[COOKIE_NAME]);
  if (fromCookie) return fromCookie;
  const header = req.headers['x-session-token'];
  if (header) return verifySessionToken(String(header));
  return null;
}

function sessionCookie(req, role) {
  const token = createSessionToken(role);
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
  const session = getSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: 'unauthorized', message: 'Sesión no válida o caducada.' });
  }
  req.session = session;
  return next();
}

function requireAdmin(req, res, next) {
  const session = req.session || getSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: 'unauthorized', message: 'Sesión no válida o caducada.' });
  }
  if (session.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden', message: 'Esta acción requiere el perfil de administración.' });
  }
  req.session = session;
  return next();
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
  resolveRole,
  sessionCookie,
  clearCookie,
  getSessionFromRequest,
  requireAuth,
  requireAdmin,
  isRateLimited,
  registerFailure,
  clearFailures,
  hasValidApiToken,
};
