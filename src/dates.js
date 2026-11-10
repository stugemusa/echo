'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value) {
  return String(value).padStart(2, '0');
}

function toISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function todayISO() {
  return toISO(new Date());
}

function parseISO(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return utc;
}

function isValidISO(value) {
  return parseISO(value) !== null;
}

function addDays(iso, days) {
  const date = parseISO(iso);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + Number(days));
  return date.toISOString().slice(0, 10);
}

/** Días completos entre dos fechas ISO (b - a). */
function diffDays(a, b) {
  const from = parseISO(a);
  const to = parseISO(b);
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

/** Lunes = 0 ... domingo = 6. */
function weekdayMondayFirst(iso) {
  const date = parseISO(iso);
  if (!date) return 0;
  return (date.getUTCDay() + 6) % 7;
}

function startOfWeek(iso) {
  return addDays(iso, -weekdayMondayFirst(iso));
}

function eachDay(from, to) {
  const days = [];
  if (!isValidISO(from) || !isValidISO(to) || from > to) return days;
  let cursor = from;
  let guard = 0;
  while (cursor <= to && guard < 400) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return days;
}

function monthKey(iso) {
  return iso.slice(0, 7);
}

function formatLong(iso, locale = 'es-ES') {
  if (!isValidISO(iso)) return '';
  const date = parseISO(iso);
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function formatShort(iso, locale = 'es-ES') {
  if (!isValidISO(iso)) return '';
  const date = parseISO(iso);
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(date);
}

module.exports = {
  DAY_MS,
  toISO,
  todayISO,
  parseISO,
  isValidISO,
  addDays,
  diffDays,
  weekdayMondayFirst,
  startOfWeek,
  eachDay,
  monthKey,
  formatLong,
  formatShort,
};
