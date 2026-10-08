// Almacenamiento propio de la GUI (SQLite embebido de Node): ajustes, usuarios y eventos.
const sqlite = require('./sqlite');
const fs = require('fs');
const path = require('path');

let db;

function open(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  db = sqlite.open(path.join(dataDir, 'gui.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      disabled INTEGER NOT NULL DEFAULT 0,
      token_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login TEXT
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
  `);
  return db;
}

const q = (sql) => db.prepare(sql);

module.exports = {
  open,
  getSetting(key) {
    const r = q('SELECT value FROM settings WHERE key = ?').get(key);
    return r ? JSON.parse(r.value) : undefined;
  },
  setSetting(key, value) {
    q('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  },
  users: {
    count: () => q('SELECT COUNT(*) AS n FROM users').get().n,
    byName: (u) => q('SELECT * FROM users WHERE username = ?').get(u),
    byId: (id) => q('SELECT * FROM users WHERE id = ?').get(id),
    list: () => q('SELECT id, username, role, disabled, created_at, last_login FROM users ORDER BY username').all(),
    create: (username, hash, role) =>
      Number(q('INSERT INTO users(username, password_hash, role) VALUES(?,?,?)').run(username, hash, role).lastInsertRowid),
    update(id, f) {
      const sets = [], vals = [];
      for (const [k, v] of Object.entries(f)) { sets.push(`${k} = ?`); vals.push(v); }
      if (sets.length) q(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    },
    bumpToken: (id) => q('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(id),
    touchLogin: (id) => q("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(id),
    remove: (id) => q('DELETE FROM users WHERE id = ?').run(id),
    admins: () => q("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0").get().n,
  },
  events: {
    add(e) {
      const r = q('INSERT INTO events(ts, kind, severity, title, detail) VALUES(?,?,?,?,?)')
        .run(e.ts, e.kind, e.severity, e.title, e.detail ? JSON.stringify(e.detail) : null);
      return Number(r.lastInsertRowid);
    },
    prune(keep = 20000) {
      q('DELETE FROM events WHERE id <= (SELECT MAX(id) FROM events) - ?').run(keep);
    },
    list({ severity, kind, search, since, before, limit = 100 }) {
      const w = [], p = [];
      if (severity) { w.push('severity = ?'); p.push(severity); }
      if (kind) { w.push('kind = ?'); p.push(kind); }
      if (since) { w.push('ts >= ?'); p.push(since); }
      if (before) { w.push('id < ?'); p.push(before); }
      if (search) { w.push('(title LIKE ? OR detail LIKE ?)'); p.push(`%${search}%`, `%${search}%`); }
      const rows = q(`SELECT * FROM events ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`)
        .all(...p, limit);
      return rows.map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
    },
    counts(sinceIso) {
      return q('SELECT severity, COUNT(*) AS n FROM events WHERE ts >= ? GROUP BY severity').all(sinceIso);
    },
  },
};
