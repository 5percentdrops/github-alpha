import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', '..', 'data', 'alpha.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let _db = null;

export function getDb() {
  if (_db) return _db;

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('busy_timeout = 5000');

  // Run schema
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  _db.exec(schema);

  return _db;
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// --- Developer queries ---

export function upsertDeveloper(dev) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO developers (login, name, bio, followers, company, location, twitter, blog, url, created)
    VALUES (@login, @name, @bio, @followers, @company, @location, @twitter, @blog, @url, @created)
    ON CONFLICT(login) DO UPDATE SET
      name=@name, bio=@bio, followers=@followers, company=@company,
      location=@location, twitter=@twitter, blog=@blog, url=@url
  `).run(dev);
}

export function getAllDevelopers() {
  return getDb().prepare('SELECT * FROM developers WHERE active = 1 ORDER BY followers DESC').all();
}

export function getDeveloperCount() {
  return getDb().prepare('SELECT COUNT(*) as count FROM developers WHERE active = 1').get().count;
}

// --- Scan result queries ---

export function insertScanResult(result) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO scan_results (
      login, repo, repo_owner, repo_age, stars, watchers, is_fork, is_org,
      languages, description, events, commits_24h, commits_48h, commits_7d,
      last_push, signal, gate_not_org, gate_not_fork, gate_personal_ns,
      gate_velocity, gate_repo_age, gate_stars, gate_watchers
    ) VALUES (
      @login, @repo, @repoOwner, @repoAge, @stars, @watchers, @isFork, @isOrg,
      @languages, @description, @events, @commits24h, @commits48h, @commits7d,
      @lastPush, @signal, @gateNotOrg, @gateNotFork, @gatePersonalNs,
      @gateVelocity, @gateRepoAge, @gateStars, @gateWatchers
    )
  `).run(result);
}

export function getLatestSignals() {
  return getDb().prepare(`
    SELECT s.* FROM scan_results s
    INNER JOIN (
      SELECT login, repo, MAX(scanned_at) as max_scan
      FROM scan_results
      GROUP BY login, repo
    ) latest ON s.login = latest.login AND s.repo = latest.repo AND s.scanned_at = latest.max_scan
    WHERE s.signal IN ('ALPHA', 'HOT', 'WATCHING')
    ORDER BY
      CASE s.signal WHEN 'ALPHA' THEN 0 WHEN 'HOT' THEN 1 WHEN 'WATCHING' THEN 2 END,
      s.commits_48h DESC
  `).all();
}

export function getHotTargets() {
  return getDb().prepare(`
    SELECT DISTINCT login FROM scan_results
    WHERE signal = 'HOT'
    AND scanned_at > datetime('now', '-24 hours')
  `).all().map(r => r.login);
}

// --- Alert queries ---

export function hasAlerted(login, repo) {
  return getDb().prepare(
    'SELECT 1 FROM alerts WHERE login = ? AND repo = ? AND sent_at > datetime("now", "-7 days")'
  ).get(login, repo) != null;
}

export function recordAlert(login, repo, signal) {
  return getDb().prepare(
    'INSERT INTO alerts (login, repo, signal) VALUES (?, ?, ?)'
  ).run(login, repo, signal);
}
