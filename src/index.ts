import { Bot } from 'grammy';
import { config } from './config.js';
import { initDb } from './db/schema.js';
import { getBotConfig } from './db/queries.js';
import { registerCommands } from './bot/commands.js';
import { registerCallbacks } from './bot/callbacks.js';
import { loadProjects } from './game/engine.js';
import { startScheduler } from './game/scheduler.js';

async function main() {
  const projects = loadProjects();
  console.log(`loaded ${projects.length} projects`);

  const database = initDb();
  console.log(`database initialized`);

  // Override group chat ID from DB if previously set via /setgroup
  const savedGroup = getBotConfig(database, 'group_chat_id');
  if (savedGroup) {
    config.groupChatId = Number(savedGroup);
    console.log(`group chat ID loaded from DB: ${config.groupChatId}`);
  }

  const bot = new Bot(config.botToken);

  registerCommands(bot, database);
  registerCallbacks(bot, database);

  bot.catch((err) => {
    console.error('bot error:', err);
  });

  console.log(`admin: ${config.adminUserId || 'not set'}`);
  console.log(`group: ${config.groupChatId || 'not set'}`);

  if (!config.groupChatId) {
    console.error('fatal: GROUP_CHAT_ID is not set. set it in .env and restart.');
    process.exit(1);
  }
  if (!config.adminUserId) {
    console.warn('warning: ADMIN_USER_ID is not set. admin commands will not work.');
  }

  await bot.api.setMyCommands([
    { command: 'portfolio', description: 'your stats' },
    { command: 'leaderboard', description: 'top 10' },
    { command: 'help', description: 'rules' },
  ]);

  // Start the persisted scheduler (replaces in-memory auto-resolve timer)
  startScheduler(bot, database);

  bot.start({
    onStart: () => console.log('carbon roulette is live. use /drop to start the game.'),
  });
}

main().catch((err) => {
  console.error('fatal error:', err);
  process.exit(1);
});
