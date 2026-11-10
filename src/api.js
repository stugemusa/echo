'use strict';

const express = require('express');
const config = require('./config');
const {
  db,
  getSetting,
  setSetting,
  getExamDate,
  getMaxPerDay,
} = require('./db');
const {
  todayISO,
  isValidISO,
  addDays,
  diffDays,
  eachDay,
  startOfWeek,
} = require('./dates');
const auth = require('./auth');
const { planCascade, planReschedule, applyPlan, occupancyCount } = require('./scheduler');
const { getSignalMarks, signalState, addSignal } = require('./signals');

const router = express.Router();

const reviewWithTopic = db.prepare(
  `SELECT r.*, t.code AS topic_code
   FROM reviews r JOIN topics t ON t.id = r.topic_id
   WHERE r.id = ?`
);
const topicByCode = db.prepare('SELECT * FROM topics WHERE code = ? COLLATE NOCASE');
const topicById = db.prepare('SELECT * FROM topics WHERE id = ?');
const pendingReviewById = db.prepare(
  `SELECT r.*, t.code AS topic_code
   FROM reviews r JOIN topics t ON t.id = r.topic_id
   WHERE r.id = ? AND r.status = 'pending'`
);

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanCode(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function serializeReview(row) {
  return {
    id: row.id,
    dueDate: row.due_date,
    intervalDays: row.interval_days,
    status: row.status,
    completedOn: row.completed_on,
    comments: row.comments,
    origin: row.origin,
    topic: { id: row.topic_id, code: row.topic_code || row.code },
  };
}

function publicCollision(item) {
  return {
    plannedDate: item.planned_date || item.plannedDate,
    adjustedDate: item.due_date || item.adjustedDate,
    days: item.days,
    direction: item.direction,
    intervalDays: item.interval_days || item.intervalDays,
  };
}

function publicPlan(plan) {
  return plan.map((item) => ({
    dueDate: item.due_date,
    plannedDate: item.planned_date,
    intervalDays: item.interval_days,
    moved: Boolean(item.moved),
    direction: item.direction,
    days: item.days,
  }));
}

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  next();
});

/* ------------------------------------------------------------------ */
/* Sesión / autenticación                                              */
/* ------------------------------------------------------------------ */

router.get('/health', (req, res) => {
  res.json({ ok: true, app: 'echo', version: config.version });
});

router.get('/session', (req, res) => {
  res.json({
    authenticated: auth.getSessionFromRequest(req),
    version: config.version,
  });
});

router.post('/auth', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (auth.isRateLimited(ip)) {
    return res.status(429).json({
      error: 'rate_limited',
      message: 'Demasiados intentos. Espera unos minutos antes de volver a probar.',
    });
  }

  const pin = String(req.body?.pin || '').trim();
  if (!pin) {
    return res.status(400).json({ error: 'missing_pin', message: 'Introduce el PIN de acceso.' });
  }

  if (!auth.pinMatches(pin)) {
    auth.registerFailure(ip);
    return res.status(401).json({ error: 'invalid_pin', message: 'El PIN no es correcto.' });
  }

  auth.clearFailures(ip);
  res.setHeader('Set-Cookie', auth.sessionCookie(req));
  return res.json({ ok: true, version: config.version });
});

router.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', auth.clearCookie());
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* API externa (token) — debe ir antes del middleware de sesión        */
/* ------------------------------------------------------------------ */

router.post('/signal', (req, res) => {
  if (!config.apiToken) {
    return res.status(503).json({
      error: 'api_disabled',
      message: 'Configura API_TOKEN para habilitar la API externa.',
    });
  }
  if (!auth.hasValidApiToken(req)) {
    return res.status(401).json({ error: 'invalid_token', message: 'API_TOKEN no válido.' });
  }

  let date = todayISO();
  if (req.body?.date) {
    if (!isValidISO(req.body.date)) {
      return res.status(400).json({ error: 'invalid_date', message: 'Fecha no válida.' });
    }
    if (req.body.date > todayISO()) {
      return res.status(400).json({ error: 'future_date', message: 'No se pueden registrar señales futuras.' });
    }
    date = req.body.date;
  }

  const result = addSignal(db, {
    date,
    source: req.body?.source || 'external',
    note: req.body?.note || null,
  });

  res.status(201).json({
    ok: true,
    marked: result.date,
    signalId: result.id,
    state: result.state,
  });
});

/* ------------------------------------------------------------------ */
/* A partir de aquí, todo requiere sesión                              */
/* ------------------------------------------------------------------ */

router.use(auth.requireAuth);

router.get('/overview', (req, res) => {
  const today = todayISO();
  const examDate = getExamDate();
  const maxPerDay = getMaxPerDay();

  const rows = db
    .prepare(
      `SELECT r.*, t.code AS topic_code
       FROM reviews r JOIN topics t ON t.id = r.topic_id
       WHERE r.status = 'pending' AND r.due_date <= ?
       ORDER BY r.due_date ASC, t.code COLLATE NOCASE ASC`
    )
    .all(today);

  const todayItems = rows.filter((row) => row.due_date === today).map(serializeReview);
  const overdue = rows.filter((row) => row.due_date < today).map(serializeReview);

  const totals = {
    topics: db.prepare('SELECT COUNT(*) AS count FROM topics').get().count,
    done: db.prepare("SELECT COUNT(*) AS count FROM reviews WHERE status = 'done'").get().count,
    pending: db.prepare("SELECT COUNT(*) AS count FROM reviews WHERE status = 'pending'").get().count,
  };

  const next7 = [];
  for (let index = 0; index < 7; index += 1) {
    const date = addDays(today, index);
    const count = db
      .prepare("SELECT COUNT(*) AS count FROM reviews WHERE status = 'pending' AND due_date = ?")
      .get(date).count;
    next7.push({ date, count, overloaded: count >= maxPerDay });
  }

  const lastStudy = db
    .prepare("SELECT MAX(COALESCE(completed_on, due_date)) AS last FROM reviews WHERE status = 'done'")
    .get().last;

  res.json({
    today,
    examDate,
    daysToExam: examDate ? diffDays(today, examDate) : null,
    maxPerDay,
    totals,
    todayItems,
    overdue,
    next7,
    lastStudy,
    signal: signalState(db),
  });
});

router.get('/calendar', (req, res) => {
  const today = todayISO();
  const from = isValidISO(req.query.from) ? req.query.from : today;
  let to = isValidISO(req.query.to) ? req.query.to : addDays(from, 41);

  if (from > to) return res.status(400).json({ error: 'invalid_range', message: 'Rango de fechas no válido.' });
  if (diffDays(from, to) > 150) {
    return res.status(400).json({ error: 'range_too_large', message: 'El rango máximo es de 150 días.' });
  }

  const rows = db
    .prepare(
      `SELECT r.*, t.code AS topic_code
       FROM reviews r JOIN topics t ON t.id = r.topic_id
       WHERE r.due_date BETWEEN ? AND ?
       ORDER BY r.due_date ASC, t.code COLLATE NOCASE ASC, r.id ASC`
    )
    .all(from, to);

  const marks = getSignalMarks(db, from, to);
  const byDate = new Map();
  for (const date of eachDay(from, to)) {
    byDate.set(date, { date, reviews: [], marks: marks.get(date) || [] });
  }

  for (const row of rows) {
    const day = byDate.get(row.due_date);
    if (day) day.reviews.push(serializeReview(row));
  }

  const days = Array.from(byDate.values()).map((day) => {
    const pending = day.reviews.filter((review) => review.status === 'pending');
    return {
      ...day,
      pendingCount: pending.length,
      doneCount: day.reviews.length - pending.length,
      full: pending.length >= getMaxPerDay(),
    };
  });

  res.json({
    from,
    to,
    today,
    examDate: getExamDate(),
    maxPerDay: getMaxPerDay(),
    days,
  });
});

router.post('/studies', (req, res) => {
  const body = req.body || {};
  const studyDate = body.study_date || todayISO();
  if (!isValidISO(studyDate)) {
    return res.status(400).json({ error: 'invalid_date', message: 'Fecha de estudio no válida.' });
  }
  if (studyDate > todayISO()) {
    return res
      .status(400)
      .json({ error: 'future_study', message: 'No puedes registrar un estudio en el futuro.' });
  }

  let review = null;
  let topic = null;

  if (body.review_id) {
    review = pendingReviewById.get(Number(body.review_id));
    if (!review) {
      return res.status(404).json({ error: 'not_found', message: 'El repaso pendiente ya no existe.' });
    }
    topic = topicById.get(review.topic_id);
  } else {
    const code = cleanCode(body.code);
    if (!code) {
      return res.status(400).json({ error: 'missing_code', message: 'Indica el tema estudiado.' });
    }
    topic = topicByCode.get(code) || null;
  }

  const examDate = getExamDate();
  let firstGap = 3;

  if (body.next_date) {
    if (!isValidISO(body.next_date)) {
      return res.status(400).json({ error: 'invalid_next_date', message: 'Fecha de repaso no válida.' });
    }
    firstGap = diffDays(studyDate, body.next_date);
    if (firstGap === null || firstGap < 1) {
      return res
        .status(400)
        .json({ error: 'past_next_date', message: 'El siguiente repaso debe ser posterior al estudio.' });
    }
  } else if (body.next_interval !== undefined && body.next_interval !== null) {
    firstGap = Number(body.next_interval);
  }

  if (!Number.isFinite(firstGap) || firstGap < 1 || firstGap > 365) {
    return res.status(400).json({ error: 'invalid_interval', message: 'Intervalo de repaso no válido.' });
  }

  const preview = planCascade({
    db,
    topicId: topic ? topic.id : -1,
    startDate: studyDate,
    firstGap,
    examDate,
    maxPerDay: getMaxPerDay(),
  });

  if (preview.error) {
    return res.status(400).json({ error: 'invalid_plan', message: preview.error });
  }

  if (preview.collisions.length > 0 && body.confirm !== true) {
    return res.status(409).json({
      error: 'collision',
      requiresConfirmation: true,
      message: 'Algunos repasos deben moverse por exceso de carga.',
      collisions: preview.collisions.map(publicCollision),
      preview: publicPlan(preview.plan),
      nextInterval: firstGap,
      studyDate,
    });
  }

  const comments = body.comments ? String(body.comments).trim().slice(0, 2000) : null;
  const timestamp = new Date().toISOString();

  let result;
  try {
    result = db.transaction(() => {
      let topicRow = topic ? topicById.get(topic.id) : null;
      if (review) {
        const freshReview = pendingReviewById.get(review.id);
        if (!freshReview) throw httpError(409, 'El repaso pendiente cambió mientras guardabas.');
      }

      if (!topicRow) {
        const code = cleanCode(body.code);
        if (!code) throw httpError(400, 'Indica el tema estudiado.');
        const info = db
          .prepare('INSERT INTO topics (code, created_at, updated_at) VALUES (?, ?, ?)')
          .run(code, timestamp, timestamp);
        topicRow = topicById.get(info.lastInsertRowid);
      }

      let completedId = null;

      if (review) {
        db.prepare(
          `UPDATE reviews SET status = 'done', completed_on = ?, comments = ?, updated_at = ? WHERE id = ?`
        ).run(studyDate, comments, timestamp, review.id);
        completedId = review.id;
      } else {
        const pending = db
          .prepare(
            `SELECT * FROM reviews
             WHERE topic_id = ? AND status = 'pending' AND due_date <= ?
             ORDER BY due_date ASC, id ASC LIMIT 1`
          )
          .get(topicRow.id, studyDate);

        if (pending) {
          db.prepare(
            `UPDATE reviews SET status = 'done', completed_on = ?, comments = ?, updated_at = ? WHERE id = ?`
          ).run(studyDate, comments, timestamp, pending.id);
          completedId = pending.id;
        } else {
          const existingDone = db
            .prepare(
              `SELECT * FROM reviews
               WHERE topic_id = ? AND status = 'done' AND (completed_on = ? OR due_date = ?)
               ORDER BY due_date DESC LIMIT 1`
            )
            .get(topicRow.id, studyDate, studyDate);

          if (existingDone) {
            if (comments !== null) {
              db.prepare('UPDATE reviews SET comments = ?, updated_at = ? WHERE id = ?').run(
                comments,
                timestamp,
                existingDone.id
              );
            }
            completedId = existingDone.id;
          } else {
            const last = db
              .prepare(
                `SELECT MAX(COALESCE(completed_on, due_date)) AS last
                 FROM reviews WHERE topic_id = ? AND status = 'done'`
              )
              .get(topicRow.id).last;
            const gap = last ? Math.max(1, diffDays(last, studyDate)) : 0;
            const info = db
              .prepare(
                `INSERT INTO reviews
                   (topic_id, due_date, interval_days, status, completed_on, comments, origin, created_at, updated_at)
                 VALUES (?, ?, ?, 'done', ?, ?, 'manual', ?, ?)`
              )
              .run(topicRow.id, studyDate, gap, studyDate, comments, timestamp, timestamp);
            completedId = Number(info.lastInsertRowid);
          }
        }
      }

      db.prepare("DELETE FROM reviews WHERE topic_id = ? AND status = 'pending'").run(topicRow.id);

      const finalPlan = planCascade({
        db,
        topicId: topicRow.id,
        startDate: studyDate,
        firstGap,
        examDate,
        maxPerDay: getMaxPerDay(),
      });

      for (const item of finalPlan.plan) {
        db.prepare(
          `INSERT INTO reviews
             (topic_id, due_date, interval_days, status, completed_on, comments, origin, created_at, updated_at)
           VALUES (?, ?, ?, 'pending', NULL, NULL, 'auto', ?, ?)`
        ).run(topicRow.id, item.due_date, item.interval_days, timestamp, timestamp);
      }

      db.prepare('UPDATE topics SET updated_at = ? WHERE id = ?').run(timestamp, topicRow.id);

      return {
        topic: topicRow,
        completedId,
        plan: finalPlan.plan,
        collisions: finalPlan.collisions,
        examReached: finalPlan.examReached,
      };
    })();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: 'conflict', message: err.message });
    throw err;
  }

  res.json({
    ok: true,
    topic: { id: result.topic.id, code: result.topic.code },
    completedReviewId: result.completedId,
    studyDate,
    nextReview: result.plan[0] ? result.plan[0].due_date : null,
    plannedReviews: result.plan.length,
    collisions: result.collisions.map(publicCollision),
    examReached: result.examReached,
  });
});

router.patch('/reviews/:id', (req, res) => {
  const review = pendingReviewById.get(Number(req.params.id));
  if (!review) {
    return res.status(404).json({ error: 'not_found', message: 'Repaso pendiente no encontrado.' });
  }

  const target = req.body?.due_date;
  if (!isValidISO(target)) {
    return res.status(400).json({ error: 'invalid_date', message: 'Fecha de repaso no válida.' });
  }
  if (target < todayISO()) {
    return res.status(400).json({ error: 'past_date', message: 'No puedes mover un repaso al pasado.' });
  }

  const planResult = planReschedule({
    db,
    review,
    targetDate: target,
    examDate: getExamDate(),
    maxPerDay: getMaxPerDay(),
  });

  if (planResult.error) {
    return res.status(400).json({ error: 'invalid_reschedule', message: planResult.error });
  }

  if (planResult.collisions.length > 0 && req.body?.confirm !== true) {
    return res.status(409).json({
      error: 'collision',
      requiresConfirmation: true,
      message: 'El nuevo día está completo. Revisa el ajuste sugerido.',
      collisions: planResult.collisions.map(publicCollision),
      preview: publicPlan(planResult.plan),
      targetDate: target,
    });
  }

  const timestamp = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      "DELETE FROM reviews WHERE topic_id = ? AND status = 'pending' AND due_date >= ?"
    ).run(review.topic_id, review.due_date);
    applyPlan(db, review.topic_id, planResult.plan);
    db.prepare('UPDATE topics SET updated_at = ? WHERE id = ?').run(timestamp, review.topic_id);
  })();

  res.json({
    ok: true,
    topic: { id: review.topic_id, code: review.topic_code },
    targetDate: planResult.plan[0]?.due_date || target,
    plannedReviews: planResult.plan.length,
    collisions: planResult.collisions.map(publicCollision),
    preview: publicPlan(planResult.plan),
  });
});

router.delete('/reviews/:id', (req, res) => {
  const review = pendingReviewById.get(Number(req.params.id));
  if (!review) {
    return res.status(404).json({ error: 'not_found', message: 'Repaso pendiente no encontrado.' });
  }
  db.prepare('DELETE FROM reviews WHERE id = ?').run(review.id);
  res.json({ ok: true });
});

router.get('/history', (req, res) => {
  const query = String(req.query.q || '').trim().toLowerCase();
  const sort = req.query.sort === 'topic' ? 'topic' : 'date';

  const topics = db.prepare('SELECT * FROM topics').all();
  const reviews = db.prepare('SELECT * FROM reviews').all();

  const grouped = new Map();
  for (const topic of topics) {
    grouped.set(topic.id, {
      id: topic.id,
      code: topic.code,
      createdAt: topic.created_at,
      done: [],
      pending: [],
      totalStudies: 0,
      lastStudy: null,
      nextDue: null,
    });
  }

  for (const row of reviews) {
    const entry = grouped.get(row.topic_id);
    if (!entry) continue;
    if (row.status === 'done') {
      entry.done.push({
        id: row.id,
        dueDate: row.due_date,
        completedOn: row.completed_on || row.due_date,
        intervalDays: row.interval_days,
        comments: row.comments,
        origin: row.origin,
      });
    } else {
      entry.pending.push({
        id: row.id,
        dueDate: row.due_date,
        intervalDays: row.interval_days,
      });
    }
  }

  const list = Array.from(grouped.values());
  for (const entry of list) {
    entry.done.sort((a, b) => (a.completedOn < b.completedOn ? -1 : a.completedOn > b.completedOn ? 1 : 0));
    entry.pending.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    entry.totalStudies = entry.done.length;
    entry.lastStudy = entry.done.length ? entry.done[entry.done.length - 1].completedOn : null;
    entry.nextDue = entry.pending.length ? entry.pending[0].dueDate : null;
  }

  const stats = {
    topics: list.length,
    studies: list.reduce((sum, entry) => sum + entry.totalStudies, 0),
    average: list.length
      ? Math.round((list.reduce((sum, entry) => sum + entry.totalStudies, 0) / list.length) * 10) / 10
      : 0,
    lastStudy: list.reduce((max, entry) => (entry.lastStudy && (!max || entry.lastStudy > max) ? entry.lastStudy : max), null),
  };

  const filtered = query
    ? list.filter((entry) => entry.code.toLowerCase().includes(query))
    : list;

  filtered.sort((a, b) => {
    if (sort === 'topic') return a.code.localeCompare(b.code, 'es', { numeric: true, sensitivity: 'base' });
    if (!a.lastStudy && !b.lastStudy) return a.code.localeCompare(b.code, 'es', { numeric: true });
    if (!a.lastStudy) return 1;
    if (!b.lastStudy) return -1;
    return a.lastStudy < b.lastStudy ? 1 : a.lastStudy > b.lastStudy ? -1 : 0;
  });

  res.json({
    topics: filtered,
    stats,
    query,
    sort,
    today: todayISO(),
    maxPerDay: getMaxPerDay(),
  });
});

router.get('/settings', (req, res) => {
  res.json({
    examDate: getExamDate(),
    maxPerDay: getMaxPerDay(),
    intervals: config.intervals,
    apiEnabled: Boolean(config.apiToken),
    apiTokenConfigured: Boolean(config.apiToken),
    appPinConfigured: Boolean(config.appPin),
    version: config.version,
    today: todayISO(),
    signal: signalState(db),
    storage: config.isAddon ? 'Volumen persistente /data' : 'Carpeta local ./data',
    isAddon: config.isAddon,
  });
});

router.put('/settings', (req, res) => {
  const body = req.body || {};
  if (body.exam_date !== undefined) {
    const value = String(body.exam_date || '').trim();
    if (value && !isValidISO(value)) {
      return res.status(400).json({ error: 'invalid_date', message: 'Fecha de examen no válida.' });
    }
    setSetting('exam_date', value);
  }
  if (body.max_per_day !== undefined) {
    const value = Number(body.max_per_day);
    if (!Number.isFinite(value) || value < 1 || value > 3) {
      return res.status(400).json({ error: 'invalid_max', message: 'El máximo permitido es 3 temas por día.' });
    }
    setSetting('max_per_day', String(Math.min(3, Math.round(value))));
  }
  res.json({
    ok: true,
    examDate: getExamDate(),
    maxPerDay: getMaxPerDay(),
  });
});

router.post('/signals', (req, res) => {
  const result = addSignal(db, {
    date: todayISO(),
    source: 'manual',
    note: req.body?.note ? String(req.body.note) : null,
  });
  res.json({ ok: true, date: result.date, state: result.state });
});

router.get('/export', (req, res) => {
  const format = String(req.query.format || 'json').toLowerCase();
  const topics = db.prepare('SELECT * FROM topics ORDER BY code COLLATE NOCASE').all();
  const reviews = db
    .prepare(
      `SELECT r.*, t.code AS topic_code
       FROM reviews r JOIN topics t ON t.id = r.topic_id
       ORDER BY t.code COLLATE NOCASE, r.due_date`
    )
    .all();
  const signals = db.prepare('SELECT * FROM signals ORDER BY date ASC, id ASC').all();
  const stamp = todayISO();

  if (format === 'csv') {
    const escape = (value) => {
      const text = value === null || value === undefined ? '' : String(value);
      return `"${text.replace(/"/g, '""')}"`;
    };
    const lines = [
      ['Tema', 'Fecha planificada', 'Estado', 'Fecha completado', 'Intervalo (días)', 'Comentarios'].join(','),
      ...reviews.map((row) =>
        [
          escape(row.topic_code),
          escape(row.due_date),
          escape(row.status === 'done' ? 'Completado' : 'Pendiente'),
          escape(row.completed_on || ''),
          escape(row.interval_days),
          escape(row.comments || ''),
        ].join(',')
      ),
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="echo-repasos-${stamp}.csv"`);
    return res.send(`\uFEFF${lines.join('\r\n')}`);
  }

  const payload = {
    app: 'echo',
    version: config.version,
    exportedAt: new Date().toISOString(),
    settings: {
      examDate: getExamDate(),
      maxPerDay: getMaxPerDay(),
      intervals: config.intervals,
    },
    topics,
    reviews,
    signals,
    stats: {
      topics: topics.length,
      done: reviews.filter((row) => row.status === 'done').length,
      pending: reviews.filter((row) => row.status === 'pending').length,
      signals: signals.length,
    },
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="echo-backup-${stamp}.json"`);
  res.send(JSON.stringify(payload, null, 2));
});

module.exports = router;
