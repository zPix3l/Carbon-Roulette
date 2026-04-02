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
  choice: 'BUY' | 'PASS';
  amount: number;
  result: 'win' | 'lose' | null;
  payout: number | null;
  created_at: string;
}

// ---- Player queries ----

export function getPlayer(db: Database.Database, telegramId: number): Player | undefined {
  return db.prepare(`SELECT * FROM players WHERE telegram_id = ?`).get(telegramId) as Player | undefined;
}

export function createPlayer(db: Database.Database, telegramId: number, username: string | null, displayName: string | null, startingPoints: number): Player {
  db.prepare(`
    INSERT OR IGNORE INTO players (telegram_id, username, display_name, balance)
    VALUES (?, ?, ?, ?)
  `).run(telegramId, username, displayName, startingPoints);
  return getPlayer(db, telegramId)!;
}

export function getOrCreatePlayer(db: Database.Database, telegramId: number, username: string | null, displayName: string | null, startingPoints: number): Player {
  const existing = getPlayer(db, telegramId);
  if (existing) {
    // Update username/display_name if changed
    if (existing.username !== username || existing.display_name !== displayName) {
      db.prepare(`UPDATE players SET username = ?, display_name = ? WHERE telegram_id = ?`)
        .run(username, displayName, telegramId);
    }
    return getPlayer(db, telegramId)!;
  }
  return createPlayer(db, telegramId, username, displayName, startingPoints);
}

export function updateBalance(db: Database.Database, telegramId: number, delta: number): void {
  db.prepare(`UPDATE players SET balance = balance + ? WHERE telegram_id = ?`).run(delta, telegramId);
}

export function updateStreak(db: Database.Database, telegramId: number, won: boolean): void {
  if (won) {
    db.prepare(`
      UPDATE players SET
        current_streak = current_streak + 1,
        best_streak = MAX(best_streak, current_streak + 1),
        wins = wins + 1,
        games_played = games_played + 1
      WHERE telegram_id = ?
    `).run(telegramId);
  } else {
    db.prepare(`
      UPDATE players SET
        current_streak = 0,
        games_played = games_played + 1
      WHERE telegram_id = ?
    `).run(telegramId);
  }
}

export function getLeaderboard(db: Database.Database, limit: number = 10): Player[] {
  return db.prepare(`SELECT * FROM players ORDER BY balance DESC LIMIT ?`).all(limit) as Player[];
}

export function getPlayerCount(db: Database.Database): number {
  const row = db.prepare(`SELECT COUNT(*) as count FROM players`).get() as { count: number };
  return row.count;
}

export function getPlayerRank(db: Database.Database, telegramId: number): number {
  const row = db.prepare(`
    SELECT COUNT(*) + 1 as rank FROM players
    WHERE balance > (SELECT balance FROM players WHERE telegram_id = ?)
  `).get(telegramId) as { rank: number };
  return row.rank;
}

export function performBailout(db: Database.Database, telegramId: number, amount: number): void {
  const now = new Date().toISOString().split('T')[0];
  db.prepare(`
    UPDATE players SET balance = ?, current_streak = 0, last_bailout = ?
    WHERE telegram_id = ?
  `).run(amount, now, telegramId);
}

// ---- Bet queries ----

export function placeBet(db: Database.Database, telegramId: number, projectDay: number, choice: 'BUY' | 'PASS', amount: number): boolean {
  try {
    db.prepare(`
      INSERT INTO bets (telegram_id, project_day, choice, amount)
      VALUES (?, ?, ?, ?)
    `).run(telegramId, projectDay, choice, amount);
    return true;
  } catch {
    // UNIQUE constraint violation = already bet
    return false;
  }
}

export function getBet(db: Database.Database, telegramId: number, projectDay: number): Bet | undefined {
  return db.prepare(`SELECT * FROM bets WHERE telegram_id = ? AND project_day = ?`).get(telegramId, projectDay) as Bet | undefined;
}

export function getBetsForDay(db: Database.Database, projectDay: number): Bet[] {
  return db.prepare(`SELECT * FROM bets WHERE project_day = ?`).all(projectDay) as Bet[];
}

export function getBetCountForDay(db: Database.Database, projectDay: number): number {
  const row = db.prepare(`SELECT COUNT(*) as count FROM bets WHERE project_day = ?`).get(projectDay) as { count: number };
  return row.count;
}

export function resolveBet(db: Database.Database, betId: number, result: 'win' | 'lose', payout: number): void {
  db.prepare(`UPDATE bets SET result = ?, payout = ? WHERE id = ?`).run(result, payout, betId);
}

// ---- Game state queries ----

export function getState(db: Database.Database, key: string): string {
  const row = db.prepare(`SELECT value FROM game_state WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? '';
}

export function setState(db: Database.Database, key: string, value: string): void {
  db.prepare(`INSERT OR REPLACE INTO game_state (key, value) VALUES (?, ?)`).run(key, value);
}

export function getCurrentDay(db: Database.Database): number {
  return parseInt(getState(db, 'current_day'), 10) || 0;
}
