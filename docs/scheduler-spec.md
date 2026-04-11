# Scheduler — Spec

> **Status:** spec locked, ready to implement.
> **Branch:** `feature/scheduler` (off `main`).
> **Replaces:** the in-memory `setTimeout` in `src/game/engine.ts`.

## 1. Problem

Two pending issues in the current bot:

1. **Timer lost on restart.** `/drop` schedules the auto-resolve via `setTimeout`. If the process dies (crash, deploy, VM reboot) between drop and resolve, the timer disappears and the round stays `open` forever — admin has to notice and manually run `/resolve`.
2. **Admin-only cadence.** Every round has to be triggered manually with `/drop`. No way to say "drop a new round every Monday and Thursday at 14:00 UTC".

This spec addresses both with a single persisted scheduler.

## 2. Goals

- **Persistence:** every pending drop/resolve lives in SQLite, survives restarts.
- **Recurring schedules:** admin defines `(days_of_week, time_utc, resolve_delay_min)` per group.
- **Unified pipeline:** manual `/drop` goes through the same job table as scheduled drops — no parallel code path.
- **Safe catch-up:** on boot, rattrape les jobs récents, skip les jobs trop vieux.
- **No external dependency:** stays in-process, no Redis / cron daemon / external queue. One extra ticker via `setInterval`.

## 3. Locked design decisions

| # | Decision | Value |
|---|---|---|
| 1 | Timezone | **UTC everywhere.** Admin does the mental math once. No per-group tz. |
| 2 | Scheduled drop fires while a round is still open for the same group | **Auto-resolve the open round first, then drop.** Single group = single active round invariant preserved. |
| 3 | Catch-up window on boot | **4 hours.** Job late by ≤ 4h → run immediately. Late by > 4h → mark `skipped`, log warning. |
| 4 | Multiple schedules per group | **Yes.** A group can have `mon 14:00 60m` AND `fri 18:00 30m` simultaneously. |
| 5 | Game-over (`current_day >= 30`) + scheduled drop fires | **Disable the schedule** (`enabled = 0`) + log warning. Admin must manually re-enable after `/resetgame`. Prevents silent spam of "skipped" warnings on a dead season. |
| 6 | `/schedule add` UX | **Text parsing.** `/schedule add mon,wed,fri 14:00 60`. No inline keyboard builder. |

## 4. Database schema

Two new tables. Added to `src/db/schema.ts` alongside the existing `CREATE TABLE IF NOT EXISTS` block. No migration needed (both are new, `CREATE TABLE IF NOT EXISTS` handles first-run creation).

```sql
-- Concrete jobs: either one-off (manual /drop) or materialized from a schedule
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('drop','resolve')),
  run_at TEXT NOT NULL,                -- ISO 8601 UTC, e.g. '2026-04-13T14:00:00Z'
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','done','failed','skipped')),
  schedule_id INTEGER,                 -- NULL if one-off
  payload TEXT,                        -- JSON, e.g. {"resolve_delay_minutes":60}
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  executed_at TEXT,
  error TEXT,
  FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_pending_run_at
  ON scheduled_jobs(status, run_at);

-- Recurring schedules: days × time × per group
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  days_of_week TEXT NOT NULL,          -- CSV of 'mon|tue|wed|thu|fri|sat|sun'
  time_utc TEXT NOT NULL,              -- 'HH:MM'
  resolve_delay_minutes INTEGER NOT NULL DEFAULT 60,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_schedules_enabled
  ON schedules(enabled, group_id);
```

### Invariants
- A `scheduled_jobs` row is immutable after transitioning from `pending` to any terminal state (`done`, `failed`, `skipped`).
- Deleting a `schedule` sets `schedule_id = NULL` on its future jobs (FK `ON DELETE SET NULL`). Existing materialized jobs still fire — admin can cancel them explicitly via `/jobs rm <id>` (maybe, see §8).
- At most **one `pending` drop per group** at any time. Enforced in application code, not DB (a unique partial index is an option but keeps complexity).

## 5. Scheduler service

New file: `src/game/scheduler.ts`.

### 5.1 Boot sequence

```
startScheduler(bot, database) {
  // 1. Load all pending jobs
  jobs = db.getPendingJobs(database)

  for job in jobs:
    delta = job.run_at - now
    if delta >= 0:
      scheduleInMemory(job, delta)       // setTimeout, keep pointer
    else if delta > -4h:
      runJobNow(job)                     // catch-up
    else:
      markSkipped(job, "stale on boot")  // too old, drop it
      log.warn(...)

  // 2. Start the tick
  setInterval(tick, 60_000)
}
```

### 5.2 Tick (every 60s)

```
tick() {
  // Generate next 24h of jobs from active schedules (idempotent)
  for schedule in db.getActiveSchedules():
    for each (day, time) slot in next 24h:
      if db.jobExists(schedule.id, slot.run_at):
        continue
      db.insertJob(schedule.group_id, 'drop', slot.run_at, schedule.id, payload)
      // Note: resolve job is only inserted AFTER the drop executes,
      // because the resolve delay may change between now and execution
}
```

**Why 24h window:** small enough that a schedule edit propagates quickly, large enough that a ticker downtime of a few minutes doesn't miss anything.

### 5.3 Job execution

A job fires when:
- Its in-memory `setTimeout` resolves, OR
- It's caught up at boot, OR
- The tick picks up a just-materialized job that's already due

Execution goes through a single function:

```
executeJob(job) {
  if job.status != 'pending': return  // race safety

  try:
    if job.kind == 'drop':
      executeDrop(job)
    else if job.kind == 'resolve':
      executeResolve(job)
    markDone(job)
  catch err:
    markFailed(job, err.message)
    log.error(...)
}

executeDrop(job) {
  // Invariant: single round per group at a time
  status = db.getRoundStatus(job.group_id)
  if status == 'open':
    // Auto-resolve first (decision #2)
    doResolve(bot, db, job.group_id)

  // Game-over check (decision #5)
  currentDay = db.getCurrentDay(job.group_id)
  if currentDay >= TOTAL_DAYS:
    if job.schedule_id:
      db.disableSchedule(job.schedule_id)
      log.warn("schedule disabled: game over on group", job.group_id)
    markSkipped(job, "game over")
    return

  // Normal path
  doDrop(bot, db, job.group_id, job.payload)

  // Schedule the companion resolve
  delay = job.payload.resolve_delay_minutes || config.resolveDelayMinutes
  db.insertJob(job.group_id, 'resolve', now + delay, null, null)
}

executeResolve(job) {
  status = db.getRoundStatus(job.group_id)
  if status != 'open':
    markSkipped(job, "round already closed")
    return
  doResolve(bot, db, job.group_id)
}
```

### 5.4 `doDrop` / `doResolve` refactor

Current: `doDrop(bot, database)` reads `config.groupChatId` internally.
New: `doDrop(bot, database, groupId, payload?)` — explicit groupId, optional payload (for resolve_delay override). Same for `doResolve`.

The active-group concept (`bot_config.group_chat_id`) stays for commands that don't target a specific group (`/portfolio`, `/leaderboard` via DM, etc.) — it's not removed, just bypassed by the scheduler which always knows which group a job belongs to.

### 5.5 Manual `/drop`

```
/drop [minutes]
  → inserts a scheduled_jobs row with kind='drop', run_at=now, payload={resolve_delay_minutes: arg || config.default}
  → scheduler picks it up immediately (either via next tick or via setImmediate hint)
```

Same code path as scheduled drops. The only difference is `schedule_id = NULL`.

## 6. New admin commands

All gated by `ADMIN_USER_ID`, scoped to the active group (`bot_config.group_chat_id`).

### `/schedule`
Lists all schedules for the active group.

```
group: BigWater (-1002327057074)

[1] mon,wed,fri @ 14:00 UTC · resolve 60min · enabled ✓
[2] sat       @ 18:00 UTC · resolve 30min · disabled
```

### `/schedule add <days> <HH:MM> [delay]`
- `days` — CSV of `mon|tue|wed|thu|fri|sat|sun`, case-insensitive
- `HH:MM` — 24h UTC
- `delay` — optional, minutes, defaults to `config.resolveDelayMinutes`

Examples:
```
/schedule add mon,wed,fri 14:00 60
/schedule add sat 18:00
/schedule add mon,tue,wed,thu,fri 10:05
```

Validation:
- Days must parse; reject otherwise
- Time must match `HH:MM` with H in `[0,23]`, M in `[0,59]`
- Delay must be positive int if provided

### `/schedule rm <id>`
Delete a schedule by id. Existing already-materialized jobs keep firing (they'll have `schedule_id = NULL` after the FK cascade). Use `/jobs` to see and cancel them.

### `/schedule on <id>` / `/schedule off <id>`
Toggle `enabled`. Disabling does NOT cancel already-materialized future jobs. Use `/jobs rm` if you want them gone.

### `/jobs`
Show the next 10 pending jobs for the active group, most recent first:

```
group: BigWater

[142] drop    2026-04-13 14:00 UTC · schedule #1
[143] resolve 2026-04-13 15:00 UTC
[158] drop    2026-04-15 14:00 UTC · schedule #1
...
```

### `/jobs rm <id>`
Cancel a pending job (marks it `skipped` with reason `"canceled by admin"`). Cannot cancel terminal jobs.

## 7. What happens to existing `/resolve`

Still works as a manual override. Now it:
1. Finds the `pending` resolve job for the active group, if any → marks it `skipped`
2. Runs `doResolve` directly

This way, manual `/resolve` can't race with the scheduler firing the same resolve a second later.

## 8. What happens to `config.resolveDelayMinutes`

Still exists as the default for manual `/drop` without arg, and as the default for `/schedule add` without delay. Schedules store their own delay in the table, so env var changes don't retroactively affect them.

## 9. Edge cases & error handling

| Case | Behavior |
|---|---|
| DB write fails in `executeJob` | Mark `failed`, log, continue. Job won't retry — admin must investigate. |
| Telegram API fails during drop | `sendPhoto` throws → caught → job `failed`. No retry. Admin can `/drop` manually. |
| Two scheduled drops same minute on same group | Tick inserts both rows. First one executes → auto-resolves nothing (no open round) → drops. Second one executes → auto-resolves the first round (!) → drops. **This is undesired.** Mitigation: `executeDrop` checks if there's already a `done` drop with `run_at` within the last X minutes for the same group and skips. Simpler: tick-level dedup based on `(group_id, hour_of_day, day_of_week)` uniqueness. |
| Schedule added while game is at day 15 | New jobs materialize normally. |
| Bot restarted mid-tick | Tick is idempotent — next tick will re-run, same results. |
| `run_at` in the far future (>24h) | Not scheduled in-memory yet. Will be picked up by a later tick when it enters the 24h window. Avoids piling up thousands of `setTimeout`s for distant schedules. |
| Very short resolve delay (e.g. 1 min) | Works. Tick latency is ≤60s so the resolve job may fire on the next tick, not instantly, but that's fine. |

## 10. Implementation plan

On `feature/scheduler`:

1. **Schema + queries**
   - Add the two tables to `src/db/schema.ts`
   - Add query helpers in `src/db/queries.ts`: `insertJob`, `getPendingJobs`, `markJobDone/Failed/Skipped`, `getActiveSchedules`, `insertSchedule`, `deleteSchedule`, `toggleSchedule`, `getSchedulesForGroup`, `getJobsForGroup`
2. **Refactor `doDrop` / `doResolve`**
   - Accept explicit `groupId` + optional `payload`
   - Remove internal `setTimeout`-based scheduling
3. **`src/game/scheduler.ts`**
   - `startScheduler()`, `tick()`, `executeJob()`, `scheduleInMemory()`, `cancelInMemory()`
   - Unit-testable: export `materializeJobsForWindow(schedules, now)` as a pure function
4. **Commands**
   - `/schedule`, `/schedule add|rm|on|off`, `/jobs`, `/jobs rm` in `src/bot/commands.ts`
5. **Boot wiring**
   - `src/index.ts` calls `startScheduler(bot, db)` after command registration
6. **Remove the old `setTimeout`**
   - Delete `scheduleAutoResolve` / `cancelAutoResolve` from `engine.ts`
7. **Smoke test**
   - Manually: create a schedule for `<now + 2 minutes>`, watch it fire, check the resolve fires on time, restart the bot mid-round, confirm the resolve still fires after boot
   - Edge: put the clock forward to test the 4h skip path
8. **Docs**
   - Update `CLAUDE.md` "Known limitations" section — remove the "timer lost on restart" warning — once the feature lands on `main`

## 11. What this does NOT address

- Per-group timezone (explicit non-goal, decision #1)
- Automatic season reset (admin still runs `/resetgame`)
- Retry on failed jobs (explicit non-goal — admin intervenes)
- A UI / web app for managing schedules (Telegram commands only)
- Cross-platform scheduler — that's the job of `feature/cross-platform` and would build on top of this work

## 12. Open question for the implementation

**Tick latency vs responsiveness:**
- Tick interval is 60s. A manual `/drop` inserts a job with `run_at = now`, so it either:
  - Fires via the next tick (worst case: 60s delay)
  - Fires via a synchronous nudge right after insert (0s delay)

I'll implement the **synchronous nudge** — the command inserts the job, calls `executeJob(job)` directly, and returns. The tick is only for schedule-generated jobs and catch-up safety. This keeps manual `/drop` feeling instant.

---

## Addendum v2 — per-group resolve delay + pre-drop announcements (`feature/announcements-resolve-config`)

Landed after the core scheduler was in production. Two simple additions that layer on top of the existing job pipeline without touching the hot path.

### Per-group resolve delay

**Motivation:** the group admin wanted to change "round length" per group without editing env vars or per-schedule arguments.

**Design:**
- New `group_state` keys: `resolve_delay_minutes` (integer).
- `doDrop` resolves the delay with precedence: **payload (`/drop N` one-shot) > group_state > env default**.
- Schedules no longer embed their own `resolve_delay_minutes` in the drop-job payload; the column stays in the table for back-compat but is not read at execution time. Changing `/setresolvedelay` therefore takes effect retroactively for already-materialized drop jobs that haven't fired yet.
- New admin command: `/setresolvedelay <minutes>`. `/schedule add` no longer accepts the delay argument.

### Pre-drop announcements (new `kind='announce'`)

**Motivation:** post a community-engagement teaser X minutes before every scheduled drop.

**Design:**
- New `group_state` key: `announce_minutes_before` (integer, `0` disables). Admin sets it with `/setannounce <minutes>`.
- New job kind `announce`. Schema migration widens the `CHECK` constraint defensively (detected via `sqlite_master.sql`, rebuilds the table only when needed).
- **Tick materialization:** for each drop slot produced by `materializeSlots`, if the group's `announce_minutes_before > 0`, tick inserts a companion `announce` job at `drop_run_at − X min`. Payload: `{ drop_run_at: <ISO> }`. Dedup key: `(schedule_id, json_extract(payload,'$.drop_run_at'))` via `announceExistsForScheduleDrop`.
- **Execution:** `executeAnnounce` decodes `drop_run_at`, renders `formatDropAnnouncement` (dynamic `Today/Tomorrow/Weekday at HH:MM UTC` label computed from UTC calendar diff), and posts a photo + LEARN-only keyboard to the group.
- **Skip conditions:**
  1. `drop_run_at <= now` — drop already fired (manual `/drop` cut the line, or clock drift)
  2. Companion drop job is no longer `pending` (canceled via `/jobs rm`, failed, or skipped game-over)
  3. `current_day >= totalDays` — game over
- Manual `/drop` does **not** trigger an announce. Only scheduled drops do.
- The announce banner reuses `generateBannerPNG(resolveDelay)` where `resolveDelay` is read from the current group config — the banner's "YOU HAVE X HOUR(S)" pill stays consistent with what the upcoming drop will use.

### Backward compatibility for existing prod deploys

- Schema migration is idempotent: detects old `CHECK(kind IN ('drop','resolve'))` via `sqlite_master.sql`, rebuilds the `scheduled_jobs` table preserving all rows, recreates indexes. Skipped on fresh installs (new `CREATE TABLE` already has the widened check).
- `getGroupResolveDelayMinutes` returns `null` when unset so the env default keeps working for groups that never ran `/setresolvedelay`.
- `getGroupAnnounceMinutesBefore` defaults to `0`, so nothing happens until explicitly enabled.
- The existing `schedules.resolve_delay_minutes` column is preserved but ignored at drop-execution time. `/schedule add` still writes it (set to the current group-level value or env default) to keep T3 and legacy readers happy.

