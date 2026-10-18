/* =====================================================================
 * FiNALLY — js/trading.js
 * The paper-trading ledger: virtual cash, positions, trade history.
 * Everything is client-side and persisted to localStorage, so a page
 * reload keeps your portfolio. No real money anywhere.
 * ===================================================================== */
'use strict';

const Trading = {
  START_CASH: 100000,
  STORE_KEY: 'finally_portfolio_v1',

  cash: 100000,
  /* positions: SYMBOL -> { qty, avg }  (avg = average entry price) */
  positions: {},
  realizedPnl: 0,   // profit/loss banked by completed sells
  history: [],      // newest first: {t, asset, side, qty, price, value, agent}
  equityCurve: [],  // {t, e} snapshots for the dashboard chart

  init() { this.load(); },

  /* ---------------- persistence ---------------- */
  save() {
    try {
      localStorage.setItem(this.STORE_KEY, JSON.stringify({
        cash: this.cash,
        positions: this.positions,
        realizedPnl: this.realizedPnl,
        history: this.history.slice(0, 300),
        equityCurve: this.equityCurve.slice(-900)
      }));
    } catch (e) { /* storage full or unavailable — trading still works */ }
  },

  load() {
    try {
      const d = JSON.parse(localStorage.getItem(this.STORE_KEY));
      if (d && typeof d.cash === 'number') {
        this.cash = d.cash;
        this.positions = d.positions || {};
        this.realizedPnl = d.realizedPnl || 0;
        this.history = d.history || [];
        this.equityCurve = d.equityCurve || [];
      }
    } catch (e) { /* corrupted storage — start fresh */ }
  },

  /* ---------------- orders ----------------
   * priceOf: function(symbol) -> current price. Kept as a parameter so
   * this module never depends on the market directly (easy to explain). */
  buy(symbol, qty, price, agent = false) {
    qty = Number(qty);
    if (!isFinite(qty) || qty <= 0) return { ok: false, msg: 'Quantity must be greater than 0.' };
    const cost = qty * price;
    if (cost > this.cash + 1e-9)
      return { ok: false, msg: `Not enough cash — need ${Fmt.money(cost)}, have ${Fmt.money(this.cash)}.` };

    this.cash -= cost;
    const p = this.positions[symbol] || { qty: 0, avg: 0 };
    p.avg = (p.avg * p.qty + cost) / (p.qty + qty);  // weighted average entry
    p.qty += qty;
    this.positions[symbol] = p;

    this.history.unshift({ t: Date.now(), asset: symbol, side: 'BUY', qty, price, value: cost, agent });
    this.save();
    return { ok: true, qty };
  },

  sell(symbol, qty, price, agent = false) {
    qty = Number(qty);
    const p = this.positions[symbol];
    if (!p || p.qty <= 0) return { ok: false, msg: `No open position in ${symbol}.` };
    if (!isFinite(qty) || qty <= 0) return { ok: false, msg: 'Quantity must be greater than 0.' };

    const q = Math.min(qty, p.qty);              // never sell more than held
    const proceeds = q * price;
    this.cash += proceeds;
    this.realizedPnl += (price - p.avg) * q;     // bank the result of this sale
    p.qty -= q;
    if (p.qty < 1e-9) delete this.positions[symbol];

    this.history.unshift({ t: Date.now(), asset: symbol, side: 'SELL', qty: q, price, value: proceeds, agent });
    this.save();
    return { ok: true, qty: q };
  },

  /* ---------------- portfolio math ---------------- */
  equity(priceOf) {
    let e = this.cash;
    for (const s of Object.keys(this.positions)) e += this.positions[s].qty * priceOf(s);
    return e;
  },

  invested(priceOf) {
    let v = 0;
    for (const s of Object.keys(this.positions)) v += this.positions[s].qty * priceOf(s);
    return v;
  },

  unrealized(priceOf) {
    let u = 0;
    for (const s of Object.keys(this.positions)) {
      const p = this.positions[s];
      u += (priceOf(s) - p.avg) * p.qty;
    }
    return u;
  },

  totalPnl(priceOf) { return this.equity(priceOf) - this.START_CASH; },

  positionOf(symbol) { return this.positions[symbol] || null; },

  recordEquity(e) {
    this.equityCurve.push({ t: Date.now(), e });
    if (this.equityCurve.length > 900) this.equityCurve.shift();
  },

  /* ---------------- reset ---------------- */
  reset() {
    this.cash = this.START_CASH;
    this.positions = {};
    this.realizedPnl = 0;
    this.history = [];
    this.equityCurve = [{ t: Date.now(), e: this.START_CASH }];
    this.save();
  }
};
