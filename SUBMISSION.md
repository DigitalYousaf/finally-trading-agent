# FiNALLY — AI Agent for Trading · Capstone final submission

> Short project description for the LMS submission form.

## Problem

Learning to trade is expensive and intimidating: real markets punish every beginner
mistake with real money, and paper-trading tools that exist are either tied to a
broker account or too complex for a student. At the same time, most people have no
way to see how a rule-based trading strategy — the kind an AI agent would run —
actually behaves over time, so "AI trading" stays a black box of hype.

## Target market/users

Beginner traders and students who want to practice trading without risking money;
SMIT students and self-learners studying AI agents who want a concrete, visual
example of an agent perceiving a market, reasoning about it, and acting; and
anyone curious whether a simple indicator-based strategy holds up, who can run the
30-day backtest and judge the numbers themselves.

## Proposed solution

FiNALLY is a paper-trading simulator with an AI agent at its center. A simulated
market engine ticks six assets (BTC, ETH, SOL, AAPL, TSLA, EURUSD) every second with
realistic random-walk behavior, drawn as live candlestick charts. The user trades
with $100,000 of virtual cash — or enables auto-trade and watches the agent score
every asset with SMA crossover, RSI(14) and momentum, explain each decision in
plain English, and execute with proper risk management (10% position sizing, 2%
stop-loss, 4% take-profit). A backtest tab replays the identical strategy over 30
simulated days and reports return, win rate, max drawdown and per-asset results.

## Technologies/services used

The app is built with plain HTML, CSS and vanilla JavaScript — no frameworks, no
build step, no backend, no API keys — so it runs from any static host. All charts
are hand-rolled on HTML5 Canvas (candlesticks, SMA overlays, volume bars, equity
curves). Market data is fully simulated in the browser with a geometric random
walk engine (volatility regimes + mean reversion), and portfolio, trade history and
agent statistics persist in `localStorage`. It was built following the course's
professional workflow: a project CLAUDE.md, Jira-style tickets, and ticket-by-ticket
FeatureDev builds.
