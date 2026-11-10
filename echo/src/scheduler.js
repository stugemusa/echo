'use strict';

const { addDays, diffDays, todayISO, isValidISO } = require('./dates');

const LADDER = [3, 7, 14, 21, 30];
const MAX_REVIEWS = 80;

function maxDate(a, b) {
  return a > b ? a : b;
}

/**
 * Ocupación de días: Map<'YYYY-MM-DD', Set<topicId>>.
 * Solo cuentan los repasos pendientes. Se puede excluir un tema cuando su
 * cadena se va a recalcular por completo.
 */
function getOccupancy(db, excludeTopicId = null) {
  const rows =
    excludeTopicId === null || excludeTopicId === undefined
      ? db.prepare("SELECT due_date, topic_id FROM reviews WHERE status = 'pending'").all()
      : db
          .prepare("SELECT due_date, topic_id FROM reviews WHERE status = 'pending' AND topic_id != ?")
          .all(excludeTopicId);

  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.due_date)) map.set(row.due_date, new Set());
    map.get(row.due_date).add(row.topic_id);
  }
  return map;
}

function occupancyCount(occ, iso) {
  return occ.get(iso)?.size || 0;
}

function isFree(occ, iso, topicId, minDate, maxDateLimit, maxPerDay) {
  if (iso < minDate || iso > maxDateLimit) return false;
  const set = occ.get(iso);
  if (!set) return true;
  if (set.has(topicId)) return false;
  return set.size < maxPerDay;
}

/**
 * Busca el primer hueco libre para un repaso.
 * - 3 y 7 días: primero hacia delante.
 * - 14, 21 y 30+: primero hacia atrás.
 * - Si no hay hueco en la dirección preferente, alterna ambas direcciones.
 */
function findSlot({ start, intervalDays, minDate, maxDateLimit, occ, topicId, maxPerDay }) {
  if (isFree(occ, start, topicId, minDate, maxDateLimit, maxPerDay)) {
    return { date: start, moved: false, direction: null, days: 0 };
  }

  const forwardFirst = intervalDays <= 7;
  const preferred = forwardFirst ? 1 : -1;
  const limit = 120;

  for (let step = 1; step <= limit; step += 1) {
    const candidate = addDays(start, preferred * step);
    if (candidate > maxDateLimit || candidate < minDate) break;
    if (isFree(occ, candidate, topicId, minDate, maxDateLimit, maxPerDay)) {
      return {
        date: candidate,
        moved: true,
        direction: preferred === 1 ? 'forward' : 'backward',
        days: step,
      };
    }
  }

  for (let step = 1; step <= limit; step += 1) {
    const ahead = addDays(start, step);
    const behind = addDays(start, -step);
    if (ahead <= maxDateLimit && isFree(occ, ahead, topicId, minDate, maxDateLimit, maxPerDay)) {
      return { date: ahead, moved: true, direction: 'forward', days: step };
    }
    if (behind >= minDate && isFree(occ, behind, topicId, minDate, maxDateLimit, maxPerDay)) {
      return { date: behind, moved: true, direction: 'backward', days: step };
    }
  }

  return null;
}

function addOccupancy(occ, iso, topicId) {
  if (!occ.has(iso)) occ.set(iso, new Set());
  occ.get(iso).add(topicId);
}

function nextLadderGap(firstGap) {
  const index = LADDER.indexOf(firstGap);
  if (index >= 0) return { gap: LADDER[Math.min(index + 1, LADDER.length - 1)], index: index + 1 };
  const nextIndex = LADDER.findIndex((value) => value >= firstGap);
  if (nextIndex === -1) return { gap: 30, index: LADDER.length - 1 };
  return { gap: LADDER[nextIndex], index: nextIndex };
}

function describeMove(item) {
  return {
    plannedDate: item.planned_date,
    adjustedDate: item.due_date,
    days: item.days,
    direction: item.direction,
    intervalDays: item.interval_days,
  };
}

/**
 * Genera la cascada completa de repasos hasta la fecha de examen.
 * No escribe en la base de datos: devuelve un plan para previsualizar o aplicar.
 */
function buildCascade({ occ, topicId, startDate, firstGap, examDate, maxPerDay = 3 }) {
  const gap = Math.round(Number(firstGap));
  if (!Number.isFinite(gap) || gap < 1 || gap > 365) {
    return { plan: [], collisions: [], error: 'Intervalo no válido.' };
  }
  if (examDate && (!isValidISO(examDate) || examDate <= startDate)) {
    return { plan: [], collisions: [], examReached: true };
  }

  const hardEnd = examDate || addDays(startDate, 365);
  const ladder = nextLadderGap(gap);
  let nextGap = gap;
  let ladderIndex = ladder.index;
  let prev = startDate;
  let guard = 0;
  const plan = [];
  const collisions = [];

  while (guard < MAX_REVIEWS) {
    guard += 1;
    const ideal = addDays(prev, nextGap);
    if (!ideal) break;
    if (ideal > hardEnd) break;

    const slot = findSlot({
      start: ideal,
      intervalDays: nextGap,
      minDate: addDays(prev, 1),
      maxDateLimit: hardEnd,
      occ,
      topicId,
      maxPerDay,
    });
    if (!slot) break;

    const item = {
      topicId,
      due_date: slot.date,
      planned_date: ideal,
      interval_days: nextGap,
      moved: slot.moved,
      direction: slot.direction,
      days: slot.days,
    };
    plan.push(item);
    if (slot.moved) collisions.push(describeMove(item));
    addOccupancy(occ, slot.date, topicId);

    prev = slot.date;
    nextGap = LADDER[Math.min(ladderIndex, LADDER.length - 1)];
    ladderIndex += 1;
  }

  return { plan, collisions, examReached: false };
}

function planCascade({ db, topicId, startDate, firstGap, examDate, maxPerDay = 3 }) {
  const occ = getOccupancy(db, topicId);
  return buildCascade({ occ, topicId, startDate, firstGap, examDate, maxPerDay });
}

/**
 * Recalcula un repaso pendiente y toda su cadena posterior.
 * Mantiene los intervalos ya definidos para los repasos que siguen.
 *
 * `allowPast` + `exactDate` se usan al deshacer un estudio: el repaso vuelve
 * a su fecha original aunque ya haya pasado y sin buscar hueco alternativo.
 */
function planReschedule({ db, review, targetDate, examDate, maxPerDay = 3, allowPast = false, exactDate = false }) {
  const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(review.topic_id);
  if (!topic) return { error: 'Tema no encontrado.', notFound: true };

  const previous = db
    .prepare(
      `SELECT due_date, completed_on FROM reviews
       WHERE topic_id = ? AND due_date < ?
       ORDER BY due_date DESC, id DESC LIMIT 1`
    )
    .get(review.topic_id, review.due_date);

  const basePrev = previous
    ? previous.completed_on && previous.completed_on > previous.due_date
      ? previous.completed_on
      : previous.due_date
    : (topic.created_at || review.due_date).slice(0, 10);

  const minDate = allowPast
    ? addDays(basePrev, 1)
    : maxDate(todayISO(), addDays(basePrev, 1));
  if (!allowPast && targetDate < minDate) {
    return {
      error: `La fecha debe ser posterior al ${basePrev} y no anterior a hoy.`,
      invalidDate: true,
    };
  }
  if (!exactDate && targetDate < minDate) {
    return {
      error: `La fecha debe ser posterior al ${basePrev}.`,
      invalidDate: true,
    };
  }

  const hardEnd = examDate && examDate >= targetDate ? examDate : null;
  if (examDate && targetDate > examDate) {
    return { error: 'La fecha no puede superar la fecha del examen.', invalidDate: true };
  }

  const occ = getOccupancy(db, review.topic_id);
  const limit = hardEnd || addDays(targetDate, 365);
  const firstInterval = Math.max(1, review.interval_days || 3);

  const firstSlot = exactDate
    ? { date: targetDate, moved: false, direction: null, days: 0 }
    : findSlot({
        start: targetDate,
        intervalDays: firstInterval,
        minDate,
        maxDateLimit: limit,
        occ,
        topicId: review.topic_id,
        maxPerDay,
      });

  if (!firstSlot) {
    return { error: 'No hay hueco disponible antes de la fecha del examen.', noSlot: true };
  }

  const plan = [];
  const collisions = [];
  const firstItem = {
    topicId: review.topic_id,
    due_date: firstSlot.date,
    planned_date: targetDate,
    interval_days: Math.max(1, diffDays(basePrev, firstSlot.date) || firstInterval),
    moved: firstSlot.moved,
    direction: firstSlot.direction,
    days: firstSlot.days,
    current: true,
  };
  plan.push(firstItem);
  if (firstSlot.moved) collisions.push(describeMove(firstItem));
  addOccupancy(occ, firstSlot.date, review.topic_id);

  const subsequent = db
    .prepare(
      `SELECT * FROM reviews
       WHERE topic_id = ? AND status = 'pending' AND due_date >= ? AND id != ?
       ORDER BY due_date ASC, id ASC`
    )
    .all(review.topic_id, review.due_date, review.id);

  let prev = firstSlot.date;
  for (const next of subsequent) {
    const gap = Math.max(1, next.interval_days || 30);
    const ideal = addDays(prev, gap);
    if (hardEnd && ideal > hardEnd) break;

    const slot = findSlot({
      start: ideal,
      intervalDays: gap,
      minDate: addDays(prev, 1),
      maxDateLimit: limit,
      occ,
      topicId: review.topic_id,
      maxPerDay,
    });
    if (!slot) break;

    const item = {
      topicId: review.topic_id,
      due_date: slot.date,
      planned_date: ideal,
      interval_days: gap,
      moved: slot.moved,
      direction: slot.direction,
      days: slot.days,
    };
    plan.push(item);
    if (slot.moved) collisions.push(describeMove(item));
    addOccupancy(occ, slot.date, review.topic_id);
    prev = slot.date;
  }

  return {
    plan,
    collisions,
    basePrev,
    minDate,
    oldDueDate: review.due_date,
    examDate,
  };
}

function applyPlan(db, topicId, plan, { replaceFrom = null } = {}) {
  const insert = db.prepare(
    `INSERT INTO reviews
       (topic_id, due_date, interval_days, status, completed_on, comments, origin, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', NULL, NULL, 'auto', ?, ?)`
  );

  if (replaceFrom) {
    db.prepare(
      "DELETE FROM reviews WHERE topic_id = ? AND status = 'pending' AND due_date >= ?"
    ).run(topicId, replaceFrom);
  }

  const timestamp = new Date().toISOString();
  for (const item of plan) {
    insert.run(topicId, item.due_date, item.interval_days, timestamp, timestamp);
  }
}

module.exports = {
  LADDER,
  getOccupancy,
  occupancyCount,
  findSlot,
  buildCascade,
  planCascade,
  planReschedule,
  applyPlan,
};
