import type { Project } from '../projects/generator.js';
import type { Player, Bet } from '../db/queries.js';
import { getStreakMultiplier } from './scoring.js';

// URL for the "LEARN" button — explains carbon credits, the game, what to look for
export const LEARN_URL = 'https://telegra.ph/Carbon-Roulette--Rules--How-to-Play-04-02';

// ---- Method emoji lookup ----

function methodEmoji(methodName: string): string {
  const m = methodName.toLowerCase();
  if (m.includes('cookstove')) return '🍳';
  if (m.includes('mangrove') || m.includes('blue carbon') || m.includes('tidal')) return '🌊';
  if (m.includes('biochar')) return '🔥';
  if (m.includes('dac') || m.includes('direct air')) return '🏭';
  if (m.includes('soil')) return '🌾';
  if (m.includes('landfill')) return '♻️';
  if (m.includes('renewable') || m.includes('energy')) return '⚡';
  if (m.includes('peatland')) return '🫧';
  return '🌳';
}

// ---- Group teaser templates ----

function buildTeaser(project: Project): string {
  const method = project.methodName.toLowerCase();
  const vol = project.volume.toLocaleString();
  const price = `$${project.price}`;

  // Vary the teaser wording to avoid repetition
  const templates = [
    `a ${method} project in ${project.country} just hit the market.\n${price} per tonne. ${vol} credits.`,
    `someone's listing ${vol} credits from a ${method} project in ${project.country}.\n${price} a tonne.`,
    `new listing: ${method} in ${project.country}.\n${vol} credits at ${price} per tonne.`,
    `${vol} carbon credits from ${project.country}.\n${method}. ${price} per tonne.`,
    `a ${method} operation in ${project.country} is selling ${vol} credits.\nthey're asking ${price} a tonne.`,
  ];

  return templates[project.day % templates.length];
}

// ---- Drop message for GROUP (short hook, no jargon) ----

export function formatDropGroup(project: Project, betCount: number = 0, dayTotal: number = 30): string {
  const lines = [
    `${methodEmoji(project.methodName)} round ${project.day}/${dayTotal}`,
    ``,
    buildTeaser(project),
    ``,
    `clean deal or red flags?`,
  ];

  if (betCount > 0) {
    lines.push(``, `🔍 ${betCount} investigator${betCount > 1 ? 's' : ''}`);
  }

  return lines.join('\n');
}

// ---- Group drop message: CLOSED state ----

export function formatDropGroupClosed(project: Project, betCount: number, dayTotal: number = 30): string {
  const label = project.isLegit ? '✅ LEGIT' : '⚠️ INTEGRITY ISSUES';
  const lines = [
    `🔒 round ${project.day}/${dayTotal} — CLOSED`,
    ``,
    project.name.toUpperCase(),
    `${project.country} · ${project.methodName}`,
    ``,
    `verdict: ${label}`,
    `🔍 ${betCount} investigator${betCount !== 1 ? 's' : ''}`,
  ];
  return lines.join('\n');
}

// ---- Full project card for DM (the case file) ----

export function formatDrop(project: Project, dayTotal: number = 30): string {
  const emoji = methodEmoji(project.methodName);
  const lines = [
    `📋 CASE FILE #${project.day}`,
    ``,
    `${project.name.toUpperCase()}`,
    ``,
    `"${project.description}"`,
    ``,
    `━━━ verify these ━━━`,
    ``,
    `${emoji} type        ${project.methodName}`,
    `📍 location    ${project.country}`,
    `📜 standard    ${project.standard}`,
    `🔢 methodology ${project.methodologyId}`,
    `🔍 auditor     ${project.auditor}`,
    ``,
    `💰 price    $${project.price} / tonne`,
    `📊 credits  ${project.volume.toLocaleString()} tCO₂e/yr`,
  ];

  if (project.yield !== undefined && project.yieldUnit) {
    lines.push(`📈 yield    ${project.yield} ${project.yieldUnit}`);
  }
  if (project.area) {
    lines.push(`📐 area     ${project.area.toLocaleString()} ha`);
  }

  lines.push(
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `your call. [round ${project.day}/${dayTotal}]`,
  );

  return lines.join('\n');
}

// ---- Verdict message (GROUP) — replies to original drop ----

interface BetResult {
  bet: Bet;
  player: Player;
  payout: number;
}

export function formatVerdict(project: Project, results: BetResult[]): string {
  const name = project.name.toLowerCase();
  const lines: string[] = [];

  if (project.isLegit) {
    lines.push(`✅ round ${project.day} — LEGIT`);
    lines.push('');
    lines.push(`${name} checked out.`);
    lines.push('');
    lines.push(project.verdictExplanation);
  } else {
    lines.push(`⚠️ round ${project.day} — INTEGRITY ISSUES`);
    lines.push('');
    lines.push(`${name} didn't survive the audit.`);
    lines.push('');
    lines.push(project.verdictExplanation);
  }

  lines.push('');

  const winners = results.filter(r => r.payout > 0);
  const losers = results.filter(r => r.payout < 0);

  if (winners.length > 0) {
    const winLabel = project.isLegit ? 'those who trusted it:' : 'those who saw it:';
    lines.push(winLabel);
    for (const w of winners) {
      const displayName = w.player.username ? `@${w.player.username}` : (w.player.display_name ?? `player`);
      const mult = getStreakMultiplier(w.player.current_streak);
      const streakTag = mult > 1 ? ` 🔥×${mult}` : '';
      lines.push(`${displayName} (+${w.payout} pts${streakTag})`);
    }
  }

  if (losers.length > 0) {
    lines.push('');
    const loseLabel = project.isLegit
      ? 'those who didn\'t:'
      : 'those who missed it:';
    lines.push(loseLabel);
    for (const l of losers) {
      const displayName = l.player.username ? `@${l.player.username}` : (l.player.display_name ?? `player`);
      lines.push(`${displayName} (${l.payout} pts)`);
    }
  }

  if (results.length === 0) {
    lines.push('nobody investigated this one. missed opportunity.');
  }

  // Stats
  lines.push('');
  if (results.length > 0) {
    const buyCount = results.filter(r => r.bet.choice === 'BUY').length;
    const passCount = results.filter(r => r.bet.choice === 'PASS').length;
    const pLabel = results.length === 1 ? 'player' : 'players';
    lines.push(`📊 ${results.length} ${pLabel} · ${buyCount} bought · ${passCount} passed`);
  }

  return lines.join('\n');
}

// ---- Portfolio (DM only) ----

export function formatPortfolio(player: Player, rank: number, totalPlayers: number): string {
  const streakText = player.current_streak >= 3
    ? ` 🔥 (next win = ×${getStreakMultiplier(player.current_streak + 1)} bonus)`
    : '';
  const winRate = player.games_played > 0
    ? Math.round((player.wins / player.games_played) * 100)
    : 0;
  const profit = player.balance - 1000;

  return [
    `your portfolio — ${player.username ? `@${player.username}` : (player.display_name ?? 'anon')}`,
    ``,
    `balance: ${player.balance.toLocaleString()} pts`,
    `total profit: ${profit >= 0 ? '+' : ''}${profit.toLocaleString()}`,
    `games played: ${player.games_played}`,
    `win rate: ${winRate}%`,
    `current streak: ${player.current_streak}${streakText}`,
    `best streak: ${player.best_streak}`,
    `rank: #${rank} / ${totalPlayers} players`,
  ].join('\n');
}

// ---- Leaderboard (works in both) ----

export function formatLeaderboard(topPlayers: Player[], callerRank: number, totalPlayers: number): string {
  const lines = [
    `🏆 carbon roulette — top 10`,
    ``,
  ];

  topPlayers.forEach((p, i) => {
    const displayName = p.username ? `@${p.username}` : (p.display_name ?? 'anon');
    const streak = p.current_streak >= 3 ? ` (streak: ${p.current_streak} 🔥)` : '';
    lines.push(`${i + 1}. ${displayName} — ${p.balance.toLocaleString()} pts${streak}`);
  });

  if (topPlayers.length === 0) {
    lines.push('no players yet. be the first.');
  }

  lines.push('');
  lines.push(`your rank: #${callerRank} / ${totalPlayers}`);

  return lines.join('\n');
}

// ---- Help (DM only) ----

export function formatHelp(): string {
  return [
    `🎰 carbon roulette`,
    ``,
    `a carbon credit project drops in the group.`,
    `your job: figure out if it's legit or if something's off.`,
    `tap INVESTIGATE to open the case file here in DM.`,
    ``,
    `→ BUY = you think the project is clean`,
    `→ PASS = you think there are integrity issues`,
    ``,
    `scoring:`,
    `  BUY on legit project    = +100% of your bet`,
    `  BUY on flagged project  = you lose your bet`,
    `  PASS on flagged project = +50% of your bet`,
    `  PASS on legit project   = -25% of your bet`,
    ``,
    `streaks:`,
    `  3 wins → ×1.5 bonus`,
    `  5 wins → ×2 bonus`,
    `  one loss resets`,
    ``,
    `what to check in the case file:`,
    `  → is the standard valid for this method?`,
    `  → does the methodology ID match the project type?`,
    `  → is the price within the normal range?`,
    `  → does the yield make sense for that biome?`,
    `  → does volume = area × yield?`,
    `  → anything suspicious in the description?`,
    ``,
    `commands:`,
    `  /play — open current case file`,
    `  /portfolio — your stats`,
    `  /leaderboard — top 10`,
    `  /bailout — emergency 500 pts (if broke)`,
    `  /help — this message`,
    ``,
    `a game by the BigWater community.`,
  ].join('\n');
}

// ---- Bet confirmation (DM) ----

export function formatBetConfirmation(choice: 'BUY' | 'PASS', amount: number, balance: number): string {
  const remaining = balance - amount;
  return `locked in. ${choice} for ${amount} pts.\nbalance after bet: ${remaining} pts.\nwe'll see if your instincts are right.`;
}

// ---- Bailout (DM) ----

export function formatBailout(newBalance: number): string {
  return `the climate market gave you a second chance. don't waste it.\nnew balance: ${newBalance} pts.`;
}

// ---- Start (DM) ----

export function formatStart(balance: number): string {
  return [
    `welcome to carbon roulette. 🎰`,
    ``,
    `you've got ${balance} pts.`,
    ``,
    `when a carbon project drops in the group, tap INVESTIGATE`,
    `to open the case file here. study the numbers. decide if`,
    `the project is clean or if something doesn't add up.`,
    ``,
    `BUY if you trust it. PASS if you don't.`,
    `get it right, stack points. get it wrong, lose them.`,
    ``,
    `type /help for the full rules.`,
  ].join('\n');
}

// ---- Redirect to DM message (for group) ----

export function formatGoToDM(botUsername: string): string {
  return `this command works in DM. tap here → @${botUsername}`;
}
