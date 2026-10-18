/* =====================================================================
 * FiNALLY — js/app.js
 * Boots the app and wires everything together:
 *   market ticks (1s) -> agent stop-loss checks -> UI refresh
 *   agent scans (15s) -> feed + optional auto-trades
 *   tabs, watchlist, order panel, backtest button, reset, persistence
 * ===================================================================== */
'use strict';

let market = null;
let selected = 'BTC';
let hoverIdx = -1;   // hovered candle on the price chart

const $ = id => document.getElementById(id);

/* Small toast notifications (success / error). */
let toastTimer = null;
function toast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
}

const priceOf = sym => market.price(sym);

/* ============================ tabs ============================ */
function initTabs() {
  document.querySelectorAll('.tabbtn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabbtn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tabpane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $('tab-' + btn.dataset.tab).classList.add('active');
      /* A canvas hidden in an inactive tab has zero size — redraw now. */
      if (btn.dataset.tab === 'markets') drawPriceChart();
      if (btn.dataset.tab === 'dashboard') drawEquity();
    });
  });
}

/* ============================ dashboard ============================ */
function renderDashboard() {
  const cash = Trading.cash;
  const invested = Trading.invested(priceOf);
  const equity = Trading.equity(priceOf);
  const pnl = Trading.totalPnl(priceOf);
  const pnlPct = pnl / Trading.START_CASH * 100;

  $('statCash').textContent = Fmt.money(cash);
  $('statInvested').textContent = Fmt.money(invested);
  $('statEquity').textContent = Fmt.money(equity);
  $('statPnl').textContent = Fmt.money(pnl, true);
  $('statPnl').className = pnl >= 0 ? 'pos' : 'neg';
  $('statPnlPct').textContent = Fmt.pct(pnlPct);
  $('statPnlPct').className = pnlPct >= 0 ? 'pos' : 'neg';

  /* Header ticker. */
  $('hdrEquity').textContent = Fmt.money(equity);
  $('hdrPnl').textContent = Fmt.money(pnl, true);
  $('hdrPnl').className = pnl >= 0 ? 'pos' : 'neg';
  $('hdrCash').textContent = Fmt.money(cash);

  /* Positions table. */
  const syms = Object.keys(Trading.positions);
  if (syms.length === 0) {
    $('positionsBody').innerHTML =
      '<tr><td colspan="6" class="empty">No open positions yet — buy something on the Markets tab.</td></tr>';
  } else {
    $('positionsBody').innerHTML = syms.map(s => {
      const p = Trading.positions[s];
      const px = market.price(s);
      const value = p.qty * px;
      const u = (px - p.avg) * p.qty;
      const uPct = (px - p.avg) / p.avg * 100;
      return `<tr>
        <td><strong>${s}</strong></td>
        <td>${Fmt.qty(s, p.qty)}</td>
        <td>${Fmt.price(s, p.avg)}</td>
        <td>${Fmt.price(s, px)}</td>
        <td>${Fmt.money(value)}</td>
        <td class="${u >= 0 ? 'pos' : 'neg'}">${Fmt.money(u, true)} (${Fmt.pct(uPct)})</td>
      </tr>`;
    }).join('');
  }

  /* Trade history table. */
  if (Trading.history.length === 0) {
    $('historyBody').innerHTML = '<tr><td colspan="7" class="empty">No trades yet.</td></tr>';
  } else {
    $('historyBody').innerHTML = Trading.history.slice(0, 60).map(h =>
      `<tr>
        <td>${Fmt.time(h.t)}</td>
        <td><strong>${h.asset}</strong></td>
        <td><span class="side ${h.side === 'BUY' ? 'buy' : 'sell'}">${h.side}</span></td>
        <td>${Fmt.qty(h.asset, h.qty)}</td>
        <td>${Fmt.price(h.asset, h.price)}</td>
        <td>${Fmt.money(h.value)}</td>
        <td>${h.agent ? '🤖 agent' : 'you'}</td>
      </tr>`
    ).join('');
  }
}

function drawEquity() {
  drawEquityChart($('equityChart'), Trading.equityCurve);
}

/* ============================ markets tab ============================ */
function renderWatchlist() {
  $('watchlist').innerHTML = ASSETS.map(cfg => {
    const px = market.price(cfg.symbol);
    const ch = market.change24h(cfg.symbol);
    return `<div class="watchrow ${cfg.symbol === selected ? 'selected' : ''}" data-sym="${cfg.symbol}">
      <span class="sym">${cfg.symbol}</span>
      <span class="px">${Fmt.price(cfg.symbol, px)}</span>
      <span class="nm">${cfg.name}</span>
      <span class="ch ${ch >= 0 ? 'pos' : 'neg'}">${Fmt.pct(ch)}</span>
    </div>`;
  }).join('');

  document.querySelectorAll('.watchrow').forEach(row => {
    row.addEventListener('click', () => selectAsset(row.dataset.sym));
  });
}

/* Updating prices every second without rebuilding click handlers. */
function updateWatchlistPrices() {
  document.querySelectorAll('.watchrow').forEach(row => {
    const sym = row.dataset.sym;
    const px = market.price(sym);
    const ch = market.change24h(sym);
    row.querySelector('.px').textContent = Fmt.price(sym, px);
    const chEl = row.querySelector('.ch');
    chEl.textContent = Fmt.pct(ch);
    chEl.className = 'ch ' + (ch >= 0 ? 'pos' : 'neg');
  });
}

function selectAsset(sym) {
  selected = sym;
  hoverIdx = -1;
  const cfg = ASSET_MAP[sym];
  $('chartTitle').textContent = `${sym} — ${cfg.name}`;
  $('askSymbol').textContent = sym;
  document.querySelectorAll('.watchrow').forEach(r =>
    r.classList.toggle('selected', r.dataset.sym === sym));
  renderOrderPanel();
  drawPriceChart();
}

function drawPriceChart() {
  const candles = market.candles(selected);
  drawCandleChart($('priceChart'), candles, selected, hoverIdx);
  const px = market.price(selected);
  const ch = market.change24h(selected);
  const closes = Indicators.closes(candles);
  const sma20 = Indicators.sma(closes, 20);
  const sma50 = Indicators.sma(closes, 50);
  $('chartMeta').innerHTML =
    `${Fmt.price(selected, px)} &nbsp;<span class="${ch >= 0 ? 'pos' : 'neg'}">${Fmt.pct(ch)} 24h</span>` +
    (sma20 != null ? ` &nbsp;·&nbsp; SMA20 ${Fmt.price(selected, sma20)}` : '') +
    (sma50 != null ? ` &nbsp;·&nbsp; SMA50 ${Fmt.price(selected, sma50)}` : '');
}

function initChartHover() {
  const cv = $('priceChart');
  cv.addEventListener('mousemove', ev => {
    const rect = cv.getBoundingClientRect();
    const padL = 8, padR = 64;
    const plotW = rect.width - padL - padR;
    const visible = market.candles(selected).slice(-90);
    const step = plotW / visible.length;
    const idx = Math.floor((ev.clientX - rect.left - padL) / step);
    const clamped = Math.max(0, Math.min(visible.length - 1, idx));
    if (clamped !== hoverIdx) { hoverIdx = clamped; drawPriceChart(); }
  });
  cv.addEventListener('mouseleave', () => { hoverIdx = -1; drawPriceChart(); });
}

/* ============================ order panel ============================ */
function renderOrderPanel() {
  const px = market.price(selected);
  $('orderPrice').textContent = Fmt.price(selected, px);
  const pos = Trading.positionOf(selected);
  $('orderPos').textContent = pos
    ? `${Fmt.qty(selected, pos.qty)} @ ${Fmt.price(selected, pos.avg)}`
    : 'none';
  updateOrderEst();
}

function updateOrderEst() {
  const qty = parseFloat($('qtyInput').value);
  $('orderEst').textContent =
    (isFinite(qty) && qty > 0) ? Fmt.money(qty * market.price(selected)) : '—';
}

function initOrders() {
  $('qtyInput').addEventListener('input', updateOrderEst);

  $('btnBuy').addEventListener('click', () => {
    const qty = parseFloat($('qtyInput').value);
    const r = Trading.buy(selected, qty, market.price(selected), false);
    if (!r.ok) { toast(r.msg, true); return; }
    toast(`Bought ${Fmt.qty(selected, r.qty)} ${selected} @ ${Fmt.price(selected, market.price(selected))}`);
    renderAll();
  });

  $('btnSell').addEventListener('click', () => {
    const qty = parseFloat($('qtyInput').value);
    const r = Trading.sell(selected, qty, market.price(selected), false);
    if (!r.ok) { toast(r.msg, true); return; }
    toast(`Sold ${Fmt.qty(selected, r.qty)} ${selected} @ ${Fmt.price(selected, market.price(selected))}`);
    renderAll();
  });

  $('btnReset').addEventListener('click', () => {
    if (!confirm('Reset the portfolio to $100,000 and clear all trades and agent stats?')) return;
    Trading.reset();
    Agent.reset();
    Trading.recordEquity(Trading.equity(priceOf));
    toast('Portfolio reset to $100,000.');
    renderAll();
  });
}

/* ============================ agent tab ============================ */
/* Number of feed items the last time the feed DOM was built. The feed is
 * only rebuilt when something new arrives, so reading older entries never
 * gets interrupted by the 1-second tick. */
let lastFeedCount = -1;

function renderAgentStats() {
  $('agentSignals').textContent = Fmt.int(Agent.stats.signals);
  $('agentTrades').textContent = Fmt.int(Agent.stats.trades);
  const wr = Agent.winRate();
  $('agentWinRate').textContent = wr == null ? '—' : wr.toFixed(1) + '%';
  const pnl = Agent.stats.pnl + Agent.openLotsPnl(market);
  $('agentPnl').textContent = Fmt.money(pnl, true);
  $('agentPnl').className = pnl >= 0 ? 'pos' : 'neg';
}

function renderAgentFeed() {
  const feed = $('agentFeed');
  if (Agent.feedItems.length === 0) {
    feed.innerHTML = '<div class="feed-item info">The agent is warming up — first scan lands in a few seconds.</div>';
  } else {
    feed.innerHTML = Agent.feedItems.slice(0, 60).map(item =>
      `<div class="feed-item ${item.kind}"><span class="t">${Fmt.time(item.t)}</span>${item.text}</div>`
    ).join('');
  }
  lastFeedCount = Agent.feedItems.length;
}

function renderAgent() {
  renderAgentStats();
  renderAgentFeed();
}

function initAgentControls() {
  $('autoTradeToggle').addEventListener('change', ev => {
    Agent.auto = ev.target.checked;
    $('autoTradeStatus').textContent = Agent.auto
      ? 'ON — the agent trades by itself: 10% of equity per trade, max 3 positions per asset, 2% stop-loss / 4% take-profit.'
      : 'OFF — the agent watches the market and reports, but never trades.';
    Agent.feed(Agent.auto
      ? '⚡ Auto-trade ENABLED — I will now execute my own signals as paper trades.'
      : '⏸ Auto-trade disabled — back to watch-only mode.', 'info');
    renderAgent();
  });

  $('btnAsk').addEventListener('click', () => {
    Agent.ask(market, selected, { renderAgent });
    toast(`Agent analyzed ${selected} — see the activity feed.`);
  });
}

/* ============================ backtest tab ============================ */
function initBacktest() {
  $('btnBacktest').addEventListener('click', () => {
    const btn = $('btnBacktest');
    btn.disabled = true;
    btn.textContent = 'Running…';
    /* Let the button paint before the heavy synchronous run. */
    setTimeout(() => {
      try {
        const r = Backtest.run();
        $('backtestResults').classList.remove('hidden');

        $('btReturn').textContent = Fmt.pct(r.totalReturn);
        $('btReturn').className = r.totalReturn >= 0 ? 'pos' : 'neg';
        $('btWinRate').textContent = r.winRate == null ? '—' : r.winRate.toFixed(1) + '%';
        $('btTrades').textContent = Fmt.int(r.trades);
        $('btDD').textContent = r.maxDrawdown.toFixed(2) + '%';

        drawEquityChart($('btChart'), r.curve);

        $('btBody').innerHTML = ASSETS.map(cfg => {
          const p = r.perAsset[cfg.symbol];
          const wr = p.trades === 0 ? '—' : (p.wins / p.trades * 100).toFixed(1) + '%';
          return `<tr>
            <td><strong>${cfg.symbol}</strong></td>
            <td>${p.trades}</td>
            <td>${p.wins}</td>
            <td>${wr}</td>
            <td class="${p.pnl >= 0 ? 'pos' : 'neg'}">${Fmt.money(p.pnl, true)}</td>
          </tr>`;
        }).join('');

        toast(`Backtest done: ${Fmt.pct(r.totalReturn)} over 30 days, ${r.trades} trades.`);
      } catch (err) {
        toast('Backtest failed: ' + err.message, true);
      }
      btn.disabled = false;
      btn.textContent = 'Run 30-day backtest';
    }, 60);
  });
}

/* ============================ main loops ============================ */
function renderAll() {
  renderDashboard();
  drawEquity();
  updateWatchlistPrices();
  renderOrderPanel();
  drawPriceChart();
  renderAgent();
}

/* Every second: move the market, check the agent's stop-losses, refresh. */
function onTick() {
  market.tick();
  Agent.checkStops(market);
  Trading.recordEquity(Trading.equity(priceOf));
  Trading.save();
  renderDashboard();
  drawEquity();
  updateWatchlistPrices();
  renderOrderPanel();
  drawPriceChart();
  /* Stats refresh every tick; the feed rebuilds only when new lines arrive
   * (so the user's scroll position in the feed is never disturbed). */
  renderAgentStats();
  if (Agent.feedItems.length !== lastFeedCount) renderAgentFeed();
}

/* ============================ boot ============================ */
document.addEventListener('DOMContentLoaded', () => {
  market = new Market();
  Trading.init();
  Agent.init();

  if (Trading.equityCurve.length === 0) {
    Trading.recordEquity(Trading.equity(priceOf));
  }
  if (Trading.equityCurve.length < 2) {
    /* Two points minimum so the equity chart draws on first paint. */
    Trading.recordEquity(Trading.equity(priceOf));
  }

  initTabs();
  initOrders();
  initChartHover();
  initAgentControls();
  initBacktest();

  renderWatchlist();
  selectAsset('BTC');
  renderAll();

  Agent.feed('🤖 FiNALLY agent online — scanning BTC, ETH, SOL, AAPL, TSLA and EURUSD every 15 seconds.', 'info');
  Agent.feed('My playbook: SMA(20)/SMA(50) trend + RSI(14) + 5-candle momentum. Toggle auto-trade to let me trade.', 'info');
  renderAgent();

  setInterval(onTick, 1000);
  setInterval(() => Agent.scan(market, { renderAgent, renderAll }), 15000);
});
