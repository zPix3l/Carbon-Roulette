import { Bot, InlineKeyboard } from 'grammy';
import type Database from 'better-sqlite3';
import { config } from '../config.js';
import * as db from '../db/queries.js';
import { formatBetConfirmation } from '../game/messages.js';
import { updateDropBetCount } from '../game/engine.js';

export function registerCallbacks(bot: Bot, database: Database.Database): void {

  // BUY button (DM only)
  bot.callbackQuery(/^buy:(\d+)$/, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.answerCallbackQuery({ text: 'tap INVESTIGATE to open the case in DM.' });
      return;
    }
    await handleChoiceCallback(ctx, database, 'BUY');
  });

  // PASS button (DM only)
  bot.callbackQuery(/^pass:(\d+)$/, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.answerCallbackQuery({ text: 'tap INVESTIGATE to open the case in DM.' });
      return;
    }
    await handleChoiceCallback(ctx, database, 'PASS');
  });

  // Amount selection (DM only)
  bot.callbackQuery(/^amount:(\d+):(BUY|PASS):(.+)$/, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.answerCallbackQuery({ text: 'use DM to place bets.' });
      return;
    }

    const match = ctx.match!;
    const projectDay = parseInt(match[1], 10);
    const choice = match[2] as 'BUY' | 'PASS';
    const amountStr = match[3];

    const userId = ctx.from.id;
    const username = ctx.from.username ?? null;
    const displayName = ctx.from.first_name ?? null;
    const player = db.getOrCreatePlayer(database, userId, username, displayName, config.startingPoints);

    // Check current day is still active
    const currentDay = db.getCurrentDay(database);
    if (projectDay !== currentDay) {
      await ctx.answerCallbackQuery({ text: 'this round is closed.' });
      return;
    }

    // Check not already bet
    const existingBet = db.getBet(database, userId, projectDay);
    if (existingBet) {
      await ctx.answerCallbackQuery({ text: 'you already placed your bet on this case.' });
      return;
    }

    // Parse amount
    let amount: number;
    if (amountStr === 'all') {
      amount = player.balance;
    } else {
      amount = parseInt(amountStr, 10);
    }

    // Validate
    if (amount < config.minBet) {
      await ctx.answerCallbackQuery({ text: `minimum bet is ${config.minBet} pts.` });
      return;
    }
    if (amount > player.balance) {
      await ctx.answerCallbackQuery({ text: `you only have ${player.balance} pts.` });
      return;
    }

    // Place bet
    const success = db.placeBet(database, userId, projectDay, choice, amount);
    if (!success) {
      await ctx.answerCallbackQuery({ text: 'you already placed your bet on this case.' });
      return;
    }

    await ctx.answerCallbackQuery({ text: `${choice} for ${amount} pts. locked in.` });
    await ctx.reply(formatBetConfirmation(choice, amount, player.balance));

    // Update live bet counter on group drop message
    updateDropBetCount(bot, database).catch(() => {});
  });
}

async function handleChoiceCallback(ctx: any, database: Database.Database, choice: 'BUY' | 'PASS'): Promise<void> {
  const match = ctx.match!;
  const projectDay = parseInt(match[1], 10);
  const userId = ctx.from.id;
  const username = ctx.from.username ?? null;
  const displayName = ctx.from.first_name ?? null;

  const player = db.getOrCreatePlayer(database, userId, username, displayName, config.startingPoints);

  const currentDay = db.getCurrentDay(database);
  const roundStatus = db.getState(database, 'round_status');
  if (projectDay !== currentDay || roundStatus === 'closed') {
    await ctx.answerCallbackQuery({ text: 'this round is closed. wait for the next drop.' });
    return;
  }

  const existingBet = db.getBet(database, userId, projectDay);
  if (existingBet) {
    await ctx.answerCallbackQuery({ text: 'you already placed your bet on this case.' });
    return;
  }

  if (player.balance < config.minBet) {
    await ctx.answerCallbackQuery({ text: `you're broke. type /bailout for emergency funds.` });
    return;
  }

  // Show amount selection
  const amounts = [50, 100, 250];
  const keyboard = new InlineKeyboard();

  for (const amt of amounts) {
    if (amt <= player.balance) {
      keyboard.text(`${amt} pts`, `amount:${projectDay}:${choice}:${amt}`);
    }
  }
  keyboard.text('ALL IN', `amount:${projectDay}:${choice}:all`);

  await ctx.answerCallbackQuery();
  const emoji = choice === 'BUY' ? '🟢' : '🔴';
  await ctx.reply(
    `${emoji} ${choice}. how much are you putting on it?\nbalance: ${player.balance} pts`,
    { reply_markup: keyboard },
  );
}
