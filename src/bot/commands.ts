import { Bot, InlineKeyboard, InputFile } from 'grammy';
import type Database from 'better-sqlite3';
import { config } from '../config.js';
import * as db from '../db/queries.js';
import { canBailout } from '../game/scoring.js';
import { getProjectByDay, doResolve, doDrop, cancelAutoResolve } from '../game/engine.js';
import { generateBannerPNG } from '../game/banner.js';
import {
  formatStart, formatHelp, formatPortfolio, formatLeaderboard,
  formatBailout, formatDrop, formatGoToDM, formatAnnouncement, LEARN_URL,
} from '../game/messages.js';

function extractUser(ctx: { from?: { id: number; username?: string; first_name?: string } }) {
  const from = ctx.from;
  if (!from) return null;
  return { userId: from.id, username: from.username ?? null, displayName: from.first_name ?? null };
}

function isPrivateChat(ctx: { chat?: { type: string } }): boolean {
  return ctx.chat?.type === 'private';
}

function isAdmin(userId: number): boolean {
  return config.adminUserId !== 0 && userId === config.adminUserId;
}

export function registerCommands(bot: Bot, database: Database.Database): void {

  // Log chat ID for setup
  bot.use(async (ctx, next) => {
    if (ctx.chat && ctx.chat.type !== 'private') {
      console.log(`[group detected] chat_id: ${ctx.chat.id} | type: ${ctx.chat.type} | title: ${(ctx.chat as any).title ?? '?'}`);
    }
    await next();
  });

  // ---- ADMIN COMMANDS ----

  // /drop — admin only: publish next project to the group
  // If sent in a group, auto-switches to that group first.
  bot.command('drop', async (ctx) => {
    const user = extractUser(ctx);
    if (!user || !isAdmin(user.userId)) return;
    // R7: auto-detect group
    if (ctx.chat && ctx.chat.type !== 'private' && ctx.chat.id !== config.groupChatId) {
      config.groupChatId = ctx.chat.id;
      db.setBotConfig(database, 'group_chat_id', String(ctx.chat.id));
      await ctx.reply(`⚡ group switched to ${ctx.chat.id}`);
    }
    const result = await doDrop(bot, database);
    await ctx.reply(result.message);
  });

  // /resolve — admin only: resolve current day and post verdict
  bot.command('resolve', async (ctx) => {
    const user = extractUser(ctx);
    if (!user || !isAdmin(user.userId)) return;
    cancelAutoResolve();
    const result = await doResolve(bot, database);
    await ctx.reply(result.message);
  });

  // /status — admin only: show current game state
  bot.command('status', async (ctx) => {
    const user = extractUser(ctx);
    if (!user || !isAdmin(user.userId)) return;
    const g = config.groupChatId;
    const currentDay = db.getCurrentDay(database, g);
    const roundStatus = db.getGroupState(database, g, 'round_status') || 'idle';
    const betCount = currentDay > 0 ? db.getBetCountForDay(database, currentDay, g) : 0;
    const totalPlayers = db.getPlayerCount(database, g);
    const lastRes = db.getGroupState(database, g, 'last_resolution_date');
    const lastDrop = db.getGroupState(database, g, 'last_drop_date');
    const project = currentDay > 0 ? getProjectByDay(currentDay) : null;
    const statusEmoji = roundStatus === 'open' ? '🟢 OPEN' : roundStatus === 'closed' ? '🔒 CLOSED' : '⏸ IDLE';
    await ctx.reply([
      `🔧 admin status`,
      `round: ${statusEmoji}`,
      `current day: ${currentDay}/30`,
      `project: ${project?.name ?? 'none'}`,
      `answer: ${project ? (project.isLegit ? 'LEGIT' : 'INTEGRITY ISSUES') : '-'}`,
      `bets: ${betCount}`,
      `players: ${totalPlayers}`,
      `last resolution: ${lastRes || 'never'}`,
      `last drop: ${lastDrop || 'never'}`,
      `group: ${g}`,
    ].join('\n'));
  });

  // /nextday — admin only: resolve current + drop next
  bot.command('nextday', async (ctx) => {
    const user = extractUser(ctx);
    if (!user || !isAdmin(user.userId)) return;
    cancelAutoResolve();
    const resolveResult = await doResolve(bot, database);
    const dropResult = await doDrop(bot, database);
    await ctx.reply(`resolve: ${resolveResult.message}\ndrop: ${dropResult.message}`);
  });

  // /setday N — admin only: force game to a specific day (does NOT drop or resolve)
  bot.command('setday', async (ctx) => {
    const user = extractUser(ctx);
    if (!user || !isAdmin(user.userId)) return;
    const arg = ctx.match?.trim();
    const day = parseInt(arg ?? '', 10);
    if (isNaN(day) || day < 0 || day > 30) {
      await ctx.reply('usage: /setday N (0-30). 0 = before game starts.');
      return;
    }
    const g = config.groupChatId;
    cancelAutoResolve();
    db.setGroupState(database, g, 'current_day', String(day));
    db.setGroupState(database, g, 'round_status', 'closed');
    await ctx.reply(`⚠️ game state forced to day ${day}. use /drop to open the next round.`);
  });

  // /resetgame — admin only: reset game state but KEEP players and leaderboard
  bot.command('resetgame', async (ctx) => {
    const user = extractUser(ctx);
    if (!user || !isAdmin(user.userId)) return;
    const arg = ctx.match?.trim();
    if (arg !== 'CONFIRM') {
      await ctx.reply('⚠️ this will reset the game to day 0 and delete all bets for this group.\nplayer accounts and balances are PRESERVED.\n\ntype /resetgame CONFIRM to proceed.');
      return;
    }
    const g = config.groupChatId;
    cancelAutoResolve();
    db.setGroupState(database, g, 'current_day', '0');
    db.setGroupState(database, g, 'round_status', 'closed');
    db.setGroupState(database, g, 'last_resolution_date', '');
    db.setGroupState(database, g, 'last_drop_date', '');
    db.setGroupState(database, g, 'drop_message_id', '');
    // Delete bets for this group only
    database.prepare('DELETE FROM bets WHERE group_id = ?').run(g);
    await ctx.reply('✅ game reset to day 0. all bets cleared. player accounts intact.\nuse /drop to start a new game.');
  });

  // /resetleaderboard — admin only: DELETE all players for this group, clear bets, full clean slate
  bot.command('resetleaderboard', async (ctx) => {
    const user = extractUser(ctx);
    if (!user || !isAdmin(user.userId)) return;
    const arg = ctx.match?.trim();
    if (arg !== 'CONFIRM') {
      await ctx.reply('⚠️ this will DELETE all players from the leaderboard for this group, clear all bets, and reset the game to day 0.\neveryone will need to /play again.\n\ntype /resetleaderboard CONFIRM to proceed.');
      return;
    }
    const g = config.groupChatId;
    cancelAutoResolve();
    database.prepare('DELETE FROM bets WHERE group_id = ?').run(g);
    database.prepare('DELETE FROM group_players WHERE group_id = ?').run(g);
    db.setGroupState(database, g, 'current_day', '0');
    db.setGroupState(database, g, 'round_status', 'closed');
    db.setGroupState(database, g, 'last_resolution_date', '');
    db.setGroupState(database, g, 'last_drop_date', '');
    db.setGroupState(database, g, 'drop_message_id', '');
    await ctx.reply('✅ full reset for this group. leaderboard empty, game back to day 0. everyone starts fresh with /play.');
  });

  // /resetplayer @username — admin only: reset a single player in the current group
  bot.command('resetplayer', async (ctx) => {
    const user = extractUser(ctx);
    if (!user || !isAdmin(user.userId)) return;
    const arg = ctx.match?.trim();
    if (!arg) {
      await ctx.reply('usage: /resetplayer @username or /resetplayer telegram_id');
      return;
    }
    const g = config.groupChatId;
    const target = arg.replace('@', '');
    // Try by username first, then by telegram ID
    let player = database.prepare(`SELECT * FROM players WHERE username = ?`).get(target) as any;
    if (!player) {
      const id = parseInt(target, 10);
      if (!isNaN(id)) player = database.prepare(`SELECT * FROM players WHERE telegram_id = ?`).get(id) as any;
    }
    if (!player) {
      await ctx.reply(`player "${arg}" not found.`);
      return;
    }
    // Reset group-specific stats
    database.prepare(`UPDATE group_players SET balance = ?, games_played = 0, wins = 0, current_streak = 0, best_streak = 0, last_bailout = NULL WHERE telegram_id = ? AND group_id = ?`)
      .run(config.startingPoints, player.telegram_id, g);
    // Delete bets for this player in this group
    database.prepare(`DELETE FROM bets WHERE telegram_id = ? AND group_id = ?`).run(player.telegram_id, g);
    await ctx.reply(`✅ @${player.username ?? player.telegram_id} reset to ${config.startingPoints} pts in this group. stats and bets cleared.`);
  });

  // /groups — admin only: list all known groups with their state
  bot.command('groups', async (ctx) => {
    const user = extractUser(ctx);
    if (!user || !isAdmin(user.userId)) return;
    const groups = db.getKnownGroups(database);
    if (groups.length === 0) {
      await ctx.reply('no groups found.');
      return;
    }
    const lines = ['📋 known groups:', ''];
    for (const g of groups) {
      const active = g.group_id === config.groupChatId ? ' ← active' : '';
      const roundStatus = db.getGroupState(database, g.group_id, 'round_status') || 'idle';
      const statusEmoji = roundStatus === 'open' ? '🟢' : roundStatus === 'closed' ? '🔒' : '⏸';
      lines.push(`${statusEmoji} ${g.group_id}${active}`);
      lines.push(`   day ${g.current_day}/30 · ${g.players} players`);
    }
    await ctx.reply(lines.join('\n'));
  });

  // /setgroup — admin only: set target group from current chat or by ID
  bot.command('setgroup', async (ctx) => {
    const user = extractUser(ctx);
    if (!user || !isAdmin(user.userId)) return;
    const arg = ctx.match?.trim();
    let newGroupId: number;
    if (arg) {
      newGroupId = Number(arg);
      if (isNaN(newGroupId)) {
        await ctx.reply('usage: /setgroup (in a group) or /setgroup <chat_id>');
        return;
      }
    } else if (ctx.chat && ctx.chat.type !== 'private') {
      newGroupId = ctx.chat.id;
    } else {
      await ctx.reply('usage: /setgroup (in a group) or /setgroup <chat_id>');
      return;
    }
    config.groupChatId = newGroupId;
    db.setBotConfig(database, 'group_chat_id', String(newGroupId));
    const day = db.getCurrentDay(database, newGroupId);
    const players = db.getPlayerCount(database, newGroupId);
    await ctx.reply(`✅ group set to ${newGroupId}\nstate: day ${day}/30, ${players} players`);
  });

  // /announcement <datetime> — admin only: post game teaser with banner to the group
  // e.g. /announcement Friday 11:00 UTC
  bot.command('announcement', async (ctx) => {
    const user = extractUser(ctx);
    if (!user || !isAdmin(user.userId)) return;
    const arg = ctx.match?.trim();
    if (!arg) {
      await ctx.reply('usage: /announcement Friday 11:00 UTC');
      return;
    }
    const bannerBuf = await generateBannerPNG(config.resolveDelayMinutes, `NEXT DROP · <tspan fill="#fff" fill-opacity=".85">${arg.toUpperCase()}</tspan>`);
    const keyboard = new InlineKeyboard().url('📚 LEARN', LEARN_URL);
    await bot.api.sendPhoto(config.groupChatId, new InputFile(bannerBuf, 'banner.png'), {
      caption: formatAnnouncement(arg),
      reply_markup: keyboard,
    });
    await ctx.reply('✅ announcement posted to the group.');
  });

  // ---- PLAYER COMMANDS ----

  // /start — handles both normal start AND deep links from group (start=play_X)
  bot.command('start', async (ctx) => {
    const user = extractUser(ctx);
    if (!user) return;
    const g = config.groupChatId;
    db.getOrCreatePlayer(database, user.userId, user.username, user.displayName, config.startingPoints, g);

    const payload = ctx.match;
    if (payload && payload.startsWith('play_')) {
      const day = parseInt(payload.replace('play_', ''), 10);
      if (!isNaN(day)) {
        await showProjectInDM(ctx, database, user, day);
        return;
      }
    }

    await ctx.reply(formatStart(config.startingPoints));
  });

  // /help
  bot.command('help', async (ctx) => {
    if (!isPrivateChat(ctx)) {
      const botInfo = await bot.api.getMe();
      await ctx.reply(formatGoToDM(botInfo.username));
      return;
    }
    await ctx.reply(formatHelp());
  });

  // /play — DM only
  bot.command('play', async (ctx) => {
    const user = extractUser(ctx);
    if (!user) return;

    if (!isPrivateChat(ctx)) {
      const botInfo = await bot.api.getMe();
      await ctx.reply(formatGoToDM(botInfo.username));
      return;
    }

    const g = config.groupChatId;
    db.getOrCreatePlayer(database, user.userId, user.username, user.displayName, config.startingPoints, g);
    const currentDay = db.getCurrentDay(database, g);
    await showProjectInDM(ctx, database, user, currentDay);
  });

  // /portfolio — DM only
  bot.command('portfolio', async (ctx) => {
    const user = extractUser(ctx);
    if (!user) return;

    if (!isPrivateChat(ctx)) {
      const botInfo = await bot.api.getMe();
      await ctx.reply(formatGoToDM(botInfo.username));
      return;
    }

    const g = config.groupChatId;
    const player = db.getOrCreatePlayer(database, user.userId, user.username, user.displayName, config.startingPoints, g);
    const rank = db.getPlayerRank(database, user.userId, g);
    const totalPlayers = db.getPlayerCount(database, g);
    await ctx.reply(formatPortfolio(player, rank, totalPlayers));
  });

  // /leaderboard — works in both
  bot.command('leaderboard', async (ctx) => {
    const user = extractUser(ctx);
    if (!user) return;
    const g = config.groupChatId;
    db.getOrCreatePlayer(database, user.userId, user.username, user.displayName, config.startingPoints, g);
    const top = db.getLeaderboard(database, g, 10);
    const rank = db.getPlayerRank(database, user.userId, g);
    const totalPlayers = db.getPlayerCount(database, g);
    await ctx.reply(formatLeaderboard(top, rank, totalPlayers));
  });

  // /bailout — DM only
  bot.command('bailout', async (ctx) => {
    const user = extractUser(ctx);
    if (!user) return;

    if (!isPrivateChat(ctx)) {
      const botInfo = await bot.api.getMe();
      await ctx.reply(formatGoToDM(botInfo.username));
      return;
    }

    const g = config.groupChatId;
    const player = db.getOrCreatePlayer(database, user.userId, user.username, user.displayName, config.startingPoints, g);
    const { allowed, reason } = canBailout(player.balance);
    if (!allowed) {
      await ctx.reply(reason!);
      return;
    }

    db.performBailout(database, user.userId, g, config.minBet);
    await ctx.reply(formatBailout(config.minBet));
  });
}

// ---- Show project card + BUY/PASS in DM ----

async function showProjectInDM(
  ctx: any,
  database: Database.Database,
  user: { userId: number; username: string | null; displayName: string | null },
  day: number,
): Promise<void> {
  const g = config.groupChatId;

  if (day <= 0) {
    await ctx.reply('no active case yet. a new one will drop in the group soon.');
    return;
  }
  if (day > 30) {
    await ctx.reply('the game is over. check /leaderboard for final standings.');
    return;
  }

  const currentDay = db.getCurrentDay(database, g);
  if (day !== currentDay) {
    await ctx.reply(`that case is closed. use /play to see the current one.`);
    return;
  }

  // Check if round is closed (already resolved)
  const roundStatus = db.getGroupState(database, g, 'round_status');
  if (roundStatus === 'closed') {
    await ctx.reply('this case is closed. verdict is in the group. next one drops soon.');
    return;
  }

  const existingBet = db.getBet(database, user.userId, day, g);
  if (existingBet) {
    await ctx.reply(`you already called this one. ${existingBet.choice} for ${existingBet.amount} pts. verdict comes when the round closes.`);
    return;
  }

  const project = getProjectByDay(day);
  if (!project) {
    await ctx.reply('something went wrong. no project found.');
    return;
  }

  const keyboard = new InlineKeyboard()
    .text('🟢 BUY', `buy:${day}`)
    .text('🔴 PASS', `pass:${day}`);

  await ctx.reply(formatDrop(project), { reply_markup: keyboard });
}
