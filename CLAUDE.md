# Carbon Roulette — Project Context

A Telegram bot game where players bet points on whether daily fictional carbon credit projects are legit or scams. 30-day seasons, per-group leaderboards, points-based scoring with streak multipliers.

## Stack

- **Runtime:** Node.js + TypeScript (ES2022, NodeNext modules)
- **Bot framework:** [grammy](https://grammy.dev/)
- **Database:** SQLite via `better-sqlite3` (WAL mode), file at `data/carbon-roulette.db`
- **Scheduling:** persisted job queue in SQLite (`scheduled_jobs` + `schedules`), boot-time recovery + 60s tick — see `src/game/scheduler.ts` and `docs/scheduler-spec.md`
- **Image generation:** `sharp` for the drop banner PNG (`src/game/banner.ts`)

## Layout

```
src/
├── index.ts          # Boot: load projects, init DB, register handlers, start polling
├── config.ts         # Env vars + BUILD_SHA/BUILD_DATE
├── bot/
│   ├── commands.ts   # All slash commands (player + admin)
│   └── callbacks.ts  # Inline button handlers (BUY/PASS, amount, switchgroup)
├── game/
│   ├── engine.ts     # doDrop, doResolve, updateDropBetCount
│   ├── scheduler.ts  # Persisted job queue: boot recovery, tick, materialize, runJob
│   ├── messages.ts   # All message templates (lowercase/direct tone)
│   ├── scoring.ts    # Payout math, streak multipliers
│   ├── banner.ts     # Dynamic SVG → PNG drop banner
│   └── fonts/        # Embedded fonts for banner SVG
├── projects/
│   ├── datasets.ts   # Methods × standards × biomes reference data
│   ├── generator.ts  # One-shot script: builds projects.json
│   └── projects.json # 30 pre-generated projects (18 legit, 12 scam)
└── db/
    ├── schema.ts     # Table creation + multi-tenant migration
    └── queries.ts    # All prepared statements

scripts/              # Telegraph upload scripts, mockups
data/                 # Reference markdown + SQLite DB at runtime
```

## Database — multi-tenant

Each Telegram group has fully isolated state. The active group is tracked globally in `bot_config.group_chat_id` and can be switched via `/setgroup`, `/groups`, or auto-switch on `/drop` from a group chat.

| Table | Scope | Purpose |
|---|---|---|
| `players` | global | Identity (telegram_id, username, display_name) |
| `group_players` | per `(telegram_id, group_id)` | Balance, streak, wins, games_played, last_bailout |
| `bets` | per `(telegram_id, project_day, group_id)` | UNIQUE constraint prevents double bet |
| `group_state` | per `(group_id, key)` | Per-group k/v: `current_day`, `round_status`, `drop_message_id`, `group_title`, … |
| `bot_config` | global k/v | Currently only `group_chat_id` (active group) |
| `schedules` | per `group_id` | Recurring drop schedules: `days_of_week` (CSV) × `time_utc` × `resolve_delay_minutes`, `enabled` flag |
| `scheduled_jobs` | per `group_id` | Concrete job instances (`kind='drop'|'resolve'`, `run_at` ISO, `status='pending|done|failed|skipped'`). One-off (manual `/drop`) or materialized from a schedule (`schedule_id` set). |

`src/db/schema.ts` includes a one-shot migration from the legacy single-tenant schema (detects old `game_state` table, moves all data under the saved or env-provided group_id, recreates `players`/`bets` with the new columns, drops `game_state`). Safe to re-run; idempotent.

All query functions in `src/db/queries.ts` take `groupId` as a parameter — never assume a default.

## Commands

### Player (DM, public)
| Cmd | Notes |
|---|---|
| `/start` | Welcome + register player in active group |
| `/play` | Re-open current case file |
| `/portfolio` | Stats for active group |
| `/leaderboard` | Top 10 of active group |
| `/bailout` | +500 pts if broke, 7-day cooldown |
| `/help` | Rules |

### Admin only (gated by `ADMIN_USER_ID`)
| Cmd | Notes |
|---|---|
| `/drop [minutes]` | Post the next round. Optional arg overrides `RESOLVE_DELAY_MINUTES` for this round only. If sent inside a group chat that isn't the active one, **auto-switches** to that group first. Routed through `triggerManualDrop` (synchronous nudge — inserts a job AND runs it immediately). |
| `/resolve` | Force-resolve the current open round. Cancels any pending resolve job for the group first. |
| `/schedule list\|add\|rm\|on\|off` | Manage recurring drop schedules. `add <days> HH:MM [delay_min]` where `<days>` is CSV like `mon,wed,fri`. Times are UTC. |
| `/jobs` / `/jobs rm <id>` | List pending jobs / cancel one (marks it `skipped` and clears the in-memory timer). |
| `/announcement` | Post the one-time teaser to the active group |
| `/status` | Active group, day, round status, player count, group ID |
| `/version` | Build SHA + date |
| `/groups` | List all known groups with inline buttons to switch active |
| `/setgroup <id>` | Set active group manually |
| `/nextday` / `/setday <n>` | Advance / jump round counter |
| `/resetgame` | Wipe rounds + bets for active group |
| `/resetleaderboard` | Reset balances/streaks for active group |
| `/resetplayer <id>` | Reset one player in active group |

The middleware in `commands.ts` opportunistically saves `group_title` into `group_state` whenever a group message is seen, so `/groups` can show readable names.

## Round lifecycle

1. A drop is triggered by either admin `/drop` (manual nudge) or a recurring schedule that the tick just materialized. Both paths go through `runJob → executeDrop` in `src/game/scheduler.ts`.
2. `executeDrop` enforces the **single-open-round invariant**: if `round_status === 'open'` when the drop fires, it auto-resolves the previous round first and marks its pending resolve job `skipped: superseded by auto-resolve before next drop`.
3. `doDrop` (`src/game/engine.ts`):
   - Increments `current_day` for the active group
   - Picks the project from `projects.json`
   - Generates the banner PNG, sends photo + caption + INVESTIGATE/LEARN inline keyboard to the group
   - Stores `drop_message_id`, sets `round_status = 'open'`
4. `executeDrop` then inserts the companion **resolve job** at `now + resolveDelayMinutes` into `scheduled_jobs`. No in-memory timer — the job is now fully persisted.
5. Players DM the bot, see the case file, choose BUY/PASS, then bet amount (50/100/250/ALL IN). `updateDropBetCount` edits the original drop caption to show the live investigator count.
6. When the resolve job fires (either via its in-memory `setTimeout` pointer or via boot-time recovery after a crash), `executeResolve → doResolve`:
   - Sets `round_status = 'closed'`
   - Computes payouts, updates balances + streaks atomically
   - Edits the drop caption to "CLOSED"
   - Posts the verdict as a reply to the original drop

### Scheduler internals (`src/game/scheduler.ts`)

- **Boot recovery:** `startScheduler()` loads all `pending` jobs and schedules them via `schedulePendingJob`. Jobs whose `run_at` is within the 4h catch-up window are executed immediately; jobs older than 4h are marked `skipped: stale on boot`.
- **Tick:** every 60s (and once on boot) `tick()` materializes concrete drop jobs from active schedules for the next 24h, deduplicated via `jobExistsForScheduleSlot`. Also re-picks any pending jobs not already in flight (defense in depth).
- **inFlight map:** the scheduler reserves every job id in an in-memory `Map` **before** calling `runJob`, in both the catch-up and future-setTimeout branches, and clears it via `.finally()` only after execution completes. Without this, the boot-loop + immediate-tick combo would double-execute any catch-up job (bug was found during scheduler end-to-end testing on 2026-04-11 — see commit 8373450).
- **Game-over guard:** if `current_day >= totalDays` when a drop fires, the scheduler disables the source schedule (`setScheduleEnabled(false)`) and marks the job `skipped: game over`.
- **Manual nudge:** `/drop` calls `triggerManualDrop` which inserts the job AND calls `runJob` synchronously, so the admin doesn't wait up to 60s for the next tick.

## Scoring

| Choice | Truth | Payout |
|---|---|---|
| BUY | LEGIT | +100% of bet |
| BUY | SCAM | −100% (lose stake) |
| PASS | SCAM | +50% |
| PASS | LEGIT | −25% |

Streak multipliers: 3 wins → ×1.5, 5 wins → ×2. One loss resets.

## Environment

`.env` (see `.env.example`):
```
BOT_TOKEN=...
GROUP_CHAT_ID=...           # initial active group
ADMIN_USER_ID=...
STARTING_POINTS=1000
MIN_BET=50
BAILOUT_AMOUNT=500
BAILOUT_COOLDOWN_DAYS=7
RESOLVE_DELAY_MINUTES=60
TELEGRAPH_TOKEN=...         # only for scripts/update-telegraph-page.cjs
```

## Build & deploy

### Local
```bash
npm install
npm run build       # tsc + copies fonts to dist/game/fonts
npm start           # node dist/index.js
npm run dev         # tsx watch src/index.ts
npm run generate    # regenerate src/projects/projects.json
```

### Production VM
- **Host:** Google Cloud `e2-micro` instance `bigwater` (us-central1, Ubuntu 24.04)
- **Path:** `/home/pix3l_nomad/Carbon-Roulette`
- **Service:** `carbon-roulette.service` (systemd, `Restart=always`, enabled at boot)
- **Auto-deploy:** `carbon-deploy.timer` runs `scripts/deploy.sh` every 2 min, watching `production` branch
  - `git fetch` → if HEAD differs → `git pull` → `npm install` → `./node_modules/.bin/tsc && cp -r src/game/fonts dist/game/fonts` → `sudo systemctl restart carbon-roulette`
- **Sudoers:** passwordless restart for the deploy user limited to `systemctl restart carbon-roulette`
- **Logs:** `journalctl -u carbon-roulette -f`

### Git workflow
- `main` — dev branch, what you push first
- `production` — what the VM auto-deploys. Merge `main` → `production` to ship.
- Feature branches carry their own scoped docs in `docs/` (e.g. `docs/cross-platform-spec.md` lives only on `feature/cross-platform`).

## Tone conventions

All player-facing copy is **lowercase, direct, slightly sarcastic** — see `src/game/messages.ts` for the canonical voice. New messages should match: no exclamation marks, no emoji-spam, no marketing tone. The announcement (`formatAnnouncement`) is the one exception — it uses sentence case for the public-launch teaser.

## Things that look weird but are intentional

- `players` table holds **only identity** (no balance) — balances live in `group_players` so the same Telegram user can have independent state in BigWater vs a test group.
- `bets.group_id` defaults to `0` in the schema but is always set explicitly by `placeBet()`. The default exists only so the migration doesn't fail on old rows before they're rewritten.
- `BUILD_SHA` is read at runtime via `git rev-parse HEAD`, not baked into the binary. This is so the VM reports the SHA it actually has checked out, not the SHA of whatever built the dist.
- The drop caption is updated via `editMessageCaption` (not `editMessageText`) because the drop is sent as a photo.
