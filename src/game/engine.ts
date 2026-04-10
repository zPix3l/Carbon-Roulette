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

export function getTotalDays(): number {
  return loadProjects().length;
}

// ============================================================
// CORE LOGIC — called by scheduler (and by admin commands via scheduler)
// ============================================================

/**
 * Resolve current day: calculate payouts, post verdict in group.
 * Operates on the specified group.
 */
export async function doResolve(
  bot: Bot,
  database: Database.Database,
  groupId: number,
): Promise<{ ok: boolean; message: string }> {
  const currentDay = db.getCurrentDay(database, groupId);
  if (currentDay <= 0) {
    return { ok: false, message: 'no active day to resolve.' };
  }

  const project = getProjectByDay(currentDay);
  if (!project) {
    return { ok: false, message: `no project found for day ${currentDay}.` };
  }

  // Check if already resolved (has resolved bets for this day)
  const existingBets = db.getBetsForDay(database, currentDay, groupId);
  const alreadyResolved = existingBets.some(b => b.result !== null);
  if (alreadyResolved) {
    return { ok: false, message: `day ${currentDay} already resolved.` };
  }

  // Get the original drop message_id for reply
  const dropMsgId = db.getGroupState(database, groupId, 'drop_message_id');

  const bets = db.getBetsForDay(database, currentDay, groupId);

  // Resolve all bets in a transaction
  const results: { bet: db.Bet; player: db.Player; payout: number }[] = [];

  if (bets.length > 0) {
    const transaction = database.transaction(() => {
      for (const bet of bets) {
        const player = db.getPlayer(database, bet.telegram_id, groupId);
        if (!player) continue;

        const { result, payout } = calculatePayout(
          bet.choice,
          bet.amount,
          project.isLegit,
          player.current_streak,
        );

        db.resolveBet(database, bet.id, result, payout);
        db.updateBalance(database, bet.telegram_id, groupId, payout);
        db.updateStreak(database, bet.telegram_id, groupId, result === 'win');

        const updatedPlayer = db.getPlayer(database, bet.telegram_id, groupId)!;
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
    await bot.api.sendMessage(groupId, verdictMsg, opts);
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
  db.setGroupState(database, groupId, 'last_resolution_date', today);
  db.setGroupState(database, groupId, 'round_status', 'closed');

  // Update group drop message: show CLOSED, remove buttons
  if (dropMsgId) {
    try {
      const betCount = db.getBetCountForDay(database, currentDay, groupId);
      const closedText = formatDropGroupClosed(project, betCount);
      await bot.api.editMessageCaption(
        groupId,
        parseInt(dropMsgId, 10),
        { caption: closedText },
      );
    } catch {
      // Message might not be editable anymore
    }
  }

  return { ok: true, message: `day ${currentDay} resolved. ${results.length} bets processed.` };
}

export interface DropPayload {
  resolve_delay_minutes?: number;
}

/**
 * Publish a new drop: increment day, post teaser in group with PLAY + LEARN buttons.
 * Operates on the specified group.
 */
export async function doDrop(
  bot: Bot,
  database: Database.Database,
  groupId: number,
  payload?: DropPayload,
): Promise<{ ok: boolean; message: string; resolveDelayMinutes: number }> {
  const resolveDelayMinutes = payload?.resolve_delay_minutes ?? config.resolveDelayMinutes;
  const currentDay = db.getCurrentDay(database, groupId);
  const nextDay = currentDay + 1;
  const totalDays = getTotalDays();

  if (nextDay > totalDays) {
    // Game over
    try {
      const top = db.getLeaderboard(database, groupId, 10);
      const totalPlayers = db.getPlayerCount(database, groupId);
      const lines = ['🏆 carbon roulette — game over!', '', 'final standings:', ''];
      top.forEach((p, i) => {
        const displayName = p.username ? `@${p.username}` : (p.display_name ?? 'anon');
        lines.push(`${i + 1}. ${displayName} — ${p.balance.toLocaleString()} pts`);
      });
      lines.push('', `${totalPlayers} players participated. thanks for playing.`);
      await bot.api.sendMessage(groupId, lines.join('\n'));
    } catch (err) {
      console.error('failed to send game over:', err);
    }
    return { ok: false, message: `game over. all ${totalDays} days played.`, resolveDelayMinutes };
  }

  const project = getProjectByDay(nextDay);
  if (!project) {
    return { ok: false, message: `no project found for day ${nextDay}.`, resolveDelayMinutes };
  }

  // Advance game state
  db.setGroupState(database, groupId, 'current_day', String(nextDay));
  db.setGroupState(database, groupId, 'round_status', 'open');
  const today = new Date().toISOString().split('T')[0];
  db.setGroupState(database, groupId, 'last_drop_date', today);

  // Get bot username for the DM link
  const botInfo = await bot.api.getMe();
  const botUsername = botInfo.username;

  // Build group message
  const dropMsg = formatDropGroup(project, 0);
  const keyboard = new InlineKeyboard()
    .url('🔍 INVESTIGATE', `https://t.me/${botUsername}?start=play_${nextDay}`)
    .url('📚 LEARN', LEARN_URL);

  try {
    const bannerBuf = await generateBannerPNG(resolveDelayMinutes);
    const sent = await bot.api.sendPhoto(groupId, new InputFile(bannerBuf, 'banner.png'), {
      caption: dropMsg,
      reply_markup: keyboard,
    });
    // Store message_id for verdict reply + live counter updates
    db.setGroupState(database, groupId, 'drop_message_id', String(sent.message_id));
    console.log(`[drop] group ${groupId} day ${nextDay} posted (msg_id: ${sent.message_id})`);
  } catch (err) {
    console.error('failed to send drop to group:', err);
    return { ok: false, message: `day advanced to ${nextDay} but failed to post in group: ${err}`, resolveDelayMinutes };
  }

  return {
    ok: true,
    message: `day ${nextDay}/${totalDays} dropped. auto-resolve in ${resolveDelayMinutes}min.`,
    resolveDelayMinutes,
  };
}

/**
 * Update the group drop message with the current bet count.
 * Called each time a player places a bet.
 */
export async function updateDropBetCount(
  bot: Bot,
  database: Database.Database,
  groupId: number,
): Promise<void> {
  const currentDay = db.getCurrentDay(database, groupId);
  const dropMsgId = db.getGroupState(database, groupId, 'drop_message_id');
  if (!dropMsgId || currentDay <= 0) {
    console.log('[bet counter] no drop_message_id stored, skipping update');
    return;
  }

  const project = getProjectByDay(currentDay);
  if (!project) return;

  const betCount = db.getBetCountForDay(database, currentDay, groupId);
  const botInfo = await bot.api.getMe();

  const updatedText = formatDropGroup(project, betCount);
  const keyboard = new InlineKeyboard()
    .url('🔍 INVESTIGATE', `https://t.me/${botInfo.username}?start=play_${currentDay}`)
    .url('📚 LEARN', LEARN_URL);

  try {
    await bot.api.editMessageCaption(
      groupId,
      parseInt(dropMsgId, 10),
      { caption: updatedText, reply_markup: keyboard },
    );
  } catch (err) {
    console.log('[bet counter] failed to update group message:', err);
  }
}
