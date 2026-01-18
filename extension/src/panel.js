import { renderPayoffCurve } from "./tinychart.js";

const signalList = document.getElementById("signal-list");
const marketList = document.getElementById("market-list");
const wsStatus = document.getElementById("ws-status");
const refreshBtn = document.getElementById("refresh");
const contextTitle = document.getElementById("context-title");
const contextSub = document.getElementById("context-sub");
const contextTag = document.getElementById("context-tag");
const nflSummary = document.getElementById("nfl-summary");
const nflList = document.getElementById("nfl-list");
const nflSource = document.getElementById("nfl-source");
const liveFeedList = document.getElementById("live-feed-list");
const payoffChart = document.getElementById("payoff-chart");
const payoffLabel = document.getElementById("payoff-label");

const port = chrome.runtime.connect();

const state = {
  signals: [],
  markets: [],
  transcripts: [],
  nfl: null
};

function renderLiveFeed() {
  liveFeedList.innerHTML = "";
  for (const item of state.transcripts) {
    const li = document.createElement("li");
    li.className = "feed-item";
    li.innerHTML = `
      <div>${item.transcript}</div>
      <div class="feed-meta">
        <span>${Math.round(item.sttConfidence * 100)}% STT</span>
        <span>${new Date(item.windowEnd).toLocaleTimeString()}</span>
      </div>
    `;
    liveFeedList.appendChild(li);
  }
}

function renderSignals() {
  signalList.innerHTML = "";
  for (const signal of state.signals) {
    const li = document.createElement("li");
    li.className = "signal-item";
    li.innerHTML = `
      <div><strong>${signal.signalType}</strong> · ${signal.entity}</div>
      <div>${signal.explanation ?? "No explanation"}</div>
      <div class="signal-meta">
        <span>${signal.polarity.replace("_", " ")}</span>
        <span>${Math.round(signal.confidence * 100)}% conf</span>
      </div>
    `;
    signalList.appendChild(li);
  }
}

function renderNflInsight() {
  nflList.innerHTML = "";
  if (!state.nfl) {
    nflSummary.textContent = "No NFL matchup detected yet.";
    nflSource.textContent = "Awaiting context";
    return;
  }
  const insight = state.nfl;
  const [teamA, teamB] = insight.teams ?? [];
  if (!teamA || !teamB) {
    nflSummary.textContent = "Unable to resolve teams from the query.";
    nflSource.textContent = insight.source ?? "ESPN";
    return;
  }
  nflSource.textContent = `${insight.source ?? "ESPN"} · ${new Date(
    insight.generatedAt
  ).toLocaleTimeString()}`;
  nflSummary.textContent = `${teamA.name} vs ${teamB.name}`;
  const recentA = insight.recent?.[teamA.abbreviation] ?? {};
  const recentB = insight.recent?.[teamB.abbreviation] ?? {};
  const headToHead = insight.headToHead ?? {};
  const lean = insight.lean ?? {};

  const items = [
    `${teamA.abbreviation} recent: ${recentA.wins ?? 0}-${recentA.losses ?? 0} (avg diff ${recentA.avgPointDiff ?? 0})`,
    `${teamB.abbreviation} recent: ${recentB.wins ?? 0}-${recentB.losses ?? 0} (avg diff ${recentB.avgPointDiff ?? 0})`,
    `Head-to-head: ${teamA.abbreviation} ${headToHead[teamA.abbreviation] ?? 0} - ${teamB.abbreviation} ${headToHead[teamB.abbreviation] ?? 0}`,
    `Lean: ${lean.team ?? "Too close"} (${Math.round((lean.confidence ?? 0) * 100)}% confidence)`
  ];

  if (headToHead.lastMeeting) {
    items.push(
      `Last meeting: ${headToHead.lastMeeting.winner} ${headToHead.lastMeeting.score}`
    );
  }

  for (const text of items) {
    const li = document.createElement("li");
    li.className = "nfl-item";
    li.textContent = text;
    nflList.appendChild(li);
  }
}

function renderMarkets() {
  marketList.innerHTML = "";
  for (const market of state.markets) {
    const card = document.createElement("div");
    card.className = "market-card";
    const volumeUsd = Number(market.volumeUsd ?? 0);
    const liquidityUsd = Number(market.liquidityUsd ?? 0);
    card.innerHTML = `
      <div class="pill">${Math.round(market.probability * 100)}% prob</div>
      <h3>${market.title}</h3>
      <div class="market-stats">
        <div>Vol $${volumeUsd.toLocaleString()}</div>
        <div>Liq $${liquidityUsd.toLocaleString()}</div>
        <div>${market.timeRemainingMinutes}m left</div>
      </div>
      <a href="${market.url}" target="_blank" rel="noreferrer">Open on Polymarket</a>
    `;
    marketList.appendChild(card);
  }
}

function buildPayoffSeries(probability) {
  const points = [];
  const base = 1 - probability;
  for (let i = 0; i <= 20; i += 1) {
    const t = i / 20;
    const y = Math.max(0.05, base + probability * Math.sin(t * Math.PI));
    points.push({ x: t, y });
  }
  return points;
}

function renderPayoff(markets) {
  const primary = markets[0];
  if (!primary) {
    payoffLabel.textContent = "No market yet";
    renderPayoffCurve(payoffChart, buildPayoffSeries(0.5), {
      lineColor: "#3cf2c3",
      label: "Waiting for market..."
    });
    return;
  }
  payoffLabel.textContent = `${Math.round(primary.probability * 100)}% implied`;
  renderPayoffCurve(payoffChart, buildPayoffSeries(primary.probability), {
    lineColor: "#ff8a2b",
    label: primary.title.slice(0, 28)
  });
}

function renderContext(context) {
  if (!context) {
    contextTitle.textContent = "No live context detected yet.";
    contextSub.textContent = "Open a live game, news stream, or search.";
    contextTag.textContent = "Idle";
    return;
  }
  const title = context.title || context.query || context.url;
  const keywordText = (context.keywords ?? []).slice(0, 6).join(" · ");
  contextTitle.textContent = title;
  contextSub.textContent = keywordText || context.url;
  if (context.source === "youtube") {
    contextTag.textContent = context.isLiveHint
      ? "Live stream detected"
      : "YouTube detected";
    return;
  }
  contextTag.textContent = context.query ? "Search detected" : "Live browsing";
}

function applySnapshot(snapshot) {
  state.signals = snapshot.signals ?? [];
  state.markets = (snapshot.markets ?? []).slice(0, 4);
  state.transcripts = snapshot.transcripts ?? [];
  state.nfl = snapshot.nfl ?? state.nfl;
  if (snapshot.wsStatus) {
    wsStatus.textContent = snapshot.wsStatus;
  }
  renderContext(snapshot.context ?? null);
  renderSignals();
  renderNflInsight();
  renderMarkets();
  renderLiveFeed();
  renderPayoff(state.markets);
}

port.onMessage.addListener((message) => {
  if (message.type === "snapshot") {
    applySnapshot(message.payload);
  }
  if (message.type === "signal") {
    state.signals = [message.payload, ...state.signals].slice(0, 10);
    renderSignals();
  }
  if (message.type === "transcript") {
    state.transcripts = [message.payload, ...state.transcripts].slice(0, 12);
    renderLiveFeed();
  }
  if (message.type === "market") {
    state.markets = [message.payload, ...state.markets].slice(0, 4);
    renderMarkets();
    renderPayoff(state.markets);
  }
  if (message.type === "markets_refresh") {
    state.markets = message.payload.slice(0, 4);
    renderMarkets();
    renderPayoff(state.markets);
  }
  if (message.type === "context") {
    renderContext(message.payload);
  }
  if (message.type === "nfl_insight") {
    state.nfl = message.payload;
    renderNflInsight();
  }
  if (message.type === "ws_status") {
    wsStatus.textContent = message.payload;
  }
});

refreshBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "request_snapshot" }, (response) => {
    if (response?.ok) {
      applySnapshot(response.payload);
    }
  });
});
