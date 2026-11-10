'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Configuración por entorno.
 * En Home Assistant OS, el Supervisor escribe las opciones del add-on en
 * /data/options.json. Ahí también vive la base de datos persistente.
 */
function readAddonOptions() {
  try {
    if (fs.existsSync('/data/options.json')) {
      return JSON.parse(fs.readFileSync('/data/options.json', 'utf8')) || {};
    }
  } catch (err) {
    console.warn('[echo] No se pudo leer /data/options.json:', err.message);
  }
  return {};
}

const options = readAddonOptions();
const isAddon = fs.existsSync('/data/options.json');
const rootDir = path.join(__dirname, '..');

function envOr(value, fallback) {
  return value === undefined || value === null || value === '' ? fallback : String(value);
}

function envBool(value, fallback = false) {
  const raw = envOr(value, fallback ? 'true' : 'false').toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

/** Las rutas de certificados relativas viven en /ssl (volumen del add-on). */
function sslPath(value, fallback) {
  const raw = envOr(value, fallback);
  if (raw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw)) return raw;
  return `/ssl/${raw}`;
}

const dbPath = envOr(
  process.env.DB_PATH,
  isAddon ? '/data/echo.db' : path.join(rootDir, 'data', 'echo.db')
);

const appPin = envOr(process.env.APP_PIN, envOr(options.app_pin, '1234'));
const adminPin = envOr(process.env.ADMIN_PIN, envOr(options.admin_pin, ''));

module.exports = {
  rootDir,
  publicDir: path.join(rootDir, 'public'),
  dbPath,
  port: Number(envOr(process.env.PORT, 3000)),
  host: envOr(process.env.HOST, '0.0.0.0'),
  appPin,
  adminPin,
  apiToken: envOr(process.env.API_TOKEN, envOr(options.api_token, '')),
  sessionSecret: envOr(process.env.SESSION_SECRET, envOr(options.session_secret, '')),
  examDate: envOr(process.env.EXAM_DATE, envOr(options.exam_date, '')),
  ssl: envBool(process.env.SSL, envBool(options.ssl, false)),
  certFile: sslPath(process.env.CERTFILE, envOr(options.certfile, 'fullchain.pem')),
  keyFile: sslPath(process.env.KEYFILE, envOr(options.keyfile, 'privkey.pem')),
  sessionDays: 30,
  maxPerDay: 3,
  intervals: [3, 7, 14, 21, 30],
  isAddon,
  version: '1.3.0',
};
