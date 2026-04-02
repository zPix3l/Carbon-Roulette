import { config } from '../config.js';

export interface PayoutResult {
  result: 'win' | 'lose';
  payout: number;
}

/**
 * Calculate payout for a bet.
 * BUY + legit  = +100% of bet (doubled)
 * BUY + scam   = -100% of bet (lost)
 * PASS + scam  = +50% of bet
 * PASS + legit = -25% of bet
 */
export function calculatePayout(
  choice: 'BUY' | 'PASS',
  amount: number,
  isLegit: boolean,
  currentStreak: number,
): PayoutResult {
  let result: 'win' | 'lose';
  let payout: number;

  if (choice === 'BUY') {
    if (isLegit) {
      result = 'win';
      payout = amount; // +100%
    } else {
      result = 'lose';
      payout = -amount;
    }
  } else {
    // PASS
    if (!isLegit) {
      result = 'win';
      payout = Math.floor(amount * 0.5); // +50%
    } else {
      result = 'lose';
      payout = -Math.floor(amount * 0.25); // -25%
    }
  }

  // Apply streak multiplier on wins
  if (result === 'win' && payout > 0) {
    const multiplier = getStreakMultiplier(currentStreak);
    payout = Math.floor(payout * multiplier);
  }

  return { result, payout };
}

export function getStreakMultiplier(streak: number): number {
  if (streak >= 5) return 2.0;
  if (streak >= 3) return 1.5;
  return 1.0;
}

export function canBailout(balance: number, lastBailout: string | null): { allowed: boolean; reason?: string } {
  if (balance >= config.minBet) {
    return { allowed: false, reason: `your balance (${balance} pts) is still above the minimum bet. no bailout needed.` };
  }

  if (lastBailout) {
    const lastDate = new Date(lastBailout + 'T00:00:00Z');
    const now = new Date();
    const daysSince = Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince < config.bailoutCooldownDays) {
      const remaining = config.bailoutCooldownDays - daysSince;
      return { allowed: false, reason: `cooldown active. you can request another bailout in ${remaining} day${remaining > 1 ? 's' : ''}.` };
    }
  }

  return { allowed: true };
}
