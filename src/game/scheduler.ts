import { InlineKeyboard, InputFile, type Bot } from 'grammy';
import type Database from 'better-sqlite3';
import * as db from '../db/queries.js';
import { doDrop, doResolve, getTotalDays, type DropPayload } from './engine.js';
import { formatDropAnnouncement, LEARN_URL } from './messages.js';
import { generateBannerPNG } from './banner.js';

// ---------------------------------------------------------------------------
// Scheduler — persisted jobs + recurring schedules
// Replaces the in-memory setTimeout auto-resolve.
// ---------------------------------------------------------------------------

const TICK_INTERVAL_MS = 60_000;                      // 1 min
const CATCHUP_WINDOW_MS = 4 * 60 * 60 * 1000;         // 4h (decision #3)
const MATERIALIZE_WINDOW_MS = 24 * 60 * 60 * 1000;    // 24h rolling window

// In-memory pointers to setTimeouts for jobs we've pre-scheduled.
// Keyed by job id. Used to avoid double-scheduling on tick and to cancel on
// manual actions.
const inFlight = new Map<number, ReturnType<typeof setTimeout>>();

// Day-of-week helpers
const DOW_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
type DayName = typeof DOW_NAMES[number];

export function isValidDayName(s: string): s is DayName {
  return (DOW_NAMES as readonly string[]).includes(s);
}

export function parseDaysOfWeek(raw: string): DayName[] | null {
  const parts = raw.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const out: DayName[] = [];
  for (const p of parts) {
    if (!isValidDayName(p)) return null;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

export function parseTimeUtc(raw: string): { h: number; m: number } | null {
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, m: min };
}

export function formatDaysOfWeek(csv: string): string {
  return csv.split(',').map(s => s.trim()).join(',');
}

// ---------------------------------------------------------------------------
// Job materialization
// ---------------------------------------------------------------------------

/**
 * For a single schedule, produce the ISO timestamps that fall within
 * [now, now + windowMs) and match the schedule's (days_of_week, time_utc).
 * Pure function — no DB access. Used by tick() and testable.
 */
export function materializeSlots(
  schedule: { days_of_week: string; time_utc: string },
  now: Date,
  windowMs: number,
): string[] {
  const days = parseDaysOfWeek(schedule.days_of_week);
  const time = parseTimeUtc(schedule.time_utc);
  if (!days || !time) return [];

  const out: string[] = [];
  const end = new Date(now.getTime() + windowMs);

  // Walk day-by-day from today (UTC) for up to ceil(windowMs / 1d) + 1 days
  const dayCount = Math.ceil(windowMs / (24 * 60 * 60 * 1000)) + 1;
  for (let i = 0; i < dayCount; i++) {
    const d = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i,
      time.h, time.m, 0, 0,
    ));
    if (d < now) continue;
    if (d >= end) break;
    const dowName = DOW_NAMES[d.getUTCDay()];
    if (days.includes(dowName)) {
      out.push(d.toISOString());
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tick: runs every minute, refreshes the next-24h job window from schedules
// ---------------------------------------------------------------------------

function tick(bot: Bot, database: Database.Database): void {
  try {
    const now = new Date();
    const schedules = db.getActiveSchedules(database);

    for (const s of schedules) {
      const slots = materializeSlots(s, now, MATERIALIZE_WINDOW_MS);
      const announceMinutesBefore = db.getGroupAnnounceMinutesBefore(database, s.group_id);

      for (const runAt of slots) {
        // Drop job — schedules now inherit resolve delay from the group config at
        // execution time (via doDrop → getGroupResolveDelayMinutes). We stop
        // stamping a schedule-level delay into the payload so /setresolvedelay
        // takes effect retroactively for already-materialized slots.
        if (!db.jobExistsForScheduleSlot(database, s.id, runAt)) {
          const jobId = db.insertJob(database, s.group_id, 'drop', runAt, s.id, null);
          console.log(`[scheduler] materialized drop job #${jobId} group=${s.group_id} run_at=${runAt} schedule=${s.id}`);
          schedulePendingJob(bot, database, db.getJobById(database, jobId)!);
        }

        // Companion announce job (only if group opted in via /setannounce N)
        if (announceMinutesBefore > 0 && !db.announceExistsForScheduleDrop(database, s.id, runAt)) {
          const announceRunAt = new Date(
            Date.parse(runAt) - announceMinutesBefore * 60_000,
          ).toISOString();
          // Only materialize if the announce run time hasn't already passed by
          // more than the catch-up window — otherwise it's pointless noise.
          if (Date.parse(announceRunAt) > now.getTime() - CATCHUP_WINDOW_MS) {
            const aId = db.insertJob(database, s.group_id, 'announce', announceRunAt, s.id, {
              drop_run_at: runAt,
            });
            console.log(`[scheduler] materialized announce job #${aId} group=${s.group_id} run_at=${announceRunAt} drop=${runAt} schedule=${s.id}`);
            schedulePendingJob(bot, database, db.getJobById(database, aId)!);
          }
        }
      }
    }

    // Also catch any jobs that were pending but not in-flight (edge case:
    // a job inserted outside the scheduler, or one we failed to schedule).
    const pending = db.getPendingJobs(database);
    for (const job of pending) {
      if (inFlight.has(job.id)) continue;
      schedulePendingJob(bot, database, job);
    }
  } catch (err) {
    console.error('[scheduler] tick error:', err);
  }
}

// ---------------------------------------------------------------------------
// Per-job scheduling (in-memory setTimeout pointer)
// ---------------------------------------------------------------------------

function schedulePendingJob(bot: Bot, database: Database.Database, job: db.ScheduledJob): void {
  if (inFlight.has(job.id)) return;
  const now = Date.now();
  const runAt = Date.parse(job.run_at);
  const delta = runAt - now;

  if (delta <= 0) {
    // Due now or in the past
    if (-delta > CATCHUP_WINDOW_MS) {
      db.markJobSkipped(database, job.id, 'stale on boot (> 4h late)');
      console.warn(`[scheduler] job #${job.id} skipped: stale (${Math.floor(-delta / 60000)}min late)`);
      return;
    }
    // Catch up immediately. Reserve in inFlight BEFORE starting runJob so a
    // concurrent tick() can't re-pick this job while runJob is still in flight.
    // The sentinel timeout fires harmlessly; the entry is cleared in finally().
    inFlight.set(job.id, setTimeout(() => {}, 0));
    void runJob(bot, database, job).finally(() => inFlight.delete(job.id));
    return;
  }

  // Future: schedule a setTimeout, keep the pointer in inFlight until runJob
  // actually completes (not just until the timeout fires) so a concurrent tick()
  // can't double-schedule it during execution.
  const timeout = setTimeout(() => {
    void runJob(bot, database, job).finally(() => inFlight.delete(job.id));
  }, delta);
  inFlight.set(job.id, timeout);
}

export function cancelInFlight(jobId: number): void {
  const t = inFlight.get(jobId);
  if (t) {
    clearTimeout(t);
    inFlight.delete(jobId);
  }
}

/**
 * Cancel any pending resolve job for the given group. Used by admin reset/setday
 * commands that change the game state out of band and need to abort a pending
 * auto-resolve.
 */
export function cancelPendingResolveForGroup(database: Database.Database, groupId: number): void {
  const pending = db.getPendingResolveJobForGroup(database, groupId);
  if (!pending) return;
  cancelInFlight(pending.id);
  db.markJobSkipped(database, pending.id, 'superseded by admin reset/setday');
}

// ---------------------------------------------------------------------------
// Job execution
// ---------------------------------------------------------------------------

async function runJob(bot: Bot, database: Database.Database, job: db.ScheduledJob): Promise<void> {
  // Re-fetch to make sure status hasn't changed since we queued it
  const fresh = db.getJobById(database, job.id);
  if (!fresh || fresh.status !== 'pending') return;

  try {
    if (fresh.kind === 'drop') {
      await executeDrop(bot, database, fresh);
    } else if (fresh.kind === 'resolve') {
      await executeResolve(bot, database, fresh);
    } else if (fresh.kind === 'announce') {
      await executeAnnounce(bot, database, fresh);
    } else {
      // Future-proof: unknown kind
      db.markJobSkipped(database, fresh.id, `unknown kind: ${fresh.kind as string}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.markJobFailed(database, fresh.id, msg);
    console.error(`[scheduler] job #${fresh.id} failed:`, err);
  }
}

async function executeDrop(bot: Bot, database: Database.Database, job: db.ScheduledJob): Promise<void> {
  const groupId = job.group_id;

  // Invariant: at most one open round per group. If a round is still open
  // (timer was lost, previous resolve failed, …), resolve it first.
  const roundStatus = db.getGroupState(database, groupId, 'round_status');
  if (roundStatus === 'open') {
    console.log(`[scheduler] job #${job.id}: open round detected before drop, auto-resolving first`);
    try {
      await doResolve(bot, database, groupId);
    } catch (err) {
      console.error(`[scheduler] auto-resolve before drop failed:`, err);
      // continue — don't block the drop
    }
    // Mark the pending resolve job as skipped if any
    const pendingResolve = db.getPendingResolveJobForGroup(database, groupId);
    if (pendingResolve && pendingResolve.id !== job.id) {
      cancelInFlight(pendingResolve.id);
      db.markJobSkipped(database, pendingResolve.id, 'superseded by auto-resolve before next drop');
    }
  }

  // Game-over check (decision #5): disable the schedule if this is a recurring
  // job and we've run out of days.
  const currentDay = db.getCurrentDay(database, groupId);
  const totalDays = getTotalDays();
  if (currentDay >= totalDays) {
    if (job.schedule_id) {
      db.setScheduleEnabled(database, job.schedule_id, false);
      console.warn(`[scheduler] schedule #${job.schedule_id} disabled: game over on group ${groupId}`);
    }
    db.markJobSkipped(database, job.id, 'game over');
    return;
  }

  // Decode payload
  let payload: DropPayload | undefined;
  if (job.payload) {
    try {
      payload = JSON.parse(job.payload) as DropPayload;
    } catch {
      payload = undefined;
    }
  }

  const result = await doDrop(bot, database, groupId, payload);
  if (!result.ok) {
    db.markJobFailed(database, job.id, result.message);
    return;
  }

  db.markJobDone(database, job.id);

  // Insert the companion resolve job
  const resolveAt = new Date(Date.now() + result.resolveDelayMinutes * 60_000).toISOString();
  const resolveJobId = db.insertJob(database, groupId, 'resolve', resolveAt, null, null);
  const resolveJob = db.getJobById(database, resolveJobId);
  if (resolveJob) {
    schedulePendingJob(bot, database, resolveJob);
  }
  console.log(`[scheduler] drop #${job.id} done, resolve #${resolveJobId} scheduled at ${resolveAt}`);
}

async function executeAnnounce(bot: Bot, database: Database.Database, job: db.ScheduledJob): Promise<void> {
  const groupId = job.group_id;

  // Decode payload: expects { drop_run_at: ISO string }
  let dropRunAt: Date | null = null;
  if (job.payload) {
    try {
      const parsed = JSON.parse(job.payload) as { drop_run_at?: string };
      if (parsed.drop_run_at) dropRunAt = new Date(parsed.drop_run_at);
    } catch {
      // fall through
    }
  }
  if (!dropRunAt || isNaN(dropRunAt.getTime())) {
    db.markJobSkipped(database, job.id, 'announce payload missing drop_run_at');
    return;
  }

  // If the referenced drop has already happened, skip — announcing a past drop
  // is nonsense. Manual /drop firing ahead of the schedule can also trigger this.
  if (dropRunAt.getTime() <= Date.now()) {
    db.markJobSkipped(database, job.id, 'drop already due, announce stale');
    return;
  }

  // If the companion drop job isn't pending (skipped / canceled / failed), skip
  // the announce too — no point teasing a drop that won't happen.
  if (job.schedule_id !== null) {
    const companionDrop = database.prepare(
      `SELECT status FROM scheduled_jobs
         WHERE schedule_id = ? AND kind = 'drop' AND run_at = ?
         LIMIT 1`,
    ).get(job.schedule_id, dropRunAt.toISOString()) as { status: string } | undefined;
    if (companionDrop && companionDrop.status !== 'pending') {
      db.markJobSkipped(database, job.id, `companion drop ${companionDrop.status}`);
      return;
    }
  }

  // Game-over guard: don't announce past the last round.
  const currentDay = db.getCurrentDay(database, groupId);
  const totalDays = getTotalDays();
  if (currentDay >= totalDays) {
    db.markJobSkipped(database, job.id, 'game over');
    return;
  }

  const caption = formatDropAnnouncement(dropRunAt, new Date(), totalDays);
  const keyboard = new InlineKeyboard().url('📚 LEARN', LEARN_URL);

  let announceMessageId: number | null = null;
  try {
    // Reuse the drop banner visual — reads the resolve delay from group config so
    // the banner's "YOU HAVE X HOUR(S)" matches what the upcoming drop will use.
    const resolveDelay =
      db.getGroupResolveDelayMinutes(database, groupId) ?? 60;
    const bannerBuf = await generateBannerPNG(resolveDelay);
    const sent = await bot.api.sendPhoto(groupId, new InputFile(bannerBuf, 'banner.png'), {
      caption,
      reply_markup: keyboard,
    });
    announceMessageId = sent.message_id;
  } catch (err) {
    db.markJobFailed(database, job.id, err instanceof Error ? err.message : String(err));
    console.error(`[scheduler] announce #${job.id} failed:`, err);
    return;
  }

  // Pin with notification — this is the whole point of announcements: reach every
  // member, including those who muted the group. The pin will be removed when the
  // companion drop fires (see doDrop). Failures here are non-fatal: the message
  // is already posted, we just lose the broadcast notification.
  if (announceMessageId !== null) {
    try {
      await bot.api.pinChatMessage(groupId, announceMessageId);
      db.setGroupState(database, groupId, 'pinned_announce_message_id', String(announceMessageId));
    } catch (err) {
      console.error(`[announce #${job.id}] failed to pin (bot needs can_pin_messages):`, err);
    }
  }

  db.markJobDone(database, job.id);
  console.log(`[scheduler] announce #${job.id} posted (drop at ${dropRunAt.toISOString()})`);
}

async function executeResolve(bot: Bot, database: Database.Database, job: db.ScheduledJob): Promise<void> {
  const groupId = job.group_id;
  const roundStatus = db.getGroupState(database, groupId, 'round_status');
  if (roundStatus !== 'open') {
    db.markJobSkipped(database, job.id, 'round already closed');
    return;
  }
  const result = await doResolve(bot, database, groupId);
  if (!result.ok) {
    db.markJobFailed(database, job.id, result.message);
    return;
  }
  db.markJobDone(database, job.id);
  console.log(`[scheduler] resolve #${job.id} done: ${result.message}`);
}

// ---------------------------------------------------------------------------
// Public API — boot + manual triggers
// ---------------------------------------------------------------------------

let tickHandle: ReturnType<typeof setInterval> | null = null;

export function startScheduler(bot: Bot, database: Database.Database): void {
  if (tickHandle) return;
  console.log('[scheduler] starting');

  // Boot: schedule all pending jobs (catch-up or future)
  const pending = db.getPendingJobs(database);
  console.log(`[scheduler] loaded ${pending.length} pending jobs`);
  for (const job of pending) {
    schedulePendingJob(bot, database, job);
  }

  // Run an immediate tick to materialize the next 24h, then on interval
  tick(bot, database);
  tickHandle = setInterval(() => tick(bot, database), TICK_INTERVAL_MS);
}

export function stopScheduler(): void {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
  for (const [, t] of inFlight) clearTimeout(t);
  inFlight.clear();
}

/**
 * Trigger a manual drop immediately. Inserts a job and executes it synchronously
 * (the "nudge") so admin /drop feels instant instead of waiting for the next tick.
 */
export async function triggerManualDrop(
  bot: Bot,
  database: Database.Database,
  groupId: number,
  resolveDelayMinutes?: number,
): Promise<{ ok: boolean; message: string }> {
  const runAt = new Date().toISOString();
  const payload = resolveDelayMinutes ? { resolve_delay_minutes: resolveDelayMinutes } : null;
  const jobId = db.insertJob(database, groupId, 'drop', runAt, null, payload);
  const job = db.getJobById(database, jobId);
  if (!job) return { ok: false, message: 'failed to insert drop job' };

  // Execute synchronously — no setTimeout round-trip
  try {
    await runJob(bot, database, job);
    const final = db.getJobById(database, jobId);
    if (final?.status === 'done') {
      return { ok: true, message: `drop #${jobId} executed.` };
    }
    if (final?.status === 'failed') {
      return { ok: false, message: `drop #${jobId} failed: ${final.error}` };
    }
    if (final?.status === 'skipped') {
      return { ok: false, message: `drop #${jobId} skipped: ${final.error}` };
    }
    return { ok: true, message: `drop #${jobId} queued.` };
  } catch (err) {
    return { ok: false, message: `drop error: ${err}` };
  }
}

/**
 * Trigger a manual resolve immediately. If there's a pending resolve job for the
 * group, cancel it first to avoid double-firing.
 */
export async function triggerManualResolve(
  bot: Bot,
  database: Database.Database,
  groupId: number,
): Promise<{ ok: boolean; message: string }> {
  // Cancel any pending resolve job for this group
  const pending = db.getPendingResolveJobForGroup(database, groupId);
  if (pending) {
    cancelInFlight(pending.id);
    db.markJobSkipped(database, pending.id, 'superseded by manual /resolve');
  }
  const result = await doResolve(bot, database, groupId);
  return { ok: result.ok, message: result.message };
}
