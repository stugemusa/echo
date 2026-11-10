'use strict';

const { addDays, diffDays, todayISO } = require('./dates');

/**
 * Señales y marcas de decaimiento.
 *
 * Las señales no se planifican con antelación, a diferencia de los repasos.
 * Solo existe una "siguiente" marca: aparece en el calendario dos días antes
 * de su fecha y se queda ahí una vez alcanzada. Las marcas anteriores también
 * permanecen visibles. El ciclo se reinicia con cada nueva señal.
 *
 * Cadencia desde la última señal:
 *   +7  😢
 *   +14 😭
 *   +21 💔, +26 💔💔, +31 💔💔💔… (un corazón roto más cada 5 días)
 */
const FIRST_OFFSET = 7;
const SECOND_OFFSET = 14;
const BROKEN_OFFSET = 21;
const BROKEN_STEP = 5;
const MAX_BROKEN = 8;
const LAST_OFFSET = 720;
const VISIBILITY_DAYS = 2;

function symbolForOffset(offset) {
  if (offset === FIRST_OFFSET) return '😢';
  if (offset === SECOND_OFFSET) return '😭';
  const repeats = Math.floor((offset - BROKEN_OFFSET) / BROKEN_STEP) + 1;
  return '💔'.repeat(Math.min(Math.max(repeats, 1), MAX_BROKEN));
}

function toneForOffset(offset) {
  if (offset === FIRST_OFFSET) return 'sad';
  if (offset === SECOND_OFFSET) return 'cry';
  return 'broken';
}

/** Recorre las marcas en orden ascendente: 7, 14, 21, 26, 31… */
function* milestones(fromOffset = FIRST_OFFSET) {
  if (fromOffset <= FIRST_OFFSET) yield FIRST_OFFSET;
  if (fromOffset <= SECOND_OFFSET) yield SECOND_OFFSET;
  for (let offset = BROKEN_OFFSET; offset <= LAST_OFFSET; offset += BROKEN_STEP) {
    if (offset >= fromOffset) yield offset;
  }
}

/**
 * Marcas del calendario dentro del rango [from, to].
 * Una marca futura solo se muestra cuando faltan dos días o menos.
 */
function decayMarks(lastSignalDate, from, to, today = todayISO()) {
  const marks = [];
  if (!lastSignalDate) return marks;

  const visibleUntil = addDays(today, VISIBILITY_DAYS);
  for (const offset of milestones()) {
    const date = addDays(lastSignalDate, offset);
    if (!date) break;
    if (date > visibleUntil) break;
    if (date < from || date > to) continue;
    marks.push({ date, symbol: symbolForOffset(offset), tone: toneForOffset(offset), offset });
  }
  return marks;
}

function getSignalMarks(db, from, to, today = todayISO()) {
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
    for (const mark of decayMarks(last.date, from, to, today)) {
      const existing = map.get(mark.date) || [];
      if (!existing.some((item) => item.tone === 'heart')) add(mark.date, mark);
    }
  }

  return map;
}

function signalState(db, today = todayISO()) {
  const last = db
    .prepare('SELECT id, date, received_at, source, note FROM signals ORDER BY date DESC, id DESC LIMIT 1')
    .get();
  const total = db.prepare('SELECT COUNT(*) AS count FROM signals').get().count;

  if (!last) {
    return {
      total,
      last: null,
      daysSince: null,
      currentSymbol: null,
      nextMark: null,
      today,
    };
  }

  const daysSince = Math.max(0, diffDays(last.date, today));
  let currentSymbol = '❤️';
  if (daysSince >= BROKEN_OFFSET) {
    currentSymbol = symbolForOffset(
      BROKEN_OFFSET + Math.floor((daysSince - BROKEN_OFFSET) / BROKEN_STEP) * BROKEN_STEP
    );
  } else if (daysSince >= SECOND_OFFSET) {
    currentSymbol = symbolForOffset(SECOND_OFFSET);
  } else if (daysSince >= FIRST_OFFSET) {
    currentSymbol = symbolForOffset(FIRST_OFFSET);
  }

  // Solo interesa la siguiente marca, y solo se revela cerca de su fecha.
  let nextMark = null;
  for (const offset of milestones()) {
    if (offset <= daysSince) continue;
    const daysUntil = offset - daysSince;
    nextMark = {
      offset,
      date: addDays(last.date, offset),
      symbol: symbolForOffset(offset),
      daysUntil,
      visible: daysUntil <= VISIBILITY_DAYS,
    };
    break;
  }

  return {
    total,
    last,
    daysSince,
    currentSymbol,
    nextMark,
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
  FIRST_OFFSET,
  VISIBILITY_DAYS,
  decayMarks,
  getSignalMarks,
  signalState,
  addSignal,
};
