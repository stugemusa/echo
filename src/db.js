'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const config = require('./config');
const { todayISO, isValidISO } = require('./dates');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const schema = fs.readFileSync(path.join(config.rootDir, 'schema.sql'), 'utf8');
db.exec(schema);

const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare(
  `INSERT INTO settings (key, value) VALUES (?, ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value`
);

function getSetting(key, fallback = null) {
  const row = getSettingStmt.get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  setSettingStmt.run(key, value === null || value === undefined ? '' : String(value));
  return value;
}

const now = new Date().toISOString();
setSetting('app_installed_at', getSetting('app_installed_at', now));

function getSessionSecret() {
  if (config.sessionSecret) return config.sessionSecret;
  let secret = getSetting('session_secret');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    setSetting('session_secret', secret);
  }
  return secret;
}

function getExamDate() {
  const value = getSetting('exam_date', '');
  return value || null;
}

function getMaxPerDay() {
  const value = Number(getSetting('max_per_day', config.maxPerDay));
  return Number.isFinite(value) && value >= 1 && value <= 3 ? value : config.maxPerDay;
}

function ensureDefaults() {
  if (!getSetting('max_per_day')) setSetting('max_per_day', String(config.maxPerDay));
  if (!getSetting('created_on')) setSetting('created_on', todayISO());
  if (config.examDate && isValidISO(config.examDate) && !getSetting('exam_date')) {
    setSetting('exam_date', config.examDate);
  }
}

ensureDefaults();

module.exports = {
  db,
  getSetting,
  setSetting,
  getSessionSecret,
  getExamDate,
  getMaxPerDay,
};
