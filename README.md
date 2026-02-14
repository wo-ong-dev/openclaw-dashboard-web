# Coin Dashboard Web (MVP)

Read-only, exchange-style dashboard for local coin trading outputs.

## Features

- Next.js (TypeScript, App Router) + Tailwind
- Dark trading UI sections:
  - Top market header
  - Center candlestick + volume chart (`lightweight-charts`)
  - Right strategy panel (A/B/C)
- Top-level "전략 한 줄 비교" 카드 (리더/24h 스냅샷/MDD 비교)
  - Bottom recent decisions + alerts (ops/performance split)
- Server-side adapters via API route (`/api/dashboard`)
- Polling refresh every 7s (no websocket)
- KST display policy: all timestamps are rendered in `Asia/Seoul` (KST), including chart labels/tooltip time formatting, decisions, alerts, and freshness badges
- No order placement / no trade execution actions

## Data Sources (local files)

Reads from:
- `../outputs/*.json|jsonl`
- `../data/live/btc_1m.csv`

Used files:
- `outputs/paper_state.{A|B|C}.json`
- `outputs/paper_decisions.{A|B|C}.jsonl`
- `outputs/alerts_ops.jsonl`
- `outputs/alerts_performance.json`
- `data/live/btc_1m.csv`

## Environment

Copy `.env.example` to `.env.local`.

```bash
cp .env.example .env.local
```

Modes:
- **External API mode (Vercel-ready):**
  - set `NEXT_PUBLIC_DASHBOARD_API_BASE=https://<api-domain>`
  - dashboard fetches `${NEXT_PUBLIC_DASHBOARD_API_BASE}/dashboard`
- **Fallback local mode (existing behavior):**
  - leave `NEXT_PUBLIC_DASHBOARD_API_BASE` empty
  - dashboard uses internal `/api/dashboard` route

Optional local path overrides for fallback mode:
- `OUTPUTS_DIR=../outputs`
- `LIVE_DATA_DIR=../data/live`

## Local Run

```bash
npm install
npm run dev
```

Open: <http://localhost:3000>

## Build Validation

```bash
npm run build
npm run start
```

## Vercel Deploy

1. Deploy `traders/coin/dashboard-web` as a Next.js project.
2. Add env var in Vercel:
   - `NEXT_PUBLIC_DASHBOARD_API_BASE=https://<your-dashboard-api-domain>`
3. Deploy.

This is the recommended Plan A path (Vercel UI + external read-only API).

If you do not set `NEXT_PUBLIC_DASHBOARD_API_BASE`, app falls back to internal `/api/dashboard` and local filesystem adapters (`OUTPUTS_DIR`, `LIVE_DATA_DIR`).

Repo split/deploy stabilization guide: `docs/repo-split-deploy.md`

## API

- `GET /api/dashboard`
  - Normalized payload for market header, chart, strategy cards, decisions, alerts.

<!-- vercel-trigger -->

<!-- deploy trigger -->
1) Commit message: chore: trigger vercel deploy
2) Commit directly to main
3) Commit changes

<!-- ko-label-trigger -->
