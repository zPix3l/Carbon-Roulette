import type Database from 'better-sqlite3';

// ---- Types ----

export interface Player {
  telegram_id: number;
  username: string | null;
  display_name: string | null;
  balance: number;
  games_played: number;
  wins: number;
  current_streak: number;
  best_streak: number;
  last_bailout: string | null;
  created_at: string;
}

export interface Bet {
  id: number;
  telegram_id: number;
  project_day: number;
  group_id: number;
  choice: 'BUY' | 'PASS';
  amount: number;
  result: 'win' | 'lose' | null;
  payout: number | null;
  created_at: string;
}

// ---- Player queries ----

/** Get player identity + group-specific stats (joined view). */
export function getPlayer(db: Database.Database, telegramId: number, groupId: number): Player | undefined {
  return db.prepare(`
    SELECT p.telegram_id, p.username, p.display_name, p.created_at,
           COALESCE(gp.balance, 1000) as balance,
           COALESCE(gp.games_played, 0) as games_played,
           COALESCE(gp.wins, 0) as wins,
           COALESCE(gp.current_streak, 0) as current_streak,
           COALESCE(gp.best_streak, 0) as best_streak,
           gp.last_bailout
    FROM players p
    LEFT JOIN group_players gp ON p.telegram_id = gp.telegram_id AND gp.group_id = ?
    WHERE p.telegram_id = ?
  `).get(groupId, telegramId) as Player | undefined;
}

/** Ensure a player identity row exists; update username/display_name if changed. */
function ensurePlayer(db: Database.Database, telegramId: number, username: string | null, displayName: string | null): void {
  db.prepare(`INSERT OR IGNORE INTO players (telegram_id, username, display_name) VALUES (?, ?, ?)`)
    .run(telegramId, username, displayName);
  db.prepare(`UPDATE players SET username = ?, display_name = ? WHERE telegram_id = ?`)
    .run(username, displayName, telegramId);
}

/** Ensure a group_players row exists for this player + group. */
function ensureGroupPlayer(db: Database.Database, telegramId: number, groupId: number, startingPoints: number): void {
  db.prepare(`INSERT OR IGNORE INTO group_players (telegram_id, group_id, balance) VALUES (?, ?, ?)`)
    .run(telegramId, groupId, startingPoints);
}

export function getOrCreatePlayer(
  db: Database.Database,
  telegramId: number,
  username: string | null,
  displayName: string | null,
  startingPoints: number,
  groupId: number,
): Player {
  ensurePlayer(db, telegramId, username, displayName);
  ensureGroupPlayer(db, telegramId, groupId, startingPoints);
  return getPlayer(db, telegramId, groupId)!;
}

export function updateBalance(db: Database.Database, telegramId: number, groupId: number, delta: number): void {
  db.prepare(`UPDATE group_players SET balance = balance + ? WHERE telegram_id = ? AND group_id = ?`)
    .run(delta, telegramId, groupId);
}

export function updateStreak(db: Database.Database, telegramId: number, groupId: number, won: boolean): void {
  if (won) {
    db.prepare(`
      UPDATE group_players SET
        current_streak = current_streak + 1,
        best_streak = MAX(best_streak, current_streak + 1),
        wins = wins + 1,
        games_played = games_played + 1
      WHERE telegram_id = ? AND group_id = ?
    `).run(telegramId, groupId);
  } else {
    db.prepare(`
      UPDATE group_players SET
        current_streak = 0,
        games_played = games_played + 1
      WHERE telegram_id = ? AND group_id = ?
    `).run(telegramId, groupId);
  }
}

export function getLeaderboard(db: Database.Database, groupId: number, limit: number = 10): Player[] {
  return db.prepare(`
    SELECT p.telegram_id, p.username, p.display_name, p.created_at,
           gp.balance, gp.games_played, gp.wins, gp.current_streak, gp.best_streak, gp.last_bailout
    FROM group_players gp
    JOIN players p ON gp.telegram_id = p.telegram_id
    WHERE gp.group_id = ?
    ORDER BY gp.balance DESC
    LIMIT ?
  `).all(groupId, limit) as Player[];
}

export function getPlayerCount(db: Database.Database, groupId: number): number {
  const row = db.prepare(`SELECT COUNT(*) as count FROM group_players WHERE group_id = ?`)
    .get(groupId) as { count: number };
  return row.count;
}

export function getPlayerRank(db: Database.Database, telegramId: number, groupId: number): number {
  const row = db.prepare(`
    SELECT COUNT(*) + 1 as rank FROM group_players
    WHERE group_id = ? AND balance > (
      SELECT COALESCE(
        (SELECT balance FROM group_players WHERE telegram_id = ? AND group_id = ?),
        0
      )
    )
  `).get(groupId, telegramId, groupId) as { rank: number };
  return row.rank;
}

export function performBailout(db: Database.Database, telegramId: number, groupId: number, amount: number): void {
  const now = new Date().toISOString().split('T')[0];
  db.prepare(`
    UPDATE group_players SET balance = ?, current_streak = 0, last_bailout = ?
    WHERE telegram_id = ? AND group_id = ?
  `).run(amount, now, telegramId, groupId);
}

// ---- Bet queries ----

export function placeBet(
  db: Database.Database,
  telegramId: number,
  projectDay: number,
  groupId: number,
  choice: 'BUY' | 'PASS',
  amount: number,
): boolean {
  try {
    db.prepare(`
      INSERT INTO bets (telegram_id, project_day, group_id, choice, amount)
      VALUES (?, ?, ?, ?, ?)
    `).run(telegramId, projectDay, groupId, choice, amount);
    return true;
  } catch {
    // UNIQUE constraint violation = already bet
    return false;
  }
}

export function getBet(db: Database.Database, telegramId: number, projectDay: number, groupId: number): Bet | undefined {
  return db.prepare(`SELECT * FROM bets WHERE telegram_id = ? AND project_day = ? AND group_id = ?`)
    .get(telegramId, projectDay, groupId) as Bet | undefined;
}

export function getBetsForDay(db: Database.Database, projectDay: number, groupId: number): Bet[] {
  return db.prepare(`SELECT * FROM bets WHERE project_day = ? AND group_id = ?`)
    .all(projectDay, groupId) as Bet[];
}

export function getBetCountForDay(db: Database.Database, projectDay: number, groupId: number): number {
  const row = db.prepare(`SELECT COUNT(*) as count FROM bets WHERE project_day = ? AND group_id = ?`)
    .get(projectDay, groupId) as { count: number };
  return row.count;
}

export function resolveBet(db: Database.Database, betId: number, result: 'win' | 'lose', payout: number): void {
  db.prepare(`UPDATE bets SET result = ?, payout = ? WHERE id = ?`).run(result, payout, betId);
}

// ---- Per-group game state ----

export function getGroupState(db: Database.Database, groupId: number, key: string): string {
  const row = db.prepare(`SELECT value FROM group_state WHERE group_id = ? AND key = ?`)
    .get(groupId, key) as { value: string } | undefined;
  return row?.value ?? '';
}

export function setGroupState(db: Database.Database, groupId: number, key: string, value: string): void {
  db.prepare(`INSERT OR REPLACE INTO group_state (group_id, key, value) VALUES (?, ?, ?)`)
    .run(groupId, key, value);
}

export function getCurrentDay(db: Database.Database, groupId: number): number {
  return parseInt(getGroupState(db, groupId, 'current_day'), 10) || 0;
}

/**
 * Per-group resolve delay (minutes). Returns null if never set so callers can
 * fall back to the env/default. Stored under group_state key 'resolve_delay_minutes'.
 */
export function getGroupResolveDelayMinutes(db: Database.Database, groupId: number): number | null {
  const raw = getGroupState(db, groupId, 'resolve_delay_minutes');
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return isNaN(n) || n <= 0 ? null : n;
}

export function setGroupResolveDelayMinutes(db: Database.Database, groupId: number, minutes: number): void {
  setGroupState(db, groupId, 'resolve_delay_minutes', String(minutes));
}

/**
 * Per-group announce lead time (minutes before the scheduled drop).
 * 0 disables announcements. Stored under group_state key 'announce_minutes_before'.
 */
export function getGroupAnnounceMinutesBefore(db: Database.Database, groupId: number): number {
  const raw = getGroupState(db, groupId, 'announce_minutes_before');
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return isNaN(n) || n < 0 ? 0 : n;
}

export function setGroupAnnounceMinutesBefore(db: Database.Database, groupId: number, minutes: number): void {
  setGroupState(db, groupId, 'announce_minutes_before', String(minutes));
}

/** List all known group IDs (any group that has at least one group_state or group_players row). */
export function getKnownGroups(db: Database.Database): { group_id: number; current_day: number; players: number }[] {
  return db.prepare(`
    SELECT g.group_id,
           COALESCE((SELECT value FROM group_state WHERE group_id = g.group_id AND key = 'current_day'), '0') as current_day,
           (SELECT COUNT(*) FROM group_players WHERE group_id = g.group_id) as players
    FROM (
      SELECT DISTINCT group_id FROM group_players
      UNION
      SELECT DISTINCT group_id FROM group_state
    ) g
    ORDER BY players DESC
  `).all() as { group_id: number; current_day: number; players: number }[];
}

// ---- Scheduler: schedules (recurring) ----

export interface Schedule {
  id: number;
  group_id: number;
  days_of_week: string;           // CSV: 'mon,wed,fri'
  time_utc: string;               // 'HH:MM'
  resolve_delay_minutes: number;
  enabled: number;                // 0 | 1
  created_at: string;
}

export function insertSchedule(
  db: Database.Database,
  groupId: number,
  daysOfWeek: string,
  timeUtc: string,
  resolveDelayMinutes: number,
): number {
  const info = db.prepare(`
    INSERT INTO schedules (group_id, days_of_week, time_utc, resolve_delay_minutes)
    VALUES (?, ?, ?, ?)
  `).run(groupId, daysOfWeek, timeUtc, resolveDelayMinutes);
  return Number(info.lastInsertRowid);
}

export function getSchedulesForGroup(db: Database.Database, groupId: number): Schedule[] {
  return db.prepare(`SELECT * FROM schedules WHERE group_id = ? ORDER BY id`)
    .all(groupId) as Schedule[];
}

export function getScheduleById(db: Database.Database, id: number): Schedule | undefined {
  return db.prepare(`SELECT * FROM schedules WHERE id = ?`).get(id) as Schedule | undefined;
}

export function getActiveSchedules(db: Database.Database): Schedule[] {
  return db.prepare(`SELECT * FROM schedules WHERE enabled = 1`).all() as Schedule[];
}

export function deleteSchedule(db: Database.Database, id: number): boolean {
  const info = db.prepare(`DELETE FROM schedules WHERE id = ?`).run(id);
  return info.changes > 0;
}

export function setScheduleEnabled(db: Database.Database, id: number, enabled: boolean): boolean {
  const info = db.prepare(`UPDATE schedules SET enabled = ? WHERE id = ?`)
    .run(enabled ? 1 : 0, id);
  return info.changes > 0;
}

// ---- Scheduler: concrete jobs ----

export type JobKind = 'drop' | 'resolve' | 'announce';

export interface ScheduledJob {
  id: number;
  group_id: number;
  kind: JobKind;
  run_at: string;                 // ISO 8601 UTC
  status: 'pending' | 'done' | 'failed' | 'skipped';
  schedule_id: number | null;
  payload: string | null;         // JSON
  created_at: string;
  executed_at: string | null;
  error: string | null;
}

export function insertJob(
  db: Database.Database,
  groupId: number,
  kind: JobKind,
  runAt: string,
  scheduleId: number | null,
  payload: Record<string, unknown> | null,
): number {
  const info = db.prepare(`
    INSERT INTO scheduled_jobs (group_id, kind, run_at, schedule_id, payload)
    VALUES (?, ?, ?, ?, ?)
  `).run(groupId, kind, runAt, scheduleId, payload ? JSON.stringify(payload) : null);
  return Number(info.lastInsertRowid);
}

export function getJobById(db: Database.Database, id: number): ScheduledJob | undefined {
  return db.prepare(`SELECT * FROM scheduled_jobs WHERE id = ?`)
    .get(id) as ScheduledJob | undefined;
}

export function getPendingJobs(db: Database.Database): ScheduledJob[] {
  return db.prepare(`
    SELECT * FROM scheduled_jobs WHERE status = 'pending' ORDER BY run_at ASC
  `).all() as ScheduledJob[];
}

export function getPendingJobsForGroup(db: Database.Database, groupId: number, limit = 10): ScheduledJob[] {
  return db.prepare(`
    SELECT * FROM scheduled_jobs
    WHERE status = 'pending' AND group_id = ?
    ORDER BY run_at ASC LIMIT ?
  `).all(groupId, limit) as ScheduledJob[];
}

export function getPendingDropJobForGroup(db: Database.Database, groupId: number): ScheduledJob | undefined {
  return db.prepare(`
    SELECT * FROM scheduled_jobs
    WHERE status = 'pending' AND group_id = ? AND kind = 'drop'
    ORDER BY run_at ASC LIMIT 1
  `).get(groupId) as ScheduledJob | undefined;
}

export function getPendingResolveJobForGroup(db: Database.Database, groupId: number): ScheduledJob | undefined {
  return db.prepare(`
    SELECT * FROM scheduled_jobs
    WHERE status = 'pending' AND group_id = ? AND kind = 'resolve'
    ORDER BY run_at ASC LIMIT 1
  `).get(groupId) as ScheduledJob | undefined;
}

export function jobExistsForScheduleSlot(db: Database.Database, scheduleId: number, runAt: string): boolean {
  const row = db.prepare(`
    SELECT 1 FROM scheduled_jobs WHERE schedule_id = ? AND run_at = ? AND kind = 'drop' LIMIT 1
  `).get(scheduleId, runAt);
  return !!row;
}

/**
 * Check whether an announce job already exists for a given schedule + companion drop time.
 * We key announces by schedule_id and the drop_run_at stored in payload, so a run_at shift
 * (e.g. admin changed announce_minutes_before) creates a fresh announce rather than duplicating.
 */
export function announceExistsForScheduleDrop(
  db: Database.Database,
  scheduleId: number,
  dropRunAt: string,
): boolean {
  const row = db.prepare(`
    SELECT 1 FROM scheduled_jobs
    WHERE schedule_id = ? AND kind = 'announce'
      AND json_extract(payload, '$.drop_run_at') = ?
    LIMIT 1
  `).get(scheduleId, dropRunAt);
  return !!row;
}

export function markJobDone(db: Database.Database, id: number): void {
  db.prepare(`
    UPDATE scheduled_jobs SET status = 'done', executed_at = datetime('now') WHERE id = ?
  `).run(id);
}

export function markJobFailed(db: Database.Database, id: number, error: string): void {
  db.prepare(`
    UPDATE scheduled_jobs SET status = 'failed', executed_at = datetime('now'), error = ? WHERE id = ?
  `).run(error, id);
}

export function markJobSkipped(db: Database.Database, id: number, reason: string): void {
  db.prepare(`
    UPDATE scheduled_jobs SET status = 'skipped', executed_at = datetime('now'), error = ? WHERE id = ?
  `).run(reason, id);
}

// ---- Global bot config (not per-group) ----

export function getBotConfig(db: Database.Database, key: string): string {
  const row = db.prepare(`SELECT value FROM bot_config WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value ?? '';
}

export function setBotConfig(db: Database.Database, key: string, value: string): void {
  db.prepare(`INSERT OR REPLACE INTO bot_config (key, value) VALUES (?, ?)`).run(key, value);
}
