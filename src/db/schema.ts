import Database from 'better-sqlite3';
import path from 'path';
import { mkdirSync } from 'fs';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'carbon-roulette.db');

export function initDb(): Database.Database {
  mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Migrate old single-tenant schema if detected
  migrateIfNeeded(db);

  // Migrate scheduled_jobs.kind CHECK to allow 'announce' if needed
  migrateScheduledJobsKind(db);

  // Create tables (idempotent)
  db.exec(`
    -- Player identity (global, one row per Telegram user)
    CREATE TABLE IF NOT EXISTS players (
      telegram_id INTEGER PRIMARY KEY,
      username TEXT,
      display_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Per-group player stats (balance, streaks, etc.)
    CREATE TABLE IF NOT EXISTS group_players (
      telegram_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      balance INTEGER NOT NULL DEFAULT 1000,
      games_played INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      current_streak INTEGER NOT NULL DEFAULT 0,
      best_streak INTEGER NOT NULL DEFAULT 0,
      last_bailout TEXT,
      PRIMARY KEY (telegram_id, group_id)
    );

    -- Bets scoped to a group
    CREATE TABLE IF NOT EXISTS bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL,
      project_day INTEGER NOT NULL,
      group_id INTEGER NOT NULL DEFAULT 0,
      choice TEXT NOT NULL CHECK(choice IN ('BUY', 'PASS')),
      amount INTEGER NOT NULL,
      result TEXT CHECK(result IN ('win', 'lose')),
      payout INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(telegram_id, project_day, group_id)
    );

    -- Per-group game state (key-value store)
    CREATE TABLE IF NOT EXISTS group_state (
      group_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (group_id, key)
    );

    -- Global bot config (not per-group)
    CREATE TABLE IF NOT EXISTS bot_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Recurring schedules: days × time × per group
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      days_of_week TEXT NOT NULL,           -- CSV: 'mon,wed,fri'
      time_utc TEXT NOT NULL,               -- 'HH:MM'
      resolve_delay_minutes INTEGER NOT NULL DEFAULT 60,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_schedules_enabled
      ON schedules(enabled, group_id);

    -- Concrete jobs: either one-off (manual /drop) or materialized from a schedule
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('drop','resolve','announce')),
      run_at TEXT NOT NULL,                 -- ISO 8601 UTC
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','done','failed','skipped')),
      schedule_id INTEGER,                  -- NULL if one-off
      payload TEXT,                         -- JSON
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      executed_at TEXT,
      error TEXT,
      FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_pending_run_at
      ON scheduled_jobs(status, run_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_schedule_run_at
      ON scheduled_jobs(schedule_id, run_at);
  `);

  return db;
}

// ---------------------------------------------------------------------------
// Migration: widen scheduled_jobs.kind CHECK to include 'announce'
// SQLite CHECK constraints are baked into the table definition, so we detect
// the old constraint by inspecting sqlite_master.sql and recreate the table
// if needed. Idempotent: only runs when the old CHECK is present.
// ---------------------------------------------------------------------------

function migrateScheduledJobsKind(db: Database.Database): void {
  const row = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduled_jobs'`,
  ).get() as { sql: string } | undefined;
  if (!row) return; // table doesn't exist yet — fresh install will get the new CHECK

  // Already widened?
  if (row.sql.includes("'announce'")) return;

  console.log("[migration] widening scheduled_jobs.kind CHECK to include 'announce'...");

  db.transaction(() => {
    db.exec(`
      CREATE TABLE scheduled_jobs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('drop','resolve','announce')),
        run_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','done','failed','skipped')),
        schedule_id INTEGER,
        payload TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        executed_at TEXT,
        error TEXT,
        FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE SET NULL
      );
      INSERT INTO scheduled_jobs_new
        SELECT id, group_id, kind, run_at, status, schedule_id, payload, created_at, executed_at, error
        FROM scheduled_jobs;
      DROP TABLE scheduled_jobs;
      ALTER TABLE scheduled_jobs_new RENAME TO scheduled_jobs;
      CREATE INDEX IF NOT EXISTS idx_jobs_pending_run_at
        ON scheduled_jobs(status, run_at);
      CREATE INDEX IF NOT EXISTS idx_jobs_schedule_run_at
        ON scheduled_jobs(schedule_id, run_at);
    `);
  })();

  console.log('[migration] scheduled_jobs.kind CHECK widened.');
}

// ---------------------------------------------------------------------------
// Migration: old single-tenant schema → new multi-tenant schema
// ---------------------------------------------------------------------------

function migrateIfNeeded(db: Database.Database): void {
  // Detect old schema: game_state table exists
  const hasGameState = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='game_state'`,
  ).get();
  if (!hasGameState) return;

  // Double-check: old players table has 'balance' column
  const playerCols = db.prepare(`PRAGMA table_info(players)`).all() as { name: string }[];
  const hasBalance = playerCols.some(c => c.name === 'balance');
  if (!hasBalance) {
    // Already migrated but game_state wasn't cleaned up
    db.exec(`DROP TABLE IF EXISTS game_state`);
    return;
  }

  console.log('[migration] migrating to multi-tenant schema...');

  // Determine group_id from saved config or env
  const savedGroup = db.prepare(
    `SELECT value FROM game_state WHERE key = 'group_chat_id'`,
  ).get() as { value: string } | undefined;
  const groupId = savedGroup
    ? Number(savedGroup.value)
    : Number(process.env.GROUP_CHAT_ID || '0');

  db.transaction(() => {
    // ---- 1. Create new tables ----
    db.exec(`
      CREATE TABLE IF NOT EXISTS group_players (
        telegram_id INTEGER NOT NULL,
        group_id INTEGER NOT NULL,
        balance INTEGER NOT NULL DEFAULT 1000,
        games_played INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        current_streak INTEGER NOT NULL DEFAULT 0,
        best_streak INTEGER NOT NULL DEFAULT 0,
        last_bailout TEXT,
        PRIMARY KEY (telegram_id, group_id)
      );
      CREATE TABLE IF NOT EXISTS group_state (
        group_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (group_id, key)
      );
      CREATE TABLE IF NOT EXISTS bot_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // ---- 2. Migrate game_state → group_state + bot_config ----
    const allStates = db.prepare(`SELECT key, value FROM game_state`).all() as {
      key: string;
      value: string;
    }[];
    const insertGroupState = db.prepare(
      `INSERT OR IGNORE INTO group_state (group_id, key, value) VALUES (?, ?, ?)`,
    );
    for (const s of allStates) {
      if (s.key === 'group_chat_id') {
        db.prepare(`INSERT OR REPLACE INTO bot_config (key, value) VALUES (?, ?)`).run(
          s.key,
          s.value,
        );
      } else {
        insertGroupState.run(groupId, s.key, s.value);
      }
    }

    // ---- 3. Migrate player stats → group_players ----
    const oldPlayers = db.prepare(
      `SELECT telegram_id, balance, games_played, wins, current_streak, best_streak, last_bailout FROM players`,
    ).all() as any[];
    const insertGP = db.prepare(
      `INSERT OR IGNORE INTO group_players (telegram_id, group_id, balance, games_played, wins, current_streak, best_streak, last_bailout)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const p of oldPlayers) {
      insertGP.run(
        p.telegram_id,
        groupId,
        p.balance,
        p.games_played,
        p.wins,
        p.current_streak,
        p.best_streak,
        p.last_bailout,
      );
    }

    // ---- 4. Recreate players table (identity only) ----
    db.exec(`
      CREATE TABLE players_new (
        telegram_id INTEGER PRIMARY KEY,
        username TEXT,
        display_name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT OR IGNORE INTO players_new (telegram_id, username, display_name, created_at)
        SELECT telegram_id, username, display_name, created_at FROM players;
      DROP TABLE players;
      ALTER TABLE players_new RENAME TO players;
    `);

    // ---- 5. Recreate bets with group_id + new UNIQUE constraint ----
    db.exec(`
      CREATE TABLE bets_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id INTEGER NOT NULL,
        project_day INTEGER NOT NULL,
        group_id INTEGER NOT NULL DEFAULT 0,
        choice TEXT NOT NULL CHECK(choice IN ('BUY', 'PASS')),
        amount INTEGER NOT NULL,
        result TEXT CHECK(result IN ('win', 'lose')),
        payout INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(telegram_id, project_day, group_id)
      );
    `);
    const oldBets = db.prepare(`SELECT * FROM bets`).all() as any[];
    const insertBet = db.prepare(
      `INSERT INTO bets_new (telegram_id, project_day, group_id, choice, amount, result, payout, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const b of oldBets) {
      insertBet.run(
        b.telegram_id,
        b.project_day,
        groupId,
        b.choice,
        b.amount,
        b.result,
        b.payout,
        b.created_at,
      );
    }
    db.exec(`
      DROP TABLE bets;
      ALTER TABLE bets_new RENAME TO bets;
    `);

    // ---- 6. Drop old game_state ----
    db.exec(`DROP TABLE game_state`);
  })();

  console.log(`[migration] done. existing data migrated to group_id ${groupId}`);
}
