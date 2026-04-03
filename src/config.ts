import 'dotenv/config';

function env(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) {
    console.error(`missing required env var: ${key}`);
    process.exit(1);
  }
  return val;
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  return raw ? parseInt(raw, 10) : fallback;
}

export const config = {
  botToken: env('BOT_TOKEN'),
  groupChatId: Number(env('GROUP_CHAT_ID', '0')),
  startingPoints: envInt('STARTING_POINTS', 1000),
  minBet: envInt('MIN_BET', 50),
  bailoutAmount: envInt('BAILOUT_AMOUNT', 500),
  bailoutCooldownDays: envInt('BAILOUT_COOLDOWN_DAYS', 7),
  adminUserId: envInt('ADMIN_USER_ID', 0),
  resolveDelayMinutes: envInt('RESOLVE_DELAY_MINUTES', 60),
};
