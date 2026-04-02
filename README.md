# Carbon Roulette

Daily carbon credit due diligence game — Telegram bot.

Every day at 10:05 UTC, a fictional carbon project drops. Players bet points on whether it's legit or a scam. 24h later, the verdict reveals red flags (or confirms the project checks out). 30 projects, 30 days.

## Setup

```bash
npm install
cp .env.example .env
# Fill in BOT_TOKEN and GROUP_CHAT_ID
```

## Run

```bash
# Development (hot reload)
npm run dev

# Production
npm run build
npm start
```

## Re-generate projects

```bash
npm run generate
```

This produces `src/projects/projects.json` with 30 projects (18 legit, 12 scam) sourced from the datasets in `data/`.

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Register and see welcome message |
| `/play` | Bet on today's project |
| `/portfolio` | Your stats, balance, streak |
| `/leaderboard` | Top 10 players |
| `/bailout` | Emergency 500 pts (if broke) |
| `/help` | Game rules |

## Architecture

- **grammy** — Telegram bot framework
- **better-sqlite3** — Local SQLite database
- **node-cron** — Daily cycle scheduler
- 30 pre-generated projects validated against 4 carbon market datasets
- No AI/LLM at runtime
