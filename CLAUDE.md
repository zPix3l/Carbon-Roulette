# Carbon Roulette — Project Context

A Telegram bot game where players bet points on whether daily fictional carbon credit projects are legit or scams. 30-day seasons, per-group leaderboards, points-based scoring with streak multipliers.

## Stack

- **Runtime:** Node.js + TypeScript (ES2022, NodeNext modules)
- **Bot framework:** [grammy](https://grammy.dev/)
- **Database:** SQLite via `better-sqlite3` (WAL mode), file at `data/carbon-roulette.db`
- **Scheduling:** in-memory `setTimeout` for round resolve (no cron) — see "Known limitations"
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
| `/drop [minutes]` | Post the next round. Optional arg overrides `RESOLVE_DELAY_MINUTES`. If sent inside a group chat that isn't the active one, **auto-switches** to that group first. |
| `/resolve` | Force-resolve current round (manual; use if the auto-resolve timer was lost across restart) |
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

1. Admin runs `/drop` (or `/drop 30` to override resolve delay).
2. `doDrop` (`src/game/engine.ts`):
   - Increments `current_day` for the active group
   - Picks the project from `projects.json`
   - Generates the banner PNG
   - Sends photo + caption + INVESTIGATE/LEARN inline keyboard to the group
   - Stores `drop_message_id`, sets `round_status = 'open'`
   - Schedules `doResolve` via `setTimeout(resolveDelayMinutes * 60_000)`
3. Players DM the bot, see the case file, choose BUY/PASS, then bet amount (50/100/250/ALL IN).
4. `updateDropBetCount` edits the original drop message caption to show live investigator count.
5. `doResolve`:
   - Sets `round_status = 'closed'`
   - Computes payouts (`src/game/scoring.ts`), updates balances + streaks atomically
   - Edits the drop caption to "CLOSED" state
   - Posts the verdict message as a reply to the original drop

### Known limitations
- The auto-resolve timer is **in-memory**. If the bot restarts after a `/drop` but before resolve, you must manually `/resolve`.

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
