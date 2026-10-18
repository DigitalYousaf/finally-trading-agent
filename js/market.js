/* =====================================================================
 * FiNALLY — js/market.js
 * The market simulation engine. There is no real market data here:
 * every price is produced by a geometric random walk with
 * per-asset volatility, occasional volatility regime shifts, and a
 * mild pull back toward a slowly drifting "fair value" (mean reversion)
 * so the charts look like real markets.
 * ===================================================================== */
'use strict';

/* The six tradeable assets: symbol, display name, type, starting price,
 * per-tick volatility, decimals for display, and base volume. */
const ASSETS = [
  { symbol: 'BTC',    name: 'Bitcoin',         type: 'crypto', base: 67000, vol: 0.0035, decimals: 0, volumeBase: 14 },
  { symbol: 'ETH',    name: 'Ethereum',        type: 'crypto', base: 3500,  vol: 0.0045, decimals: 2, volumeBase: 900 },
  { symbol: 'SOL',    name: 'Solana',          type: 'crypto', base: 170,   vol: 0.0060, decimals: 2, volumeBase: 42000 },
  { symbol: 'AAPL',   name: 'Apple Inc.',      type: 'stock',  base: 230,   vol: 0.0018, decimals: 2, volumeBase: 750000 },
  { symbol: 'TSLA',   name: 'Tesla Inc.',      type: 'stock',  base: 250,   vol: 0.0032, decimals: 2, volumeBase: 1100000 },
  { symbol: 'EURUSD', name: 'Euro / US Dollar', type: 'forex',  base: 1.085, vol: 0.0006, decimals: 5, volumeBase: 5200000 },
];

/* Fast lookup: symbol -> asset config. */
const ASSET_MAP = {};
for (const a of ASSETS) ASSET_MAP[a.symbol] = a;

/* Standard normal random number (Box-Muller transform). */
function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/* ------------------------------------------------------------------ */
/* Formatting helpers used across the whole app.                       */
/* ------------------------------------------------------------------ */
const Fmt = {
  /* Money with commas, e.g. -$1,234.56 or $1,234.56 */
  money(x, signed = false) {
    const neg = x < 0;
    const abs = Math.abs(x);
    const str = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (signed) return (neg ? '-' : '+') + '$' + str;
    return (neg ? '-' : '') + '$' + str;
  },
  /* Price with the right decimals for the asset, e.g. 67,000 or 1.08520 */
  price(symbol, p) {
    const d = ASSET_MAP[symbol].decimals;
    return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  },
  /* Percentage with sign, e.g. +1.23% */
  pct(x) {
    const sign = x < 0 ? '-' : '+';
    return sign + Math.abs(x).toFixed(2) + '%';
  },
  /* Quantity trimmed sensibly per asset type */
  qty(symbol, q) {
    const type = ASSET_MAP[symbol].type;
    const d = type === 'crypto' ? 4 : type === 'stock' ? 2 : 0;
    return q.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d });
  },
  /* HH:MM:SS from a timestamp */
  time(t) {
    const d = new Date(t);
    return d.toTimeString().slice(0, 8);
  },
  int(x) {
    return Math.round(x).toLocaleString('en-US');
  }
};

/* ------------------------------------------------------------------ */
/* Pure technical-indicator math. Works on arrays of closing prices.    */
/* ------------------------------------------------------------------ */
const Indicators = {
  /* Simple moving average of the last n values (null if not enough data) */
  sma(values, n) {
    if (values.length < n) return null;
    let s = 0;
    for (let i = values.length - n; i < values.length; i++) s += values[i];
    return s / n;
  },

  /* Full SMA series aligned with the input (nulls where not enough data) */
  smaSeries(values, n) {
    const out = new Array(values.length).fill(null);
    let s = 0;
    for (let i = 0; i < values.length; i++) {
      s += values[i];
      if (i >= n) s -= values[i - n];
      if (i >= n - 1) out[i] = s / n;
    }
    return out;
  },

  /* Relative Strength Index over the last n periods (classic Wilder-ish) */
  rsi(closes, n = 14) {
    if (closes.length < n + 1) return null;
    let gain = 0, loss = 0;
    for (let i = closes.length - n; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      if (d > 0) gain += d; else loss -= d;
    }
    if (loss === 0) return 100;
    const rs = gain / loss;
    return 100 - 100 / (1 + rs);
  },

  /* % change over the last n closes */
  momentum(closes, n = 5) {
    if (closes.length < n + 1) return null;
    const now = closes[closes.length - 1];
    const then = closes[closes.length - 1 - n];
    return (now - then) / then * 100;
  },

  closes(candles) {
    return candles.map(c => c.c);
  }
};

/* ------------------------------------------------------------------ */
/* Market — owns all simulated price data.                             */
/*                                                                     */
/* Data kept per asset:                                                */
/*   ticks    — last 500 raw 1-second price ticks {t, p}                */
/*   candles  — ~200 seeded 1-minute candles + live ones {t,o,h,l,c,v}  */
/*   forming  — the candle currently being built from live ticks        */
/* ------------------------------------------------------------------ */
class Market {
  constructor() {
    this.assets = {};
    this._seedAll();
  }

  _seedAll() {
    for (const cfg of ASSETS) {
      const a = {
        cfg,
        price: cfg.base,
        ticks: [],
        candles: [],
        forming: null,
        /* Reference price for the "24h change" readout. */
        prevDayClose: cfg.base * (1 + (Math.random() * 0.06 - 0.03)),
        regimeMult: 1,      // current volatility multiplier
        regimeUntil: 0,     // timestamp when the regime may shift again
        fairValue: cfg.base // slow drift anchor for mean reversion
      };
      this.assets[cfg.symbol] = a;
      this._seedHistory(a);
    }
  }

  /* Pre-generate 200 one-minute candles so charts and indicators work
   * instantly on page load (no waiting for live data). */
  _seedHistory(a) {
    const now = Date.now();
    const start = now - 200 * 60 * 1000;
    let price = a.cfg.base * (1 + (Math.random() * 0.04 - 0.02));
    let fair = price;
    for (let i = 0; i < 200; i++) {
      const t = start + i * 60 * 1000;
      const o = price;
      let h = price, l = price, vol = 0;
      for (let s = 0; s < 12; s++) {           // 12 x 5-second steps
        fair *= 1 + randn() * a.cfg.vol * 0.05; // fair value drifts slowly
        const mr = 0.02 * (fair / price - 1);   // mild mean reversion
        const shock = randn() * a.cfg.vol * 3;  // random market noise
        price = Math.max(price * (1 + shock + mr), a.cfg.base * 0.2);
        if (price > h) h = price;
        if (price < l) l = price;
        vol += a.cfg.volumeBase * (0.5 + Math.random()) / 12;
      }
      a.candles.push({ t, o, h, l, c: price, v: vol });
    }
    a.price = price;
    a.fairValue = fair;
  }

  /* Advance the whole market by one tick (called every second). */
  tick() {
    const now = Date.now();
    for (const sym of Object.keys(this.assets)) {
      const a = this.assets[sym];

      /* Volatility regime shifts: mostly calm, sometimes stormy. */
      if (now >= a.regimeUntil) {
        a.regimeMult = Math.random() < 0.18
          ? 0.5 + Math.random() * 2.2    // 18%: a high/low volatility regime
          : 0.8 + Math.random() * 0.6;   // otherwise near-normal
        a.regimeUntil = now + (60 + Math.random() * 240) * 1000; // 1-5 min
      }

      a.fairValue *= 1 + randn() * a.cfg.vol * 0.02;
      const mr = 0.0015 * (a.fairValue / a.price - 1);
      const shock = randn() * a.cfg.vol * a.regimeMult;
      a.price = Math.max(a.price * (1 + shock + mr), a.cfg.base * 0.15);

      a.ticks.push({ t: now, p: a.price });
      if (a.ticks.length > 500) a.ticks.shift();

      this._updateFormingCandle(a, now);
    }
  }

  /* Fold the latest tick into the current 1-minute candle. */
  _updateFormingCandle(a, now) {
    const bucket = Math.floor(now / 60000) * 60000;
    if (!a.forming || a.forming.t !== bucket) {
      if (a.forming) {
        a.candles.push(a.forming);
        if (a.candles.length > 220) a.candles.shift();
      }
      a.forming = { t: bucket, o: a.price, h: a.price, l: a.price, c: a.price, v: 0 };
    }
    const f = a.forming;
    f.c = a.price;
    if (a.price > f.h) f.h = a.price;
    if (a.price < f.l) f.l = a.price;
    f.v += a.cfg.volumeBase * (0.3 + Math.random() * 0.7) / 60;
  }

  /* All candles including the one still forming. */
  candles(symbol) {
    const a = this.assets[symbol];
    return a.forming ? a.candles.concat([a.forming]) : a.candles.slice();
  }

  price(symbol) { return this.assets[symbol].price; }

  change24h(symbol) {
    const a = this.assets[symbol];
    return (a.price - a.prevDayClose) / a.prevDayClose * 100;
  }
}
