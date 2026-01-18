const marketList = document.getElementById("market-list");
const marketAnalyticsList = document.getElementById("market-analytics-list");
const wsStatus = document.getElementById("ws-status");
const refreshBtn = document.getElementById("refresh");
const contextTitle = document.getElementById("context-title");
const contextSub = document.getElementById("context-sub");
const contextTag = document.getElementById("context-tag");
const nflSummary = document.getElementById("nfl-summary");
const nflList = document.getElementById("nfl-list");
const nflSource = document.getElementById("nfl-source");

const port = chrome.runtime.connect();

const state = {
  markets: [],
  transcripts: [],
  nfl: null
};

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
  const markets = filterMarketsForMatchup(state.markets, state.nfl);
  for (const market of markets) {
    const card = document.createElement("div");
    card.className = "market-card";
    const volumeUsd = Number(market.volumeUsd ?? 0);
    const liquidityUsd = Number(market.liquidityUsd ?? 0);
    const displayProb = resolveMarketProbability(market);
    card.innerHTML = `
      <div class="pill">${Math.round(displayProb * 100)}% prob</div>
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

function analyzeMarketWithNflInsight(market, nflInsight) {
  if (!nflInsight || !nflInsight.teams || nflInsight.teams.length < 2) {
    return null;
  }

  const [teamA, teamB] = nflInsight.teams;
  const marketTitle = market.title.toLowerCase();

  const matchesTeamA = matchesTeamFromTitle(marketTitle, teamA);
  const matchesTeamB = matchesTeamFromTitle(marketTitle, teamB);

  if (!matchesTeamA && !matchesTeamB) {
    return null; // Market doesn't match these teams
  }

  const lean = nflInsight.lean ?? {};
  const recentA = nflInsight.recent?.[teamA.abbreviation] ?? {};
  const recentB = nflInsight.recent?.[teamB.abbreviation] ?? {};
  const headToHead = nflInsight.headToHead ?? {};
  const statsA = nflInsight.teamStats?.[teamA.abbreviation] ?? null;
  const statsB = nflInsight.teamStats?.[teamB.abbreviation] ?? null;

  const targetTeam = resolveTargetTeam(lean, teamA, teamB, matchesTeamA, matchesTeamB);
  const espnProbability = calculateModelProbability(
    recentA,
    recentB,
    headToHead,
    statsA,
    statsB,
    targetTeam,
    teamA,
    teamB
  );
  const marketOutcome = resolveMarketOutcome(market, targetTeam, teamA, teamB);
  const marketProb = marketOutcome.probability;

  // Calculate metrics
  const probabilityGap = Math.abs(espnProbability - marketProb);
  const edgeDirection = espnProbability > marketProb ? "favorable" : "overpriced";
  
  // Expected value calculation (assuming $1 bet)
  // If ESPN says 60% but market says 50%, we have edge
  const expectedValue = (espnProbability * (1 - marketProb)) - ((1 - espnProbability) * marketProb);
  const roiPercent = expectedValue * 100;
  
  // Risk/reward ratio
  const potentialProfit = 1 - marketProb; // If we win at market prob
  const potentialLoss = marketProb; // If we lose
  const riskRewardRatio = potentialLoss > 0 ? potentialProfit / potentialLoss : 0;
  
  // Confidence score based on multiple factors
  let confidence = Math.abs(probabilityGap) * 2;
  if (lean.confidence) {
    confidence = (confidence + lean.confidence) / 2;
  }
  const sampleSize = Math.min(recentA.games ?? 0, recentB.games ?? 0);
  const sampleCap = sampleSize >= 4 ? 1 : sampleSize === 3 ? 0.8 : sampleSize === 2 ? 0.65 : 0.5;
  const marketQuality = calculateMarketQuality(market);
  confidence = Math.min(sampleCap, Math.max(0.1, confidence)) * marketQuality;
  confidence = Math.min(sampleCap, Math.max(0.1, confidence));

  // Profit likelihood (0-100%)
  const profitLikelihood = Math.max(0, Math.min(100, 50 + (roiPercent * 2)));

  return {
    market,
    matchedTeam: targetTeam,
    espnProbability,
    marketProbability: marketProb,
    probabilityGap,
    edgeDirection,
    expectedValue,
    roiPercent,
    riskRewardRatio,
    confidence,
    profitLikelihood,
    marketOutcomeLabel: marketOutcome.label,
    recentStats: targetTeam.abbreviation === teamA.abbreviation ? recentA : recentB,
    marketQuality,
    headToHead
  };
}

function generatePlainEnglishExplanation(market, nflInsight, pnl) {
  if (!nflInsight || !nflInsight.teams) return null;
  
  const [teamA, teamB] = nflInsight.teams;
  const lean = nflInsight.lean ?? {};
  const marketProb = pnl.marketProbability ?? market.probability;
  const espnProb = pnl.espnProbability;
  
  // Determine which team the market favors
  const marketTitle = market.title.toLowerCase();
  const favorsTeamA = marketTitle.includes(teamA.abbreviation.toLowerCase()) || 
                      marketTitle.includes(teamA.shortName.toLowerCase());
  const favoredTeam = favorsTeamA ? teamA : teamB;
  
  // Build explanation based on ESPN data
  let explanation = '';
  
  if (lean.team && lean.team === favoredTeam.abbreviation) {
    explanation = `Based on ESPN analysis, ${favoredTeam.name} has an edge. `;
    if (lean.confidence > 0.6) {
      explanation += `Recent form strongly supports this outcome. `;
    }
    if (marketProb < espnProb - 0.1) {
      explanation += `The market appears to undervalue this outcome compared to our ESPN-based prediction.`;
    } else if (marketProb > espnProb + 0.1) {
      explanation += `The market is pricing this higher than our ESPN analysis suggests.`;
    }
  } else if (lean.team === 'Too close') {
    explanation = `ESPN data suggests this matchup is very close. The market probability of ${Math.round(marketProb * 100)}% reflects high uncertainty.`;
  } else {
    explanation = `ESPN insights show mixed signals for this market. `;
    explanation += `Consider the current ${Math.round(marketProb * 100)}% probability carefully given recent team performance.`;
  }
  
  return explanation;
}

function matchesTeamFromTitle(marketTitle, team) {
  const tokens = [
    team.abbreviation,
    team.shortName,
    team.location,
    team.name
  ]
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  return tokens.some((token) => token && marketTitle.includes(token));
}

function filterMarketsForMatchup(markets, nflInsight) {
  if (!nflInsight?.teams || nflInsight.teams.length < 2) {
    return markets;
  }
  const [teamA, teamB] = nflInsight.teams;
  return (markets ?? []).filter((market) => {
    const title = String(market.title ?? "").toLowerCase();
    const titleMatchA = matchesTeamFromTitle(title, teamA);
    const titleMatchB = matchesTeamFromTitle(title, teamB);
    const outcomeMatchA = hasOutcomeForTeam(market, teamA);
    const outcomeMatchB = hasOutcomeForTeam(market, teamB);
    if (titleMatchA && titleMatchB) {
      return true;
    }
    if (outcomeMatchA && outcomeMatchB) {
      return true;
    }
    return titleMatchA || titleMatchB || outcomeMatchA || outcomeMatchB;
  });
}

function hasOutcomeForTeam(market, team) {
  const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
  if (outcomes.length === 0) {
    return false;
  }
  const tokens = [
    team.abbreviation,
    team.shortName,
    team.location,
    team.name
  ]
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  return outcomes.some((outcome) => {
    const text = String(outcome ?? "").toLowerCase();
    return tokens.some((token) => token && text.includes(token));
  });
}

function resolveTargetTeam(lean, teamA, teamB, matchesTeamA, matchesTeamB) {
  if (lean?.team === teamA.abbreviation && matchesTeamA) {
    return teamA;
  }
  if (lean?.team === teamB.abbreviation && matchesTeamB) {
    return teamB;
  }
  if (matchesTeamA && !matchesTeamB) {
    return teamA;
  }
  if (matchesTeamB && !matchesTeamA) {
    return teamB;
  }
  return teamA;
}

function resolveMarketOutcome(market, targetTeam, teamA, teamB) {
  const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
  const prices = Array.isArray(market.outcomePrices) ? market.outcomePrices : [];
  if (outcomes.length > 0 && prices.length === outcomes.length) {
    const targetIndex = findOutcomeIndex(outcomes, targetTeam);
    if (targetIndex >= 0) {
      const price = Number(prices[targetIndex]);
      return {
        probability: Number.isFinite(price) ? clampProbability(price) : market.probability,
        label: outcomes[targetIndex]
      };
    }
    const teamAIndex = findOutcomeIndex(outcomes, teamA);
    const teamBIndex = findOutcomeIndex(outcomes, teamB);
    if (teamAIndex >= 0 && teamBIndex >= 0) {
      const fallbackIndex = targetTeam.abbreviation === teamB.abbreviation ? teamBIndex : teamAIndex;
      const price = Number(prices[fallbackIndex]);
      return {
        probability: Number.isFinite(price) ? clampProbability(price) : market.probability,
        label: outcomes[fallbackIndex]
      };
    }
  }
  return { probability: market.probability, label: "market" };
}

function resolveMarketProbability(market) {
  const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
  const prices = Array.isArray(market.outcomePrices) ? market.outcomePrices : [];
  if (outcomes.length > 0 && prices.length === outcomes.length) {
    const yesIndex = outcomes.findIndex(
      (outcome) => String(outcome ?? "").toLowerCase() === "yes"
    );
    if (yesIndex >= 0) {
      const price = Number(prices[yesIndex]);
      if (Number.isFinite(price)) {
        return clampProbability(price);
      }
    }
    const title = String(market.title ?? "").toLowerCase();
    let bestIndex = -1;
    let bestLength = 0;
    outcomes.forEach((outcome, index) => {
      const text = String(outcome ?? "").toLowerCase();
      if (text && title.includes(text) && text.length > bestLength) {
        bestIndex = index;
        bestLength = text.length;
      }
    });
    if (bestIndex >= 0) {
      const price = Number(prices[bestIndex]);
      if (Number.isFinite(price)) {
        return clampProbability(price);
      }
    }
    const fallback = Number(prices[0]);
    if (Number.isFinite(fallback)) {
      return clampProbability(fallback);
    }
  }
  const direct = Number(market.probability ?? 0.5);
  return Number.isFinite(direct) ? clampProbability(direct) : 0.5;
}

function findOutcomeIndex(outcomes, team) {
  const teamTokens = [
    team.abbreviation,
    team.shortName,
    team.location,
    team.name
  ]
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  return outcomes.findIndex((outcome) => {
    const normalized = String(outcome ?? "").toLowerCase();
    return teamTokens.some((token) => token && normalized.includes(token));
  });
}

function calculateModelProbability(
  recentA,
  recentB,
  headToHead,
  statsA,
  statsB,
  targetTeam,
  teamA,
  teamB
) {
  const winRateA = recentA.games > 0 ? recentA.wins / recentA.games : 0.5;
  const winRateB = recentB.games > 0 ? recentB.wins / recentB.games : 0.5;
  const pointDiffDelta = (recentA.avgPointDiff ?? 0) - (recentB.avgPointDiff ?? 0);
  const h2hDelta =
    (headToHead?.[teamA.abbreviation] ?? 0) -
    (headToHead?.[teamB.abbreviation] ?? 0);
  const ratingA = calculateStatRating(statsA);
  const ratingB = calculateStatRating(statsB);
  const ratingDelta = ratingA - ratingB;

  let base = 0.5 + (winRateA - winRateB) * 0.35;
  base += Math.max(-0.15, Math.min(0.15, pointDiffDelta / 24));
  base += Math.max(-0.1, Math.min(0.1, h2hDelta * 0.05));
  base += Math.max(-0.12, Math.min(0.12, ratingDelta / 20));

  const modelProb = clampProbability(base);
  if (targetTeam.abbreviation === teamA.abbreviation) {
    return modelProb;
  }
  return clampProbability(1 - modelProb);
}

function calculateStatRating(stats) {
  if (!stats) {
    return 0;
  }
  const pointsFor = Number(stats.pointsForPerGame ?? stats.pointsFor ?? 0);
  const pointsAgainst = Number(stats.pointsAgainstPerGame ?? stats.pointsAgainst ?? 0);
  const yardsFor = Number(stats.yardsPerGame ?? 0);
  const yardsAgainst = Number(stats.yardsAllowedPerGame ?? 0);
  let rating = 0;
  if (Number.isFinite(pointsFor) && Number.isFinite(pointsAgainst)) {
    rating += pointsFor - pointsAgainst;
  }
  if (Number.isFinite(yardsFor) && Number.isFinite(yardsAgainst)) {
    rating += (yardsFor - yardsAgainst) / 12;
  }
  return rating;
}

function calculateMarketQuality(market) {
  const volume = Number(market.volumeUsd ?? 0);
  const liquidity = Number(market.liquidityUsd ?? 0);
  const score = Math.log10(volume + 1) + Math.log10(liquidity + 1);
  const normalized = Math.min(1, Math.max(0.4, score / 6));
  return normalized;
}

function calculateMarketStrength(markets) {
  const strengths = new Map();
  if (!markets || markets.length === 0) {
    return strengths;
  }
  const metrics = markets.map((market) => ({
    key: market.id ?? market.slug ?? market.title,
    volume: Number(market.volumeUsd ?? 0),
    liquidity: Number(market.liquidityUsd ?? 0)
  }));
  const maxVolume = Math.max(1, ...metrics.map((m) => m.volume));
  const maxLiquidity = Math.max(1, ...metrics.map((m) => m.liquidity));
  for (const metric of metrics) {
    const volumeScore = metric.volume / maxVolume;
    const liquidityScore = metric.liquidity / maxLiquidity;
    const combined = Math.round((volumeScore * 0.6 + liquidityScore * 0.4) * 100);
    strengths.set(metric.key, combined);
  }
  return strengths;
}

function clampProbability(value) {
  return Math.min(0.95, Math.max(0.05, value));
}

function calculatePnL(marketProbability, espnProbability, betAmount = 100) {
  const marketProb = marketProbability;
  const costToBuy = marketProb * betAmount; // Cost to buy $100 worth of YES shares
  
  // If YES resolves: You get $100, profit = $100 - cost
  const profitIfYes = betAmount - costToBuy;
  
  // If NO resolves: You lose your cost
  const lossIfNo = -costToBuy;
  
  // Expected value based on ESPN probability
  const expectedValue = (espnProbability * profitIfYes) + ((1 - espnProbability) * lossIfNo);
  
  // ROI percentage
  const roiIfYes = (profitIfYes / costToBuy) * 100;
  const roiIfNo = (lossIfNo / costToBuy) * 100;
  
  return {
    marketProbability: marketProb,
    betAmount,
    costToBuy,
    profitIfYes,
    lossIfNo,
    expectedValue,
    roiIfYes,
    roiIfNo,
    espnProbability
  };
}

function renderMarketAnalytics() {
  marketAnalyticsList.innerHTML = "";
  
  if (!state.markets || state.markets.length === 0) {
    marketAnalyticsList.innerHTML = '<div class="analytics-empty">No markets available yet. Search for a game to pull Polymarket markets.</div>';
    return;
  }

  const markets = state.nfl ? filterMarketsForMatchup(state.markets, state.nfl) : state.markets;
  const topMarkets = markets.slice(0, 4);

  for (const market of topMarkets) {
    const card = document.createElement("div");
    card.className = "pnl-card";
    
    const marketProb = resolveMarketProbability(market);
    if (market.title?.toLowerCase().includes("seahawks")) {
      console.log("[panel][debug] market data", {
        title: market.title,
        probability: market.probability,
        outcomes: market.outcomes,
        outcomePrices: market.outcomePrices
      });
      console.log("[panel][debug] resolved probability", marketProb);
    }
    const probPercent = Math.round(marketProb * 100);
    const yesPercent = Math.max(0, Math.min(100, probPercent));
    const noPercent = 100 - yesPercent;
    const volumeUsd = Number(market.volumeUsd ?? 0);
    const liquidityUsd = Number(market.liquidityUsd ?? 0);
    card.innerHTML = `
      <div class="pnl-card-header">
        <h3 class="pnl-market-title">${market.title}</h3>
        <div class="pnl-probability">${probPercent}% probability</div>
      </div>
      <div class="pnl-probability">Vol $${volumeUsd.toLocaleString()} · Liq $${liquidityUsd.toLocaleString()}</div>
      <div class="pnl-quick-view">
        <div class="pnl-mini-graph">
          <div class="pnl-mini-bar profit-mini" style="height: ${yesPercent}%; background: var(--accent-2);">
            <span class="pnl-mini-label">${yesPercent}%</span>
          </div>
          <div class="pnl-mini-bar loss-mini" style="height: ${noPercent}%; background: var(--accent);">
            <span class="pnl-mini-label">${noPercent}%</span>
          </div>
        </div>
      </div>
    `;
    marketAnalyticsList.appendChild(card);
  }
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
  state.markets = (snapshot.markets ?? []).slice(0, 4);
  state.transcripts = snapshot.transcripts ?? [];
  state.nfl = snapshot.nfl ?? state.nfl;
  if (snapshot.wsStatus) {
    wsStatus.textContent = snapshot.wsStatus;
  }
  renderContext(snapshot.context ?? null);
  renderNflInsight();
  renderMarkets();
  renderMarketAnalytics();
}

port.onMessage.addListener((message) => {
  if (message.type === "snapshot") {
    applySnapshot(message.payload);
  }
  if (message.type === "transcript") {
    state.transcripts = [message.payload, ...state.transcripts].slice(0, 12);
  }
  if (message.type === "market") {
    state.markets = [message.payload, ...state.markets].slice(0, 4);
    renderMarkets();
  }
  if (message.type === "markets_refresh") {
    state.markets = message.payload.slice(0, 4);
    renderMarkets();
    renderMarketAnalytics();
  }
  if (message.type === "nfl_insight") {
    state.nfl = message.payload;
    renderNflInsight();
    renderMarketAnalytics(); // Re-analyze when NFL insight updates
  }
  if (message.type === "context") {
    renderContext(message.payload);
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
