import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import type { Envelope, MarketCandidate, Signal } from "@nexhacks/shared";

type GammaMarket = {
  id?: string;
  slug?: string;
  question?: string;
  description?: string;
  url?: string;
  outcomes?: string[];
  outcomePrices?: string[];
  liquidity?: number;
  volume?: number;
  endDate?: string;
  endTime?: string;
  closed?: boolean;
  active?: boolean;
};

const hubUrl = process.env.WS_HUB_URL ?? "ws://127.0.0.1:8788";
const gammaBase =
  process.env.POLYMARKET_GAMMA_BASE ?? "https://gamma-api.polymarket.com";
let ws: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

const REQUEST_TIMEOUT_MS = 3500;

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function buildQuery(signal: Signal): string {
  const parts = [signal.entity, signal.signalType]
    .map((p) => p?.trim())
    .filter(Boolean);
  return parts.join(" ");
}

function parseProbability(market: GammaMarket): number {
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
  if (Number.isNaN(price)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, price));
}

function parseTimeRemainingMinutes(market: GammaMarket): number {
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

function scoreMarket(market: GammaMarket, query: string): number {
  const text = `${market.question ?? ""} ${market.description ?? ""}`.toLowerCase();
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matched = tokens.filter((token) => text.includes(token)).length;
  const semanticScore = tokens.length > 0 ? matched / tokens.length : 0.2;

  const liquidity = market.liquidity ?? 0;
  const volume = market.volume ?? 0;
  const timeRemaining = parseTimeRemainingMinutes(market);

  const liquidityScore = Math.min(1, Math.log10(liquidity + 1) / 6);
  const volumeScore = Math.min(1, Math.log10(volume + 1) / 7);
  const timeScore = timeRemaining > 0 ? Math.min(1, timeRemaining / 240) : 0;

  return (
    semanticScore * 0.5 +
    liquidityScore * 0.2 +
    volumeScore * 0.2 +
    timeScore * 0.1
  );
}

async function searchMarkets(signal: Signal): Promise<MarketCandidate[]> {
  const query = buildQuery(signal);
  if (!query) {
    return [];
  }

  const url = new URL(`${gammaBase}/markets`);
  url.searchParams.set("search", query);
  url.searchParams.set("active", "true");
  url.searchParams.set("closed", "false");
  url.searchParams.set("limit", "12");

  const markets = await fetchJson<GammaMarket[]>(url.toString());
  const scored = markets
    .filter((market) => market.active !== false && market.closed !== true)
    .map((market) => ({ market, score: scoreMarket(market, query) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return scored.map(({ market }) => {
    const probability = parseProbability(market);
    return {
      id: market.id ?? uuidv4(),
      title: market.question ?? market.slug ?? "Polymarket market",
      url: market.url ?? "https://polymarket.com",
      probability,
      volumeUsd: market.volume ?? 0,
      liquidityUsd: market.liquidity ?? 0,
      timeRemainingMinutes: parseTimeRemainingMinutes(market),
      matchedSignals: [signal.id],
      ts: new Date().toISOString()
    };
  });
}

function connectHub() {
  ws = new WebSocket(hubUrl);

  ws.on("open", () => {
    console.log(`[market-matcher] connected to ${hubUrl}`);
  });

  ws.on("message", async (data) => {
    try {
      const envelope = JSON.parse(data.toString()) as Envelope<Signal>;
      if (envelope.type !== "signal") {
        return;
      }

      const signal = envelope.payload;
      console.log(`[market-matcher] 📊 Searching markets for: ${signal.signalType} - ${signal.entity}`);
      
      const markets = await searchMarkets(envelope.payload);
      console.log(`[market-matcher] ✅ Found ${markets.length} matching markets`);
      
      for (const market of markets) {
        const out: Envelope<MarketCandidate> = {
          type: "market",
          payload: market,
          ts: new Date().toISOString()
        };
        ws?.send(JSON.stringify(out));
        console.log(`[market-matcher]   📈 ${market.title} (prob: ${(market.probability * 100).toFixed(0)}%)`);
      }
    } catch (err) {
      console.error("[market-matcher] failed to handle signal", err);
    }
  });

  ws.on("close", () => {
    console.log("[market-matcher] disconnected from ws hub");
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    console.error("[market-matcher] ws error", err);
    ws?.close();
  });
}

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectHub();
  }, 1000);
}

connectHub();
