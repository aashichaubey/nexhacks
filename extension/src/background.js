const HUB_URL = "ws://127.0.0.1:8788";
const POLYMARKET_BASE = "https://polymarket.com";
const GAMMA_BASE = "https://gamma-api.polymarket.com";
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const ESPN_SCOREBOARD = `${ESPN_BASE}/scoreboard`;
const GEMINI_MODEL = "gemini-1.5-flash";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1/models";
let ws;
const state = {
  markets: [],
  nfl: null,
  context: null,
  transcripts: [],
  wsStatus: "disconnected",
  wsLastChange: null
};
let lastPopupQuery = "";
let lastPopupAt = 0;
let lastNflQuery = "";
let lastNflAt = 0;

const ports = new Set();
let searchTimeout;
let marketRefreshTimer;
let nflSearchTimeout;
let nflTeamsCache = null;
let nflTeamsCachedAt = 0;
const NFL_TEAMS_TTL_MS = 24 * 60 * 60 * 1000;
let geminiApiKey = "";

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

function sendToHub(type, payload) {
  if (!ws || ws.readyState !== ws.OPEN) {
    return;
  }
  const envelope = {
    type,
    payload,
    ts: new Date().toISOString()
  };
  ws.send(JSON.stringify(envelope));
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
    queueNflSearch(message.payload);
    scheduleMarketRefresh();
    sendResponse({ ok: true });
  }
  if (message?.type === "open_popup") {
    console.log("[extension][debug] open_popup requested", message.payload);
    maybeOpenPopup(message.payload?.query);
    sendResponse({ ok: true });
  }
});

connectHub();
hydrateNflFromStorage();
hydrateGeminiKey();

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
    queueNflSearch(context);
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
        return enrichMarketsWithGamma(merged);
      })
      .then((enriched) => {
        const markets = enriched ?? [];
        state.markets = markets.concat(state.markets).slice(0, 4);
        broadcast({ type: "markets_refresh", payload: markets });
        scheduleMarketRefresh();
      })
      .catch((err) => {
        console.warn("[extension] polymarket search failed", err);
      });
  }, 800);
}

function queueNflSearch(context) {
  if (!context) {
    return;
  }
  clearTimeout(nflSearchTimeout);
  nflSearchTimeout = setTimeout(() => {
    const query = buildNflQuery(context);
    if (!query) {
      return;
    }
    const now = Date.now();
    if (query === lastNflQuery && now - lastNflAt < 120000) {
      return;
    }
    lastNflQuery = query;
    lastNflAt = now;
    fetchNflInsight(query)
      .then((insight) => {
        if (!insight) {
          state.nfl = null;
          chrome.storage.local.remove("lastNflInsight");
          broadcast({ type: "nfl_insight", payload: null });
          return;
        }
        state.nfl = insight;
        chrome.storage.local.set({ lastNflInsight: insight });
        broadcast({ type: "nfl_insight", payload: insight });
        sendToHub("nfl_insight", insight);
      })
      .catch((err) => {
        console.warn("[extension] nfl insight fetch failed", err);
      });
  }, 700);
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

function buildNflQuery(context) {
  const query = (context.query ?? "").trim();
  if (query && looksLikeNflQuery(query)) {
    return query;
  }
  const keywords = (context.keywords ?? []).slice(0, 8).join(" ").trim();
  if (keywords && looksLikeNflQuery(keywords)) {
    return keywords;
  }
  if (query) {
    return query;
  }
  if (keywords) {
    return keywords;
  }
  return "";
}

function looksLikeNflQuery(text) {
  const lowered = text.toLowerCase();
  if (/\bnfl\b/.test(lowered) || /\bfootball\b/.test(lowered)) {
    return true;
  }
  return /\b(vs|v|at)\b/.test(lowered);
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

function maybeOpenPopup(query) {
  const now = Date.now();
  if (query && query === lastPopupQuery && now - lastPopupAt < 120000) {
    console.log("[extension][debug] open_popup skipped (cooldown)");
    return;
  }
  lastPopupQuery = query ?? "";
  lastPopupAt = now;
  if (chrome.action?.openPopup) {
    chrome.action.openPopup().catch(() => {
      console.log("[extension][debug] openPopup blocked, opening window");
      openPopupWindow();
    });
    return;
  }
  console.log("[extension][debug] openPopup unavailable, opening window");
  openPopupWindow();
}

function openPopupWindow() {
  const url = chrome.runtime.getURL("src/panel.html");
  chrome.windows.create(
    { url, type: "popup", width: 420, height: 640, focused: true },
    () => {
      if (chrome.runtime.lastError) {
        console.warn("[extension] failed to open popup window", chrome.runtime.lastError.message);
      }
    }
  );
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

function hydrateNflFromStorage() {
  chrome.storage.local.get("lastNflInsight", (result) => {
    if (result?.lastNflInsight) {
      state.nfl = result.lastNflInsight;
      broadcast({ type: "nfl_insight", payload: result.lastNflInsight });
    }
  });
}

function hydrateGeminiKey() {
  chrome.storage.local.get("geminiApiKey", (result) => {
    if (result?.geminiApiKey) {
      geminiApiKey = result.geminiApiKey;
    }
  });
}

async function fetchNflInsight(query) {
  const teams = await loadNflTeams();
  const matched = findTeamsFromQuery(query, teams);
  if (matched.length < 2) {
    return null;
  }
  const [teamA, teamB] = matched;
  const [scheduleA, scheduleB, scoreboard, statsA, statsB] = await Promise.all([
    fetchTeamSchedule(teamA.id),
    fetchTeamSchedule(teamB.id),
    fetchScoreboard(),
    fetchTeamStats(teamA.id),
    fetchTeamStats(teamB.id)
  ]);
  const gamesA = extractGamesFromSchedule(scheduleA);
  const gamesB = extractGamesFromSchedule(scheduleB);
  const scoreboardGames = extractGamesFromScoreboard(scoreboard);
  const headToHead = gamesA.filter(
    (game) =>
      game.isFinal &&
      hasValidScores(game) &&
      ((game.home.id === teamA.id && game.away.id === teamB.id) ||
        (game.home.id === teamB.id && game.away.id === teamA.id))
  );
  const recentA = summarizeRecentGames(
    mergeRecentGames(gamesA, scoreboardGames, teamA.id),
    teamA.id,
    5
  );
  const recentB = summarizeRecentGames(
    mergeRecentGames(gamesB, scoreboardGames, teamB.id),
    teamB.id,
    5
  );
  const h2hSummary = summarizeHeadToHead(headToHead, teamA, teamB);
  const lean = buildLeanSummary(teamA, teamB, recentA, recentB, h2hSummary);
  const gemini = await fetchGeminiSummary(query, teamA, teamB, recentA, recentB, h2hSummary);
  return {
    query,
    generatedAt: new Date().toISOString(),
    source: "ESPN",
    teams: [teamA, teamB],
    recent: {
      [teamA.abbreviation]: recentA,
      [teamB.abbreviation]: recentB
    },
    teamStats: {
      [teamA.abbreviation]: statsA,
      [teamB.abbreviation]: statsB
    },
    headToHead: h2hSummary,
    lean,
    gemini
  };
}

async function fetchGeminiSummary(query, teamA, teamB, recentA, recentB, headToHead) {
  const apiKey = geminiApiKey?.trim();
  if (!apiKey) {
    return null;
  }
  const prompt = [
    "You are a sports analyst. Summarize historical and current matchup context using the data provided.",
    "Return JSON with keys: summary, keyFactors, caution.",
    "",
    `Query: ${query}`,
    `Teams: ${teamA.name} (${teamA.abbreviation}) vs ${teamB.name} (${teamB.abbreviation})`,
    `Recent ${teamA.abbreviation}: ${recentA.wins}-${recentA.losses}, avg point diff ${recentA.avgPointDiff}`,
    `Recent ${teamB.abbreviation}: ${recentB.wins}-${recentB.losses}, avg point diff ${recentB.avgPointDiff}`,
    `Head-to-head: ${teamA.abbreviation} ${headToHead[teamA.abbreviation] ?? 0} - ${teamB.abbreviation} ${headToHead[teamB.abbreviation] ?? 0}`,
    `Last meeting: ${headToHead.lastMeeting ? `${headToHead.lastMeeting.winner} ${headToHead.lastMeeting.score}` : "unknown"}`
  ].join("\n");

  const url = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 300
      }
    })
  });
  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    console.warn("[extension] gemini request failed", res.status, errorBody);
    return null;
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) {
    return null;
  }
  const parsed = safeJsonParse(text);
  if (parsed) {
    return { ...parsed, generatedAt: new Date().toISOString() };
  }
  return {
    summary: text.trim(),
    keyFactors: [],
    caution: "Gemini output was not JSON.",
    generatedAt: new Date().toISOString()
  };
}

function safeJsonParse(text) {
  try {
    const trimmed = text.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      return JSON.parse(trimmed);
    }
    return null;
  } catch {
    return null;
  }
}

async function loadNflTeams() {
  const now = Date.now();
  if (nflTeamsCache && now - nflTeamsCachedAt < NFL_TEAMS_TTL_MS) {
    return nflTeamsCache;
  }
  const res = await fetch(`${ESPN_BASE}/teams`);
  if (!res.ok) {
    throw new Error(`ESPN teams error ${res.status}`);
  }
  const data = await res.json();
  const teams = [];
  const entries = data?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  for (const entry of entries) {
    const team = entry?.team ?? {};
    if (!team?.id) {
      continue;
    }
    teams.push({
      id: String(team.id),
      abbreviation: team.abbreviation ?? "",
      name: team.displayName ?? team.name ?? team.shortDisplayName ?? "",
      shortName: team.shortDisplayName ?? team.name ?? team.displayName ?? "",
      location: team.location ?? "",
      slug: team.slug ?? ""
    });
  }
  nflTeamsCache = teams;
  nflTeamsCachedAt = now;
  return teams;
}

function findTeamsFromQuery(query, teams) {
  const normalized = normalizeSearchText(query);
  const lowered = query.toLowerCase();
  const numericTokens = extractNumericTokens(query);
  const scored = teams
    .map((team) => {
      const tokens = buildTeamTokens(team);
      let score = 0;
      for (const token of tokens) {
        if (!token) {
          continue;
        }
        if (token.length <= 3) {
          const regex = new RegExp(`\\b${escapeRegExp(token)}\\b`, "i");
          if (regex.test(lowered)) {
            score += 1;
          }
        } else if (normalized.includes(token)) {
          score += 1;
        }
        if (numericTokens.length > 0 && tokenHasNumericMatch(token, numericTokens)) {
          score += 1;
        }
      }
      return { team, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 2).map((entry) => entry.team);
}

function buildTeamTokens(team) {
  const rawTokens = [
    team.abbreviation,
    team.name,
    team.shortName,
    team.location,
    team.slug
  ]
    .filter(Boolean)
    .map((token) => normalizeSearchText(token))
    .filter(Boolean);
  const tokens = new Set(rawTokens);
  for (const token of rawTokens) {
    const numeric = token.replace(/[^0-9]+/g, "");
    if (numeric) {
      tokens.add(numeric);
    }
    if (token.endsWith("s") && token.length > 3) {
      tokens.add(token.slice(0, -1));
    }
  }
  return Array.from(tokens);
}

function normalizeSearchText(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractNumericTokens(text) {
  return String(text)
    .split(/[^0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

function tokenHasNumericMatch(token, numericTokens) {
  const tokenDigits = token.replace(/[^0-9]+/g, "");
  if (!tokenDigits) {
    return false;
  }
  return numericTokens.includes(tokenDigits);
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fetchTeamSchedule(teamId) {
  const res = await fetch(`${ESPN_BASE}/teams/${teamId}/schedule`);
  if (!res.ok) {
    throw new Error(`ESPN schedule error ${res.status}`);
  }
  return res.json();
}

async function fetchTeamStats(teamId) {
  const res = await fetch(`${ESPN_BASE}/teams/${teamId}/statistics`);
  if (!res.ok) {
    return null;
  }
  const data = await res.json();
  return extractTeamStats(data);
}

function extractTeamStats(data) {
  const stats = Array.isArray(data?.stats) ? data.stats : [];
  const byName = new Map();
  for (const stat of stats) {
    const name = String(stat?.name ?? stat?.displayName ?? "").toLowerCase();
    if (!name) {
      continue;
    }
    const value = Number(stat?.value ?? stat?.displayValue ?? NaN);
    if (Number.isFinite(value)) {
      byName.set(name, value);
    }
  }
  return {
    pointsForPerGame:
      byName.get("pointspergame") ??
      byName.get("pointsforpergame") ??
      byName.get("pointsfor") ??
      null,
    pointsAgainstPerGame:
      byName.get("pointsagainstpergame") ??
      byName.get("pointsagainst") ??
      null,
    yardsPerGame:
      byName.get("totalyardspergame") ??
      byName.get("yardspergame") ??
      null,
    yardsAllowedPerGame:
      byName.get("yardsallowedpergame") ??
      byName.get("yardsallowed") ??
      null
  };
}

async function fetchScoreboard() {
  const res = await fetch(ESPN_SCOREBOARD);
  if (!res.ok) {
    throw new Error(`ESPN scoreboard error ${res.status}`);
  }
  return res.json();
}

function extractGamesFromSchedule(data) {
  const events = Array.isArray(data?.events)
    ? data.events
    : Array.isArray(data?.items)
      ? data.items
      : [];
  return events
    .map((event) => {
      const competition = Array.isArray(event?.competitions)
        ? event.competitions[0]
        : null;
      const competitors = competition?.competitors ?? [];
      const home =
        competitors.find((team) => team.homeAway === "home") ?? competitors[0];
      const away =
        competitors.find((team) => team.homeAway === "away") ?? competitors[1];
      if (!home?.team?.id || !away?.team?.id) {
        return null;
      }
      const status = competition?.status?.type ?? {};
      return {
        id: String(event?.id ?? competition?.id ?? ""),
        date: event?.date ?? competition?.date ?? "",
        isFinal: Boolean(status?.completed),
        week: event?.week?.number ?? event?.week?.text ?? "",
        home: {
          id: String(home.team.id),
          name: home.team.shortDisplayName ?? home.team.displayName ?? "",
          abbreviation: home.team.abbreviation ?? "",
          score: parseScore(home.score)
        },
        away: {
          id: String(away.team.id),
          name: away.team.shortDisplayName ?? away.team.displayName ?? "",
          abbreviation: away.team.abbreviation ?? "",
          score: parseScore(away.score)
        }
      };
    })
    .filter(Boolean);
}

function extractGamesFromScoreboard(data) {
  const events = Array.isArray(data?.events) ? data.events : [];
  return events
    .map((event) => {
      const competition = Array.isArray(event?.competitions)
        ? event.competitions[0]
        : null;
      const competitors = competition?.competitors ?? [];
      const home =
        competitors.find((team) => team.homeAway === "home") ?? competitors[0];
      const away =
        competitors.find((team) => team.homeAway === "away") ?? competitors[1];
      if (!home?.team?.id || !away?.team?.id) {
        return null;
      }
      const status = competition?.status?.type ?? {};
      return {
        id: String(event?.id ?? competition?.id ?? ""),
        date: event?.date ?? competition?.date ?? "",
        isFinal: Boolean(status?.completed),
        week: event?.week?.number ?? event?.week?.text ?? "",
        home: {
          id: String(home.team.id),
          name: home.team.shortDisplayName ?? home.team.displayName ?? "",
          abbreviation: home.team.abbreviation ?? "",
          score: parseScore(home.score)
        },
        away: {
          id: String(away.team.id),
          name: away.team.shortDisplayName ?? away.team.displayName ?? "",
          abbreviation: away.team.abbreviation ?? "",
          score: parseScore(away.score)
        }
      };
    })
    .filter(Boolean);
}

function mergeRecentGames(scheduleGames, scoreboardGames, teamId) {
  const combined = scheduleGames
    .concat(scoreboardGames)
    .filter((game) => game && (game.home.id === teamId || game.away.id === teamId))
    .filter((game) => game.isFinal && hasValidScores(game));
  const byId = new Map();
  for (const game of combined) {
    const key = game.id || `${game.date}-${game.home.id}-${game.away.id}`;
    if (!byId.has(key)) {
      byId.set(key, game);
    }
  }
  return Array.from(byId.values());
}

function summarizeRecentGames(games, teamId, limit) {
  const completed = games
    .filter((game) => game.isFinal && hasValidScores(game))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, limit);
  let wins = 0;
  let losses = 0;
  let pointDiffTotal = 0;
  const recent = completed.map((game) => {
    const isHome = game.home.id === teamId;
    const teamScore = isHome ? game.home.score : game.away.score;
    const oppScore = isHome ? game.away.score : game.home.score;
    const diff = teamScore - oppScore;
    if (diff > 0) {
      wins += 1;
    } else if (diff < 0) {
      losses += 1;
    }
    pointDiffTotal += diff;
    return {
      date: game.date,
      opponent: isHome ? game.away.abbreviation : game.home.abbreviation,
      result: diff > 0 ? "W" : diff < 0 ? "L" : "T",
      score: `${teamScore}-${oppScore}`
    };
  });
  const gamesCount = wins + losses + (completed.length - wins - losses);
  const avgPointDiff = completed.length ? pointDiffTotal / completed.length : 0;
  return {
    games: gamesCount,
    wins,
    losses,
    avgPointDiff: safeNumber(avgPointDiff, 0, 2),
    recent
  };
}

function summarizeHeadToHead(games, teamA, teamB) {
  let teamAWins = 0;
  let teamBWins = 0;
  let lastMeeting = null;
  const sorted = games
    .filter((game) => hasValidScores(game))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  for (const game of sorted) {
    const teamAScore =
      game.home.id === teamA.id ? game.home.score : game.away.score;
    const teamBScore =
      game.home.id === teamB.id ? game.home.score : game.away.score;
    if (teamAScore > teamBScore) {
      teamAWins += 1;
    } else if (teamBScore > teamAScore) {
      teamBWins += 1;
    }
    if (!lastMeeting) {
      lastMeeting = {
        date: game.date,
        winner: teamAScore === teamBScore ? "Tied" : teamAScore > teamBScore ? teamA.abbreviation : teamB.abbreviation,
        score: `${teamAScore}-${teamBScore}`
      };
    }
  }
  return {
    games: games.length,
    [teamA.abbreviation]: teamAWins,
    [teamB.abbreviation]: teamBWins,
    lastMeeting
  };
}

function buildLeanSummary(teamA, teamB, recentA, recentB, headToHead) {
  const winRateA = recentA.games ? recentA.wins / recentA.games : 0;
  const winRateB = recentB.games ? recentB.wins / recentB.games : 0;
  const pointDiffDelta = recentA.avgPointDiff - recentB.avgPointDiff;
  const h2hDelta =
    (headToHead?.[teamA.abbreviation] ?? 0) -
    (headToHead?.[teamB.abbreviation] ?? 0);
  const score = winRateA - winRateB + pointDiffDelta / 14 + h2hDelta * 0.15;
  const confidence = Math.min(0.9, Math.max(0.1, Math.abs(score)));
  if (score > 0.15) {
    return {
      team: teamA.abbreviation,
      confidence: safeNumber(confidence, 0.1, 2),
      reason: "Recent form and point differential lean this way."
    };
  }
  if (score < -0.15) {
    return {
      team: teamB.abbreviation,
      confidence: safeNumber(confidence, 0.1, 2),
      reason: "Recent form and point differential lean this way."
    };
  }
  return {
    team: "Too close",
    confidence: safeNumber(confidence, 0.1, 2),
    reason: "Recent form is mixed; edge is small."
  };
}

function parseScore(value) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasValidScores(game) {
  return (
    Number.isFinite(game?.home?.score) &&
    Number.isFinite(game?.away?.score) &&
    game.home.score !== null &&
    game.away.score !== null &&
    !(game.home.score === 0 && game.away.score === 0)
  );
}

function safeNumber(value, fallback, precision) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  if (precision === undefined) {
    return numeric;
  }
  return Number(numeric.toFixed(precision));
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
    outcomes: Array.isArray(market.outcomes) ? market.outcomes : [],
    outcomePrices: Array.isArray(market.outcomePrices) ? market.outcomePrices : [],
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
    outcomes: Array.isArray(market.outcomes) ? market.outcomes : [],
    outcomePrices: Array.isArray(market.outcomePrices) ? market.outcomePrices : [],
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

async function enrichMarketsWithGamma(markets) {
  const updates = await Promise.all(
    markets.map(async (market) => {
      try {
        const snapshot = await fetchGammaMarket(market);
        if (!snapshot) {
          return market;
        }
        if (market.title?.toLowerCase().includes("seahawks")) {
          console.log("[extension][debug] gamma snapshot", {
            title: market.title,
            outcomes: snapshot.outcomes,
            outcomePrices: snapshot.outcomePrices
          });
        }
        return {
          ...market,
          probability: resolveProbability(snapshot, market.probability),
          volumeUsd: snapshot.volume ?? market.volumeUsd ?? 0,
          liquidityUsd: snapshot.liquidity ?? market.liquidityUsd ?? 0,
          timeRemainingMinutes: parseTimeRemainingMinutes(snapshot),
          outcomes: normalizeOutcomeArray(snapshot.outcomes, market.outcomes),
          outcomePrices: normalizeOutcomeArray(snapshot.outcomePrices, market.outcomePrices),
          url:
            snapshot.url ??
            (snapshot.slug
              ? `${POLYMARKET_BASE}/market/${snapshot.slug}`
              : market.url),
          slug: snapshot.slug ?? market.slug
        };
      } catch (err) {
        console.warn("[extension] gamma enrich failed", err);
        return market;
      }
    })
  );
  return updates;
}

function normalizeOutcomeArray(value, fallback) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback ?? [];
    } catch {
      return fallback ?? [];
    }
  }
  return fallback ?? [];
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
  return Number.isNaN(price) ? 0.5 : clampProbability(price);
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

function clampProbability(value) {
  return Math.min(1, Math.max(0, value));
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

function resolveProbability(snapshot, fallback) {
  const hasOutcomes = Array.isArray(snapshot.outcomes) && snapshot.outcomes.length > 0;
  const hasPrices =
    Array.isArray(snapshot.outcomePrices) && snapshot.outcomePrices.length > 0;
  if (hasOutcomes && hasPrices) {
    return parseProbability(snapshot);
  }
  const direct = Number(snapshot.probability ?? snapshot.lastPrice);
  if (!Number.isNaN(direct) && Number.isFinite(direct)) {
    return clampProbability(direct);
  }
  return fallback ?? 0.5;
}


function scheduleMarketRefresh() {
  if (marketRefreshTimer) {
    return;
  }
  console.log("[extension][debug] market refresh scheduled");
  marketRefreshTimer = setInterval(() => {
    if (state.markets.length === 0) {
      clearInterval(marketRefreshTimer);
      marketRefreshTimer = null;
      console.log("[extension][debug] market refresh stopped (no markets)");
      return;
    }
    console.log(
      "[extension][debug] market refresh tick",
      state.markets.map((market) => market.slug ?? market.id)
    );
    refreshMarketSnapshots().catch((err) => {
      console.warn("[extension] market refresh failed", err);
    });
  }, 10000); // Refresh every 10 seconds
}

async function refreshMarketSnapshots() {
  console.log("[extension][debug] refreshing market snapshots");
  const updates = await Promise.all(
    state.markets.map((market) => refreshMarketSnapshot(market))
  );
  const refreshed = updates.filter(Boolean);
  console.log("[extension][debug] market refresh results", refreshed);
  if (refreshed.length === 0) {
    return;
  }
  const merged = dedupeMarkets(refreshed.concat(state.markets));
  state.markets = merged.slice(0, 4);
  broadcast({ type: "markets_refresh", payload: state.markets });
}

async function refreshMarketSnapshot(market) {
  console.log("[extension][debug] refresh market snapshot", market.slug ?? market.id);
  const snapshot = await fetchGammaMarket(market);
  if (!snapshot) {
    console.log(
      "[extension][debug] no gamma snapshot for",
      market.slug ?? market.id
    );
    return null;
  }
  const nextProbability = resolveProbability(snapshot, market.probability);
  return {
    ...market,
    probability: nextProbability,
    volumeUsd: snapshot.volume ?? market.volumeUsd ?? 0,
    liquidityUsd: snapshot.liquidity ?? market.liquidityUsd ?? 0,
    timeRemainingMinutes: parseTimeRemainingMinutes(snapshot),
    outcomes: Array.isArray(snapshot.outcomes) ? snapshot.outcomes : market.outcomes ?? [],
    outcomePrices: Array.isArray(snapshot.outcomePrices) ? snapshot.outcomePrices : market.outcomePrices ?? [],
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
