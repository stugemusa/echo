-- Echo · Esquema de base de datos (SQLite)
-- Fechas en formato ISO local YYYY-MM-DD.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS topics (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id      INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  due_date      TEXT NOT NULL,
  interval_days INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  completed_on  TEXT,
  comments      TEXT,
  origin        TEXT NOT NULL DEFAULT 'auto' CHECK (origin IN ('auto', 'manual', 'initial')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reviews_due   ON reviews (due_date, status);
CREATE INDEX IF NOT EXISTS idx_reviews_topic ON reviews (topic_id, due_date);

CREATE TABLE IF NOT EXISTS signals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,
  received_at TEXT NOT NULL,
  source      TEXT DEFAULT 'external',
  note        TEXT
);

CREATE INDEX IF NOT EXISTS idx_signals_date ON signals (date);
