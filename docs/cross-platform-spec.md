# Cross-Platform — Spec & Brainstorm

> **Status:** brainstorm / pre-implementation. Lives only on `feature/cross-platform`.
> Last updated by the conversation that produced commit history of this branch.

## 1. Goal

Port Carbon Roulette beyond Telegram (Discord, X, LinkedIn, web) without rewriting the game mechanics for each platform. Single shared backend, unified leaderboard across surfaces, optional token rewards at season-end.

Client ask in plain words:
- Same game on Discord, X, LinkedIn, etc.
- One leaderboard across platforms
- Token reward at the end (airdrop), nice-to-have

User constraints (do not violate):
1. **Not a maintenance hellhole.** No "usine à gaz". Each new surface should be a thin client, not a fork.
2. **Anti-cheat / multi-account is critical.** Sybil resistance must be designed in from day 1, not bolted on.
3. **Centralised system** accessible from Telegram / Discord / web app / etc., without re-implementing the game loop per surface.

## 2. Approach: Web App centrale + bot Discord natif

Selected over the alternatives (one-bot-per-platform fork; separate apps with sync).

```
                  ┌─────────────────────┐
                  │   Game API (REST)   │
                  │   Postgres + Redis  │
                  │   – rounds          │
                  │   – bets            │
                  │   – scoring         │
                  │   – leaderboard     │
                  │   – auth/identity   │
                  └──────────┬──────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
   ┌────▼────┐          ┌────▼────┐          ┌────▼────┐
   │ Telegram│          │ Discord │          │ Web App │
   │   bot   │          │   bot   │          │ (PWA)   │
   │  (thin) │          │ (native)│          │         │
   └─────────┘          └─────────┘          └─────────┘
                                                  ▲
                                                  │ deep link
                                              ┌───┴───┐
                                              │   X   │
                                              │LinkedIn│
                                              │ (post)│
                                              └───────┘
```

### Why this shape

| Surface | Why this client type |
|---|---|
| Telegram | Existing bot — keep it. Becomes a thin client over the API. |
| Discord | Native bot. Discord users live in Discord; sending them to a web app to play would tank conversion. Slash commands + ephemeral messages map cleanly to the BUY/PASS flow. |
| Web App (PWA) | Universal fallback. Anyone with a link can play. The destination for "X / LinkedIn" teasers (since neither platform allows interactive content). |
| X / LinkedIn | **Posts only**, not playable surfaces. Today's drop posted as an image card → "play here" deep link → web app. They're acquisition channels, not game runtimes. |

### Why not "one bot per platform, each with its own DB"

- Leaderboards diverge → no cross-platform competition → defeats the point
- 4× the migration pain every schema change
- Anti-cheat impossible (no shared identity)

## 3. Identity, accounts, anti-sybil

This is the load-bearing decision. Get it wrong and the airdrop is gameable from day one.

### Account model

One **Player** record in the DB. Many **PlatformIdentity** rows linked to it (telegram_user_id, discord_user_id, web_session, …). A player joins via any surface and can later link additional surfaces.

```
Player (id, display_name, created_at, anti_sybil_score, …)
  ├── PlatformIdentity (player_id, platform, platform_user_id, linked_at)
  ├── Wallet           (player_id, address, chain, linked_at, verified)  -- optional
  └── per-group stats per platform  (room_id, balance, streak, …)
```

### Anti-sybil layers (defense in depth)

1. **Platform-native identity** — telegram_id and discord_id are stable and cost something to farm. Don't accept anonymous web sessions for leaderboard scoring without a linked platform identity.
2. **Account age + activity heuristics** — flag accounts created < N days ago, accounts with no avatar/no friends/no server history. Don't ban, but exclude from reward eligibility.
3. **Rate limit per IP / per device fingerprint** on the web app.
4. **Wallet linking is optional but rewarded.** A linked wallet increases anti-sybil score because it's another costly identity to fake. **Required only at claim time**, not to play.
5. **One reward per Player, not per identity.** Linking a second account to claim twice does nothing.
6. **Manual review queue** for top N before payout. The leaderboard winners are few; eyeballing top 20 is cheap insurance.

### Wallet flow (offchain rewards, optional connect)

- Player plays the whole season without ever touching a wallet
- At season end, reward eligibility computed offchain (we keep the ledger)
- "Claim" UI in the web app: connect wallet → sign a message proving ownership → wallet recorded against Player
- We do the airdrop manually (CSV → batch transfer) — **no smart contract on our side**
- A player who never connects a wallet keeps their points and bragging rights but forfeits the token reward. That's the deal.

## 4. What stays the same, what moves

### Stays
- Project generation (`projects.json`) — pure data, surface-agnostic
- Scoring math (`src/game/scoring.ts`) — pure functions
- Tone / messaging templates per surface (each client has its own copy)

### Moves to API
- DB schema (Postgres in cloud, not SQLite per host)
- Round lifecycle (drop, accept bets, resolve) — driven by a scheduler service, not in-memory `setTimeout`
- Bet placement, leaderboard, portfolio queries
- Identity, linking, wallet, claim

### Per client
- Slash commands & inline buttons (Telegram)
- Slash commands & ephemeral messages (Discord)
- React UI (web)
- Render image card (for X / LinkedIn posts)

## 5. Phasing

### Phase 0 — Prereq (on `main`, not this branch)
- Ship and stabilise the multi-tenant Telegram bot ✅ done
- Document current architecture ✅ done in `CLAUDE.md`

### Phase 1 — Extract the game core into an API
- Move game logic out of `src/game/` into a standalone service
- Postgres replaces SQLite (write a one-time importer for current data)
- Telegram bot becomes the first thin client of the API
- **Acceptance:** existing Telegram experience unchanged from a player's POV
- **Risk:** scheduler must not lose rounds across restarts (fix the in-memory `setTimeout` issue at the same time — use a persisted job table)

### Phase 2 — Web App (PWA)
- Same game, browser surface
- Magic-link or OAuth login (Telegram login widget, Discord OAuth, email)
- Public landing page → leaderboard → "play today's round"
- This is the destination for all X / LinkedIn posts
- **Acceptance:** a player who never used Telegram can play a full season

### Phase 3 — Discord native bot
- Slash commands: `/play`, `/portfolio`, `/leaderboard`, `/help`
- Drop posted in a Discord channel (server admin opts in, equivalent of Telegram group)
- Same anti-cheat: discord_user_id ↔ Player record
- **Acceptance:** unified leaderboard shows Telegram + Discord + web players together

### Phase 4 — Wallet connect & claim
- Wallet linking UI in the web app
- "Connect to be eligible for the airdrop" badge
- Claim flow at season end
- **Acceptance:** we can export a CSV of (wallet, amount) for the manual airdrop

### Phase 5 (optional) — X / LinkedIn distribution
- Auto-generate the daily drop card as an image
- Post to X / LinkedIn with deep link to the web app
- Track conversion (impressions → clicks → plays)

## 6. Points d'attention (from the user, not negotiable)

- **No "usine à gaz".** If a phase starts looking like a 3-month rewrite, stop and reconsider. Each phase must be shippable on its own.
- **Anti-sybil from day 1.** Don't ship Phase 2 (web app) without at least platform identity binding + IP rate limiting. We can layer wallet/manual-review later, but the structure must already separate Player from PlatformIdentity.
- **Centralised, multi-surface, no game-loop duplication.** Every client is a thin shell over the API.

## 7. Open questions

- **Hosting:** the Telegram bot fits on a free e2-micro. The API + Postgres + web app will not. Budget?
- **Scheduler:** do we want one global "season" (all groups in lockstep) or keep per-group rounds? Per-group is more flexible but cross-platform leaderboard becomes weird (whose round 5 is whose?). Probably need a "season" concept above the "group" concept.
- **Token & chain:** which token, which chain, who funds it? Affects nothing technically until Phase 4.
- **Moderation:** if anyone can spin up a Discord game, how do we prevent abuse? Allowlist of approved servers initially, probably.

## 8. What this branch contains today

Just this spec. No code changes. The branch exists as a marker for the work to come and a place where this doc can evolve without polluting `main`.

When we actually start Phase 1, the first commit on this branch should extract `src/game/scoring.ts` and the projects loader into a `core/` directory shared between the future API and the existing bot — proving the extraction works on the smallest possible scope before touching the DB.
