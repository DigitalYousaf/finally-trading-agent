# CLAUDE.md — FiNALLY (AI Agent for Trading)

> Project context file for AI coding agents (Claude Code, Cursor, etc.).
> Written the way the SMIT "Vibe Engineering with AI Coding Agents" course teaches:
> a tight, effective CLAUDE.md that gives any agent the full picture in one read.
> Keep this file updated when the architecture changes.

## Project overview

**FiNALLY** is the Class 12 capstone project: a paper-trading simulator where an AI
agent analyzes simulated markets and trades them. It is a single-page web app —
no backend, no database, no API keys. All market data is simulated in the browser
with a geometric random walk engine, and all state (portfolio, trades, agent stats)
is persisted in `localStorage`.

The point of the project is to **demonstrate the course's full workflow**:
write the CLAUDE.md → plan the work as Jira-style tickets → build ticket by
ticket (FeatureDev) → demo and explain every part.

## Tech stack

- Plain HTML + CSS + vanilla JavaScript. No build step, no npm, no frameworks,
  no runtime CDN dependencies — the app must work from local files / any static host.
- Canvas 2D for all charts (hand-rolled candlesticks + equity curves).
- `localStorage` for persistence (portfolio, trade history, agent stats).

## How to run

```bash
cd trading-agent
python3 -m http.server 8000
# then open http://localhost:8000
```

No install step. If a change doesn't show up, hard-refresh (Ctrl+Shift+R) —
browsers cache the JS files.

## Architecture

```
index.html            layout: header ticker, disclaimer, 4 tabs, footer
css/styles.css        dark trading-terminal theme, responsive
js/market.js          Market class: 1-second ticks, 1-minute candles,
                      regime shifts, mean reversion + Indicators (SMA/RSI/momentum)
                      + Fmt (number formatting) + ASSETS config
js/charts.js          setupCanvas, drawCandleChart (candles + SMA20/50 + volume
                      + crosshair/OHLC), drawEquityChart
js/trading.js         Trading: cash, positions, avg entry, buy/sell ledger,
                      realized/unrealized P&L, localStorage save/load/reset
js/agent.js           strategySignal(closes) — the PURE strategy used by BOTH
                      the live agent and the backtest. Agent: 15s scans, feed,
                      auto-trade (10% sizing, max 3 lots/asset, 2% SL / 4% TP),
                      stats, ask().
js/backtest.js        Backtest: generates 30 days of hourly candles per asset,
                      replays strategySignal over a shared $100k portfolio,
                      returns { totalReturn, winRate, trades, maxDrawdown,
                      perAsset, curve }
js/app.js             boot + wiring: tabs, watchlist, order panel, 1s tick loop,
                      15s agent scan loop, toasts, all render functions
```

Data flow: `Market.tick()` (every 1s) → `Agent.checkStops()` → `renderAll()`.
Every 15s: `Agent.scan()` → feed lines + optional `Agent.execute()`.
The backtest never touches live state — it builds its own candles and portfolio.

## Key files to know

- `js/agent.js` → `strategySignal()` is the heart of the project. The demo lives
  or dies on explaining the three votes (trend / RSI / momentum) and the scoring.
- `js/market.js` → `_seedHistory()` pre-generates 200 candles so charts and
  indicators work instantly; `tick()` is the live simulation.
- `js/trading.js` → `buy()`/`sell()` keep the weighted average entry price;
  everything financial flows through here.

## Conventions for AI agents working in this repo

1. **Vanilla only.** Do not add npm packages, frameworks, or CDN scripts.
   If a library seems needed, hand-roll the small piece instead.
2. **Numbers must be formatted.** Prices via `Fmt.price(symbol, p)`,
   money via `Fmt.money(x)`, quantities via `Fmt.qty(symbol, q)`. Never show
   raw floats in the UI.
3. **No console errors, ever.** Every button must work; guard canvas sizing
   (hidden tabs have zero size — see `setupCanvas` returning null).
4. **Strategy changes go in `strategySignal()` only.** The live agent and the
   backtest share it — never fork the logic.
5. **Keep functions small and commented.** The student must demo and explain
   this code; clarity beats cleverness.
6. **Fractional quantities are required** (BTC at ~$67k can't be integer-only).
7. **Simulated data only.** Never add real market APIs or real-money flows.

## What to know before changing code

- Tabs render lazily: charts redraw on tab switch because hidden canvases
  measure 0×0.
- `Trading.buy/sell` take an `agent` flag that tags the row in trade history.
- Agent lots (`Agent.lots`) are separate from `Trading.positions` so the agent's
  stop-loss/take-profit and win-rate stats stay attributable to the agent.
- `localStorage` keys: `finally_portfolio_v1`, `finally_agent_v1`.
