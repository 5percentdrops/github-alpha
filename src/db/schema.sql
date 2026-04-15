-- Project Alpha — SQLite schema
-- WAL mode set programmatically on connection

CREATE TABLE IF NOT EXISTS developers (
  login       TEXT PRIMARY KEY,
  name        TEXT,
  bio         TEXT,
  followers   INTEGER NOT NULL,
  company     TEXT,
  location    TEXT,
  twitter     TEXT,
  blog        TEXT,
  url         TEXT,
  created     TEXT,
  added_at    TEXT DEFAULT (datetime('now')),
  active      INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS scan_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  login       TEXT NOT NULL REFERENCES developers(login),
  repo        TEXT NOT NULL,
  repo_owner  TEXT NOT NULL,
  repo_age    INTEGER,          -- days since creation
  stars       INTEGER DEFAULT 0,
  watchers    INTEGER DEFAULT 0,
  is_fork     INTEGER DEFAULT 0,
  is_org      INTEGER DEFAULT 0,
  languages   TEXT,             -- JSON array
  description TEXT,             -- max 250 chars
  events      TEXT,             -- JSON: { CreateEvent: n, PushEvent: n }
  commits_24h INTEGER DEFAULT 0,
  commits_48h INTEGER DEFAULT 0,
  commits_7d  INTEGER DEFAULT 0,
  last_push   TEXT,
  signal      TEXT CHECK(signal IN ('ALPHA','HOT','WATCHING','DORMANT')),
  scanned_at  TEXT DEFAULT (datetime('now')),

  -- Gate pass/fail flags (1=pass, 0=fail)
  gate_not_org       INTEGER,
  gate_not_fork      INTEGER,
  gate_personal_ns   INTEGER,
  gate_velocity      INTEGER,
  gate_repo_age      INTEGER,
  gate_stars         INTEGER,
  gate_watchers      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_scan_login ON scan_results(login);
CREATE INDEX IF NOT EXISTS idx_scan_signal ON scan_results(signal);
CREATE INDEX IF NOT EXISTS idx_scan_date ON scan_results(scanned_at);
CREATE INDEX IF NOT EXISTS idx_scan_repo ON scan_results(repo, login);

CREATE TABLE IF NOT EXISTS alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  login       TEXT NOT NULL,
  repo        TEXT NOT NULL,
  signal      TEXT NOT NULL,
  sent_at     TEXT DEFAULT (datetime('now')),
  channel     TEXT DEFAULT 'telegram'
);

CREATE INDEX IF NOT EXISTS idx_alerts_login ON alerts(login, repo);
