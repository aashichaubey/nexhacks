import WebSocket from "ws";

// @ts-ignore - process is available at runtime
const hubUrl = process.env.WS_HUB_URL ?? "ws://127.0.0.1:8788";
// @ts-ignore
const ESPN_BASE = process.env.ESPN_BASE ?? "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
// @ts-ignore
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1/models";
const GEMINI_MODEL = "gemini-1.5-flash";

const POLL_INTERVAL_MS = 30000; // Poll ESPN every 30 seconds
let ws: WebSocket | null = null;
let reconnectTimer: any = null;
let pollTimer: any = null;
let lastPolledAt = 0;
let trackedGames = new Map<string, any>();

function connectHub() {
  ws = new WebSocket(hubUrl);

  ws.on("open", () => {
    console.log(`[gemini-worker] connected to ${hubUrl}`);
    startPolling();
  });

  ws.on("close", () => {
    console.log("[gemini-worker] disconnected from ws hub");
    stopPolling();
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    console.error("[gemini-worker] ws error", err);
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

function startPolling() {
  if (pollTimer) {
    return;
  }
  console.log("[gemini-worker] 🔄 Starting ESPN data polling...");
  pollEspnData();
  pollTimer = setInterval(pollEspnData, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function pollEspnData() {
  try {
    console.log("[gemini-worker] 📊 Polling ESPN for live games and updates...");
    
    // Fetch current week's schedule to find live games
    const liveGames = await fetchLiveGames();
    
    // Signal generation disabled - just tracking games for now
    for (const game of liveGames) {
      const gameId = game.id;
      
      // Update tracked state
      trackedGames.set(gameId, {
        ...game,
        lastChecked: Date.now()
      });
    }
    
    lastPolledAt = Date.now();
  } catch (err) {
    console.error("[gemini-worker] failed to poll ESPN data", err);
  }
}

async function fetchLiveGames() {
  try {
    // Try to get current week's schedule
    const res = await fetch(`${ESPN_BASE}/scoreboard`);
    if (!res.ok) {
      console.warn(`[gemini-worker] ESPN scoreboard error ${res.status}`);
      return [];
    }
    
    const data = await res.json();
    const events = data?.events ?? data?.items ?? [];
    
    // Filter for live or upcoming games
    const liveGames = events
      .map((event: any) => {
        const competition = event?.competitions?.[0];
        if (!competition) return null;
        
        const competitors = competition.competitors ?? [];
        const home = competitors.find((c: any) => c.homeAway === "home") ?? competitors[0];
        const away = competitors.find((c: any) => c.homeAway === "away") ?? competitors[1];
        
        if (!home?.team?.id || !away?.team?.id) return null;
        
        const status = competition.status?.type ?? {};
        const isLive = status.id === "1" || status.id === "2" || status.completed === false;
        
        return {
          id: String(event.id ?? competition.id ?? ""),
          date: event.date ?? competition.date ?? "",
          isLive,
          status: status.description ?? status.detail ?? "",
          home: {
            id: String(home.team.id),
            name: home.team.shortDisplayName ?? home.team.displayName ?? "",
            abbreviation: home.team.abbreviation ?? "",
            score: parseScore(home.score),
            record: home.team.record?.items?.[0]?.summary ?? ""
          },
          away: {
            id: String(away.team.id),
            name: away.team.shortDisplayName ?? away.team.displayName ?? "",
            abbreviation: away.team.abbreviation ?? "",
            score: parseScore(away.score),
            record: away.team.record?.items?.[0]?.summary ?? ""
          }
        };
      })
      .filter((game: any) => game !== null && (game.isLive || isGameRecent(game.date)));
    
    return liveGames;
  } catch (err) {
    console.error("[gemini-worker] failed to fetch live games", err);
    return [];
  }
}

function isGameRecent(dateStr: string): boolean {
  if (!dateStr) return false;
  const gameDate = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - gameDate.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  // Consider games from last 3 hours
  return diffHours >= -1 && diffHours <= 3;
}

function parseScore(value: any): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}


connectHub();
