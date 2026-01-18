const HUB_URL = "ws://127.0.0.1:8788";
const POLYMARKET_BASE = "https://polymarket.com";
const GAMMA_BASE = "https://gamma-api.polymarket.com";
let ws;
const state = {
  signals: [],
  markets: [],
  context: null,
  transcripts: [],
  wsStatus: "disconnected",
  wsLastChange: null
};

const ports = new Set();
let searchTimeout;
let marketRefreshTimer;

function connectHub() {
  ws = new WebSocket(HUB_URL);

  ws.addEventListener("open", () => {
    updateWsStatus("connected");
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
        state.markets = [envelope.payload, ...state.markets].slice(0, 4);
        broadcast({ type: "market", payload: envelope.payload });
      }
    } catch (err) {
      console.warn("[extension] failed to parse ws message", err);
    }
  });

  ws.addEventListener("close", () => {
    updateWsStatus("disconnected");
    setTimeout(connectHub, 2000);
  });

  ws.addEventListener("error", () => {
    updateWsStatus("error");
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
  hydrateContextFromActiveTab();
  port.onDisconnect.addListener(() => ports.delete(port));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "request_snapshot") {
    sendResponse({ ok: true, payload: state });
  }
  if (message?.type === "request_context") {
    hydrateContextFromActiveTab().then(() => {
      sendResponse({ ok: true, payload: state.context });
    });
    return true;
  }
  if (message?.type === "page_context") {
    console.log("[extension][debug] page_context received", message.payload);
    state.context = message.payload;
    chrome.storage.local.set({ lastPageContext: message.payload });
    broadcast({ type: "context", payload: message.payload });
    queueMarketSearch(message.payload);
    scheduleMarketRefresh();
    sendResponse({ ok: true });
  }
});

connectHub();

function updateWsStatus(status) {
  state.wsStatus = status;
  state.wsLastChange = new Date().toISOString();
  broadcast({ type: "ws_status", payload: status });
}

async function hydrateContextFromActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    if (!tab?.url) {
      return;
    }
    const context = buildContextFromTab(tab);
    state.context = context;
    broadcast({ type: "context", payload: context });
    queueMarketSearch(context);
  } catch (err) {
    console.warn("[extension] failed to read active tab", err);
  }
}

function buildContextFromTab(tab) {
  let query = "";
  let source = "web";
  let isLiveHint = false;
  const title = tab.title ?? "";
  try {
    const url = new URL(tab.url);
    const isGoogleSearch =
      url.hostname.includes("google.") && url.pathname === "/search";
    const isYouTubeWatch =
      url.hostname.includes("youtube.com") && url.pathname === "/watch";
    if (isGoogleSearch) {
      query = url.searchParams.get("q") ?? "";
      source = "google_search";
    } else if (isYouTubeWatch) {
      source = "youtube";
    }
    isLiveHint = /\\blive\\b/i.test(title);
  } catch {
    // ignore url parse
  }

  const keywords = [title, query]
    .join(" ")
    .split(/\\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 25);

  return {
    url: tab.url ?? "",
    title,
    keywords,
    query,
    source,
    isLiveHint,
    timestamp: new Date().toISOString()
  };
}

function queueMarketSearch(context) {
  if (!context) {
    return;
  }
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    const queries = buildSearchQueries(context);
    console.log("[extension][debug] market queries", queries);
    if (queries.length === 0) {
      return;
    }
    Promise.all(queries.map((query) => searchPolymarket(query)))
      .then((results) => {
        const merged = dedupeMarkets(results.flat());
        console.log("[extension][debug] market results", merged);
        state.markets = merged.concat(state.markets).slice(0, 4);
        broadcast({ type: "markets_refresh", payload: merged });
        scheduleMarketRefresh();
      })
      .catch((err) => {
        console.warn("[extension] polymarket search failed", err);
      });
  }, 800);
}

function buildSearchQueries(context) {
  const queries = new Set();
  if (context.source === "google_search" && context.query) {
    const cleaned = cleanSearchQuery(context.query);
    if (cleaned) {
      queries.add(cleaned);
      for (const variant of buildQueryVariants(cleaned)) {
        queries.add(variant);
      }
    }
    return Array.from(queries).filter((q) => q.length > 2);
  }

  const keywords = (context.keywords ?? []).slice(0, 8).join(" ");
  if (keywords) {
    queries.add(keywords);
  }

  return Array.from(queries).filter((q) => q.length > 2);
}

function normalizeTitle(title) {
  if (!title) {
    return "";
  }
  return title
    .replace(/\\|\\s*NBA\\.com/i, "")
    .replace(/\\s+\\|\\s+/g, " ")
    .trim();
}

function cleanSearchQuery(query) {
  const stripped = query
    .toLowerCase()
    .replace(/\b(score|scores|today|live|highlights|stats|stream)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped;
}

function buildQueryVariants(query) {
  const variants = new Set();
  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    return [];
  }
  variants.add(tokens.join(" "));
  variants.add(`${tokens.join(" ")} nba`);
  variants.add(`${tokens.join(" ")} nfl`);
  variants.add(`${tokens.join(" ")} mlb`);
  variants.add(`${tokens.join(" ")} nhl`);
  if (tokens.includes("vs")) {
    const withoutVs = tokens.filter((token) => token !== "vs");
    if (withoutVs.length >= 2) {
      variants.add(withoutVs.join(" "));
      variants.add(`${withoutVs.join(" ")} nba`);
      variants.add(`${withoutVs.join(" ")} nfl`);
      variants.add(`${withoutVs.join(" ")} mlb`);
      variants.add(`${withoutVs.join(" ")} nhl`);
    }
  }
  return Array.from(variants);
}

async function searchPolymarket(query) {
  try {
    const web = await searchPolymarketWeb(query);
    if (web.length > 0) {
      return web;
    }
  } catch (err) {
    console.warn("[extension] polymarket web search failed", err);
  }
  return searchPolymarketGamma(query);
}

async function searchPolymarketWeb(query) {
  const url = new URL(`${POLYMARKET_BASE}/api/search`);
  url.searchParams.set("query", query);

  const res = await fetch(url.toString());
  if (!res.ok) {
    return [];
  }
  const data = await res.json();
  const markets = Array.isArray(data)
    ? data
    : Array.isArray(data?.markets)
      ? data.markets
      : Array.isArray(data?.results)
        ? data.results
        : [];

  return markets.map((market) => ({
    id: market.id ?? market.slug ?? query,
    slug: market.slug,
    title:
      market.question ??
      market.title ??
      market.name ??
      market.slug ??
      "Polymarket market",
    url:
      market.url ??
      (market.slug ? `${POLYMARKET_BASE}/market/${market.slug}` : POLYMARKET_BASE),
    probability: Number(market.probability ?? market.lastPrice ?? 0.5),
    volumeUsd: Number(market.volume ?? market.volumeUsd ?? 0),
    liquidityUsd: Number(market.liquidity ?? market.liquidityUsd ?? 0),
    timeRemainingMinutes: 0,
    matchedSignals: [],
    ts: new Date().toISOString()
  }));
}

async function searchPolymarketGamma(query) {
  const url = new URL(`${GAMMA_BASE}/markets`);
  url.searchParams.set("search", query);
  url.searchParams.set("active", "true");
  url.searchParams.set("closed", "false");
  url.searchParams.set("limit", "50");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Gamma error ${res.status}`);
  }
  const markets = await res.json();
  console.log("[extension][debug] gamma response size", markets?.length ?? 0);
  const queryTokens = normalizeQueryTokens(query);
  const scored = markets
    .map((market) => ({ market, score: scoreMarketMatch(queryTokens, market) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.map(({ market }) => ({
    id: market.id ?? market.slug ?? query,
    slug: market.slug,
    title: market.question ?? market.slug ?? "Polymarket market",
    url:
      market.url ??
      (market.slug ? `${POLYMARKET_BASE}/market/${market.slug}` : POLYMARKET_BASE),
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
  const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
  const prices = Array.isArray(market.outcomePrices) ? market.outcomePrices : [];
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

function normalizeQueryTokens(query) {
  const stopwords = new Set([
    "the",
    "and",
    "or",
    "vs",
    "v",
    "score",
    "scores",
    "game",
    "games",
    "live",
    "highlights"
  ]);
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !stopwords.has(token));
}

function scoreMarketMatch(queryTokens, market) {
  if (queryTokens.length === 0) {
    return 1;
  }
  const haystack =
    `${market.question ?? ""} ${market.slug ?? ""} ${market.description ?? ""}`.toLowerCase();
  return queryTokens.filter((token) => haystack.includes(token)).length;
}

function scheduleMarketRefresh() {
  if (marketRefreshTimer) {
    return;
  }
  marketRefreshTimer = setInterval(() => {
    if (state.markets.length === 0) {
      clearInterval(marketRefreshTimer);
      marketRefreshTimer = null;
      return;
    }
    refreshMarketSnapshots().catch((err) => {
      console.warn("[extension] market refresh failed", err);
    });
  }, 20000);
}

async function refreshMarketSnapshots() {
  const updates = await Promise.all(
    state.markets.map((market) => refreshMarketSnapshot(market))
  );
  const refreshed = updates.filter(Boolean);
  if (refreshed.length === 0) {
    return;
  }
  const merged = dedupeMarkets(refreshed.concat(state.markets));
  state.markets = merged.slice(0, 4);
  broadcast({ type: "markets_refresh", payload: state.markets });
}

async function refreshMarketSnapshot(market) {
  const snapshot = await fetchGammaMarket(market);
  if (!snapshot) {
    return null;
  }
  return {
    ...market,
    probability: parseProbability(snapshot),
    volumeUsd: snapshot.volume ?? market.volumeUsd ?? 0,
    liquidityUsd: snapshot.liquidity ?? market.liquidityUsd ?? 0,
    timeRemainingMinutes: parseTimeRemainingMinutes(snapshot),
    url:
      snapshot.url ??
      (snapshot.slug ? `${POLYMARKET_BASE}/market/${snapshot.slug}` : market.url),
    slug: snapshot.slug ?? market.slug
  };
}

async function fetchGammaMarket(market) {
  const byId = market.id ? await fetchGammaById(market.id) : null;
  if (byId) {
    return byId;
  }
  if (market.slug) {
    const bySlug = await fetchGammaBySlug(market.slug);
    if (bySlug) {
      return bySlug;
    }
  }
  return null;
}

async function fetchGammaById(id) {
  try {
    const res = await fetch(`${GAMMA_BASE}/markets/${encodeURIComponent(id)}`);
    if (!res.ok) {
      return null;
    }
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchGammaBySlug(slug) {
  try {
    const url = new URL(`${GAMMA_BASE}/markets`);
    url.searchParams.set("slug", slug);
    const res = await fetch(url.toString());
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    if (Array.isArray(data)) {
      return data[0] ?? null;
    }
    return data ?? null;
  } catch {
    return null;
  }
}
