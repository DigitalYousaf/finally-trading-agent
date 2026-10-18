/* =====================================================================
 * FiNALLY — js/charts.js
 * Hand-rolled canvas charts (no charting libraries):
 *   drawCandleChart — candlesticks + SMA(20)/SMA(50) + volume + crosshair
 *   drawEquityChart — portfolio equity curve with gradient fill
 * ===================================================================== */
'use strict';

/* Size a canvas to its CSS box (crisp on retina screens). Returns null
 * when the canvas is hidden (e.g. its tab is not active). */
function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) return null;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: rect.width, h: rect.height };
}

const C_UP = '#26a69a';
const C_DOWN = '#ef5350';
const C_SMA20 = '#2962ff';
const C_SMA50 = '#ff9800';
const C_GRID = 'rgba(139,149,167,0.14)';
const C_TEXT = '#8b95a7';

/* Draw the last ~90 candles with SMA overlays, volume bars and an
 * optional crosshair (hoverIdx = index into the visible candles). */
function drawCandleChart(canvas, candles, symbol, hoverIdx = -1) {
  const s = setupCanvas(canvas);
  if (!s || candles.length < 5) return;
  const { ctx, w, h } = s;
  const cfg = ASSET_MAP[symbol];

  const padL = 8, padR = 64, padT = 12, padB = 16;
  const plotW = w - padL - padR;
  const volH = (h - padT - padB) * 0.20;
  const priceH = (h - padT - padB) - volH - 8;

  const visible = candles.slice(-90);
  const closes = Indicators.closes(candles);           // full history for SMAs
  const sma20 = Indicators.smaSeries(closes, 20).slice(-90);
  const sma50 = Indicators.smaSeries(closes, 50).slice(-90);

  /* Price range covers candle extremes + SMA lines. */
  let lo = Infinity, hi = -Infinity, maxV = 0;
  for (const c of visible) {
    if (c.l < lo) lo = c.l;
    if (c.h > hi) hi = c.h;
    if (c.v > maxV) maxV = c.v;
  }
  for (const v of sma20.concat(sma50)) {
    if (v == null) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = (hi - lo) || 1;
  lo -= span * 0.06; hi += span * 0.06;

  const y = p => padT + (1 - (p - lo) / (hi - lo)) * priceH;
  const step = plotW / visible.length;
  const bodyW = Math.max(1.5, step * 0.62);

  ctx.clearRect(0, 0, w, h);
  ctx.font = '11px "Segoe UI", sans-serif';

  /* Horizontal gridlines + price labels. */
  ctx.strokeStyle = C_GRID;
  ctx.fillStyle = C_TEXT;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const p = lo + (hi - lo) * i / 5;
    const yy = Math.round(y(p)) + 0.5;
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
    ctx.fillText(Fmt.price(symbol, p), w - padR + 6, yy + 4);
  }

  /* Volume bars along the bottom. */
  const volTop = padT + priceH + 8;
  for (let i = 0; i < visible.length; i++) {
    const c = visible[i];
    const vh = maxV > 0 ? (c.v / maxV) * volH : 0;
    ctx.fillStyle = c.c >= c.o ? 'rgba(38,166,154,0.45)' : 'rgba(239,83,80,0.45)';
    ctx.fillRect(padL + i * step + (step - bodyW) / 2, volTop + volH - vh, bodyW, vh);
  }

  /* Candles: wick + body. */
  for (let i = 0; i < visible.length; i++) {
    const c = visible[i];
    const up = c.c >= c.o;
    const col = up ? C_UP : C_DOWN;
    const x = padL + i * step + step / 2;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y(c.h)); ctx.lineTo(x, y(c.l)); ctx.stroke();
    ctx.fillStyle = col;
    const bT = y(Math.max(c.o, c.c)), bB = y(Math.min(c.o, c.c));
    ctx.fillRect(x - bodyW / 2, bT, bodyW, Math.max(1, bB - bT));
  }

  /* SMA overlay lines. */
  const drawLine = (series, col) => {
    ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.beginPath();
    let started = false;
    for (let i = 0; i < series.length; i++) {
      if (series[i] == null) continue;
      const x = padL + i * step + step / 2;
      if (!started) { ctx.moveTo(x, y(series[i])); started = true; }
      else ctx.lineTo(x, y(series[i]));
    }
    ctx.stroke();
  };
  drawLine(sma20, C_SMA20);
  drawLine(sma50, C_SMA50);

  /* Last-price dashed line + tag. */
  const last = visible[visible.length - 1].c;
  const ly = y(last);
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = last >= visible[visible.length - 1].o ? C_UP : C_DOWN;
  ctx.beginPath(); ctx.moveTo(padL, ly); ctx.lineTo(w - padR, ly); ctx.stroke();
  ctx.setLineDash([]);
  const tag = Fmt.price(symbol, last);
  const tagW = ctx.measureText(tag).width + 12;
  ctx.fillStyle = last >= visible[visible.length - 1].o ? C_UP : C_DOWN;
  ctx.fillRect(w - padR, ly - 10, tagW, 20);
  ctx.fillStyle = '#0a0e14';
  ctx.fillText(tag, w - padR + 6, ly + 4);

  /* Crosshair + OHLC readout on hover. */
  if (hoverIdx >= 0 && hoverIdx < visible.length) {
    const c = visible[hoverIdx];
    const x = padL + hoverIdx * step + step / 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(219,226,238,0.5)';
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + priceH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(padL, y(c.c)); ctx.lineTo(w - padR, y(c.c)); ctx.stroke();
    ctx.setLineDash([]);

    const chg = (c.c - c.o) / c.o * 100;
    const txt = `O ${Fmt.price(symbol, c.o)}  H ${Fmt.price(symbol, c.h)}  ` +
                `L ${Fmt.price(symbol, c.l)}  C ${Fmt.price(symbol, c.c)}  ${Fmt.pct(chg)}`;
    ctx.font = '12px "Segoe UI", sans-serif';
    const tw = ctx.measureText(txt).width + 16;
    ctx.fillStyle = 'rgba(10,14,20,0.88)';
    ctx.fillRect(padL + 4, padT + 4, tw, 24);
    ctx.strokeStyle = C_GRID; ctx.strokeRect(padL + 4, padT + 4, tw, 24);
    ctx.fillStyle = chg >= 0 ? C_UP : C_DOWN;
    ctx.fillText(txt, padL + 12, padT + 20);
  }
}

/* Simple equity curve: line + soft fill, min/max labels. */
function drawEquityChart(canvas, points) {
  const s = setupCanvas(canvas);
  if (!s || points.length < 2) return;
  const { ctx, w, h } = s;

  const padL = 8, padR = 64, padT = 12, padB = 16;
  const plotW = w - padL - padR, plotH = h - padT - padB;

  let lo = Infinity, hi = -Infinity;
  for (const p of points) {
    if (p.e < lo) lo = p.e;
    if (p.e > hi) hi = p.e;
  }
  const span = (hi - lo) || 1;
  lo -= span * 0.08; hi += span * 0.08;

  const x = i => padL + (i / (points.length - 1)) * plotW;
  const y = e => padT + (1 - (e - lo) / (hi - lo)) * plotH;

  ctx.clearRect(0, 0, w, h);
  ctx.font = '11px "Segoe UI", sans-serif';

  /* Breakeven line at the starting $100,000 if it is in range. */
  if (lo < 100000 && hi > 100000) {
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(139,149,167,0.5)';
    ctx.beginPath(); ctx.moveTo(padL, y(100000)); ctx.lineTo(w - padR, y(100000)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C_TEXT;
    ctx.fillText('$100k start', w - padR + 6, y(100000) + 4);
  }

  /* Filled area under the curve. */
  const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
  const up = points[points.length - 1].e >= points[0].e;
  const col = up ? C_UP : C_DOWN;
  grad.addColorStop(0, up ? 'rgba(38,166,154,0.35)' : 'rgba(239,83,80,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath();
  ctx.moveTo(x(0), y(points[0].e));
  for (let i = 1; i < points.length; i++) ctx.lineTo(x(i), y(points[i].e));
  ctx.lineTo(x(points.length - 1), padT + plotH);
  ctx.lineTo(x(0), padT + plotH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  /* The line itself. */
  ctx.beginPath();
  ctx.moveTo(x(0), y(points[0].e));
  for (let i = 1; i < points.length; i++) ctx.lineTo(x(i), y(points[i].e));
  ctx.strokeStyle = col;
  ctx.lineWidth = 2;
  ctx.stroke();

  /* Min / max labels. */
  ctx.fillStyle = C_TEXT;
  ctx.fillText(Fmt.money(hi), w - padR + 6, padT + 10);
  ctx.fillText(Fmt.money(lo), w - padR + 6, padT + plotH);
}
