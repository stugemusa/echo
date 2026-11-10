'use strict';

const { addDays, diffDays, todayISO } = require('./dates');

const OFFSET_MARKS = [
  { offset: 7, symbol: '😢', tone: 'sad' },
  { offset: 14, symbol: '😭', tone: 'cry' },
];

/**
 * Marcas visuales del calendario:
 * - ❤️ en cada día con señal.
 * - Desde la última señal: 😢 (+7), 😭 (+14), 💔 (+21) y un 💔 adicional
 *   cada 5 días. El ciclo se reinicia con una nueva señal.
 */
function decayMarks(lastSignalDate, from, to) {
  const marks = [];
  if (!lastSignalDate) return marks;

  const pushIfInside = (offset, symbol, tone) => {
    const date = addDays(lastSignalDate, offset);
    if (!date || date < from || date > to) return;
    marks.push({ date, symbol, tone, offset });
  };

  for (const mark of OFFSET_MARKS) pushIfInside(mark.offset, mark.symbol, mark.tone);

  for (let offset = 21; offset <= 720; offset += 5) {
    const repeats = Math.floor((offset - 21) / 5) + 1;
    pushIfInside(offset, '💔'.repeat(Math.min(repeats, 8)), 'broken');
  }

  return marks;
}

function getSignalMarks(db, from, to) {
  const map = new Map();
  const add = (date, mark) => {
    if (date < from || date > to) return;
    if (!map.has(date)) map.set(date, []);
    map.get(date).push(mark);
  };

  const signals = db
    .prepare('SELECT id, date, received_at, source, note FROM signals WHERE date >= ? AND date <= ? ORDER BY date ASC, id ASC')
    .all(from, to);

  for (const signal of signals) {
    add(signal.date, { symbol: '❤️', tone: 'heart', signalId: signal.id });
  }

  const last = db.prepare('SELECT date FROM signals ORDER BY date DESC, id DESC LIMIT 1').get();
  if (last) {
    for (const mark of decayMarks(last.date, from, to)) {
      const existing = map.get(mark.date) || [];
      if (!existing.some((item) => item.tone === 'heart')) add(mark.date, mark);
    }
  }

  return map;
}

function signalState(db) {
  const last = db
    .prepare('SELECT id, date, received_at, source, note FROM signals ORDER BY date DESC, id DESC LIMIT 1')
    .get();
  const total = db.prepare('SELECT COUNT(*) AS count FROM signals').get().count;
  const today = todayISO();

  if (!last) {
    return {
      total,
      last: null,
      daysSince: null,
      currentSymbol: null,
      nextMarks: [],
      today,
    };
  }

  const daysSince = diffDays(last.date, today);
  let currentSymbol = '❤️';
  if (daysSince >= 21) {
    currentSymbol = '💔'.repeat(Math.min(Math.floor((daysSince - 21) / 5) + 1, 8));
  } else if (daysSince >= 14) {
    currentSymbol = '😭';
  } else if (daysSince >= 7) {
    currentSymbol = '😢';
  }

  const upcoming = [];
  for (const offset of [7, 14, 21, 26, 31, 36, 41, 46]) {
    if (offset < daysSince) continue;
    const symbol =
      offset === 7 ? '😢' : offset === 14 ? '😭' : '💔'.repeat(Math.floor((offset - 21) / 5) + 1);
    upcoming.push({ offset, date: addDays(last.date, offset), symbol });
    if (upcoming.length >= 4) break;
  }

  return {
    total,
    last,
    daysSince: Math.max(0, daysSince),
    currentSymbol,
    nextMarks: upcoming,
    today,
  };
}

function addSignal(db, { date, source = 'external', note = null }) {
  const when = date || todayISO();
  const info = db
    .prepare('INSERT INTO signals (date, received_at, source, note) VALUES (?, ?, ?, ?)')
    .run(when, new Date().toISOString(), String(source || 'external').slice(0, 40), note ? String(note).slice(0, 500) : null);
  return {
    id: info.lastInsertRowid,
    date: when,
    state: signalState(db),
  };
}

module.exports = {
  getSignalMarks,
  signalState,
  addSignal,
};
