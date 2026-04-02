import { Bot, InlineKeyboard, InputFile } from 'grammy';
import type Database from 'better-sqlite3';
import { config } from '../config.js';
import * as db from '../db/queries.js';
import { calculatePayout } from './scoring.js';
import { formatDropGroup, formatDropGroupClosed, formatVerdict, LEARN_URL } from './messages.js';
import type { Project } from '../projects/generator.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateBannerPNG } from './banner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Auto-resolve timer
let resolveTimer: ReturnType<typeof setTimeout> | null = null;

// Load projects from JSON
let projects: Project[];

export function loadProjects(): Project[] {
  if (!projects) {
    const raw = readFileSync(resolve(__dirname, '../projects/projects.json'), 'utf-8');
    projects = JSON.parse(raw) as Project[];
  }
  return projects;
}

export function getProjectByDay(day: number): Project | undefined {
  return loadProjects().find(p => p.day === day);
}

// ============================================================
// CORE LOGIC — no date guards, called by admin commands
// ============================================================

/**
 * Resolve current day: calculate payouts, post verdict in group.
 * Returns true if resolution happened, false if nothing to resolve.
 */
export async function doResolve(bot: Bot, database: Database.Database): Promise<{ ok: boolean; message: string }> {
  const currentDay = db.getCurrentDay(database);
  if (currentDay <= 0) {
    return { ok: false, message: 'no active day to resolve.' };
  }

  const project = getProjectByDay(currentDay);
  if (!project) {
    return { ok: false, message: `no project found for day ${currentDay}.` };
  }

  // Check if already resolved (has resolved bets for this day)
  const existingBets = db.getBetsForDay(database, currentDay);
  const alreadyResolved = existingBets.some(b => b.result !== null);
  if (alreadyResolved) {
    return { ok: false, message: `day ${currentDay} already resolved.` };
  }

  // Get the original drop message_id for reply
  const dropMsgId = db.getState(database, 'drop_message_id');

  const bets = db.getBetsForDay(database, currentDay);

  // Resolve all bets in a transaction
  const results: { bet: db.Bet; player: db.Player; payout: number }[] = [];

  if (bets.length > 0) {
    const transaction = database.transaction(() => {
      for (const bet of bets) {
        const player = db.getPlayer(database, bet.telegram_id);
        if (!player) continue;

        const { result, payout } = calculatePayout(
          bet.choice,
          bet.amount,
          project.isLegit,
          player.current_streak,
        );

        db.resolveBet(database, bet.id, result, payout);
        db.updateBalance(database, bet.telegram_id, payout);
        db.updateStreak(database, bet.telegram_id, result === 'win');

        const updatedPlayer = db.getPlayer(database, bet.telegram_id)!;
        results.push({ bet, player: updatedPlayer, payout });
      }
    });
    transaction();
  }

  // Send verdict to GROUP — reply to original drop message
  try {
    const verdictMsg = formatVerdict(project, results);
    const opts: Record<string, unknown> = {};
    if (dropMsgId) {
      opts.reply_parameters = { message_id: parseInt(dropMsgId, 10) };
    }
    await bot.api.sendMessage(config.groupChatId, verdictMsg, opts);
  } catch (err) {
    console.error('failed to send verdict to group:', err);
    return { ok: false, message: `verdict computed but failed to post in group: ${err}` };
  }

  // Send individual DM notifications
  for (const r of results) {
    try {
      const emoji = r.payout > 0 ? '✅' : '❌';
      const sign = r.payout > 0 ? '+' : '';
      const verdict = project.isLegit ? 'checked out — LEGIT' : 'had INTEGRITY ISSUES';
      await bot.api.sendMessage(r.bet.telegram_id,
        `${emoji} verdict is in: ${project.name} ${verdict}.\n` +
        `your ${r.bet.choice} → ${sign}${r.payout} pts. balance: ${r.player.balance} pts.`
      );
    } catch {
      // Player hasn't started DM with bot yet
    }
  }

  // Mark resolved
  const today = new Date().toISOString().split('T')[0];
  db.setState(database, 'last_resolution_date', today);
  db.setState(database, 'round_status', 'closed');

  // Update group drop message: show CLOSED, remove buttons
  if (dropMsgId) {
    try {
      const betCount = db.getBetCountForDay(database, currentDay);
      const closedText = formatDropGroupClosed(project, betCount);
      await bot.api.editMessageCaption(
        config.groupChatId,
        parseInt(dropMsgId, 10),
        { caption: closedText },
      );
    } catch {
      // Message might not be editable anymore
    }
  }

  return { ok: true, message: `day ${currentDay} resolved. ${results.length} bets processed.` };
}

/**
 * Publish a new drop: increment day, post teaser in group with PLAY + LEARN buttons.
 * Returns true if drop was published.
 */
export async function doDrop(bot: Bot, database: Database.Database): Promise<{ ok: boolean; message: string }> {
  const currentDay = db.getCurrentDay(database);
  const nextDay = currentDay + 1;

  if (nextDay > 30) {
    // Game over
    try {
      const top = db.getLeaderboard(database, 10);
      const totalPlayers = db.getPlayerCount(database);
      const lines = ['🏆 carbon roulette — game over!', '', 'final standings:', ''];
      top.forEach((p, i) => {
        const displayName = p.username ? `@${p.username}` : (p.display_name ?? 'anon');
        lines.push(`${i + 1}. ${displayName} — ${p.balance.toLocaleString()} pts`);
      });
      lines.push('', `${totalPlayers} players participated. thanks for playing.`);
      await bot.api.sendMessage(config.groupChatId, lines.join('\n'));
    } catch (err) {
      console.error('failed to send game over:', err);
    }
    return { ok: false, message: 'game over. all 30 days played.' };
  }

  const project = getProjectByDay(nextDay);
  if (!project) {
    return { ok: false, message: `no project found for day ${nextDay}.` };
  }

  // Advance game state
  db.setState(database, 'current_day', String(nextDay));
  db.setState(database, 'round_status', 'open');
  const today = new Date().toISOString().split('T')[0];
  db.setState(database, 'last_drop_date', today);

  // Get bot username for the DM link
  const botInfo = await bot.api.getMe();
  const botUsername = botInfo.username;

  // Build group message
  const dropMsg = formatDropGroup(project, 0);
  const keyboard = new InlineKeyboard()
    .url('🔍 INVESTIGATE', `https://t.me/${botUsername}?start=play_${nextDay}`)
    .url('📚 LEARN', LEARN_URL);

  try {
    const bannerBuf = await generateBannerPNG(config.resolveDelayMinutes);
    const sent = await bot.api.sendPhoto(config.groupChatId, new InputFile(bannerBuf, 'banner.png'), {
      caption: dropMsg,
      reply_markup: keyboard,
    });
    // Store message_id for verdict reply + live counter updates
    db.setState(database, 'drop_message_id', String(sent.message_id));
    console.log(`[drop] day ${nextDay} posted to group (msg_id: ${sent.message_id})`);
  } catch (err) {
    console.error('failed to send drop to group:', err);
    return { ok: false, message: `day advanced to ${nextDay} but failed to post in group: ${err}` };
  }

  // Schedule auto-resolve
  scheduleAutoResolve(bot, database);

  const delayMin = config.resolveDelayMinutes;
  return { ok: true, message: `day ${nextDay}/30 dropped. auto-resolve in ${delayMin}min.` };
}

/**
 * Schedule automatic resolution after the configured delay.
 * Cancels any previously scheduled timer.
 */
function scheduleAutoResolve(bot: Bot, database: Database.Database): void {
  // Cancel previous timer if any
  if (resolveTimer) {
    clearTimeout(resolveTimer);
    resolveTimer = null;
  }

  const delayMs = config.resolveDelayMinutes * 60 * 1000;
  console.log(`[timer] auto-resolve scheduled in ${config.resolveDelayMinutes}min`);

  resolveTimer = setTimeout(async () => {
    console.log(`[timer] auto-resolve firing...`);
    try {
      const result = await doResolve(bot, database);
      console.log(`[timer] ${result.message}`);
    } catch (err) {
      console.error('[timer] auto-resolve error:', err);
    }
    resolveTimer = null;
  }, delayMs);
}

/**
 * Cancel the auto-resolve timer (used by /resolve when admin resolves manually).
 */
export function cancelAutoResolve(): void {
  if (resolveTimer) {
    clearTimeout(resolveTimer);
    resolveTimer = null;
    console.log('[timer] auto-resolve cancelled (manual resolve)');
  }
}

/**
 * Update the group drop message with the current bet count.
 * Called each time a player places a bet.
 */
export async function updateDropBetCount(bot: Bot, database: Database.Database): Promise<void> {
  const currentDay = db.getCurrentDay(database);
  const dropMsgId = db.getState(database, 'drop_message_id');
  if (!dropMsgId || currentDay <= 0) {
    console.log('[bet counter] no drop_message_id stored, skipping update');
    return;
  }

  const project = getProjectByDay(currentDay);
  if (!project) return;

  const betCount = db.getBetCountForDay(database, currentDay);
  const botInfo = await bot.api.getMe();

  const updatedText = formatDropGroup(project, betCount);
  const keyboard = new InlineKeyboard()
    .url('🔍 INVESTIGATE', `https://t.me/${botInfo.username}?start=play_${currentDay}`)
    .url('📚 LEARN', LEARN_URL);

  try {
    await bot.api.editMessageCaption(
      config.groupChatId,
      parseInt(dropMsgId, 10),
      { caption: updatedText, reply_markup: keyboard },
    );
  } catch (err) {
    console.log('[bet counter] failed to update group message:', err);
  }
}

