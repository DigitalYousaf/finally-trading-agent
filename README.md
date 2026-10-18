# FiNALLY — AI Agent for Trading

> Capstone project · Muhammad Yousaf · SMIT "Vibe Engineering with AI Coding Agents", Batch 1

**FiNALLY** is a paper-trading simulator where an AI agent analyzes simulated
markets and trades them. It watches six assets (BTC, ETH, SOL, AAPL, TSLA, EURUSD),
draws live candlestick charts with SMA overlays, and lets you trade with $100,000
of virtual cash — or flip on auto-trade and let the agent trade by itself with
real risk management (position sizing, stop-losses, take-profits). A built-in
backtester replays the exact same agent strategy over 30 simulated days so you can
see how it would have performed. Everything runs in the browser: no backend, no
API keys, no build step.

## Features

- **Live simulated market** — 6 assets ticking every second via a geometric random
  walk with volatility regime shifts and mean reversion; 200 pre-seeded 1-minute
  candles so charts work instantly.
- **Candlestick charts** — hand-rolled canvas rendering with SMA(20)/SMA(50)
  overlays, volume bars, crosshair with OHLC readout, and 24h change %.
- **Paper trading** — market buy/sell, fractional quantities, average entry price,
  unrealized P&L, trade history, portfolio summary, one-click reset to $100,000.
- **AI agent** — scans all assets every 15 seconds using SMA crossover, RSI(14) and
  momentum; posts plain-English reasoning to a live activity feed with confidence %.
- **Auto-trade mode** — the agent executes its own signals: 10% of equity per trade,
  max 3 positions per asset, 2% stop-loss and 4% take-profit checked on every tick.
- **Agent stats** — signals generated, trades executed, win rate on closed agent
  trades, agent-attributed P&L. "Ask agent" button for instant analysis.
- **30-day backtest** — generates 30 days of hourly candles with the same engine and
  runs the *identical* strategy: total return %, win rate, trade count, max drawdown,
  per-asset breakdown, equity curve.
- **Persistence** — portfolio, history and agent stats survive reloads (localStorage).

## How the AI agent strategy works

One pure function — `strategySignal(closes)` in `js/agent.js` — is used by both the
live agent and the backtest, so they can never disagree. Three indicators vote:

1. **Trend — SMA(20) vs SMA(50).** Fast average above slow = uptrend (+1 vote);
   a fresh crossover adds ±0.5.
2. **RSI(14).** Below 30 = oversold (+1 buy vote); above 70 = overbought (−1 sell
   vote); between 40–60 it leans gently (±0.5).
3. **Momentum.** 5-candle % change: above +1% (+1), below −1% (−1).

Votes are summed into a score: **≥ +1.5 → BUY**, **≤ −1.5 → SELL**, otherwise
**HOLD**. Confidence = 55% + up to 40% scaled by score strength → 55–95%.

## How to run locally

```bash
cd trading-agent
python3 -m http.server 8000
# open http://localhost:8000 in your browser
```

That's it — no install, no build. (On Windows you can also use `npx serve`.)
Use a local server rather than opening the file directly so everything loads cleanly.

## Project structure

```
trading-agent/
├── index.html          layout: header ticker, disclaimer, 4 tabs, footer
├── css/styles.css      dark trading-terminal theme, responsive
├── js/
│   ├── market.js       market simulation engine + indicators + formatting
│   ├── charts.js       canvas candlestick + equity-curve rendering
│   ├── trading.js      paper-trading ledger (cash, positions, history)
│   ├── agent.js        the AI agent: strategy, scans, auto-trade, stats
│   ├── backtest.js     30-day strategy replay
│   └── app.js          boot, wiring, tick/scan loops, all rendering
├── CLAUDE.md           project context file for AI coding agents
├── SUBMISSION.md       short project description (for the LMS form)
└── README.md           this file
```

## Tech stack

HTML + CSS + vanilla JavaScript. Canvas 2D for charts. `localStorage` for
persistence. Zero dependencies, zero build tools, zero API keys — deployable to
any static host (Vercel, Netlify, GitHub Pages, plain hosting).

## Build plan — Jira-style tickets (FeatureDev workflow)

Following the course's professional workflow (Class 9: *read work from Jira →
drive the build through the disciplined FeatureDev process → ship*), the project
was planned as tickets and built ticket by ticket. Each ticket = one focused,
shippable increment.

- **Ticket 1 — FIN-1 · App shell & layout.** *"We need the trading-terminal shell:
  header with live equity ticker, disclaimer banner, and four tabs (Dashboard,
  Markets, AI Agent, Backtest) in a dark theme."* → `index.html`, `css/styles.css`.
- **Ticket 2 — FIN-2 · Market simulation engine.** *"We need a believable simulated
  market: 6 assets ticking every second with realistic random-walk prices and
  1-minute candles for charts."* → `js/market.js` (Market class, regime shifts,
  mean reversion, seeded history, SMA/RSI/momentum indicators).
- **Ticket 3 — FIN-3 · Candlestick chart renderer.** *"We need a chart worthy of a
  trading terminal: candles, SMA(20)/SMA(50) overlays, volume bars, crosshair with
  OHLC readout — no charting libraries."* → `js/charts.js`.
- **Ticket 4 — FIN-4 · Paper-trading ledger.** *"We need virtual trading: $100,000
  cash, buy/sell with quantities, average entry price, unrealized P&L, trade
  history, and a dashboard with an equity curve."* → `js/trading.js` + Dashboard tab.
- **Ticket 5 — FIN-5 · The AI agent brain.** *"We need the agent: every 15 seconds
  it scores all six assets with SMA crossover + RSI(14) + momentum, and explains
  each verdict in plain English in a live feed."* → `strategySignal()` + `Agent.scan()`
  in `js/agent.js`, AI Agent tab.
- **Ticket 6 — FIN-6 · Agent auto-trading & risk.** *"We need the agent to trade by
  itself safely: 10% equity sizing, max 3 positions per asset, 2% stop-loss / 4%
  take-profit on every tick, plus win-rate and agent-P&L stats."* → `Agent.execute()`,
  `checkStops()`, stats panel.
- **Ticket 7 — FIN-7 · 30-day backtest.** *"We need proof the strategy is testable:
  generate 30 days of hourly candles with the same engine and replay the identical
  strategy — return %, win rate, max drawdown, per-asset table, equity curve."*
  → `js/backtest.js`, Backtest tab.
- **Ticket 8 — FIN-8 · Polish & QA.** *"We need it demo-ready: mobile-responsive,
  correct number formatting everywhere, localStorage persistence, no console
  errors, every button working."* → responsive CSS, `Fmt` helpers, full click-through.

## Author

**Muhammad Yousaf** — SMIT "Vibe Engineering with AI Coding Agents", Batch 1.

## Disclaimer

Simulated market data for education only — not financial advice. No real money is
used or traded. Past simulated performance does not predict anything.
