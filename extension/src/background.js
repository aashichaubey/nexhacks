const HUB_URL = "ws://localhost:8787";
const GAMMA_BASE =
  "https://gamma-api.polymarket.com";
let ws;
const state = {
  signals: [],
  markets: [],
  context: null,
  transcripts: []
};

const ports = new Set();
let searchTimeout;

function connectHub() {
  ws = new WebSocket(HUB_URL);

  ws.addEventListener("open", () => {
    broadcast({ type: "ws_status", payload: "connected" });
  });

  ws.addEventListener("message", (event) => {
    try {
      const envelope = JSON.parse(event.data);
      if (envelope.type === "transcript_packet") {
        state.transcripts = [envelope.payload, ...state.transcripts].slice(0, 12);
        broadcast({ type: "transcript", payload: envelope.payload });
      }
      if (envelope.type === "signal") {
        state.signals = [envelope.payload, ...state.signals].slice(0, 10);
        broadcast({ type: "signal", payload: envelope.payload });
      }
      if (envelope.type === "market") {
        state.markets = [envelope.payload, ...state.markets].slice(0, 8);
        broadcast({ type: "market", payload: envelope.payload });
      }
    } catch (err) {
      console.warn("[extension] failed to parse ws message", err);
    }
  });

  ws.addEventListener("close", () => {
    broadcast({ type: "ws_status", payload: "disconnected" });
    setTimeout(connectHub, 2000);
  });

  ws.addEventListener("error", () => {
    broadcast({ type: "ws_status", payload: "error" });
    ws.close();
  });
}

function broadcast(message) {
  for (const port of ports) {
    port.postMessage(message);
  }
}

chrome.runtime.onConnect.addListener((port) => {
  ports.add(port);
  port.postMessage({ type: "snapshot", payload: state });
  port.onDisconnect.addListener(() => ports.delete(port));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "request_snapshot") {
    sendResponse({ ok: true, payload: state });
  }
  if (message?.type === "page_context") {
    state.context = message.payload;
    chrome.storage.local.set({ lastPageContext: message.payload });
    broadcast({ type: "context", payload: message.payload });
    queueMarketSearch(message.payload);
    sendResponse({ ok: true });
  }
});

connectHub();

function queueMarketSearch(context) {
  if (!context) {
    return;
  }
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    const queries = buildSearchQueries(context);
    if (queries.length === 0) {
      return;
    }
    Promise.all(queries.map((query) => searchPolymarket(query)))
      .then((results) => {
        const merged = dedupeMarkets(results.flat());
        state.markets = merged.concat(state.markets).slice(0, 8);
        broadcast({ type: "markets_refresh", payload: merged });
      })
      .catch((err) => {
        console.warn("[extension] polymarket search failed", err);
      });
  }, 800);
}

function buildSearchQueries(context) {
  const queries = new Set();
  const base = context.query || context.title || "";
  if (base) {
    queries.add(base);
  }
  const keywords = (context.keywords ?? []).slice(0, 8).join(" ");
  if (keywords) {
    queries.add(keywords);
  }

  const match =
    base.match(/([a-zA-Z\\s]+)\\s+vs\\.?\\s+([a-zA-Z\\s]+)/i) ||
    base.match(/([a-zA-Z\\s]+)\\s+v\\.?\\s+([a-zA-Z\\s]+)/i);
  if (match) {
    const teamA = match[1].trim();
    const teamB = match[2].trim();
    const headToHead = `${teamA} ${teamB}`;
    queries.add(`${headToHead} moneyline`);
    queries.add(`${headToHead} spread`);
    queries.add(`${headToHead} total`);
  }

  return Array.from(queries).filter((q) => q.length > 2);
}

async function searchPolymarket(query) {
  const url = new URL(`${GAMMA_BASE}/markets`);
  url.searchParams.set("search", query);
  url.searchParams.set("active", "true");
  url.searchParams.set("closed", "false");
  url.searchParams.set("limit", "6");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Gamma error ${res.status}`);
  }
  const markets = await res.json();
  return markets.map((market) => ({
    id: market.id ?? market.slug ?? query,
    title: market.question ?? market.slug ?? "Polymarket market",
    url: market.url ?? "https://polymarket.com",
    probability: parseProbability(market),
    volumeUsd: market.volume ?? 0,
    liquidityUsd: market.liquidity ?? 0,
    timeRemainingMinutes: parseTimeRemainingMinutes(market),
    matchedSignals: [],
    ts: new Date().toISOString()
  }));
}

function dedupeMarkets(markets) {
  const map = new Map();
  for (const market of markets) {
    const key = market.id || market.title;
    if (!map.has(key)) {
      map.set(key, market);
    }
  }
  return Array.from(map.values());
}

function parseProbability(market) {
  const outcomes = market.outcomes ?? [];
  const prices = market.outcomePrices ?? [];
  if (outcomes.length === 0 || prices.length === 0) {
    return 0.5;
  }
  const yesIndex = outcomes.findIndex(
    (outcome) => outcome.toLowerCase() === "yes"
  );
  const index = yesIndex >= 0 ? yesIndex : 0;
  const price = Number(prices[index]);
  return Number.isNaN(price) ? 0.5 : Math.min(1, Math.max(0, price));
}

function parseTimeRemainingMinutes(market) {
  const end = market.endDate ?? market.endTime;
  if (!end) {
    return 0;
  }
  const endMs = Date.parse(end);
  if (Number.isNaN(endMs)) {
    return 0;
  }
  return Math.max(0, Math.round((endMs - Date.now()) / 60000));
}
