/* =====================================================================
 * FiNALLY — js/backtest.js
 * "What if the agent had traded the last 30 days?"
 *
 * Generates 30 days of 1-hour candles for every asset with the same
 * geometric-random-walk engine as the live market, then replays the
 * IDENTICAL strategy (strategySignal from agent.js): same votes, same
 * 10% position sizing, same 2% stop-loss / 4% take-profit, one shared
 * $100,000 portfolio. Reports return, win rate, trade count, max
 * drawdown and a per-asset breakdown.
 * ===================================================================== */
'use strict';

const Backtest = {
  HOURS: 30 * 24,   // 720 hourly candles = 30 days

  /* Per-hour volatility for the backtest (hourly steps are bigger than
   * the 1-second live ticks, so these are tuned separately). */
  hourlyVol(cfg) {
    if (cfg.type === 'crypto') return 0.011;
    if (cfg.type === 'stock') return 0.007;
    return 0.0028; // forex
  },

  /* Build 720 hourly candles for one asset with the same engine idea:
   * random walk + regime shifts + mean reversion. */
  generateCandles(cfg) {
    const vol = this.hourlyVol(cfg);
    const candles = [];
    let price = cfg.base * (1 + (Math.random() * 0.10 - 0.05));
    let fair = price;
    let regimeMult = 1, regimeLeft = 0;
    let t = Date.now() - this.HOURS * 3600 * 1000;

    for (let i = 0; i < this.HOURS; i++) {
      if (regimeLeft <= 0) {                       // regime shifts
        regimeMult = Math.random() < 0.18 ? 0.5 + Math.random() * 2.2 : 0.8 + Math.random() * 0.6;
        regimeLeft = 24 + Math.floor(Math.random() * 96); // 1-5 days
      }
      regimeLeft--;

      const o = price;
      let h = price, l = price, v = 0;
      for (let s = 0; s < 6; s++) {                 // 6 x 10-minute steps
        fair *= 1 + randn() * vol * 0.05;
        const mr = 0.02 * (fair / price - 1);
        price = Math.max(price * (1 + randn() * vol * 2.2 + mr), cfg.base * 0.2);
        if (price > h) h = price;
        if (price < l) l = price;
        v += cfg.volumeBase * (0.5 + Math.random()) / 6;
      }
      candles.push({ t, o, h, l, c: price, v });
      t += 3600 * 1000;
    }
    return candles;
  },

  /* Run the whole backtest. Returns a results object (no DOM here —
   * drawing happens separately so this stays testable). */
  run() {
    const data = {};   // symbol -> { candles, closes }
    for (const cfg of ASSETS) {
      const candles = this.generateCandles(cfg);
      data[cfg.symbol] = { cfg, candles, closes: candles.map(c => c.c) };
    }

    let cash = 100000;
    const positions = {};  // symbol -> { qty, entry, sl, tp }
    const perAsset = {};
    for (const cfg of ASSETS) perAsset[cfg.symbol] = { trades: 0, wins: 0, pnl: 0 };

    const curve = [{ t: data.BTC.candles[0].t, e: 100000 }];
    let peak = 100000, maxDD = 0;
    let wins = 0, trades = 0;

    const equityNow = (i) => {
      let e = cash;
      for (const sym of Object.keys(positions))
        e += positions[sym].qty * data[sym].closes[i];
      return e;
    };

    const closePosition = (sym, price, i) => {
      const pos = positions[sym];
      const pnl = (price - pos.entry) * pos.qty;
      cash += pos.qty * price;
      trades++;
      perAsset[sym].trades++;
      perAsset[sym].pnl += pnl;
      if (pnl > 0) { wins++; perAsset[sym].wins++; }
      delete positions[sym];
    };

    /* Walk hour by hour, starting once indicators have enough history. */
    for (let i = 60; i < this.HOURS; i++) {
      const equity = equityNow(i);

      for (const cfg of ASSETS) {
        const sym = cfg.symbol;
        const d = data[sym];
        const c = d.candles[i];
        const pos = positions[sym];

        if (pos) {
          /* Stop-loss / take-profit trigger inside the candle's range. */
          if (c.l <= pos.sl)      { closePosition(sym, pos.sl, i); continue; }
          if (c.h >= pos.tp)      { closePosition(sym, pos.tp, i); continue; }
        }

        const sig = strategySignal(d.closes.slice(0, i + 1));
        if (!sig) continue;

        if (sig.signal === 'SELL' && pos) {
          closePosition(sym, c.c, i);
        } else if (sig.signal === 'BUY' && !pos) {
          let qty = (0.10 * equity) / c.c;
          qty = Math.floor(qty * 10000) / 10000;
          const cost = qty * c.c;
          if (qty > 0 && cost <= cash) {
            cash -= cost;
            positions[sym] = { qty, entry: c.c, sl: c.c * 0.98, tp: c.c * 1.04 };
          }
        }
      }

      const e = equityNow(i);
      curve.push({ t: data.BTC.candles[i].t, e });
      if (e > peak) peak = e;
      const dd = (peak - e) / peak * 100;
      if (dd > maxDD) maxDD = dd;
    }

    /* Mark any still-open positions to market at the final prices. */
    const finalEquity = equityNow(this.HOURS - 1);

    return {
      startEquity: 100000,
      endEquity: finalEquity,
      totalReturn: (finalEquity - 100000) / 100000 * 100,
      trades,
      wins,
      winRate: trades === 0 ? null : wins / trades * 100,
      maxDrawdown: maxDD,
      perAsset,
      curve
    };
  }
};
