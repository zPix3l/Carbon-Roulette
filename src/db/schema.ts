import Database from 'better-sqlite3';
import path from 'path';
import { mkdirSync } from 'fs';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'carbon-roulette.db');

export function initDb(): Database.Database {
  // Ensure the directory exists (safe for fresh clones / first deploy)
  mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const db = new Database(DB_PATH);

  // WAL mode: better concurrent read performance + crash resilience
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      telegram_id INTEGER PRIMARY KEY,
      username TEXT,
      display_name TEXT,
      balance INTEGER NOT NULL DEFAULT 1000,
      games_played INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      current_streak INTEGER NOT NULL DEFAULT 0,
      best_streak INTEGER NOT NULL DEFAULT 0,
      last_bailout TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL,
      project_day INTEGER NOT NULL,
      choice TEXT NOT NULL CHECK(choice IN ('BUY', 'PASS')),
      amount INTEGER NOT NULL,
      result TEXT CHECK(result IN ('win', 'lose')),
      payout INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(telegram_id, project_day)
    );

    CREATE TABLE IF NOT EXISTS game_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Seed initial game state if empty
  const row = db.prepare(`SELECT value FROM game_state WHERE key = 'current_day'`).get();
  if (!row) {
    db.prepare(`INSERT INTO game_state (key, value) VALUES ('current_day', '0')`).run();
    db.prepare(`INSERT INTO game_state (key, value) VALUES ('last_resolution_date', '')`).run();
    db.prepare(`INSERT INTO game_state (key, value) VALUES ('last_drop_date', '')`).run();
    db.prepare(`INSERT INTO game_state (key, value) VALUES ('drop_message_id', '')`).run();
    db.prepare(`INSERT INTO game_state (key, value) VALUES ('round_status', 'closed')`).run();
  }

  return db;
}
