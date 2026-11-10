'use strict';

/* ==========================================================================
   Echo · Frontend (vanilla JS)
   ========================================================================== */

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const MONTHS = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const WEEKDAYS_SHORT = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
  const WEEKDAYS_MINI = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const MAX_PER_DAY = 3;
  const AUTH_FLAG = 'echo:authed';
  const ROLE_KEY = 'echo:role';
  const PREF_KEY = 'echo:prefs';

  const state = {
    auth: false,
    role: null,
    version: null,
    view: 'calendar',
    mode: 'month',
    cursor: todayISO(),
    overview: null,
    calendar: null,
    history: null,
    historyDirty: true,
    historyQuery: '',
    historySort: 'date',
    settings: null,
    settingsDirty: true,
    study: {
      review: null,
      interval: 3,
      manualDate: '',
      suggestions: [],
    },
    move: { review: null },
    plan: { date: '' },
    deleting: null,
    undoing: null,
    restore: null,
    pendingConfirm: null,
    previewSeq: 0,
    movePreviewSeq: 0,
    installPrompt: null,
  };

  /* ------------------------------------------------------------------ */
  /* Fechas                                                              */
  /* ------------------------------------------------------------------ */

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function todayISO() {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function parseISO(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      return null;
    }
    return date;
  }

  function toISO(date) {
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }

  function addDays(iso, days) {
    const date = parseISO(iso);
    if (!date) return iso;
    date.setUTCDate(date.getUTCDate() + Number(days));
    return toISO(date);
  }

  function diffDays(a, b) {
    const from = parseISO(a);
    const to = parseISO(b);
    if (!from || !to) return 0;
    return Math.round((to.getTime() - from.getTime()) / 86400000);
  }

  function weekdayIndex(iso) {
    const date = parseISO(iso);
    return date ? (date.getUTCDay() + 6) % 7 : 0;
  }

  function startOfWeek(iso) {
    return addDays(iso, -weekdayIndex(iso));
  }

  function startOfMonth(iso) {
    return `${iso.slice(0, 7)}-01`;
  }

  function endOfMonth(iso) {
    const [year, month] = iso.split('-').map(Number);
    return toISO(new Date(Date.UTC(year, month, 0)));
  }

  function eachDay(from, to) {
    const days = [];
    let cursor = from;
    let guard = 0;
    while (cursor <= to && guard < 400) {
      days.push(cursor);
      cursor = addDays(cursor, 1);
      guard += 1;
    }
    return days;
  }

  function capitalize(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  function formatMonthYear(iso) {
    const date = parseISO(iso);
    if (!date) return '';
    return capitalize(`${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`);
  }

  function formatLongDate(iso) {
    const date = parseISO(iso);
    if (!date) return '';
    return capitalize(
      `${WEEKDAYS[weekdayIndex(iso)]}, ${date.getUTCDate()} de ${MONTHS[date.getUTCMonth()]} de ${date.getUTCFullYear()}`
    );
  }

  function formatShortDate(iso) {
    const date = parseISO(iso);
    if (!date) return '';
    return `${date.getUTCDate()} ${MONTHS_SHORT[date.getUTCMonth()]}`;
  }

  function formatMediumDate(iso) {
    const date = parseISO(iso);
    if (!date) return '';
    return `${date.getUTCDate()} ${MONTHS_SHORT[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  }

  function formatWeekday(iso, short = false) {
    return (short ? WEEKDAYS_SHORT : WEEKDAYS)[weekdayIndex(iso)];
  }

  function formatWeekRange(from, to) {
    const f = parseISO(from);
    const t = parseISO(to);
    if (!f || !t) return '';
    if (f.getUTCMonth() === t.getUTCMonth()) {
      return `${f.getUTCDate()} – ${t.getUTCDate()} ${MONTHS[f.getUTCMonth()]} ${t.getUTCFullYear()}`;
    }
    return `${formatShortDate(from)} – ${formatShortDate(to)} ${t.getUTCFullYear()}`;
  }

  function relativeDays(iso) {
    const delta = diffDays(todayISO(), iso);
    if (delta === 0) return 'Hoy';
    if (delta === 1) return 'Mañana';
    if (delta === -1) return 'Ayer';
    if (delta > 0) return `En ${delta} días`;
    return `Hace ${Math.abs(delta)} días`;
  }

  /* ------------------------------------------------------------------ */
  /* API                                                                 */
  /* ------------------------------------------------------------------ */

  class ApiError extends Error {
    constructor(status, data) {
      super(data?.message || 'Se produjo un error inesperado.');
      this.status = status;
      this.data = data;
    }
  }

  async function api(path, options = {}) {
    const { method = 'GET', body, signal } = options;
    let response;
    try {
      response = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new ApiError(0, {
        message: 'No se pudo conectar con Echo. Comprueba tu conexión.',
      });
    }

    const contentType = response.headers.get('content-type') || '';
    let data = null;
    if (contentType.includes('application/json')) {
      data = await response.json().catch(() => null);
    } else {
      data = await response.text().catch(() => '');
    }

    if (!response.ok) {
      if (response.status === 401 && !path.endsWith('/auth')) {
        handleUnauthorized();
      }
      throw new ApiError(response.status, data || {});
    }
    return data;
  }

  function handleUnauthorized() {
    if (!state.auth) return;
    state.auth = false;
    state.role = null;
    localStorage.removeItem(AUTH_FLAG);
    localStorage.removeItem(ROLE_KEY);
    closeAllDialogs();
    $('#app').hidden = true;
    $('#authGate').hidden = false;
    $('#pinError').textContent = 'La sesión ha caducado. Vuelve a introducir tu PIN.';
    setTimeout(() => $('#pinInput').focus(), 80);
  }

  function isAdmin() {
    return state.role === 'admin';
  }

  function applyRole() {
    const admin = isAdmin();
    document.body.dataset.role = admin ? 'admin' : 'user';
    $$('[data-admin-only]').forEach((element) => {
      element.hidden = !admin;
    });
    const pill = $('#adminPill');
    if (pill) pill.hidden = !admin;
    const badge = $('#adminBadge');
    if (badge) badge.hidden = !admin;
    if (!admin && state.view === 'settings') {
      switchView('calendar', { push: false });
      if (location.hash.startsWith('#settings')) {
        history.replaceState(null, '', '#calendar');
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Utilidades UI                                                       */
  /* ------------------------------------------------------------------ */

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function shortCode(code, max = 18) {
    const text = String(code || '');
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function plural(count, singular, pluralForm) {
    return count === 1 ? singular : pluralForm;
  }

  function toast(message, tone = 'success') {
    const stack = $('#toastStack');
    const item = document.createElement('div');
    item.className = `toast${tone === 'error' ? ' is-error' : tone === 'amber' ? ' is-amber' : ''}`;
    const icon = tone === 'error' ? 'i-alert' : tone === 'amber' ? 'i-clock' : 'i-check';
    item.innerHTML = `<span class="toast-icon"><svg class="icon"><use href="#${icon}"></use></svg></span><span>${esc(message)}</span>`;
    stack.appendChild(item);
    setTimeout(() => {
      item.classList.add('is-leaving');
      setTimeout(() => item.remove(), 260);
    }, 4200);
  }

  function showDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    document.body.classList.add('modal-open');
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    dialog.close();
  }

  function closeAllDialogs() {
    $$('dialog[open]').forEach((dialog) => dialog.close());
    document.body.classList.remove('modal-open');
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML = '<span class="spinner" style="width:15px;height:15px;border-width:1.5px"></span><span>Guardando…</span>';
    } else {
      button.disabled = false;
      if (button.dataset.originalHtml) {
        button.innerHTML = button.dataset.originalHtml;
        delete button.dataset.originalHtml;
      } else if (label) {
        button.textContent = label;
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Arranque                                                            */
  /* ------------------------------------------------------------------ */

  async function init() {
    bindStaticEvents();
    restorePrefs();

    let session = null;
    try {
      session = await api('/api/session');
    } catch (error) {
      if (localStorage.getItem(AUTH_FLAG) === '1' && error.status === 0) {
        state.auth = true;
        state.role = localStorage.getItem(ROLE_KEY) === 'admin' ? 'admin' : 'user';
        $('#app').hidden = false;
        $('#authGate').hidden = true;
        applyRole();
        await refreshData({ silent: true }).catch(() => {
          toast('Sin conexión: se muestran los últimos datos guardados.', 'amber');
        });
        switchView(hashView(), { push: false });
        handleLaunchAction();
      } else {
        showGate();
      }
      hideBoot();
      registerServiceWorker();
      return;
    }

    if (session.authenticated) {
      localStorage.setItem(AUTH_FLAG, '1');
      state.auth = true;
      state.role = session.role === 'admin' ? 'admin' : 'user';
      state.version = session.version || null;
      localStorage.setItem(ROLE_KEY, state.role);
      $('#authGate').hidden = true;
      $('#app').hidden = false;
      applyRole();
      await refreshData({ silent: true }).catch((error) => {
        toast(error.message || 'No se pudieron cargar los datos.', 'error');
      });
      switchView(hashView(), { push: false });
      handleLaunchAction();
    } else {
      showGate();
    }

    hideBoot();
    registerServiceWorker();
  }

  function hideBoot() {
    const boot = $('#boot');
    if (!boot) return;
    setTimeout(() => boot.classList.add('is-hidden'), 250);
    setTimeout(() => boot.remove(), 900);
  }

  function showGate() {
    $('#app').hidden = true;
    $('#authGate').hidden = false;
    setTimeout(() => $('#pinInput')?.focus(), 80);
  }

  function hashView() {
    const value = location.hash.replace('#', '');
    return ['calendar', 'history', 'settings'].includes(value) ? value : 'calendar';
  }

  function handleLaunchAction() {
    const action = new URLSearchParams(location.search).get('action');
    if (!action) return;
    if (action === 'study') {
      setTimeout(() => openStudy(), 250);
    }
    const url = new URL(location.href);
    url.searchParams.delete('action');
    history.replaceState(null, '', `${url.pathname}${url.hash}`);
  }

  function restorePrefs() {
    try {
      const prefs = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
      if (['month', 'week', 'day'].includes(prefs.mode)) state.mode = prefs.mode;
      if (prefs.view) state.view = prefs.view;
    } catch (_) {
      // noop
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ mode: state.mode, view: state.view }));
    } catch (_) {
      // noop
    }
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // El navegador solo permite SW en HTTPS o localhost.
      });
    };
    // La sesión se comprueba de forma asíncrona: el evento load puede haber
    // ocurrido ya cuando llegamos aquí, así que no basta con escucharlo.
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }

  /* ------------------------------------------------------------------ */
  /* Carga de datos                                                      */
  /* ------------------------------------------------------------------ */

  function calendarRange() {
    if (state.mode === 'week') {
      const from = startOfWeek(state.cursor);
      return { from, to: addDays(from, 6) };
    }
    if (state.mode === 'day') {
      return { from: state.cursor, to: state.cursor };
    }
    const first = startOfMonth(state.cursor);
    const from = startOfWeek(first);
    return { from, to: addDays(from, 41) };
  }

  async function loadOverview() {
    state.overview = await api('/api/overview');
  }

  async function loadCalendar() {
    const range = calendarRange();
    state.calendar = await api(`/api/calendar?from=${range.from}&to=${range.to}`);
  }

  async function loadHistory(force = false) {
    if (!force && state.history && !state.historyDirty) return;
    state.history = await api('/api/history?sort=date');
    state.historyDirty = false;
  }

  async function loadSettings(force = false) {
    if (!force && state.settings && !state.settingsDirty) return;
    state.settings = await api('/api/settings');
    state.settingsDirty = false;
  }

  async function refreshData({ silent = false } = {}) {
    try {
      await Promise.all([loadOverview(), loadCalendar()]);
      renderAll();
      if (!silent) {
        // noop
      }
    } catch (error) {
      if (!silent) toast(error.message, 'error');
      throw error;
    }
  }

  async function refreshAfterMutation() {
    state.historyDirty = true;
    state.settingsDirty = true;
    await refreshData({ silent: true });
    if (state.view === 'history') {
      await loadHistory(true);
      renderHistory();
    } else if (state.view === 'settings') {
      await loadSettings(true);
      renderSettings();
    }
  }

  function renderAll() {
    renderTopbar();
    renderSidebar();
    renderCalendar();
    renderRail();
  }

  /* ------------------------------------------------------------------ */
  /* Navegación                                                          */
  /* ------------------------------------------------------------------ */

  function navigate(view) {
    if (!['calendar', 'history', 'settings'].includes(view)) view = 'calendar';
    if (view === 'settings' && !isAdmin()) view = 'calendar';
    if (state.view === view) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    switchView(view);
    history.replaceState(null, '', `#${view}`);
  }

  function switchView(view, { push = true } = {}) {
    if (view === 'settings' && !isAdmin()) view = 'calendar';
    state.view = view;
    document.body.dataset.view = view;
    savePrefs();
    $$('.view').forEach((section) => {
      section.hidden = section.id !== `view-${view}`;
    });
    $$('[data-nav]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.nav === view);
    });
    if (view === 'history') {
      loadHistory()
        .then(() => renderHistory())
        .catch((error) => toast(error.message, 'error'));
    }
    if (view === 'settings') {
      loadSettings()
        .then(() => renderSettings())
        .catch((error) => toast(error.message, 'error'));
    }
    if (push) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ------------------------------------------------------------------ */
  /* Render: cabecera, sidebar y rail                                    */
  /* ------------------------------------------------------------------ */

  function renderTopbar() {
    const today = todayISO();
    $('#topbarDate').textContent = `${formatWeekday(today)} · ${formatShortDate(today)}`;
  }

  const SIGNAL_NUDGES = {
    none: [
      'Todavía sin señales.',
    ],
    today: [
      'La señal de hoy ya está aquí. El ciclo empieza de nuevo.',
      'Hoy hay un corazón nuevo en el calendario.',
    ],
    early: [
      'Hace {d} días de la última señal.',
      'La última señal fue hace {d} días.',
      'Han pasado {d} días desde la última señal.',
    ],
    mid: [
      'Hace {d} días que no llega una señal.',
      'La última señal fue hace {d} días. Se nota el hueco.',
      'Ya son {d} días sin un corazón nuevo.',
    ],
    late: [
      'Hace {d} días que no llega una señal. El calendario lo nota.',
      '{d} días sin señal. Quizá toque recordarlo.',
      'La última señal queda lejos: {d} días.',
    ],
    overdue: [
      '{d} días sin señal. Un ❤️ reiniciaría el ciclo.',
      'El ciclo lleva {d} días parado. Toca un corazón nuevo.',
      '{d} días. El calendario se ha ido llenando de corazones rotos.',
    ],
  };

  function signalNudgeCopy(signal) {
    if (!signal?.last) return SIGNAL_NUDGES.none[0];
    const days = Math.max(0, signal.daysSince || 0);
    let tier = 'early';
    if (days === 0) tier = 'today';
    else if (days <= 3) tier = 'early';
    else if (days <= 13) tier = 'mid';
    else if (days <= 34) tier = 'late';
    else tier = 'overdue';
    const list = SIGNAL_NUDGES[tier];
    return list[days % list.length].replace('{d}', days);
  }

  function renderSidebar() {
    const overview = state.overview;
    const examBox = $('#sidebarExam');
    if (!overview) return;

    if (overview.examDate) {
      const days = overview.daysToExam;
      examBox.classList.remove('is-empty');
      examBox.innerHTML = `
        <span class="mini-label">Fecha del examen</span>
        <div class="mini-days"><strong>${days >= 0 ? days : 0}</strong><span>días</span></div>
        <p class="mini-date">${esc(formatMediumDate(overview.examDate))} · ${days >= 0 ? 'en marcha' : 'fecha pasada'}</p>
      `;
    } else {
      examBox.classList.add('is-empty');
      examBox.innerHTML = `
        <span class="mini-label">Examen</span>
        <p class="mini-date">Define tu fecha para proyectar la cascada completa.</p>
        <button type="button" data-action="open-exam">Configurar fecha →</button>
      `;
    }

    $('#sidebarFootText').textContent = `Sincronizado · v${state.version || state.settings?.version || '1.2'}`;
    const dot = $('#connectionDot');
    dot.classList.toggle('is-offline', !navigator.onLine);
  }

  function renderExamChip() {
    const overview = state.overview;
    const container = $('#examChip');
    if (!overview) {
      container.innerHTML = '';
      return;
    }
    if (overview.examDate) {
      const warn = overview.daysToExam <= 30 ? ' is-warning' : '';
      container.innerHTML = `
        <span class="exam-chip${warn}">
          <span class="dot"></span>
          Examen <strong>${esc(formatMediumDate(overview.examDate))}</strong>
          · <strong>${overview.daysToExam >= 0 ? overview.daysToExam : 0} días</strong>
        </span>
      `;
    } else {
      container.innerHTML = `
        <button type="button" class="exam-chip" data-action="open-exam">
          <span class="dot"></span>
          Configura la fecha del examen
          <svg class="icon icon-sm"><use href="#i-arrow-right"></use></svg>
        </button>
      `;
    }
  }

  function renderRail() {
    const overview = state.overview;
    const rail = $('#rail');
    if (!overview) {
      rail.innerHTML = '';
      return;
    }

    const todayRows = overview.todayItems.map((review) => `
      <div class="today-row">
        <span class="t-code">${esc(shortCode(review.topic.code, 24))}</span>
        <span class="t-int">${review.intervalDays}d</span>
        <button type="button" class="icon-btn" data-open-review="${review.id}" title="Registrar este repaso" aria-label="Registrar ${esc(review.topic.code)}">
          <svg class="icon"><use href="#i-check"></use></svg>
        </button>
      </div>
    `).join('');

    const todayCard = `
      <section class="rail-card">
        <div class="rail-card-head">
          <h3 class="rail-title">Hoy</h3>
          <span class="rail-sub">${overview.todayItems.length}/${overview.maxPerDay} ${plural(overview.todayItems.length, 'repaso', 'repasos')}</span>
        </div>
        <p class="rail-date">${esc(capitalize(formatWeekday(overview.today)))} · ${esc(formatShortDate(overview.today))}</p>
        <div class="rail-body">
          ${todayRows ? `<div class="today-list">${todayRows}</div>` : `
            <div class="rail-empty">
              <div class="rail-empty-emoji">🌿</div>
              <p>Día despejado. No hay repasos programados para hoy.</p>
              <button type="button" class="btn btn-soft btn-sm" data-action="open-study">Registrar estudio</button>
            </div>
          `}
        </div>
      </section>
    `;

    const overdueCard = overview.overdue.length ? `
      <section class="rail-card rail-overdue">
        <div class="rail-card-head">
          <h3 class="rail-title">Pendientes anteriores</h3>
          <span class="rail-sub">${overview.overdue.length}</span>
        </div>
        <div class="rail-body">
          <div class="today-list">
            ${overview.overdue.slice(0, 5).map((review) => `
              <div class="overdue-row">
                <span class="t-code">${esc(shortCode(review.topic.code, 22))}</span>
                <span class="t-days">${Math.abs(diffDays(review.dueDate, overview.today))}d</span>
                <button type="button" class="icon-btn" data-open-review="${review.id}" title="Registrar este repaso atrasado" aria-label="Registrar ${esc(review.topic.code)}">
                  <svg class="icon"><use href="#i-check"></use></svg>
                </button>
              </div>
            `).join('')}
          </div>
        </div>
      </section>
    ` : '';

    const totalReviews = overview.totals.done + overview.totals.pending;
    const progress = totalReviews ? Math.round((overview.totals.done / totalReviews) * 100) : 0;

    const examCard = overview.examDate ? `
      <section class="exam-card">
        <span class="mini-label">Cuenta atrás · examen</span>
        <div class="exam-days"><strong>${overview.daysToExam >= 0 ? overview.daysToExam : 0}</strong><span>días</span></div>
        <p class="exam-date">${esc(formatMediumDate(overview.examDate))}</p>
        <div class="exam-progress">
          <div class="exam-progress-bar"><i style="width:${progress}%"></i></div>
          <div class="exam-progress-meta"><span>${overview.totals.done} repasos hechos</span><span>${progress}%</span></div>
        </div>
      </section>
    ` : `
      <section class="exam-card is-empty">
        <span class="mini-label">Examen</span>
        <p>Define la fecha del examen para que Echo proyecte todos los repasos en cascada.</p>
        <button type="button" class="btn btn-sm" data-action="open-exam">Configurar fecha</button>
      </section>
    `;

    const signal = overview.signal;
    const nudge = signalNudgeCopy(signal);
    const signalCard = `
      <section class="signal-card is-quiet">
        <div class="signal-top">
          <span class="signal-emoji ${signal?.last ? '' : 'is-empty'}">${esc(signal?.currentSymbol || '♡')}</span>
          <div class="signal-copy">
            <strong>${esc(nudge)}</strong>
            <span>${signal?.last ? `Última señal · ${esc(formatMediumDate(signal.last.date))}` : 'aquí verás el tiempo transcurrido'}</span>
          </div>
        </div>
        ${isAdmin() ? `
          <button type="button" class="btn btn-ghost btn-sm signal-mark" data-action="mark-signal">
            <svg class="icon icon-sm"><use href="#i-heart"></use></svg>
            <span>Dejar señal</span>
          </button>
        ` : ''}
      </section>
    `;

    const maxCount = Math.max(1, ...overview.next7.map((day) => day.count));
    const loadCard = `
      <section class="rail-card load-card">
        <div class="rail-card-head">
          <h3 class="rail-title">Próximos 7 días</h3>
          <span class="rail-sub">${overview.next7.reduce((sum, day) => sum + day.count, 0)} repasos</span>
        </div>
        <div class="load-bars">
          ${overview.next7.map((day) => {
            const height = day.count === 0 ? 6 : Math.max(12, Math.round((day.count / maxCount) * 100));
            return `
              <div class="load-bar-col ${day.overloaded ? 'is-full' : ''} ${day.date === overview.today ? 'is-today' : ''}" title="${esc(formatMediumDate(day.date))}: ${day.count} repasos">
                <div class="load-bar-track"><i style="height:${height}%"></i></div>
                <strong>${day.count}</strong>
                <span>${esc(WEEKDAYS_MINI[weekdayIndex(day.date)])}</span>
              </div>
            `;
          }).join('')}
        </div>
      </section>
    `;

    rail.innerHTML = todayCard + overdueCard + examCard + loadCard + signalCard;
  }

  /* ------------------------------------------------------------------ */
  /* Render: calendario                                                  */
  /* ------------------------------------------------------------------ */

  function markTitle(mark) {
    return mark.tone === 'heart' ? 'Señal' : '';
  }

  function marksHtml(marks) {
    if (!marks || !marks.length) return '';
    return `<span class="day-marks">${marks.slice(0, 4).map((mark) => {
      const cls = mark.tone === 'heart' ? '' : mark.tone === 'broken' ? 'is-decay is-broken' : 'is-decay';
      const title = markTitle(mark);
      return `<span class="mark ${cls}"${title ? ` title="${esc(title)}"` : ''}>${esc(mark.symbol)}</span>`;
    }).join('')}</span>`;
  }

  function reviewChip(review, today) {
    const done = review.status === 'done';
    const overdue = !done && review.dueDate < today;
    const classes = ['review-chip', done ? 'is-done' : '', overdue ? 'is-overdue' : ''].filter(Boolean).join(' ');
    const title = done
      ? `${review.topic.code} · completado ${formatMediumDate(review.completedOn || review.dueDate)}`
      : `${review.topic.code} · ${formatMediumDate(review.dueDate)} · repaso de ${review.intervalDays} días`;
    const data = done ? '' : ` data-review-id="${review.id}" role="button" tabindex="-1"`;
    return `
      <span class="${classes}"${data} title="${esc(title)}">
        ${done ? '<svg class="icon"><use href="#i-check"></use></svg>' : ''}
        <span class="chip-code">${esc(shortCode(review.topic.code, 16))}</span>
        <span class="chip-int">${review.intervalDays}d</span>
      </span>
    `;
  }

  function calendarMetrics() {
    const today = state.calendar?.today || todayISO();
    const days = state.calendar?.days || [];
    let pending = 0;
    let done = 0;
    let activeDays = 0;
    let overloaded = 0;
    days.forEach((day) => {
      const dayPending = day.reviews.filter((review) => review.status === 'pending').length;
      const dayDone = day.reviews.filter((review) => review.status === 'done').length;
      pending += dayPending;
      done += dayDone;
      if (dayPending + dayDone > 0) activeDays += 1;
      if (dayPending >= MAX_PER_DAY) overloaded += 1;
    });
    return { today, pending, done, activeDays, overloaded };
  }

  function renderCalendar() {
    renderExamChip();
    const stage = $('#calendarStage');
    if (!state.calendar) {
      stage.innerHTML = '<div class="loading-block"><span class="spinner"></span></div>';
      return;
    }

    $$('.seg-item').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.mode === state.mode);
      button.setAttribute('aria-selected', button.dataset.mode === state.mode ? 'true' : 'false');
    });

    const metrics = calendarMetrics();
    const title = $('#calendarTitle');
    const sub = $('#calendarSub');
    const examText = state.overview?.examDate
      ? ` · ${state.overview.daysToExam >= 0 ? state.overview.daysToExam : 0} días para el examen`
      : '';

    if (state.mode === 'month') {
      const range = calendarRange();
      title.textContent = formatMonthYear(state.cursor);
      sub.textContent = `${metrics.pending} ${plural(metrics.pending, 'repaso planificado', 'repasos planificados')} · ${metrics.activeDays} ${plural(metrics.activeDays, 'día con carga', 'días con carga')}${examText}`;
      stage.innerHTML = renderMonth(range);
    } else if (state.mode === 'week') {
      const range = calendarRange();
      title.textContent = formatWeekRange(range.from, range.to);
      sub.textContent = `${metrics.pending} ${plural(metrics.pending, 'repaso', 'repasos')} esta semana · ${metrics.activeDays} ${plural(metrics.activeDays, 'día activo', 'días activos')}${examText}`;
      stage.innerHTML = renderWeek(state.calendar.days, metrics.today);
    } else {
      title.textContent = formatLongDate(state.cursor);
      sub.textContent = `${metrics.pending} ${plural(metrics.pending, 'repaso pendiente', 'repasos pendientes')} · ${metrics.done} ${plural(metrics.done, 'completado', 'completados')}${examText}`;
      stage.innerHTML = renderDay(state.calendar.days[0], metrics.today);
    }

    $('#loadLegend').textContent = metrics.overloaded
      ? `${metrics.overloaded} ${plural(metrics.overloaded, 'día lleno', 'días llenos')} · máximo 3 temas`
      : 'Máximo 3 temas por día';
  }

  function renderMonth(range) {
    const today = state.calendar.today;
    const monthKey = state.cursor.slice(0, 7);
    const map = new Map(state.calendar.days.map((day) => [day.date, day]));
    const headers = WEEKDAYS_SHORT.map((day) => `<div class="weekday-cell">${day}</div>`).join('');

    const cells = eachDay(range.from, range.to).map((date) => {
      const day = map.get(date) || { date, reviews: [], marks: [], pendingCount: 0, doneCount: 0 };
      const pending = day.reviews.filter((review) => review.status === 'pending');
      const done = day.reviews.filter((review) => review.status === 'done');
      const ordered = [...pending, ...done];
      const visible = ordered.slice(0, 3);
      const extra = ordered.length - visible.length;
      const isToday = date === today;
      const out = date.slice(0, 7) !== monthKey;
      const weekend = weekdayIndex(date) >= 5;
      const classes = [
        'month-cell',
        out ? 'is-out' : '',
        isToday ? 'is-today' : '',
        weekend ? 'is-weekend' : '',
        ordered.length ? 'has-load' : '',
      ].filter(Boolean).join(' ');
      const count = pending.length;
      const countLabel = count > 0 ? `${count}/${MAX_PER_DAY}` : done.length ? `${done.length}✓` : '';
      const countClass = count >= MAX_PER_DAY ? 'is-full' : count === 0 ? 'is-done-only' : '';
      const dots = ordered
        .slice(0, 3)
        .map((reviewItem) => {
          if (reviewItem.status === 'done') return '<i class="is-done"></i>';
          if (reviewItem.dueDate < today) return '<i class="is-overdue"></i>';
          return '<i class="is-pending"></i>';
        })
        .join('') + (ordered.length > 3 ? `<i class="is-more">+${ordered.length - 3}</i>` : '');
      const label = [
        formatLongDate(date),
        count ? `${count} repasos pendientes` : done.length ? `${done.length} completados` : 'sin repasos',
        day.marks?.length ? 'con señal' : '',
      ].filter(Boolean).join(', ');

      return `
        <div class="${classes}" data-date="${date}" role="button" tabindex="0" aria-label="${esc(label)}">
          <span class="day-top">
            <span class="day-num">${Number(date.slice(8, 10))}</span>
            ${countLabel ? `<span class="day-count ${countClass}" title="${count ? `${count} de ${MAX_PER_DAY} huecos ocupados` : `${done.length} completados`}">${countLabel}</span>` : ''}
          </span>
          <span class="day-reviews">
            ${visible.map((review) => reviewChip(review, today)).join('')}
            ${extra > 0 ? `<span class="day-more">+${extra} más</span>` : ''}
          </span>
          ${dots ? `<span class="day-dots" aria-hidden="true">${dots}</span>` : ''}
          ${marksHtml(day.marks)}
        </div>
      `;
    }).join('');

    return `<div class="month-grid">${headers}${cells}</div>`;
  }

  function renderWeek(days, today) {
    return `
      <div class="week-grid">
        ${days.map((day) => {
          const pending = day.reviews.filter((review) => review.status === 'pending');
          const done = day.reviews.filter((review) => review.status === 'done');
          const isToday = day.date === today;
          const cards = [...pending, ...done].map((review) => `
            <div class="week-card ${review.status === 'done' ? 'is-done' : ''} ${review.status === 'pending' && review.dueDate < today ? 'is-overdue' : ''}"
              ${review.status === 'pending' ? `data-review-id="${review.id}" role="button" tabindex="0" title="Registrar ${esc(review.topic.code)}"` : ''}>
              <strong>${esc(shortCode(review.topic.code, 22))}</strong>
              <span>${review.status === 'done' ? 'Completado' : `Repaso de ${review.intervalDays} días`}</span>
            </div>
          `).join('');

          return `
            <div class="week-col ${isToday ? 'is-today' : ''} ${day.date.slice(0, 7) !== state.cursor.slice(0, 7) ? 'is-out' : ''}" data-date="${day.date}" role="button" tabindex="0" aria-label="${esc(formatLongDate(day.date))}: ${pending.length} repasos">
              <div class="week-head">
                <span class="wd">${esc(formatWeekday(day.date, true))}</span>
                <span class="wn">${Number(day.date.slice(8, 10))}</span>
                <span class="week-head-marks">${(day.marks || []).slice(0, 3).map((mark) => {
                  const title = markTitle(mark);
                  return `<span${title ? ` title="${esc(title)}"` : ''}>${esc(mark.symbol)}</span>`;
                }).join('')}</span>
              </div>
              <div class="week-body">
                ${cards || '<div class="week-empty">—</div>'}
              </div>
              <div class="week-foot">${pending.length}/${MAX_PER_DAY}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderDay(day, today) {
    if (!day) {
      return '<div class="day-empty"><p>No hay datos para este día.</p></div>';
    }
    const pending = day.reviews.filter((review) => review.status === 'pending');
    const done = day.reviews.filter((review) => review.status === 'done');
    const date = day.date;
    const isToday = date === today;
    const isPast = date < today;
    const isFuture = date > today;
    const nr = parseISO(date);

    const pendingRows = pending.map((review) => {
      const overdue = date < today || (review.dueDate < today);
      const late = diffDays(review.dueDate, today);
      return `
        <div class="agenda-item">
          <span class="agenda-icon">${review.intervalDays}d</span>
          <div class="agenda-main">
            <strong>${esc(review.topic.code)}</strong>
            <span>${overdue ? `Atrasado ${late} ${plural(late, 'día', 'días')}` : `Programado · ${formatShortDate(review.dueDate)}`} · intervalo de ${review.intervalDays} días</span>
          </div>
          <div class="agenda-actions">
            <button type="button" class="icon-btn is-danger" data-delete-review="${review.id}" title="Eliminar este repaso" aria-label="Eliminar ${esc(review.topic.code)}">
              <svg class="icon"><use href="#i-trash"></use></svg>
            </button>
            <button type="button" class="icon-btn" data-move-review="${review.id}" title="Cambiar la fecha de este repaso" aria-label="Cambiar fecha de ${esc(review.topic.code)}">
              <svg class="icon"><use href="#i-move"></use></svg>
            </button>
            ${isFuture ? '' : `
              <button type="button" class="icon-btn is-primary" data-open-review="${review.id}" title="Registrar este repaso" aria-label="Registrar ${esc(review.topic.code)}">
                <svg class="icon"><use href="#i-check"></use></svg>
              </button>
            `}
          </div>
        </div>
      `;
    }).join('');

    const doneRows = done.map((review) => `
      <div class="agenda-item is-done">
        <span class="agenda-icon"><svg class="icon"><use href="#i-check"></use></svg></span>
        <div class="agenda-main">
          <strong>${esc(review.topic.code)}</strong>
          <span>Completado · repaso de ${review.intervalDays} días</span>
          ${review.comments ? `<p class="agenda-note">${esc(review.comments)}</p>` : ''}
        </div>
        <div class="agenda-actions"></div>
      </div>
    `).join('');

    return `
      <div class="day-view">
        <div class="day-hero">
          <div class="day-hero-date">
            <div class="day-hero-num">
              <strong>${nr.getUTCDate()}</strong>
              <span>${MONTHS_SHORT[nr.getUTCMonth()]}</span>
            </div>
            <div>
              <h2>${esc(capitalize(formatLongDate(date)))}</h2>
              <div class="day-hero-meta">
                <span>${pending.length} ${plural(pending.length, 'pendiente', 'pendientes')}</span>
                <span>·</span>
                <span>${done.length} ${plural(done.length, 'completado', 'completados')}</span>
                ${day.marks?.length ? `<span class="day-hero-marks">${day.marks.map((mark) => esc(mark.symbol)).join(' ')}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="day-hero-actions">
            ${isToday ? `
              <button type="button" class="btn btn-primary btn-sm" data-action="open-study">
                <svg class="icon icon-sm"><use href="#i-plus"></use></svg>
                Registrar hoy
              </button>
            ` : ''}
            ${!isPast ? `
              <button type="button" class="btn btn-soft btn-sm" data-action="open-plan" data-date="${date}">
                <svg class="icon icon-sm"><use href="#i-calendar"></use></svg>
                Planificar repaso
              </button>
            ` : ''}
          </div>
        </div>

        <div class="day-agenda">
          ${pending.length ? `<div class="agenda-label">Pendientes · ${pending.length}</div>${pendingRows}` : ''}
          ${done.length ? `<div class="agenda-label">Completados · ${done.length}</div>${doneRows}` : ''}
          ${!pending.length && !done.length ? `
            <div class="day-empty">
              <div class="day-empty-emoji">🍃</div>
              <p>No hay repasos planificados para este día.</p>
              <div class="day-empty-actions">
                ${isToday ? '<button type="button" class="btn btn-soft btn-sm" data-action="open-study">Registrar un estudio</button>' : ''}
                ${!isPast ? `<button type="button" class="btn btn-ghost btn-sm" data-action="open-plan" data-date="${date}">Planificar un repaso</button>` : ''}
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  /* ------------------------------------------------------------------ */
  /* Acciones del calendario                                             */
  /* ------------------------------------------------------------------ */

  function goToDay(date) {
    state.cursor = date;
    state.mode = 'day';
    savePrefs();
    loadCalendar().then(renderAll).catch((error) => toast(error.message, 'error'));
  }

  function shiftPeriod(direction) {
    if (state.mode === 'month') {
      const date = parseISO(state.cursor);
      date.setUTCMonth(date.getUTCMonth() + direction, 1);
      state.cursor = toISO(date);
    } else if (state.mode === 'week') {
      state.cursor = addDays(state.cursor, 7 * direction);
    } else {
      state.cursor = addDays(state.cursor, direction);
    }
    loadCalendar().then(renderAll).catch((error) => toast(error.message, 'error'));
  }

  function goToday() {
    state.cursor = todayISO();
    if (state.view !== 'calendar') {
      navigate('calendar');
    }
    loadCalendar().then(renderAll).catch((error) => toast(error.message, 'error'));
  }

  function setMode(mode) {
    if (!['month', 'week', 'day'].includes(mode)) return;
    state.mode = mode;
    savePrefs();
    if (mode === 'day' && state.cursor < startOfMonth(state.cursor)) {
      // no-op
    }
    loadCalendar().then(renderAll).catch((error) => toast(error.message, 'error'));
  }

  /* ------------------------------------------------------------------ */
  /* Modal: registrar estudio                                            */
  /* ------------------------------------------------------------------ */

  function findReviewInState(id) {
    const numeric = Number(id);
    const pools = [];
    if (state.overview) pools.push(state.overview.todayItems, state.overview.overdue);
    if (state.calendar) state.calendar.days.forEach((day) => pools.push(day.reviews));
    for (const pool of pools) {
      const found = pool.find((review) => review.id === numeric);
      if (found) return found;
    }
    return null;
  }

  function buildSuggestions(extraReview) {
    const suggestions = [];
    const seen = new Set();
    const add = (review, hint) => {
      if (!review || seen.has(review.id)) return;
      seen.add(review.id);
      suggestions.push({ review, hint });
    };

    if (extraReview) add(extraReview, `Elegido · ${formatMediumDate(extraReview.dueDate)}`);
    if (state.overview) {
      state.overview.todayItems.forEach((review) => add(review, 'Programado para hoy'));
      state.overview.overdue.forEach((review) => {
        const late = Math.abs(diffDays(review.dueDate, state.overview.today));
        add(review, `Atrasado ${late} ${plural(late, 'día', 'días')} · ${formatShortDate(review.dueDate)}`);
      });
    }
    return suggestions;
  }

  function openStudy(options = {}) {
    if (!state.overview) return;
    const extra = options.review || (options.reviewId ? findReviewInState(options.reviewId) : null);
    if (extra && extra.dueDate > todayISO()) {
      openMove(extra);
      toast('Ese repaso todavía no toca. Puedes cambiar su fecha.', 'amber');
      return;
    }
    state.study = {
      review: extra || null,
      interval: 3,
      manualDate: '',
      suggestions: buildSuggestions(extra),
    };

    const dialog = $('#studyDialog');
    const suggestionsBox = $('#studySuggestions');
    suggestionsBox.innerHTML = state.study.suggestions.map(({ review, hint }) => {
      const overdue = review.dueDate < (state.overview?.today || todayISO());
      const code = shortCode(review.topic.code, 42);
      return `
        <button type="button" class="suggestion ${overdue ? 'is-overdue' : ''} ${extra && extra.id === review.id ? 'is-active' : ''}" data-suggestion="${review.id}">
          <span class="suggestion-icon">${review.intervalDays}d</span>
          <span class="suggestion-main">
            <strong>${esc(code)}</strong>
            <span>${esc(hint)}</span>
          </span>
          <span class="suggestion-badge">${overdue ? 'Atrasado' : 'Hoy'}</span>
        </button>
      `;
    }).join('');

    $('#studyCode').value = extra ? extra.topic.code : '';
    $('#studyComments').value = '';
    $('#studyDate').value = '';
    $('#studyDate').min = todayISO();
    $('#studyDate').max = state.overview?.examDate || '';
    $('#studyError').textContent = '';
    $('#intervalChips').querySelectorAll('.chip').forEach((chip) => {
      chip.classList.toggle('is-active', Number(chip.dataset.interval) === 3);
    });
    $('#studyCodeHint').textContent = extra
      ? `Registrarás el repaso pendiente del ${formatMediumDate(extra.dueDate)}.`
      : 'Elige un repaso pendiente o escribe un identificador libre.';
    updateIntervalHint();
    showDialog(dialog);
    updateStudyPreview();
    setTimeout(() => {
      if (!extra) $('#studyCode').focus();
      else $('#studyComments').focus();
    }, 140);
  }

  function selectSuggestion(id) {
    const suggestion = state.study.suggestions.find((item) => item.review.id === Number(id));
    if (!suggestion) return;
    state.study.review = suggestion.review;
    $('#studyCode').value = suggestion.review.topic.code;
    $('#studyCodeHint').textContent = `Registrarás el repaso pendiente del ${formatMediumDate(suggestion.review.dueDate)}.`;
    $$('#studySuggestions .suggestion').forEach((button) => {
      button.classList.toggle('is-active', Number(button.dataset.suggestion) === Number(id));
    });
    $('#studyError').textContent = '';
  }

  function updateIntervalHint() {
    const hint = $('#intervalHint');
    if (state.study.manualDate) {
      hint.textContent = `Fecha manual: ${formatMediumDate(state.study.manualDate)}`;
      return;
    }
    const target = addDays(todayISO(), state.study.interval);
    hint.textContent = `Siguiente repaso el ${formatMediumDate(target)} (+${state.study.interval} días)`;
  }

  function studyTargetDate() {
    return state.study.manualDate || addDays(todayISO(), state.study.interval);
  }

  /** Elige desde la vista rápida la fecha exacta del siguiente repaso. */
  function pickStudyDate(date) {
    if (!date || date <= todayISO()) return;
    state.study.manualDate = date;
    $('#studyDate').value = date;
    $$('#intervalChips .chip').forEach((item) => item.classList.remove('is-active'));
    updateIntervalHint();
    updateStudyPreview();
  }

  /** Elige desde la vista rápida la nueva fecha de un repaso. */
  function pickMoveDate(date) {
    if (!date || date < todayISO()) return;
    const input = $('#moveDate');
    if (!input) return;
    input.value = date;
    updateMovePreview();
  }

  function loadStripRange(target) {
    const narrow = window.matchMedia('(max-width: 640px)').matches;
    const span = narrow ? 2 : 4;
    return { from: addDays(target, -span), to: addDays(target, span) };
  }

  async function updateStudyPreview() {
    const target = studyTargetDate();
    const sequence = ++state.previewSeq;
    const { from, to } = loadStripRange(target);
    const note = $('#loadPreviewNote');
    note.textContent = 'Calculando…';
    note.classList.remove('is-warning');

    try {
      const data = await api(`/api/calendar?from=${from}&to=${to}`);
      if (sequence !== state.previewSeq) return;
      renderLoadStrip($('#loadDays'), data, target, addDays(todayISO(), 1));
      const targetDay = data.days.find((day) => day.date === target);
      const count = targetDay ? targetDay.reviews.filter((review) => review.status === 'pending').length : 0;
      const isFull = count >= MAX_PER_DAY;
      note.textContent = isFull
        ? `Día completo (${count}/${MAX_PER_DAY}). Se buscará el hueco más cercano.`
        : `${count}/${MAX_PER_DAY} ocupados · queda${MAX_PER_DAY - count === 1 ? '' : 'n'} ${MAX_PER_DAY - count} ${plural(MAX_PER_DAY - count, 'hueco', 'huecos')}`;
      note.classList.toggle('is-warning', isFull);
    } catch (error) {
      if (sequence !== state.previewSeq) return;
      note.textContent = 'No se pudo cargar la previsión.';
    }
  }

  function renderLoadStrip(container, data, target, minDate) {
    if (!container) return;
    container.style.setProperty('--load-days', String(data.days.length || 1));
    if (minDate) container.dataset.minDate = minDate;
    container.innerHTML = data.days.map((day) => {
      const pending = day.reviews.filter((review) => review.status === 'pending').length;
      const meter = Array.from({ length: MAX_PER_DAY }, (_, index) => `<i class="${index < pending ? 'is-on' : ''}"></i>`).join('');
      const pickable = !minDate || day.date >= minDate;
      const title = pickable
        ? `${formatMediumDate(day.date)}: ${pending} de ${MAX_PER_DAY} · pulsa para usar esta fecha`
        : `${formatMediumDate(day.date)}: ${pending} de ${MAX_PER_DAY}`;
      return `
        <button type="button" class="load-day ${day.date === target ? 'is-target' : ''} ${pending >= MAX_PER_DAY ? 'is-full' : ''} ${pickable ? '' : 'is-past'}"
          data-date="${day.date}" ${pickable ? '' : 'aria-disabled="true"'} title="${esc(title)}">
          <span>${esc(WEEKDAYS_MINI[weekdayIndex(day.date)])} ${Number(day.date.slice(8, 10))}</span>
          <strong>${pending}</strong>
          <span class="load-meter">${meter}</span>
        </button>
      `;
    }).join('');
  }

  async function submitStudy(event) {
    event.preventDefault();
    const button = $('#studySubmit');
    const errorBox = $('#studyError');
    errorBox.textContent = '';

    const review = state.study.review;
    const typedCode = $('#studyCode').value.trim();
    if (!review && !typedCode) {
      errorBox.textContent = 'Escribe el tema que has estudiado o elige uno de la lista.';
      return;
    }

    const payload = {
      code: typedCode,
      comments: $('#studyComments').value.trim() || null,
    };
    if (review) payload.review_id = review.id;
    if (state.study.manualDate) payload.next_date = state.study.manualDate;
    else payload.next_interval = state.study.interval;

    setBusy(button, true);
    try {
      const result = await api('/api/studies', { method: 'POST', body: payload });
      afterStudySuccess(result);
    } catch (error) {
      if (error.status === 409 && error.data?.requiresConfirmation) {
        state.pendingConfirm = {
          kind: 'study',
          payload,
          topicCode: review ? review.topic.code : typedCode,
        };
        setBusy(button, false);
        showCollisions(error.data.collisions, async () => {
          const confirmed = await api('/api/studies', {
            method: 'POST',
            body: { ...payload, confirm: true },
          });
          afterStudySuccess(confirmed);
        });
        return;
      }
      errorBox.textContent = error.message;
      if (error.status === 0) toast(error.message, 'error');
    } finally {
      setBusy(button, false);
    }
  }

  function afterStudySuccess(result) {
    const first = result.nextReview;
    closeDialog($('#studyDialog'));
    closeDialog($('#collisionDialog'));
    state.study.review = null;
    if (first) {
      toast(`Estudio registrado. Próximo repaso: ${formatMediumDate(first)}.`);
    } else if (result.examReached) {
      toast('Estudio registrado. La fecha del examen ya está próxima: no hay repasos posteriores.', 'amber');
    } else {
      toast('Estudio registrado. No se han generado repasos posteriores.', 'amber');
    }
    refreshAfterMutation().catch((error) => toast(error.message, 'error'));
  }

  /* ------------------------------------------------------------------ */
  /* Modal: mover repaso                                                 */
  /* ------------------------------------------------------------------ */

  function openMove(review) {
    if (!review) return;
    state.move = { review };
    $('#moveTopicCode').textContent = review.topic.code;
    $('#moveTopicMeta').textContent = `Programado para ${formatMediumDate(review.dueDate)} · repaso de ${review.intervalDays} días`;
    const input = $('#moveDate');
    input.value = review.dueDate;
    input.min = todayISO();
    input.max = state.overview?.examDate || '';
    $('#moveError').textContent = '';
    showDialog($('#moveDialog'));
    updateMovePreview();
  }

  async function updateMovePreview() {
    const review = state.move.review;
    const value = $('#moveDate').value;
    const note = $('#movePreviewNote');
    if (!review || !value) {
      note.textContent = '';
      return;
    }
    const sequence = ++state.movePreviewSeq;
    const { from, to } = loadStripRange(value);
    note.textContent = 'Calculando…';
    note.classList.remove('is-warning');
    try {
      const data = await api(`/api/calendar?from=${from}&to=${to}`);
      if (sequence !== state.movePreviewSeq) return;
      renderLoadStrip($('#moveDays'), data, value, todayISO());
      const targetDay = data.days.find((day) => day.date === value);
      const count = targetDay
        ? targetDay.reviews.filter((reviewItem) => reviewItem.status === 'pending' && reviewItem.id !== review.id).length
        : 0;
      const isFull = count >= MAX_PER_DAY;
      note.textContent = isFull
        ? `Día completo (${count}/${MAX_PER_DAY}). Se ajustará la fecha.`
        : `${count}/${MAX_PER_DAY} ocupados sin contar este repaso`;
      note.classList.toggle('is-warning', isFull);
    } catch (error) {
      if (sequence !== state.movePreviewSeq) return;
      note.textContent = 'No se pudo cargar la previsión.';
    }
  }

  async function submitMove(event) {
    event.preventDefault();
    const review = state.move.review;
    const date = $('#moveDate').value;
    const errorBox = $('#moveError');
    errorBox.textContent = '';
    if (!review || !date) return;

    const button = $('#moveSubmit');
    setBusy(button, true);
    try {
      const result = await api(`/api/reviews/${review.id}`, {
        method: 'PATCH',
        body: { due_date: date },
      });
      afterMoveSuccess(result);
    } catch (error) {
      if (error.status === 409 && error.data?.requiresConfirmation) {
        state.pendingConfirm = {
          kind: 'move',
          reviewId: review.id,
          targetDate: date,
          topicCode: review.topic.code,
        };
        setBusy(button, false);
        showCollisions(error.data.collisions, async () => {
          const confirmed = await api(`/api/reviews/${review.id}`, {
            method: 'PATCH',
            body: { due_date: date, confirm: true },
          });
          afterMoveSuccess(confirmed);
        });
        return;
      }
      errorBox.textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  }

  function afterMoveSuccess(result) {
    closeDialog($('#moveDialog'));
    closeDialog($('#collisionDialog'));
    toast(`Repaso movido al ${formatMediumDate(result.targetDate)}. Se ha recalculado la cadencia.`);
    state.historyDirty = true;
    refreshAfterMutation().catch((error) => toast(error.message, 'error'));
  }

  /* ------------------------------------------------------------------ */
  /* Modal: planificar repaso                                            */
  /* ------------------------------------------------------------------ */

  function planTopicCodes() {
    const codes = new Set();
    const add = (code) => {
      if (code) codes.add(code);
    };
    state.overview?.todayItems?.forEach((review) => add(review.topic.code));
    state.overview?.overdue?.forEach((review) => add(review.topic.code));
    state.calendar?.days?.forEach((day) => day.reviews.forEach((review) => add(review.topic.code)));
    state.history?.topics?.forEach((topic) => add(topic.code));
    return Array.from(codes).sort((a, b) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' }));
  }

  function openPlan(date) {
    const target = date && parseISO(date) ? date : todayISO();
    state.plan.date = target;
    $('#planCode').value = '';
    $('#planDate').value = target;
    $('#planDate').min = todayISO();
    $('#planDate').max = state.overview?.examDate || '';
    $('#planError').textContent = '';
    $('#planHint').textContent = `Reservarás un repaso para el ${formatMediumDate(target)} sin registrar un estudio.`;
    fillPlanCodes();
    showDialog($('#planDialog'));
    if (!state.history) {
      loadHistory()
        .then(() => fillPlanCodes())
        .catch(() => {});
    }
    setTimeout(() => $('#planCode').focus(), 140);
  }

  function fillPlanCodes() {
    const list = $('#planCodeList');
    if (!list) return;
    const current = $('#planCode').value;
    list.innerHTML = planTopicCodes()
      .map((code) => `<option value="${esc(code)}"></option>`)
      .join('');
    if (current) $('#planCode').value = current;
  }

  async function submitPlan(event) {
    event.preventDefault();
    const button = $('#planSubmit');
    const errorBox = $('#planError');
    const code = $('#planCode').value.trim();
    const date = $('#planDate').value;
    errorBox.textContent = '';

    if (!code) {
      errorBox.textContent = 'Indica el tema que quieres planificar.';
      return;
    }
    if (!date) {
      errorBox.textContent = 'Elige la fecha del repaso.';
      return;
    }
    if (date < todayISO()) {
      errorBox.textContent = 'No puedes planificar un repaso en el pasado.';
      return;
    }

    setBusy(button, true);
    try {
      const result = await api('/api/plan', { method: 'POST', body: { code, due_date: date } });
      closeDialog($('#planDialog'));
      toast(`Repaso de ${result.topic.code} planificado para el ${formatMediumDate(result.dueDate)}.`);
      await refreshAfterMutation().catch((error) => toast(error.message, 'error'));
      goToDay(result.dueDate);
    } catch (error) {
      if (error.status === 409 && error.data?.suggestedDate) {
        const suggestion = error.data.suggestedDate;
        $('#planDate').value = suggestion;
        $('#planHint').textContent = `El día estaba completo. Se propone el ${formatMediumDate(suggestion)}: vuelve a guardar para aceptarlo.`;
        errorBox.textContent = 'Ese día ya tiene 3 temas. Ajusta la fecha propuesta o elige otra.';
      } else if (error.status === 409 && error.data?.error === 'duplicate') {
        errorBox.textContent = error.message;
      } else {
        errorBox.textContent = error.message;
      }
    } finally {
      setBusy(button, false);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Modal: fecha del examen                                             */
  /* ------------------------------------------------------------------ */

  function openExam() {
    $('#examDateModal').value = state.overview?.examDate || state.settings?.examDate || '';
    $('#examError').textContent = '';
    showDialog($('#examDialog'));
  }

  async function submitExam(event) {
    event.preventDefault();
    const button = $('#examSubmit');
    const value = $('#examDateModal').value;
    const errorBox = $('#examError');
    errorBox.textContent = '';
    setBusy(button, true);
    try {
      const result = await api('/api/settings', { method: 'PUT', body: { exam_date: value } });
      state.settingsDirty = true;
      if (state.settings) state.settings.examDate = result.examDate;
      closeDialog($('#examDialog'));
      toast(result.examDate ? `Fecha de examen: ${formatMediumDate(result.examDate)}.` : 'Fecha de examen eliminada.');
      await refreshData({ silent: true });
      if (state.view === 'settings') {
        await loadSettings(true);
        renderSettings();
      }
    } catch (error) {
      errorBox.textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Modal: eliminar repaso                                              */
  /* ------------------------------------------------------------------ */

  function openDelete(review) {
    if (!review) return;
    state.deleting = review;
    $('#deleteIntro').textContent = `Se eliminará el repaso de ${review.topic.code} previsto para el ${formatMediumDate(review.dueDate)}.`;
    $('#deleteError').textContent = '';
    closeDialog($('#moveDialog'));
    showDialog($('#deleteDialog'));
  }

  async function confirmDelete() {
    const review = state.deleting;
    if (!review) return;
    const button = $('#deleteConfirm');
    const errorBox = $('#deleteError');
    errorBox.textContent = '';
    setBusy(button, true);
    try {
      await api(`/api/reviews/${review.id}`, { method: 'DELETE' });
      closeDialog($('#deleteDialog'));
      state.deleting = null;
      toast(`Repaso de ${review.topic.code} eliminado.`);
      state.historyDirty = true;
      await refreshAfterMutation().catch((error) => toast(error.message, 'error'));
    } catch (error) {
      if (error.status === 404) {
        closeDialog($('#deleteDialog'));
        state.deleting = null;
        toast('Ese repaso ya no existía.', 'amber');
        await refreshAfterMutation().catch(() => {});
        return;
      }
      errorBox.textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Modal: deshacer estudio                                             */
  /* ------------------------------------------------------------------ */

  function openUndo(button) {
    const id = Number(button.dataset.undoReview);
    if (!id) return;
    state.undoing = {
      id,
      code: button.dataset.undoCode || 'el tema',
      date: button.dataset.undoDate || '',
    };
    $('#undoIntro').textContent = state.undoing.date
      ? `Se deshará el estudio de ${state.undoing.code} registrado el ${formatMediumDate(state.undoing.date)}.`
      : `Se deshará el estudio de ${state.undoing.code}.`;
    $('#undoError').textContent = '';
    showDialog($('#undoDialog'));
  }

  async function confirmUndo() {
    const target = state.undoing;
    if (!target) return;
    const button = $('#undoConfirm');
    const errorBox = $('#undoError');
    errorBox.textContent = '';
    setBusy(button, true);
    try {
      const result = await api(`/api/reviews/${target.id}/undo`, { method: 'POST', body: {} });
      closeDialog($('#undoDialog'));
      state.undoing = null;
      toast(
        result.restoredDate
          ? `Estudio deshecho. ${target.code} vuelve a estar pendiente el ${formatMediumDate(result.restoredDate)}.`
          : `Estudio de ${target.code} deshecho.`
      );
      state.historyDirty = true;
      state.settingsDirty = true;
      await refreshAfterMutation().catch((error) => toast(error.message, 'error'));
    } catch (error) {
      if (error.status === 404) {
        closeDialog($('#undoDialog'));
        state.undoing = null;
        toast('Ese estudio ya no existía.', 'amber');
        await refreshAfterMutation().catch(() => {});
        return;
      }
      errorBox.textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Modal: colisiones                                                   */
  /* ------------------------------------------------------------------ */

  function showCollisions(collisions, onConfirm) {
    const list = $('#collisionList');
    const topic = state.pendingConfirm?.topicCode || 'Tema';
    const intro = $('#collisionIntro');
    intro.textContent = collisions.length === 1
      ? 'El día elegido está completo. Echo propone este ajuste para respetar el máximo de 3 temas diarios.'
      : `Hay ${collisions.length} repasos que deben moverse para respetar el máximo de 3 temas diarios.`;

    list.innerHTML = collisions.map((collision) => {
      const delta = collision.adjustedDate > collision.plannedDate ? '+' : '';
      const days = `${delta}${diffDays(collision.plannedDate, collision.adjustedDate)} ${plural(Math.abs(diffDays(collision.plannedDate, collision.adjustedDate)), 'día', 'días')}`;
      return `
        <li class="collision-item">
          <span class="collision-item-icon"><svg class="icon"><use href="#i-move"></use></svg></span>
          <div class="collision-item-main">
            <strong>${esc(topic)}</strong> pasa del <strong>${esc(formatMediumDate(collision.plannedDate))}</strong>
            al <strong>${esc(formatMediumDate(collision.adjustedDate))}</strong> por exceso de carga.
          </div>
          <span class="collision-item-days">${esc(days)}</span>
        </li>
      `;
    }).join('');

    $('#collisionError').textContent = '';
    const confirmButton = $('#collisionConfirm');
    confirmButton.onclick = async () => {
      confirmButton.disabled = true;
      $('#collisionError').textContent = '';
      try {
        await onConfirm();
      } catch (error) {
        $('#collisionError').textContent = error.message;
      } finally {
        confirmButton.disabled = false;
      }
    };
    showDialog($('#collisionDialog'));
  }

  /* ------------------------------------------------------------------ */
  /* Historial                                                           */
  /* ------------------------------------------------------------------ */

  function filteredHistoryTopics() {
    if (!state.history) return [];
    const query = state.historyQuery.trim().toLowerCase();
    const topics = state.history.topics.filter((topic) => !query || topic.code.toLowerCase().includes(query));
    if (state.historySort === 'topic') {
      topics.sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true, sensitivity: 'base' }));
    } else {
      topics.sort((a, b) => {
        if (!a.lastStudy && !b.lastStudy) return a.code.localeCompare(b.code, 'es', { numeric: true });
        if (!a.lastStudy) return 1;
        if (!b.lastStudy) return -1;
        return a.lastStudy < b.lastStudy ? 1 : a.lastStudy > b.lastStudy ? -1 : 0;
      });
    }
    return topics;
  }

  function renderHistory() {
    if (!state.history) return;
    const stats = state.history.stats;
    $('#historyStats').innerHTML = `
      <article class="stat-card is-accent">
        <p class="stat-label">Temas registrados</p>
        <p class="stat-value">${stats.topics}</p>
        <p class="stat-sub">en tu sistema de arrastre</p>
      </article>
      <article class="stat-card">
        <p class="stat-label">Repasos completados</p>
        <p class="stat-value">${stats.studies}</p>
        <p class="stat-sub">cada vuelta suma</p>
      </article>
      <article class="stat-card">
        <p class="stat-label">Media por tema</p>
        <p class="stat-value">${String(stats.average).replace('.', ',')}</p>
        <p class="stat-sub">repasos de media</p>
      </article>
      <article class="stat-card">
        <p class="stat-label">Última sesión</p>
        <p class="stat-value" style="font-size:22px;line-height:1.3">${stats.lastStudy ? esc(formatShortDate(stats.lastStudy)) : '—'}</p>
        <p class="stat-sub">${stats.lastStudy ? esc(relativeDays(stats.lastStudy)) : 'aún sin repasos'}</p>
      </article>
    `;
    renderHistoryList();
  }

  function renderHistoryList() {
    const container = $('#historyList');
    const topics = filteredHistoryTopics();
    if (!topics.length) {
      const hasAny = state.history?.topics?.length > 0;
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-art"><svg class="icon"><use href="#i-${hasAny ? 'search' : 'book'}"></use></svg></div>
          <h3>${hasAny ? 'Sin coincidencias' : 'Aún no hay historial'}</h3>
          <p>${hasAny ? 'Prueba con otro número o identificador de tema.' : 'Registra tu primer estudio y Echo empezará a construir la cadencia de repasos.'}</p>
          ${hasAny ? '' : '<button type="button" class="btn btn-primary btn-sm" data-action="open-study">Registrar primer estudio</button>'}
        </div>
      `;
      return;
    }

    container.innerHTML = topics.map((topic) => {
      const timeline = topic.done.map((review, index) => `
        <li class="timeline-item ${index === 0 ? 'is-first' : ''}">
          <span class="timeline-dot"></span>
          <div class="timeline-main">
            <div class="timeline-head">
              <strong>${esc(formatMediumDate(review.completedOn))}</strong>
              <span>repaso de ${review.intervalDays} días · programado ${esc(formatShortDate(review.dueDate))}</span>
            </div>
            ${review.comments ? `<p class="timeline-note">${esc(review.comments)}</p>` : ''}
          </div>
          <button type="button" class="icon-btn is-danger timeline-undo" data-undo-review="${review.id}" data-undo-code="${esc(topic.code)}" data-undo-date="${esc(review.completedOn || review.dueDate)}" title="Deshacer este estudio" aria-label="Deshacer el estudio del ${esc(formatMediumDate(review.completedOn))}">
            <svg class="icon"><use href="#i-undo"></use></svg>
          </button>
        </li>
      `).join('');

      return `
        <details class="topic-card">
          <summary>
            <span class="topic-code">${esc(shortCode(topic.code, 12))}</span>
            <span class="topic-title">
              <strong>${esc(topic.code)}</strong>
              <span>${topic.totalStudies} ${plural(topic.totalStudies, 'repaso', 'repasos')}${topic.lastStudy ? ` · último ${formatMediumDate(topic.lastStudy)}` : ''}</span>
            </span>
            <span class="topic-badges">
              ${topic.nextDue ? `<span class="badge is-green">Próximo ${esc(formatShortDate(topic.nextDue))}</span>` : '<span class="badge">Sin repasos futuros</span>'}
              <span class="badge">${topic.totalStudies}×</span>
            </span>
            <svg class="icon topic-chevron"><use href="#i-chevron-down"></use></svg>
          </summary>
          <div class="topic-body">
            ${timeline ? `<ul class="timeline">${timeline}</ul>` : '<p class="hint">Sin repasos completados todavía.</p>'}
            ${topic.pending.length ? `
              <div class="topic-pending">
                <p class="topic-pending-label">Próximos repasos</p>
                <div class="pending-chips">
                  ${topic.pending.slice(0, 12).map((review) => `<span class="pending-chip">${esc(formatShortDate(review.dueDate))}</span>`).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        </details>
      `;
    }).join('');
  }

  /* ------------------------------------------------------------------ */
  /* Ajustes                                                             */
  /* ------------------------------------------------------------------ */

  function renderSettings() {
    const container = $('#settingsContent');
    if (!isAdmin()) {
      container.innerHTML = '';
      return;
    }
    if (!state.settings) {
      container.innerHTML = '<div class="loading-block"><span class="spinner"></span></div>';
      return;
    }
    const settings = state.settings;
    const overview = state.overview || { totals: { topics: 0, done: 0, pending: 0 }, daysToExam: null };
    const signal = settings.signal || overview.signal;
    const origin = location.origin;
    const apiConfigured = settings.apiTokenConfigured;
    const intervals = settings.intervals || [3, 7, 14, 21, 30];
    const installAvailable = Boolean(state.installPrompt) && !window.matchMedia('(display-mode: standalone)').matches;

    const examCard = `
      <section class="panel setting-card">
        <div class="setting-head">
          <span class="setting-icon"><svg class="icon"><use href="#i-calendar"></use></svg></span>
          <div>
            <h3>Fecha del examen</h3>
            <p>El punto final de la cascada. Echo no programará repasos más allá de este día.</p>
          </div>
        </div>
        <form class="exam-form" id="examForm">
          <div class="field">
            <label for="examDateInput">Día del examen</label>
            <input class="input" type="date" id="examDateInput" value="${esc(settings.examDate || '')}">
          </div>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </form>
        <div class="setting-row">
          <span>Cuenta atrás</span>
          <strong class="setting-value">${settings.examDate ? `${Math.max(0, overview.daysToExam)} días` : 'Sin definir'}</strong>
        </div>
        <div class="setting-row">
          <span>Proyección</span>
          <strong>${settings.examDate ? `hasta ${esc(formatMediumDate(settings.examDate))}` : 'cascada de 365 días'}</strong>
        </div>
        <p class="hint">Cambiar la fecha afecta a los repasos que registres a partir de ahora; las planificaciones ya guardadas conservan su cadencia.</p>
        <p class="form-error" id="settingsExamError" role="alert"></p>
      </section>
    `;

    const planCard = `
      <section class="panel setting-card">
        <div class="setting-head">
          <span class="setting-icon"><svg class="icon"><use href="#i-sparkle"></use></svg></span>
          <div>
            <h3>Planificación</h3>
            <p>La curva del olvido, resuelta con una cadencia que se recalcula sola.</p>
          </div>
        </div>
        <div class="ladder" aria-label="Escalón de intervalos">
          ${intervals.map((interval, index) => `
            <span>${interval}d</span>${index < intervals.length - 1 ? '<i>→</i>' : '<i>→</i><span>30d…</span>'}
          `).join('')}
        </div>
        <div class="setting-row">
          <span>Máximo por día</span>
          <strong>${settings.maxPerDay} temas</strong>
        </div>
        <div class="setting-row">
          <span>Colisiones 3 y 7 días</span>
          <strong>Buscar hacia delante</strong>
        </div>
        <div class="setting-row">
          <span>Colisiones 14 días o más</span>
          <strong>Buscar hacia atrás</strong>
        </div>
        <p class="hint">Si el hueco preferente está lleno, la búsqueda se expande en ambas direcciones. Cada ajuste te pide confirmación.</p>
      </section>
    `;

    const accessCard = `
      <section class="panel setting-card">
        <div class="setting-head">
          <span class="setting-icon"><svg class="icon"><use href="#i-shield"></use></svg></span>
          <div>
            <h3>Acceso y seguridad</h3>
            <p>Perfiles y sesión de este dispositivo.</p>
          </div>
        </div>
        <div class="setting-row"><span>Perfil activo</span><strong>Administración</strong></div>
        <div class="setting-row"><span>PIN de usuario</span><strong>${settings.appPinConfigured ? 'Configurado' : 'No configurado'}</strong></div>
        <div class="setting-row"><span>PIN de administración</span><strong>${settings.adminPinConfigured ? 'Configurado' : 'Usa el PIN de usuario'}</strong></div>
        <div class="setting-row"><span>Sesión</span><strong>30 días por dispositivo</strong></div>
        <div class="setting-row"><span>Cookie</span><strong>HttpOnly · SameSite Lax</strong></div>
        <div class="settings-actions">
          ${installAvailable ? '<button type="button" class="btn btn-soft" data-action="install"><svg class="icon icon-sm"><use href="#i-install"></use></svg> Instalar app</button>' : ''}
          <button type="button" class="btn btn-ghost" data-action="logout"><svg class="icon icon-sm"><use href="#i-logout"></use></svg> Cerrar sesión</button>
        </div>
      </section>
    `;

    const signalCard = `
      <section class="panel setting-card">
        <div class="setting-head">
          <span class="setting-icon"><svg class="icon"><use href="#i-heart"></use></svg></span>
          <div>
            <h3>Señal de vida</h3>
            <p>Un corazón en el calendario y un recordatorio visual si pasan los días.</p>
          </div>
        </div>
        <div class="setting-row">
          <span>Última señal</span>
          <strong>${signal?.last ? `${esc(formatMediumDate(signal.last.date))} · ${esc(relativeDays(signal.last.date))}` : 'Sin señales'}</strong>
        </div>
        <div class="setting-row">
          <span>Estado del ciclo</span>
          <strong>${signal?.currentSymbol || '—'} ${signal?.last ? `${signal.daysSince} ${plural(signal.daysSince, 'día', 'días')}` : ''}</strong>
        </div>
        <div class="settings-actions">
          <button type="button" class="btn btn-soft" data-action="mark-signal"><svg class="icon icon-sm"><use href="#i-heart"></use></svg> Marcar señal ahora</button>
        </div>
        <p class="hint">❤️ el día de la señal · 😢 +7 días · 😭 +14 días · 💔 +21 días y un corazón roto más cada 5 días. Cada marca aparece en el calendario dos días antes de su fecha y se queda una vez alcanzada; el ciclo se reinicia con una nueva señal.</p>
      </section>
    `;

    const apiCard = `
      <section class="panel setting-card is-wide">
        <div class="setting-head">
          <span class="setting-icon"><svg class="icon"><use href="#i-database"></use></svg></span>
          <div>
            <h3>API externa · señal desde Home Assistant</h3>
            <p>Registra una señal desde una automatización, un botón físico o cualquier servicio externo.</p>
          </div>
        </div>
        <div class="api-block">
          <div class="api-line">
            <span class="method">POST</span>
            <code>${esc(origin)}/api/signal</code>
            <span class="status-line ${apiConfigured ? '' : 'is-warning'}"><span class="dot"></span>${apiConfigured ? 'Token configurado' : 'Configura API_TOKEN'}</span>
          </div>
          <div class="api-line">Cabecera <code>x-api-token: TU_TOKEN</code> · también admite <code>Authorization: Bearer TU_TOKEN</code>.</div>
        </div>
        <pre class="code-block">curl -X POST "${esc(origin)}/api/signal" \\
  -H "x-api-token: $API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"source":"home-assistant","note":"Sigo aquí"}'</pre>
        <details>
          <summary class="hint" style="cursor:pointer">Ejemplo de automatización en Home Assistant</summary>
          <pre class="code-block" style="margin-top:8px">rest_command:
  echo_signal:
    url: "${esc(origin)}/api/signal"
    method: POST
    headers:
      x-api-token: !secret echo_api_token
    payload: '{"source":"home-assistant"}'

automation:
  - alias: "Echo · señal diaria"
    triggers:
      - trigger: time
        at: "21:30:00"
    actions:
      - action: rest_command.echo_signal</pre>
        </details>
        ${apiConfigured ? '' : '<p class="hint">La API está desactivada hasta que definas <code class="code-inline">API_TOKEN</code> en el add-on o en docker-compose.</p>'}
      </section>
    `;

    const dataCard = `
      <section class="panel setting-card is-wide">
        <div class="setting-head">
          <span class="setting-icon"><svg class="icon"><use href="#i-download"></use></svg></span>
          <div>
            <h3>Datos, copias y restauración</h3>
            <p>Exporta, restaura una copia o empieza de cero.</p>
          </div>
        </div>
        <div class="setting-row"><span>Temas · repasos · pendientes · señales</span><strong>${overview.totals.topics} · ${overview.totals.done + overview.totals.pending} · ${overview.totals.pending} · ${signal?.total || 0}</strong></div>
        <div class="setting-row"><span>Almacenamiento</span><strong>${esc(settings.storage)}</strong></div>

        <p class="setting-sub">Exportar</p>
        <div class="settings-actions">
          <button type="button" class="btn btn-ghost" data-action="export-json"><svg class="icon icon-sm"><use href="#i-download"></use></svg> Copia JSON</button>
          <button type="button" class="btn btn-ghost" data-action="export-csv"><svg class="icon icon-sm"><use href="#i-download"></use></svg> CSV de datos</button>
          <button type="button" class="btn btn-ghost" data-action="print"><svg class="icon icon-sm"><use href="#i-printer"></use></svg> Imprimir / PDF</button>
        </div>

        <p class="setting-sub">Restaurar</p>
        <p class="hint">Acepta la copia JSON de Echo o el CSV de datos. La restauración <strong>reemplaza</strong> los datos actuales.</p>
        <div class="settings-actions">
          <button type="button" class="btn btn-soft" data-action="pick-backup">
            <svg class="icon icon-sm"><use href="#i-upload"></use></svg>
            Elegir archivo…
          </button>
          <input type="file" id="backupFile" accept=".json,.csv,application/json,text/csv" hidden>
        </div>

        <div class="danger-zone">
          <span class="danger-title">Zona delicada</span>
          <p class="hint">Borra todos los temas, repasos y señales para empezar de cero.</p>
          <button type="button" class="btn btn-danger" data-action="open-reset">
            <svg class="icon icon-sm"><use href="#i-trash"></use></svg>
            Empezar de cero
          </button>
        </div>
      </section>
    `;

    const aboutCard = `
      <section class="panel setting-card">
        <div class="setting-head">
          <span class="setting-icon"><svg class="icon"><use href="#i-book"></use></svg></span>
          <div>
            <h3>Acerca de Echo</h3>
            <p>Repaso espaciado para oposiciones · v${esc(settings.version)}</p>
          </div>
        </div>
        <p class="hint">${window.isSecureContext
          ? 'Echo funciona como PWA. Añádela a la pantalla de inicio para usarla a pantalla completa y también sin conexión.'
          : 'Estás usando Echo por HTTP en tu red local. Para tenerla como icono en el móvil, abre el menú del navegador y elige «Añadir a pantalla de inicio». El modo sin conexión necesita HTTPS, pero el resto de la app funciona igual.'}</p>
        <div class="setting-row"><span>Servidor</span><strong>${settings.isAddon ? 'Home Assistant Add-on' : 'Docker'}</strong></div>
        <div class="setting-row"><span>Datos</span><strong>SQLite local</strong></div>
        <p class="footer-note">Hecho para tu memoria.</p>
      </section>
    `;

    container.innerHTML = examCard + planCard + accessCard + signalCard + apiCard + dataCard + aboutCard;
  }

  /* ------------------------------------------------------------------ */
  /* Exportar / imprimir                                                 */
  /* ------------------------------------------------------------------ */

  async function downloadExport(format) {
    try {
      const response = await fetch(`/api/export?format=${format}`, { credentials: 'same-origin' });
      if (response.status === 401) {
        handleUnauthorized();
        return;
      }
      if (!response.ok) throw new Error('No se pudo generar la exportación.');
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match ? match[1] : `echo-export.${format}`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast(`Exportación ${format.toUpperCase()} descargada.`);
    } catch (error) {
      toast(error.message || 'No se pudo exportar.', 'error');
    }
  }

  async function printReport() {
    let data;
    try {
      data = await api('/api/export?format=json');
    } catch (error) {
      toast(error.message, 'error');
      return;
    }

    const win = window.open('', '_blank');
    if (!win) {
      toast('El navegador ha bloqueado la ventana de impresión. Permite las ventanas emergentes.', 'error');
      return;
    }

    const settings = data.settings || {};
    const exam = settings.examDate ? formatMediumDate(settings.examDate) : 'Sin definir';
    const topics = data.topics || [];
    const reviews = data.reviews || [];
    const pending = reviews.filter((review) => review.status === 'pending');
    const done = reviews.filter((review) => review.status === 'done');

    const pendingByDate = new Map();
    pending.forEach((review) => {
      if (!pendingByDate.has(review.due_date)) pendingByDate.set(review.due_date, []);
      pendingByDate.get(review.due_date).push(review);
    });
    const pendingDates = Array.from(pendingByDate.keys()).sort();

    const byTopic = new Map();
    done.forEach((review) => {
      if (!byTopic.has(review.topic_id)) byTopic.set(review.topic_id, []);
      byTopic.get(review.topic_id).push(review);
    });

    const topicName = new Map(topics.map((topic) => [topic.id, topic.code]));

    const printEsc = (value) => esc(value);

    const planRows = pendingDates.map((date) => `
      <div class="print-day">
        <h3>${printEsc(formatLongDate(date))}</h3>
        ${pendingByDate.get(date).map((review) => `
          <div class="print-row">
            <span>${printEsc(topicName.get(review.topic_id) || `Tema ${review.topic_id}`)}</span>
            <span class="print-meta">repaso de ${review.interval_days} días</span>
          </div>
        `).join('')}
      </div>
    `).join('');

    const historyRows = topics.map((topic) => {
      const items = (byTopic.get(topic.id) || []).sort((a, b) => (a.completed_on < b.completed_on ? -1 : 1));
      if (!items.length) return '';
      return `
        <div class="print-topic">
          <h3>${printEsc(topic.code)} <span>${items.length} ${items.length === 1 ? 'repaso' : 'repasos'}</span></h3>
          ${items.map((review) => `
            <div class="print-review">
              <strong>${printEsc(formatMediumDate(review.completed_on || review.due_date))}</strong>
              <span>+${review.interval_days} días</span>
              ${review.comments ? `<p>${printEsc(review.comments)}</p>` : ''}
            </div>
          `).join('')}
        </div>
      `;
    }).join('');

    const generated = formatLongDate(todayISO());

    const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Echo · Planificación e historial</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: #0f172a; font-size: 10pt; line-height: 1.45; }
  h1, h2, h3 { margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 14px; border-bottom: 2px solid #007a33; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand img { width: 38px; height: 38px; border-radius: 9px; }
  .brand strong { font-family: Georgia, 'Times New Roman', serif; font-size: 24px; font-weight: 400; color: #003d1a; }
  .head-meta { text-align: right; font-size: 8pt; color: #64748b; }
  .head-meta strong { display: block; font-size: 10pt; color: #00562a; }
  .summary { display: flex; gap: 8px; margin: 16px 0 22px; }
  .summary div { flex: 1; padding: 9px 11px; border: 1px solid #e2e8f0; border-radius: 7px; }
  .summary span { display: block; font-size: 7pt; letter-spacing: .08em; text-transform: uppercase; color: #94a3b8; }
  .summary strong { font-size: 15pt; font-weight: 600; color: #00562a; }
  h2 { margin: 22px 0 10px; padding-bottom: 5px; border-bottom: 1px solid #e2e8f0; font-family: Georgia, 'Times New Roman', serif; font-size: 16pt; font-weight: 400; color: #003d1a; }
  .print-day { margin-bottom: 10px; break-inside: avoid; }
  .print-day h3 { font-size: 9.5pt; color: #00562a; margin-bottom: 3px; }
  .print-row { display: flex; justify-content: space-between; gap: 10px; padding: 3px 0 3px 10px; border-left: 2px solid #d7efe1; }
  .print-meta { font-size: 7.5pt; color: #94a3b8; }
  .print-topic { margin-bottom: 13px; break-inside: avoid; }
  .print-topic h3 { font-size: 10.5pt; color: #0f172a; margin-bottom: 5px; }
  .print-topic h3 span { font-weight: 400; font-size: 8pt; color: #94a3b8; }
  .print-review { padding: 3px 0 3px 10px; border-left: 2px solid #d7efe1; }
  .print-review strong { font-size: 9pt; font-weight: 600; }
  .print-review span { margin-left: 6px; font-size: 7.5pt; color: #94a3b8; }
  .print-review p { margin: 3px 0 0; font-size: 8.5pt; color: #475569; white-space: pre-wrap; }
  .foot { margin-top: 26px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 7pt; color: #94a3b8; display: flex; justify-content: space-between; }
  .empty { font-size: 9pt; color: #94a3b8; }
  @media print { .no-print { display: none; } }
</style>
</head>
<body>
  <div class="head">
    <div class="brand">
      <img src="${location.origin}/icons/icon-192.png" alt="">
      <strong>Echo</strong>
    </div>
    <div class="head-meta">
      Planificación e historial<br>
      Examen: <strong>${printEsc(exam)}</strong>
      Generado el ${printEsc(generated)}
    </div>
  </div>
  <div class="summary">
    <div><span>Temas</span><strong>${topics.length}</strong></div>
    <div><span>Repasos realizados</span><strong>${done.length}</strong></div>
    <div><span>Repasos pendientes</span><strong>${pending.length}</strong></div>
    <div><span>Señales</span><strong>${(data.signals || []).length}</strong></div>
  </div>

  <h2>Planificación pendiente</h2>
  ${planRows || '<p class="empty">No hay repasos pendientes.</p>'}

  <h2>Historial de repasos</h2>
  ${historyRows || '<p class="empty">Todavía no hay repasos completados.</p>'}

  <div class="foot"><span>Echo · Repaso espaciado para oposiciones</span></div>
</body>
</html>`;

    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => {
      try {
        win.print();
      } catch (_) {
        // noop
      }
    }, 500);
  }

  /* ------------------------------------------------------------------ */
  /* Mantenimiento: reset y restauración                                 */
  /* ------------------------------------------------------------------ */

  function openReset() {
    const totals = state.overview?.totals || { topics: 0, done: 0, pending: 0 };
    $('#resetIntro').textContent = `Se borrarán ${totals.topics} ${plural(totals.topics, 'tema', 'temas')}, ${totals.done + totals.pending} ${plural(totals.done + totals.pending, 'repaso', 'repasos')} y todas las señales.`;
    $('#resetKeepSettings').checked = true;
    $('#resetError').textContent = '';
    showDialog($('#resetDialog'));
  }

  async function confirmReset() {
    const button = $('#resetConfirm');
    const errorBox = $('#resetError');
    errorBox.textContent = '';
    setBusy(button, true);
    try {
      await api('/api/reset', {
        method: 'POST',
        body: { keep_settings: $('#resetKeepSettings').checked },
      });
      closeDialog($('#resetDialog'));
      toast('Base de datos vacía. Listo para empezar.');
      await refreshAfterMutation().catch((error) => toast(error.message, 'error'));
    } catch (error) {
      errorBox.textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  }

  /** Convierte un CSV de repasos en el mismo formato que la copia JSON. */
  function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    const source = text.replace(/^\uFEFF/, '');
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (quoted) {
        if (char === '"') {
          if (source[index + 1] === '"') {
            field += '"';
            index += 1;
          } else {
            quoted = false;
          }
        } else {
          field += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ',') {
        row.push(field);
        field = '';
      } else if (char === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (char !== '\r') {
        field += char;
      }
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((cells) => cells.some((cell) => String(cell).trim() !== ''));
  }

  function backupFromCsv(text) {
    const rows = parseCsvRows(text);
    if (!rows.length) throw new Error('El CSV está vacío.');
    const header = rows[0].map((cell) => String(cell).trim().toLowerCase());
    const column = (...names) => header.findIndex((name) => names.some((candidate) => name.startsWith(candidate)));
    const iType = column('tipo');
    const iTopic = column('tema');
    const iDue = column('fecha planificada', 'fecha');
    const iStatus = column('estado');
    const iDone = column('fecha completado', 'completado');
    const iInterval = column('intervalo');
    const iNotes = column('comentario', 'nota');
    if (iDue < 0 || (iTopic < 0 && iType < 0)) {
      throw new Error('El CSV no tiene las columnas esperadas (Tema y Fecha).');
    }

    const timestamp = new Date().toISOString();
    const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);
    const cell = (row, index) => (index >= 0 ? String(row[index] ?? '').trim() : '');
    const topics = [];
    const byCode = new Map();
    const reviews = [];
    const signals = [];

    for (const row of rows.slice(1)) {
      const type = cell(row, iType).toLowerCase();
      // Filas de señal (formato «Tipo»): no llevan tema ni repaso.
      if (type.startsWith('señal') || type.startsWith('senal') || type.startsWith('signal')) {
        const date = cell(row, iDue);
        if (!isDate(date)) continue;
        const note = cell(row, iNotes);
        signals.push({ date, received_at: `${date}T00:00:00.000Z`, source: 'import', note: note || null });
        continue;
      }

      const code = cell(row, iTopic);
      const due = cell(row, iDue);
      if (!code || !isDate(due)) continue;

      const key = code.toLowerCase();
      let topicId = byCode.get(key);
      if (topicId === undefined) {
        topicId = topics.length + 1;
        topics.push({ id: topicId, code, created_at: timestamp, updated_at: timestamp });
        byCode.set(key, topicId);
      }

      const statusText = cell(row, iStatus).toLowerCase();
      const isDone = statusText.startsWith('complet') || statusText === 'done';
      const completedOn = cell(row, iDone);
      const rawInterval = Number(cell(row, iInterval).replace(',', '.'));
      const notes = cell(row, iNotes);

      reviews.push({
        topic_id: topicId,
        due_date: due,
        interval_days: Number.isFinite(rawInterval) ? Math.max(0, Math.round(rawInterval)) : 0,
        status: isDone ? 'done' : 'pending',
        completed_on: isDone && isDate(completedOn) ? completedOn : null,
        comments: notes || null,
        origin: 'auto',
        created_at: timestamp,
        updated_at: timestamp,
      });
    }

    if (!topics.length && !signals.length) throw new Error('El CSV no contiene repasos ni señales.');
    return { app: 'echo', source: 'csv', settings: {}, topics, reviews, signals };
  }

  function backupSummary(payload, name) {
    const topics = Array.isArray(payload.topics) ? payload.topics : [];
    const reviews = Array.isArray(payload.reviews) ? payload.reviews : [];
    const signals = Array.isArray(payload.signals) ? payload.signals : [];
    if (!topics.length && !reviews.length && !signals.length) {
      throw new Error('El archivo no contiene datos de Echo.');
    }
    return {
      name,
      topics: topics.length,
      done: reviews.filter((review) => review && review.status === 'done').length,
      pending: reviews.filter((review) => !review || review.status !== 'done').length,
      signals: signals.length,
    };
  }

  function openRestore(summary) {
    $('#restoreIntro').textContent = `Archivo «${summary.name}». Esto es lo que contiene:`;
    $('#restoreSummary').innerHTML = `
      <li><span>Temas</span><strong>${summary.topics}</strong></li>
      <li><span>Repasos completados</span><strong>${summary.done}</strong></li>
      <li><span>Repasos pendientes</span><strong>${summary.pending}</strong></li>
      <li><span>Señales</span><strong>${summary.signals}</strong></li>
    `;
    const warning = $('#restoreWarning');
    if (warning) {
      warning.textContent = summary.signals === 0
        ? 'Esta copia no incluye señales: las actuales se quedarán a cero.'
        : '';
      warning.hidden = summary.signals !== 0;
    }
    $('#restoreError').textContent = '';
    showDialog($('#restoreDialog'));
  }

  async function handleBackupFile(file) {
    if (!file) return;
    const isCsv = /\.csv$/i.test(file.name);
    try {
      const text = await file.text();
      let payload;
      if (isCsv) {
        payload = backupFromCsv(text);
      } else {
        try {
          payload = JSON.parse(text);
        } catch (_) {
          throw new Error('El archivo no es una copia válida de Echo.');
        }
      }
      const summary = backupSummary(payload, file.name);
      state.restore = { payload };
      openRestore(summary);
    } catch (error) {
      state.restore = null;
      toast(error.message || 'No se pudo leer el archivo.', 'error');
    }
  }

  async function confirmRestore() {
    const payload = state.restore?.payload;
    if (!payload) return;
    const button = $('#restoreConfirm');
    const errorBox = $('#restoreError');
    errorBox.textContent = '';
    setBusy(button, true);
    try {
      const result = await api('/api/restore', { method: 'POST', body: { data: payload } });
      closeDialog($('#restoreDialog'));
      state.restore = null;
      const restored = result.restored || {};
      toast(`Copia restaurada: ${restored.topicsIn || 0} temas y ${restored.reviewsIn || 0} repasos.`);
      await refreshAfterMutation().catch((error) => toast(error.message, 'error'));
    } catch (error) {
      errorBox.textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Señal / sesión / instalación                                        */
  /* ------------------------------------------------------------------ */

  async function markSignal(button) {
    if (!isAdmin()) return;
    if (button) button.disabled = true;
    try {
      await api('/api/signals', { method: 'POST', body: {} });
      toast('Señal registrada ❤️ El ciclo empieza de nuevo.');
      state.settingsDirty = true;
      await refreshData({ silent: true });
      if (state.view === 'settings') {
        await loadSettings(true);
        renderSettings();
      }
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function logout() {
    try {
      await api('/api/logout', { method: 'POST' });
    } catch (_) {
      // noop
    }
    state.auth = false;
    state.role = null;
    state.overview = null;
    state.calendar = null;
    state.history = null;
    state.settings = null;
    localStorage.removeItem(AUTH_FLAG);
    localStorage.removeItem(ROLE_KEY);
    closeAllDialogs();
    $('#app').hidden = true;
    $('#authGate').hidden = false;
    $('#pinInput').value = '';
    $('#pinError').textContent = '';
    setTimeout(() => $('#pinInput').focus(), 80);
    history.replaceState(null, '', location.pathname);
  }

  async function installApp() {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    try {
      await state.installPrompt.userChoice;
    } catch (_) {
      // noop
    }
    state.installPrompt = null;
    if (state.view === 'settings') renderSettings();
  }

  /* ------------------------------------------------------------------ */
  /* Eventos                                                             */
  /* ------------------------------------------------------------------ */

  function bindStaticEvents() {
    $('#pinForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = $('#pinInput');
      const button = $('#pinSubmit');
      const errorBox = $('#pinError');
      errorBox.textContent = '';
      const pin = input.value.trim();
      if (!pin) {
        errorBox.textContent = 'Introduce tu PIN.';
        return;
      }
      const original = button.innerHTML;
      button.disabled = true;
      button.innerHTML = '<span class="spinner" style="width:15px;height:15px;border-width:1.5px"></span><span>Comprobando…</span>';
      try {
        const result = await api('/api/auth', { method: 'POST', body: { pin } });
        localStorage.setItem(AUTH_FLAG, '1');
        state.auth = true;
        state.role = result.role === 'admin' ? 'admin' : 'user';
        state.version = result.version || null;
        localStorage.setItem(ROLE_KEY, state.role);
        input.value = '';
        $('#authGate').hidden = true;
        $('#app').hidden = false;
        applyRole();
        await refreshData({ silent: true });
        switchView(hashView(), { push: false });
      } catch (error) {
        errorBox.textContent = error.message;
        input.select();
      } finally {
        button.disabled = false;
        button.innerHTML = original;
      }
    });

    document.addEventListener('click', (event) => {
      const nav = event.target.closest('[data-nav]');
      if (nav) {
        event.preventDefault();
        navigate(nav.dataset.nav);
        return;
      }

      const closer = event.target.closest('[data-close]');
      if (closer) {
        const dialog = document.getElementById(closer.dataset.close);
        if (dialog) closeDialog(dialog);
        return;
      }

      const openReview = event.target.closest('[data-open-review]');
      if (openReview) {
        const review = findReviewInState(openReview.dataset.openReview);
        if (review) {
          event.preventDefault();
          event.stopPropagation();
          openStudy({ review });
        }
        return;
      }

      const undoReview = event.target.closest('[data-undo-review]');
      if (undoReview) {
        event.preventDefault();
        event.stopPropagation();
        openUndo(undoReview);
        return;
      }

      const deleteReview = event.target.closest('[data-delete-review]');
      if (deleteReview) {
        const review = findReviewInState(deleteReview.dataset.deleteReview);
        if (review) {
          event.preventDefault();
          event.stopPropagation();
          openDelete(review);
        }
        return;
      }

      const moveReview = event.target.closest('[data-move-review]');
      if (moveReview) {
        const review = findReviewInState(moveReview.dataset.moveReview);
        if (review) {
          event.preventDefault();
          event.stopPropagation();
          openMove(review);
        }
        return;
      }

      const action = event.target.closest('[data-action]');
      if (action) {
        event.preventDefault();
        handleAction(action);
      }
    });

    $('#calendarStage').addEventListener('click', (event) => {
      const chip = event.target.closest('.review-chip');
      if (chip) {
        const id = chip.dataset.reviewId;
        if (id) {
          event.stopPropagation();
          const review = findReviewInState(id);
          if (review) openStudy({ review });
          return;
        }
      }
      const weekCard = event.target.closest('.week-card');
      if (weekCard && weekCard.dataset.reviewId) {
        event.stopPropagation();
        const review = findReviewInState(weekCard.dataset.reviewId);
        if (review) openStudy({ review });
        return;
      }
      const cell = event.target.closest('[data-date]');
      if (cell) goToDay(cell.dataset.date);
    });

    $('#calendarStage').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = event.target.closest('[data-date]');
      if (target) {
        event.preventDefault();
        goToDay(target.dataset.date);
      }
    });

    document.addEventListener('click', (event) => {
      const modeButton = event.target.closest('[data-mode]');
      if (modeButton) {
        setMode(modeButton.dataset.mode);
      }
    });

    document.addEventListener('keydown', (event) => {
      const tag = event.target.tagName;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || event.target.isContentEditable;
      const dialogOpen = Boolean($('dialog[open]'));
      if (typing || dialogOpen) return;
      if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        openStudy();
      } else if (event.key === 'ArrowLeft') {
        shiftPeriod(-1);
      } else if (event.key === 'ArrowRight') {
        shiftPeriod(1);
      } else if (event.key.toLowerCase() === 't') {
        goToday();
      }
    });

    // Registrar estudio
    $('#studyForm').addEventListener('submit', submitStudy);
    $('#studyCode').addEventListener('input', () => {
      const value = $('#studyCode').value;
      if (state.study.review && value !== state.study.review.topic.code) {
        state.study.review = null;
        $('#studyCodeHint').textContent = 'Escribe el identificador del tema estudiado.';
        $$('#studySuggestions .suggestion').forEach((button) => button.classList.remove('is-active'));
      }
    });
    $('#studySuggestions').addEventListener('click', (event) => {
      const button = event.target.closest('[data-suggestion]');
      if (button) selectSuggestion(button.dataset.suggestion);
    });
    $('#intervalChips').addEventListener('click', (event) => {
      const chip = event.target.closest('[data-interval]');
      if (!chip) return;
      state.study.interval = Number(chip.dataset.interval);
      state.study.manualDate = '';
      $('#studyDate').value = '';
      $$('#intervalChips .chip').forEach((item) => item.classList.toggle('is-active', item === chip));
      updateIntervalHint();
      updateStudyPreview();
    });
    $('#studyDate').addEventListener('change', () => {
      const value = $('#studyDate').value;
      state.study.manualDate = value || '';
      if (value) {
        $$('#intervalChips .chip').forEach((item) => item.classList.remove('is-active'));
      } else {
        const active = $('#intervalChips').querySelector(`[data-interval="${state.study.interval}"]`);
        if (active) active.classList.add('is-active');
      }
      updateIntervalHint();
      updateStudyPreview();
    });
    $('#loadDays').addEventListener('click', (event) => {
      const day = event.target.closest('[data-date]');
      if (!day || day.classList.contains('is-past')) return;
      pickStudyDate(day.dataset.date);
    });

    // Mover repaso
    $('#moveForm').addEventListener('submit', submitMove);
    $('#moveDate').addEventListener('change', updateMovePreview);
    $('#moveDays').addEventListener('click', (event) => {
      const day = event.target.closest('[data-date]');
      if (!day || day.classList.contains('is-past')) return;
      pickMoveDate(day.dataset.date);
    });
    $('#moveDelete').addEventListener('click', () => openDelete(state.move.review));

    // Eliminar repaso
    $('#deleteConfirm').addEventListener('click', confirmDelete);

    // Deshacer estudio
    $('#undoConfirm').addEventListener('click', confirmUndo);

    // Mantenimiento: copias
    document.addEventListener('change', (event) => {
      if (!event.target || event.target.id !== 'backupFile') return;
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      handleBackupFile(file);
    });
    $('#resetConfirm').addEventListener('click', confirmReset);
    $('#restoreConfirm').addEventListener('click', confirmRestore);

    // Planificar repaso
    $('#planForm').addEventListener('submit', submitPlan);
    $('#planDate').addEventListener('change', () => {
      const value = $('#planDate').value;
      $('#planHint').textContent = value
        ? `Reservarás un repaso para el ${formatMediumDate(value)} sin registrar un estudio.`
        : 'Elige el día en el que quieres repasar este tema.';
    });

    // Fecha del examen
    $('#examFormModal').addEventListener('submit', submitExam);

    // Colisión
    $('#collisionCancel').addEventListener('click', () => {
      closeDialog($('#collisionDialog'));
      state.pendingConfirm = null;
    });

    // Historial
    $('#historySearch').addEventListener('input', (event) => {
      state.historyQuery = event.target.value;
      renderHistoryList();
    });
    $('#historySort').addEventListener('change', (event) => {
      state.historySort = event.target.value;
      renderHistoryList();
    });

    // Ajustes
    $('#settingsContent').addEventListener('submit', async (event) => {
      if (event.target.id !== 'examForm') return;
      event.preventDefault();
      const value = $('#examDateInput').value;
      const errorBox = $('#settingsExamError');
      const button = event.target.querySelector('button[type="submit"]');
      errorBox.textContent = '';
      setBusy(button, true);
      try {
        const result = await api('/api/settings', { method: 'PUT', body: { exam_date: value } });
        if (state.settings) state.settings.examDate = result.examDate;
        toast(result.examDate ? `Fecha de examen: ${formatMediumDate(result.examDate)}.` : 'Fecha de examen eliminada.');
        state.historyDirty = true;
        await refreshData({ silent: true });
        await loadSettings(true);
        renderSettings();
      } catch (error) {
        errorBox.textContent = error.message;
      } finally {
        setBusy(button, false);
      }
    });

    // Diálogos: cerrar al pulsar el fondo y liberar scroll.
    $$('dialog').forEach((dialog) => {
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
      dialog.addEventListener('close', () => {
        if (!$$('dialog[open]').length) document.body.classList.remove('modal-open');
      });
    });

    window.addEventListener('hashchange', () => {
      if (state.auth) switchView(hashView(), { push: false });
    });

    window.addEventListener('online', () => {
      $('#offlinePill').hidden = true;
      $('#connectionDot')?.classList.remove('is-offline');
      toast('Conexión restablecida.');
    });
    window.addEventListener('offline', () => {
      $('#offlinePill').hidden = false;
      $('#connectionDot')?.classList.add('is-offline');
      toast(window.isSecureContext
        ? 'Sin conexión. Puedes seguir consultando los datos guardados.'
        : 'Sin conexión. Recupera la red para seguir usando Echo.', 'amber');
    });
    $('#offlinePill').hidden = navigator.onLine;

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      state.installPrompt = event;
      if (state.view === 'settings') renderSettings();
    });
  }

  function handleAction(element) {
    const action = element.dataset.action;
    switch (action) {
      case 'open-study':
        openStudy();
        break;
      case 'open-plan':
        openPlan(element.dataset.date || state.cursor);
        break;
      case 'open-exam':
        openExam();
        break;
      case 'go-today':
        goToday();
        break;
      case 'prev':
        shiftPeriod(-1);
        break;
      case 'next':
        shiftPeriod(1);
        break;
      case 'open-settings':
        navigate('settings');
        break;
      case 'mark-signal':
        markSignal(element);
        break;
      case 'logout':
        logout();
        break;
      case 'install':
        installApp();
        break;
      case 'print':
        printReport();
        break;
      case 'export-json':
        downloadExport('json');
        break;
      case 'export-csv':
        downloadExport('csv');
        break;
      case 'pick-backup':
        $('#backupFile').click();
        break;
      case 'open-reset':
        openReset();
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Arrancar                                                            */
  /* ------------------------------------------------------------------ */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
