/* =====================================================================
 * FiNALLY — js/agent.js
 * The AI trading agent — the centerpiece of the app.
 *
 * HOW IT THINKS (same logic everywhere: live scans AND the backtest):
 *   1. strategySignal(closes) — pure function, no side effects.
 *      Three indicators vote, the votes are summed into a score:
 *        + Trend:  SMA(20) vs SMA(50). Fast above slow = uptrend (+1),
 *                  fresh crossover adds another ±0.5.
 *        + RSI(14): < 30 oversold (+1 buy) · > 70 overbought (−1 sell) ·
 *                  40–60 leans gently with the reading (±0.5).
 *        + Momentum: 5-candle % change > +1% (+1) · < −1% (−1).
 *      Score ≥ +1.5 → BUY · ≤ −1.5 → SELL · otherwise HOLD.
 *      Confidence = 55% + up to 40% scaled by |score|/3  → 55–95%.
 *   2. Agent.scan() — every 15 s, runs the signal on all six assets,
 *      writes a plain-English reasoning line to the feed, and (only when
 *      auto-trade is ON) executes the trade.
 *   3. Risk rules on every agent trade: 10% of equity per trade,
 *      max 3 open agent positions per asset, 2% stop-loss and 4%
 *      take-profit checked on every price tick.
 * ===================================================================== */
'use strict';

/* Pure strategy: closes[] -> signal. Used by the live agent AND the
 * backtest, so both always agree ("the identical agent strategy"). */
function strategySignal(closes) {
  const sma20 = Indicators.sma(closes, 20);
  const sma50 = Indicators.sma(closes, 50);
  const rsi = Indicators.rsi(closes, 14);
  const mom = Indicators.momentum(closes, 5);
  if (sma20 == null || sma50 == null || rsi == null || mom == null) return null;

  let score = 0;
  const parts = [];

  /* --- Vote 1: trend (SMA20 vs SMA50) --- */
  const uptrend = sma20 > sma50;
  score += uptrend ? 1 : -1;
  parts.push({ text: `SMA20 ${uptrend ? 'above' : 'below'} SMA50 (${sma20.toFixed(2)} vs ${sma50.toFixed(2)})`, dir: uptrend ? 1 : -1 });

  /* Fresh crossover gets extra weight — it is the classic entry trigger. */
  const p20 = Indicators.sma(closes.slice(0, -1), 20);
  const p50 = Indicators.sma(closes.slice(0, -1), 50);
  const crossedUp = p20 != null && p50 != null && p20 <= p50 && sma20 > sma50;
  const crossedDown = p20 != null && p50 != null && p20 >= p50 && sma20 < sma50;
  if (crossedUp) { score += 0.5; parts.push({ text: 'SMA20 just crossed above SMA50', dir: 1 }); }
  if (crossedDown) { score -= 0.5; parts.push({ text: 'SMA20 just crossed below SMA50', dir: -1 }); }

  /* --- Vote 2: RSI(14) --- */
  let rsiLabel;
  if (rsi < 30)      { score += 1;   rsiLabel = 'oversold'; }
  else if (rsi > 70) { score -= 1;   rsiLabel = 'overbought'; }
  else if (rsi < 40) { score += 0.5; rsiLabel = 'neutral-bullish'; }
  else if (rsi > 60) { score -= 0.5; rsiLabel = 'neutral-bearish'; }
  else               {              rsiLabel = 'neutral'; }
  parts.push({ text: `RSI ${rsi.toFixed(0)} (${rsiLabel})`, dir: 0 });

  /* --- Vote 3: short-term momentum --- */
  if (mom > 1)       { score += 1; parts.push({ text: `momentum ${Fmt.pct(mom)} — buyers in control`, dir: 1 }); }
  else if (mom < -1) { score -= 1; parts.push({ text: `momentum ${Fmt.pct(mom)} — sellers in control`, dir: -1 }); }
  else               {             parts.push({ text: `momentum ${Fmt.pct(mom)} — flat`, dir: 0 }); }

  let signal = 'HOLD';
  if (score >= 1.5) signal = 'BUY';
  else if (score <= -1.5) signal = 'SELL';

  const confidence = Math.round(55 + Math.min(Math.abs(score) / 3, 1) * 40);
  return { signal, confidence, score, sma20, sma50, rsi, mom, crossedUp, crossedDown, parts };
}

/* One-line plain-English verdict, e.g.:
 * "BTC — SMA20 crossed above SMA50, RSI 61 (neutral-bullish), momentum +1.8% → BUY signal, confidence 76%" */
function signalSummary(symbol, sig) {
  const bits = [];
  if (sig.crossedUp) bits.push('SMA20 crossed above SMA50');
  else if (sig.crossedDown) bits.push('SMA20 crossed below SMA50');
  else bits.push(`SMA20 ${sig.sma20 > sig.sma50 ? 'above' : 'below'} SMA50`);
  const rsiLabel = sig.rsi < 30 ? 'oversold' : sig.rsi > 70 ? 'overbought'
    : sig.rsi < 40 ? 'neutral-bullish' : sig.rsi > 60 ? 'neutral-bearish' : 'neutral';
  bits.push(`RSI ${sig.rsi.toFixed(0)} (${rsiLabel})`);
  bits.push(`momentum ${Fmt.pct(sig.mom)}`);
  return `${symbol} — ${bits.join(', ')} → ${sig.signal} signal, confidence ${sig.confidence}%`;
}

/* ------------------------------------------------------------------ */
const Agent = {
  STORE_KEY: 'finally_agent_v1',

  auto: false,                                   // auto-trade toggle
  stats: { signals: 0, trades: 0, wins: 0, losses: 0, pnl: 0 },
  /* Open agent-managed positions: SYMBOL -> [{qty, entry, sl, tp, t}] */
  lots: {},
  feedItems: [],                                // newest first {t, text, kind}

  init() { this.load(); },

  save() {
    try {
      localStorage.setItem(this.STORE_KEY, JSON.stringify({ stats: this.stats, lots: this.lots }));
    } catch (e) { /* non-fatal */ }
  },

  load() {
    try {
      const d = JSON.parse(localStorage.getItem(this.STORE_KEY));
      if (d) {
        if (d.stats) this.stats = Object.assign(this.stats, d.stats);
        if (d.lots) this.lots = d.lots;
      }
    } catch (e) { /* start fresh */ }
  },

  /* ---------------- the 15-second scan ---------------- */
  scan(market, ui) {
    for (const cfg of ASSETS) {
      const closes = Indicators.closes(market.candles(cfg.symbol));
      const sig = strategySignal(closes);
      if (!sig) continue;
      this.stats.signals++;

      const line = signalSummary(cfg.symbol, sig);
      /* Log every verdict; BUY/SELL get highlighted, HOLD stays quiet. */
      this.feed(line, sig.signal === 'BUY' ? 'buy' : sig.signal === 'SELL' ? 'sell' : 'info');

      if (this.auto && sig.signal !== 'HOLD') {
        this.execute(market, cfg.symbol, sig, ui);
      }
    }
    this.save();
    if (ui && ui.renderAgent) ui.renderAgent();
  },

  /* ---------------- auto-trade execution ---------------- */
  execute(market, symbol, sig, ui) {
    const price = market.price(symbol);
    const equity = Trading.equity(s => market.price(s));
    this.lots[symbol] = this.lots[symbol] || [];

    if (sig.signal === 'BUY') {
      if (this.lots[symbol].length >= 3) {
        this.feed(`${symbol} — BUY signal ignored: already holding 3 agent positions (max).`, 'info');
        return;
      }
      /* Position size = 10% of equity. */
      let qty = (0.10 * equity) / price;
      qty = Math.floor(qty * 10000) / 10000;   // trim to 4 decimals
      if (qty <= 0 || qty * price > Trading.cash) {
        this.feed(`${symbol} — BUY signal ignored: not enough cash for a 10% position.`, 'info');
        return;
      }
      const r = Trading.buy(symbol, qty, price, true);
      if (!r.ok) { this.feed(`${symbol} — BUY failed: ${r.msg}`, 'info'); return; }
      this.lots[symbol].push({
        qty, entry: price,
        sl: price * 0.98,   // 2% stop-loss
        tp: price * 1.04,   // 4% take-profit
        t: Date.now()
      });
      this.stats.trades++;
      this.feed(`${symbol} — AUTO-BUY ${Fmt.qty(symbol, qty)} @ ${Fmt.price(symbol, price)} ` +
                `(10% of equity · SL ${Fmt.price(symbol, price * 0.98)} · TP ${Fmt.price(symbol, price * 1.04)})`, 'buy');
    }

    if (sig.signal === 'SELL') {
      if (this.lots[symbol].length === 0) {
        this.feed(`${symbol} — SELL signal: no agent position to close.`, 'info');
        return;
      }
      /* Close every agent lot in this asset. */
      const lots = this.lots[symbol].splice(0);
      for (const lot of lots) this._closeLot(market, symbol, lot, price, 'signal');
    }
    this.save();
    if (ui && ui.renderAll) ui.renderAll();
  },

  /* Close one agent lot at the given price and score win/loss. */
  _closeLot(market, symbol, lot, price, reason) {
    const r = Trading.sell(symbol, lot.qty, price, true);
    if (!r.ok) return;  // position already gone — nothing to do
    const pnl = (price - lot.entry) * r.qty;
    this.stats.pnl += pnl;
    if (pnl > 0) this.stats.wins++; else this.stats.losses++;
    const why = reason === 'stop-loss' ? 'STOP-LOSS hit'
              : reason === 'take-profit' ? 'TAKE-PROFIT hit' : 'SELL signal';
    this.feed(`${symbol} — ${why}: closed ${Fmt.qty(symbol, r.qty)} @ ${Fmt.price(symbol, price)} ` +
              `| P&L ${Fmt.money(pnl, true)}`, pnl >= 0 ? 'buy' : 'sell');
    this.save();
  },

  /* Checked on every price tick: stop-loss / take-profit for agent lots. */
  checkStops(market) {
    let changed = false;
    for (const symbol of Object.keys(this.lots)) {
      const lots = this.lots[symbol];
      if (!lots || lots.length === 0) continue;
      const price = market.price(symbol);
      for (let i = lots.length - 1; i >= 0; i--) {
        const lot = lots[i];
        if (price <= lot.sl) {
          lots.splice(i, 1);
          this._closeLot(market, symbol, lot, price, 'stop-loss');
          changed = true;
        } else if (price >= lot.tp) {
          lots.splice(i, 1);
          this._closeLot(market, symbol, lot, price, 'take-profit');
          changed = true;
        }
      }
    }
    return changed;
  },

  /* Instant analysis of one asset, posted to the feed ("Ask agent"). */
  ask(market, symbol, ui) {
    const closes = Indicators.closes(market.candles(symbol));
    const sig = strategySignal(closes);
    this.stats.signals++;
    if (!sig) {
      this.feed(`${symbol} — not enough data yet, check back in a minute.`, 'info');
    } else {
      const verdict = signalSummary(symbol, sig);
      const detail = sig.parts.map(p => p.text).join(' · ');
      this.feed(`🔍 ${verdict}`, sig.signal === 'BUY' ? 'buy' : sig.signal === 'SELL' ? 'sell' : 'info');
      this.feed(`&nbsp;&nbsp;&nbsp;↳ Reasoning: ${detail}`, 'info');
    }
    this.save();
    if (ui && ui.renderAgent) ui.renderAgent();
  },

  /* ---------------- feed ---------------- */
  feed(text, kind = 'info') {
    this.feedItems.unshift({ t: Date.now(), text, kind });
    if (this.feedItems.length > 120) this.feedItems.pop();
  },

  winRate() {
    const closed = this.stats.wins + this.stats.losses;
    return closed === 0 ? null : this.stats.wins / closed * 100;
  },

  /* Unrealized P&L of still-open agent lots, at current prices. */
  openLotsPnl(market) {
    let u = 0;
    for (const symbol of Object.keys(this.lots)) {
      const price = market.price(symbol);
      for (const lot of this.lots[symbol]) u += (price - lot.entry) * lot.qty;
    }
    return u;
  },

  reset() {
    this.stats = { signals: 0, trades: 0, wins: 0, losses: 0, pnl: 0 };
    this.lots = {};
    this.feedItems = [];
    this.save();
  }
};
