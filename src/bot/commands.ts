import { Bot, InlineKeyboard, InputFile } from 'grammy';
import type Database from 'better-sqlite3';
import { config, BUILD_SHA, BUILD_DATE } from '../config.js';
import * as db from '../db/queries.js';
import { canBailout } from '../game/scoring.js';
import { getProjectByDay, getTotalDays } from '../game/engine.js';
import {
  triggerManualDrop, triggerManualResolve, cancelPendingResolveForGroup,
  cancelInFlight, parseDaysOfWeek, parseTimeUtc,
} from '../game/scheduler.js';
import { generateBannerPNG } from '../game/banner.js';
import {
  formatStart, formatHelp, formatPortfolio, formatLeaderboard,
  formatBailout, formatDrop, formatGoToDM, formatAnnouncement,
  formatDropAnnouncement, LEARN_URL,
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
      const title = (ctx.chat as any).title ?? '?';
      console.log(`[group detected] chat_id: ${ctx.chat.id} | type: ${ctx.chat.type} | title: ${title}`);
      // Persist group title for /groups display
      db.setGroupState(database, ctx.chat.id, 'group_title', title);
    }
    await next();
  });

  // ---- ADMIN COMMANDS ----

  // /drop [minutes] — admin only: publish next project to the group
  // Optional: /drop 30 → sets resolve time to 30 min for this round
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
    // Optional resolve time override (per-call, not persisted)
    const arg = ctx.match?.trim();
    let resolveDelayMinutes: number | undefined;
    if (arg) {
      const mins = parseInt(arg, 10);
      if (!isNaN(mins) && mins > 0) resolveDelayMinutes = mins;
    }
    const result = await triggerManualDrop(bot, database, config.groupChatId, resolveDelayMinutes);
    await ctx.reply(result.message);
  });

  // /resolve — admin only: resolve current day and post verdict
  bot.command('resolve', async (ctx) => {
    const user = extractUser(ctx);
    if (!user || !isAdmin(user.userId)) return;
    const result = await triggerManualResolve(bot, database, config.groupChatId);
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
    const groupResolveDelay = db.getGroupResolveDelayMinutes(database, g);
    const resolveDelayLabel = groupResolveDelay !== null
      ? `${groupResolveDelay}min (group)`
      : `${config.resolveDelayMinutes}min (env default)`;
    const announceMinutes = db.getGroupAnnounceMinutesBefore(database, g);
    const announceLabel = announceMinutes > 0 ? `${announceMinutes}min before drop` : 'disabled';
    await ctx.reply([
      `🔧 admin status`,
      `round: ${statusEmoji}`,
      `current day: ${currentDay}/30`,
      `project: ${project?.name ?? 'none'}`,
      `answer: ${project ? (project.isLegit ? 'LEGIT' : 'INTEGRITY ISSUES') : '-'}`,
      `bets: ${betCount}`,
      `players: ${totalPlayers}`,
      `resolve delay: ${resolveDelayLabel}`,
      `announce: ${announceLabel}`,
      `last resolution: ${lastRes || 'never'}`,
      `last drop: ${lastDrop || 'never'}`,
      `group: ${g}`,
    ].join('\n'));
  });

  // /version — admin only: show build version
  bot.command('version', async (ctx) => {
    const user = extractUser(ctx);
    if (!user || !isAdmin(user.userId)) return;
    await ctx.reply(`🏷 build: ${BUILD_SHA.slice(0, 7)}\n📅 date: ${BUILD_DATE}`);
  });

  // /nextday — admin only: resolve current + drop next
  bot.command('nextday', async (ctx) => {
    const user = extractUser(ctx);
    if (!user || !isAdmin(user.userId)) return;
    const resolveResult = await triggerManualResolve(bot, database, config.groupChatId);
    const dropResult = await triggerManualDrop(bot, database, config.groupChatId);
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
    cancelPendingResolveForGroup(database, config.groupChatId);
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
    cancelPendingResolveForGroup(database, config.groupChatId);
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
    cancelPendingResolveForGroup(database, config.groupChatId);
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

  // /groups — admin only: list all known groups with inline buttons
  bot.command('groups', async (ctx) => {
    const user = extractUser(ctx);
    if (!user || !isAdmin(user.userId)) return;
    const groups = db.getKnownGroups(database);

    const lines = ['📋 known groups:'];
    const keyboard = new InlineKeyboard();

    if (groups.length === 0) {
      lines.push('', 'no groups yet. use the button below in a group to add one.');
    } else {
      for (const g of groups) {
        const title = db.getGroupState(database, g.group_id, 'group_title') || String(g.group_id);
        const active = g.group_id === config.groupChatId ? ' ✅' : '';
        const roundStatus = db.getGroupState(database, g.group_id, 'round_status') || 'idle';
        const statusEmoji = roundStatus === 'open' ? '🟢' : roundStatus === 'closed' ? '🔒' : '⏸';
        lines.push(`${statusEmoji} ${title}${active}`);
        lines.push(`   day ${g.current_day}/30 · ${g.players} players`);

        const btnLabel = g.group_id === config.groupChatId
          ? `✅ ${title} (active)`
          : `→ ${title}`;
        keyboard.text(btnLabel, `switchgroup:${g.group_id}`).row();
      }
    }

    keyboard.text('➕ Add current group', 'switchgroup:auto').row();
    await ctx.reply(lines.join('\n'), { reply_markup: keyboard });
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

  // /setresolvedelay <minutes> — admin only: per-group resolve delay
  // Applies to ALL drops in this group (manual /drop and scheduled). /drop N still
  // overrides for one round. Persists across restarts.
  bot.command('setresolvedelay', async (ctx) => {
    const user = extractUser(ctx);
    if (!user || !isAdmin(user.userId)) return;
    const g = config.groupChatId;
    const arg = ctx.match?.trim();
    if (!arg) {
      const current = db.getGroupResolveDelayMinutes(database, g);
      const label = current !== null
        ? `${current}min (group)`
        : `${config.resolveDelayMinutes}min (env default)`;
      await ctx.reply(`resolve delay: ${label}\nusage: /setresolvedelay <minutes>`);
      return;
    }
    const n = parseInt(arg, 10);
    if (isNaN(n) || n <= 0) {
      await ctx.reply('invalid delay. use a positive integer in minutes.');
      return;
    }
    db.setGroupResolveDelayMinutes(database, g, n);
    await ctx.reply(`✅ resolve delay for this group set to ${n}min.\napplies to future drops (doesn't affect the currently open round).`);
  });

  // /setannounce <minutes> — admin only: per-group pre-drop announcement lead time
  // 0 disables. Only applies to scheduled drops (not manual /drop).
  bot.command('setannounce', async (ctx) => {
    const user = extractUser(ctx);
    if (!user || !isAdmin(user.userId)) return;
    const g = config.groupChatId;
    const arg = ctx.match?.trim();
    if (!arg) {
      const current = db.getGroupAnnounceMinutesBefore(database, g);
      const label = current > 0 ? `${current}min before drop` : 'disabled';
      await ctx.reply(`announce: ${label}\nusage: /setannounce <minutes>  (0 to disable)`);
      return;
    }
    const n = parseInt(arg, 10);
    if (isNaN(n) || n < 0) {
      await ctx.reply('invalid value. use a non-negative integer in minutes (0 disables).');
      return;
    }
    db.setGroupAnnounceMinutesBefore(database, g, n);
    if (n === 0) {
      await ctx.reply('✅ announcements disabled for this group.\nalready-materialized announce jobs stay queued — cancel them with /jobs rm if you want.');
    } else {
      await ctx.reply(`✅ announcements set to ${n}min before each scheduled drop.\napplies to slots materialized in the next 24h.`);
    }
  });

  // /schedule — admin only: list / add / rm / on / off recurring schedules
  // Usage:
  //   /schedule                             → list for active group
  //   /schedule add mon,wed,fri 14:00       → days, HH:MM UTC (resolve delay read from group config)
  //   /schedule rm 3                        → delete schedule #3
  //   /schedule on 3                        → enable
  //   /schedule off 3                       → disable
  bot.command('schedule', async (ctx) => {
    const user = extractUser(ctx);
    if (!user || !isAdmin(user.userId)) return;
    const g = config.groupChatId;
    const raw = (ctx.match?.trim() ?? '');
    const tokens = raw.split(/\s+/).filter(Boolean);
    const sub = tokens[0]?.toLowerCase();

    // List (no sub or 'list')
    if (!sub || sub === 'list') {
      const schedules = db.getSchedulesForGroup(database, g);
      const title = db.getGroupState(database, g, 'group_title') || String(g);
      if (schedules.length === 0) {
        await ctx.reply(
          `no schedules for ${title}.\n\n` +
          `usage: /schedule add mon,wed,fri 14:00\n` +
          `resolve delay is set per-group with /setresolvedelay.`
        );
        return;
      }
      const groupResolveDelay = db.getGroupResolveDelayMinutes(database, g);
      const delayLabel = groupResolveDelay !== null
        ? `${groupResolveDelay}min (group)`
        : `${config.resolveDelayMinutes}min (env default)`;
      const lines = [`📅 schedules for ${title} (${schedules.length}):`, ''];
      for (const s of schedules) {
        const status = s.enabled ? '✓' : '✗ disabled';
        lines.push(`[${s.id}] ${s.days_of_week} @ ${s.time_utc} UTC · ${status}`);
      }
      lines.push('', `resolve delay: ${delayLabel}  (change with /setresolvedelay <min>)`);
      lines.push('commands: /schedule add <days> <HH:MM> · rm <id> · on <id> · off <id>');
      await ctx.reply(lines.join('\n'));
      return;
    }

    if (sub === 'add') {
      if (tokens.length < 3) {
        await ctx.reply('usage: /schedule add <days> <HH:MM>\nexample: /schedule add mon,wed,fri 14:00\nresolve delay is set per-group with /setresolvedelay.');
        return;
      }
      const daysRaw = tokens[1];
      const timeRaw = tokens[2];
      const days = parseDaysOfWeek(daysRaw);
      const time = parseTimeUtc(timeRaw);
      if (!days) {
        await ctx.reply('invalid days. use mon,tue,wed,thu,fri,sat,sun (comma-separated).');
        return;
      }
      if (!time) {
        await ctx.reply('invalid time. use HH:MM (24h UTC), e.g. 14:00 or 09:30.');
        return;
      }
      // resolve_delay_minutes column kept for schema back-compat but no longer
      // authoritative — doDrop reads the group-level setting at execution time.
      const delay = db.getGroupResolveDelayMinutes(database, g) ?? config.resolveDelayMinutes;
      const daysCsv = days.join(',');
      const timeFmt = `${String(time.h).padStart(2, '0')}:${String(time.m).padStart(2, '0')}`;
      const id = db.insertSchedule(database, g, daysCsv, timeFmt, delay);
      await ctx.reply(`✅ schedule [${id}] added: ${daysCsv} @ ${timeFmt} UTC · enabled\nresolve delay: ${delay}min (group-level, change with /setresolvedelay)`);
      return;
    }

    if (sub === 'rm' || sub === 'remove' || sub === 'delete') {
      const id = parseInt(tokens[1] ?? '', 10);
      if (isNaN(id)) {
        await ctx.reply('usage: /schedule rm <id>');
        return;
      }
      const schedule = db.getScheduleById(database, id);
      if (!schedule || schedule.group_id !== g) {
        await ctx.reply(`schedule #${id} not found in this group.`);
        return;
      }
      db.deleteSchedule(database, id);
      await ctx.reply(`✅ schedule [${id}] deleted. already-materialized jobs keep firing — use /jobs rm to cancel them.`);
      return;
    }

    if (sub === 'on' || sub === 'off') {
      const id = parseInt(tokens[1] ?? '', 10);
      if (isNaN(id)) {
        await ctx.reply(`usage: /schedule ${sub} <id>`);
        return;
      }
      const schedule = db.getScheduleById(database, id);
      if (!schedule || schedule.group_id !== g) {
        await ctx.reply(`schedule #${id} not found in this group.`);
        return;
      }
      db.setScheduleEnabled(database, id, sub === 'on');
      await ctx.reply(`✅ schedule [${id}] ${sub === 'on' ? 'enabled' : 'disabled'}.`);
      return;
    }

    await ctx.reply('usage: /schedule [list|add|rm|on|off] ...');
  });

  // /jobs — admin only: list next pending jobs for the active group, or cancel one
  // Usage:
  //   /jobs              → list next 10
  //   /jobs rm <id>      → cancel a pending job
  bot.command('jobs', async (ctx) => {
    const user = extractUser(ctx);
    if (!user || !isAdmin(user.userId)) return;
    const g = config.groupChatId;
    const raw = (ctx.match?.trim() ?? '');
    const tokens = raw.split(/\s+/).filter(Boolean);
    const sub = tokens[0]?.toLowerCase();

    if (sub === 'rm' || sub === 'cancel') {
      const id = parseInt(tokens[1] ?? '', 10);
      if (isNaN(id)) {
        await ctx.reply('usage: /jobs rm <id>');
        return;
      }
      const job = db.getJobById(database, id);
      if (!job || job.group_id !== g) {
        await ctx.reply(`job #${id} not found in this group.`);
        return;
      }
      if (job.status !== 'pending') {
        await ctx.reply(`job #${id} is ${job.status}, cannot cancel.`);
        return;
      }
      cancelInFlight(id);
      db.markJobSkipped(database, id, 'canceled by admin');
      await ctx.reply(`✅ job #${id} canceled.`);
      return;
    }

    const jobs = db.getPendingJobsForGroup(database, g, 10);
    const title = db.getGroupState(database, g, 'group_title') || String(g);
    if (jobs.length === 0) {
      await ctx.reply(`no pending jobs for ${title}.`);
      return;
    }
    const lines = [`⏱ next ${jobs.length} pending jobs for ${title}:`, ''];
    for (const j of jobs) {
      const when = j.run_at.replace('T', ' ').replace(/:\d\d\..*/, '').replace(/-/g, '-');
      const src = j.schedule_id ? `schedule #${j.schedule_id}` : 'manual';
      lines.push(`[${j.id}] ${j.kind.padEnd(7)} ${when} UTC · ${src}`);
    }
    lines.push('', 'cancel one with /jobs rm <id>');
    await ctx.reply(lines.join('\n'));
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

  // /testannounce — admin only: preview a pre-drop announcement IN THE CURRENT CHAT.
  // Posts to ctx.chat (not config.groupChatId), so you can try it in a test group
  // without switching the active group. No DB writes, no schedule side-effects.
  //
  // Usage:
  //   /testannounce                → simulates drop today at +6h
  //   /testannounce 2026-04-13T16:00:00Z  → simulates a specific drop time (ISO UTC)
  bot.command('testannounce', async (ctx) => {
    const user = extractUser(ctx);
    if (!user || !isAdmin(user.userId)) return;
    if (!ctx.chat) return;

    const arg = ctx.match?.trim();
    let dropRunAt: Date;
    if (arg) {
      const parsed = new Date(arg);
      if (isNaN(parsed.getTime())) {
        await ctx.reply('invalid ISO date. example: /testannounce 2026-04-13T16:00:00Z');
        return;
      }
      dropRunAt = parsed;
    } else {
      dropRunAt = new Date(Date.now() + 6 * 60 * 60 * 1000); // +6h from now
    }

    const caption = formatDropAnnouncement(dropRunAt, new Date(), getTotalDays());
    // Use the active group's resolve delay for the banner's "YOU HAVE X HOURS" line
    const resolveDelay =
      db.getGroupResolveDelayMinutes(database, config.groupChatId)
      ?? config.resolveDelayMinutes;
    const bannerBuf = await generateBannerPNG(resolveDelay);
    const keyboard = new InlineKeyboard().url('📚 LEARN', LEARN_URL);

    try {
      await bot.api.sendPhoto(ctx.chat.id, new InputFile(bannerBuf, 'banner.png'), {
        caption,
        reply_markup: keyboard,
      });
    } catch (err) {
      await ctx.reply(`failed to post preview: ${err}`);
    }
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
