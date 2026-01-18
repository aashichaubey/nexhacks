const marketList = document.getElementById("market-list");
const marketAnalyticsList = document.getElementById("market-analytics-list");
const pnlDashboardList = document.getElementById("pnl-dashboard-list");
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
  nfl: null,
  priceHistory: new Map(), // market id -> array of {price, timestamp}
  tradeActivity: new Map() // market id -> array of {volume, timestamp, volumeChange}
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

// Track price history for volatility and drawdown calculations
function updatePriceHistory(market) {
  const marketId = market.id ?? market.slug ?? market.title;
  if (!marketId) return;
  
  const currentPrice = resolveMarketProbability(market);
  const currentVolume = Number(market.volumeUsd ?? 0);
  const now = Date.now();
  
  if (!state.priceHistory.has(marketId)) {
    state.priceHistory.set(marketId, []);
  }
  
  const history = state.priceHistory.get(marketId);
  
  // Only add new entry if:
  // 1. Price has changed, OR
  // 2. At least 10 seconds have passed since last entry, OR  
  // 3. This is the first entry
  const shouldAdd = history.length === 0 || 
                    history[history.length - 1].price !== currentPrice ||
                    (now - history[history.length - 1].timestamp) >= 10000;
  
  if (shouldAdd) {
    history.push({ price: currentPrice, volume: currentVolume, timestamp: now });
  }
  
  // Keep last 60 data points (about 10 minutes at 10s intervals)
  const maxHistory = 60;
  if (history.length > maxHistory) {
    history.shift();
  }
  
  // Clean up old entries (older than 30 minutes)
  const thirtyMinutesAgo = now - (30 * 60 * 1000);
  while (history.length > 0 && history[0].timestamp < thirtyMinutesAgo) {
    history.shift();
  }
}

// Calculate rolling standard deviation of price changes
function calculateVolatility(marketId, windowSize = 20) {
  const history = state.priceHistory.get(marketId);
  if (!history || history.length < 2) {
    return null;
  }
  
  // Calculate price changes (deltas)
  const priceChanges = [];
  for (let i = 1; i < history.length; i++) {
    const change = Math.abs(history[i].price - history[i - 1].price);
    priceChanges.push(change);
  }
  
  // Use rolling window (last N changes)
  const recentChanges = priceChanges.slice(-windowSize);
  if (recentChanges.length < 2) {
    return null;
  }
  
  // Calculate mean
  const mean = recentChanges.reduce((sum, val) => sum + val, 0) / recentChanges.length;
  
  // Calculate variance
  const variance = recentChanges.reduce((sum, val) => {
    const diff = val - mean;
    return sum + (diff * diff);
  }, 0) / recentChanges.length;
  
  // Standard deviation
  const stdDev = Math.sqrt(variance);
  
  return {
    stdDev,
    mean,
    sampleSize: recentChanges.length,
    recentChanges: recentChanges.slice(-5) // Last 5 changes for context
  };
}

// Determine volatility regime
function getVolatilityRegime(marketId) {
  const history = state.priceHistory.get(marketId);
  const historyCount = history ? history.length : 0;
  
  const volatility = calculateVolatility(marketId);
  if (!volatility) {
    const neededPoints = 2;
    const hasEnough = historyCount >= neededPoints;
    return {
      regime: "unknown",
      label: "Insufficient Data",
      description: `Need ${neededPoints} price points (have ${historyCount}). Updates every 10s.`,
      recommendation: hasEnough ? "Calculating..." : `Waiting for ${neededPoints - historyCount} more update${neededPoints - historyCount > 1 ? 's' : ''}...`,
      color: "muted",
      historyCount
    };
  }
  
  const stdDev = volatility.stdDev;
  
  // Thresholds (adjustable based on typical market behavior)
  const calmThreshold = 0.005; // 0.5% price change std dev
  const moderateThreshold = 0.015; // 1.5% price change std dev
  const shockThreshold = 0.03; // 3% price change std dev
  
  if (stdDev < calmThreshold) {
    return {
      regime: "calm",
      label: "Calm",
      description: "Low volatility - stable prices",
      recommendation: "Good time to trade - prices are stable",
      color: "calm",
      stdDev,
      volatility
    };
  } else if (stdDev < moderateThreshold) {
    return {
      regime: "moderate",
      label: "Moderate",
      description: "Normal market volatility",
      recommendation: "Standard trading conditions",
      color: "moderate",
      stdDev,
      volatility
    };
  } else if (stdDev < shockThreshold) {
    return {
      regime: "high",
      label: "High Volatility",
      description: "Elevated price swings",
      recommendation: "Caution - increased risk",
      color: "high",
      stdDev,
      volatility
    };
  } else {
    return {
      regime: "shock",
      label: "Shock-Prone",
      description: "Extreme volatility - rapid price changes",
      recommendation: "⚠️ Avoid trading - market is unstable",
      color: "shock",
      stdDev,
      volatility
    };
  }
}

// Track trade activity (volume changes and update frequency)
function updateTradeActivity(market) {
  const marketId = market.id ?? market.slug ?? market.title;
  if (!marketId) return;
  
  const currentVolume = Number(market.volumeUsd ?? 0);
  const now = Date.now();
  
  if (!state.tradeActivity.has(marketId)) {
    state.tradeActivity.set(marketId, []);
  }
  
  const activity = state.tradeActivity.get(marketId);
  const lastEntry = activity.length > 0 ? activity[activity.length - 1] : null;
  
  // Calculate volume change
  const volumeChange = lastEntry ? currentVolume - lastEntry.volume : 0;
  
  // Only add entry if:
  // 1. Volume changed significantly (> $1), OR
  // 2. At least 10 seconds have passed (market update), OR
  // 3. This is the first entry
  const significantVolumeChange = Math.abs(volumeChange) > 1;
  const timeSinceLastUpdate = lastEntry ? (now - lastEntry.timestamp) : Infinity;
  const shouldAdd = activity.length === 0 || 
                    significantVolumeChange ||
                    timeSinceLastUpdate >= 10000;
  
  if (shouldAdd) {
    activity.push({
      volume: currentVolume,
      timestamp: now,
      volumeChange: volumeChange
    });
  }
  
  // Keep last 60 entries (about 10 minutes)
  const maxHistory = 60;
  if (activity.length > maxHistory) {
    activity.shift();
  }
  
  // Clean up old entries (older than 30 minutes)
  const thirtyMinutesAgo = now - (30 * 60 * 1000);
  while (activity.length > 0 && activity[0].timestamp < thirtyMinutesAgo) {
    activity.shift();
  }
}

// Calculate Trade Clustering Score
function calculateTradeClusteringScore(marketId, lookbackMinutes = 5) {
  const activity = state.tradeActivity.get(marketId);
  if (!activity || activity.length < 2) {
    return null;
  }
  
  const now = Date.now();
  const lookbackMs = lookbackMinutes * 60 * 1000;
  
  // Get recent activity within lookback window
  const recentActivity = activity.filter(entry => (now - entry.timestamp) <= lookbackMs);
  
  if (recentActivity.length < 2) {
    return null;
  }
  
  // Calculate update frequency (updates per minute)
  const timeSpan = (recentActivity[recentActivity.length - 1].timestamp - recentActivity[0].timestamp) / 1000 / 60; // minutes
  const updateFrequency = timeSpan > 0 ? recentActivity.length / timeSpan : 0;
  
  // Calculate volume change rate (total volume change per minute)
  const totalVolumeChange = recentActivity.reduce((sum, entry) => sum + Math.abs(entry.volumeChange), 0);
  const volumeChangeRate = timeSpan > 0 ? totalVolumeChange / timeSpan : 0;
  
  // Calculate baseline from earlier period (if available)
  const baselineWindow = lookbackMinutes * 2; // Look at 2x the lookback period
  const baselineActivity = activity.filter(entry => {
    const age = (now - entry.timestamp) / 1000 / 60;
    return age > lookbackMinutes && age <= baselineWindow;
  });
  
  let baselineFrequency = 0;
  let baselineVolumeRate = 0;
  
  if (baselineActivity.length >= 2) {
    const baselineTimeSpan = (baselineActivity[baselineActivity.length - 1].timestamp - baselineActivity[0].timestamp) / 1000 / 60;
    if (baselineTimeSpan > 0) {
      baselineFrequency = baselineActivity.length / baselineTimeSpan;
      const baselineVolumeChange = baselineActivity.reduce((sum, entry) => sum + Math.abs(entry.volumeChange), 0);
      baselineVolumeRate = baselineVolumeChange / baselineTimeSpan;
    }
  }
  
  // If no baseline, use a default assumption (1 update per 10 seconds = 6 per minute)
  if (baselineFrequency === 0) {
    baselineFrequency = 0.1; // Conservative baseline
    baselineVolumeRate = 10; // Conservative baseline
  }
  
  // Calculate clustering score (normalized 0-100)
  // Combines update frequency ratio and volume change rate ratio
  const frequencyRatio = baselineFrequency > 0 ? updateFrequency / baselineFrequency : 1;
  const volumeRatio = baselineVolumeRate > 0 ? volumeChangeRate / baselineVolumeRate : 1;
  
  // Weighted combination (60% frequency, 40% volume)
  const rawScore = (frequencyRatio * 0.6 + volumeRatio * 0.4);
  
  // Normalize to 0-100 scale with logarithmic scaling for extreme values
  const normalizedScore = Math.min(100, Math.max(0, Math.log10(rawScore * 9 + 1) * 50));
  
  return {
    score: normalizedScore,
    updateFrequency,
    baselineFrequency,
    volumeChangeRate,
    baselineVolumeRate,
    frequencyRatio,
    volumeRatio,
    recentActivityCount: recentActivity.length,
    timeSpan
  };
}

// Get Trade Clustering Regime
function getTradeClusteringRegime(marketId) {
  const clustering = calculateTradeClusteringScore(marketId);
  if (!clustering) {
    const activity = state.tradeActivity.get(marketId);
    const activityCount = activity ? activity.length : 0;
    return {
      regime: "unknown",
      label: "Insufficient Data",
      description: `Need trade activity history (have ${activityCount} points)`,
      recommendation: "Collecting trade data...",
      color: "muted",
      score: null
    };
  }
  
  const score = clustering.score;
  
  // Thresholds for clustering regimes
  const normalThreshold = 40; // Below 40 = normal
  const elevatedThreshold = 70; // 40-70 = elevated
  const spikingThreshold = 85; // 70-85 = high
  // Above 85 = spiking
  
  if (score < normalThreshold) {
    return {
      regime: "normal",
      label: "Normal Activity",
      description: "Trading activity is at baseline levels",
      recommendation: "Standard trading conditions",
      color: "calm",
      score,
      clustering
    };
  } else if (score < elevatedThreshold) {
    return {
      regime: "elevated",
      label: "Elevated Activity",
      description: "Increased trading frequency detected",
      recommendation: "Monitor for price movements",
      color: "moderate",
      score,
      clustering
    };
  } else if (score < spikingThreshold) {
    return {
      regime: "high",
      label: "High Activity",
      description: "Significant trading cluster detected",
      recommendation: "⚠️ Watch for rapid price changes",
      color: "high",
      score,
      clustering
    };
  } else {
    return {
      regime: "spiking",
      label: "Activity Spiking",
      description: "Extreme trading burst - potential price shock incoming",
      recommendation: "🚨 Avoid trading - wait for stabilization",
      color: "shock",
      score,
      clustering
    };
  }
}

// Calculate Volume-Weighted Price Confidence
// Thin volume moves = low confidence, heavy volume moves = high conviction
function calculateVolumeWeightedPriceConfidence(market, lookbackMinutes = 5) {
  const marketId = market.id ?? market.slug ?? market.title;
  const history = state.priceHistory.get(marketId);
  
  if (!history || history.length < 2) {
    return {
      confidence: null,
      label: "Insufficient Data",
      description: "Need price and volume history",
      color: "muted"
    };
  }
  
  const now = Date.now();
  const lookbackMs = lookbackMinutes * 60 * 1000;
  
  // Get recent history
  const recentHistory = history.filter(entry => (now - entry.timestamp) <= lookbackMs);
  if (recentHistory.length < 2) {
    return {
      confidence: null,
      label: "Insufficient Data",
      description: "Need more recent price data",
      color: "muted"
    };
  }
  
  const currentPrice = resolveMarketProbability(market);
  const currentVolume = Number(market.volumeUsd ?? 0);
  
  // Calculate price change in recent period
  const firstPrice = recentHistory[0].price;
  const priceChange = Math.abs(currentPrice - firstPrice);
  
  // Calculate average volume and volume-weighted price changes
  let totalVolume = 0;
  let weightedPriceChanges = 0;
  let totalAbsPriceChange = 0;
  
  for (let i = 1; i < recentHistory.length; i++) {
    const priceDelta = Math.abs(recentHistory[i].price - recentHistory[i - 1].price);
    const volume = recentHistory[i].volume || 0;
    const avgVolume = (recentHistory[i].volume + recentHistory[i - 1].volume) / 2;
    
    totalVolume += avgVolume;
    weightedPriceChanges += priceDelta * avgVolume;
    totalAbsPriceChange += priceDelta;
  }
  
  const avgVolume = totalVolume / Math.max(1, recentHistory.length - 1);
  const weightedAvgPriceChange = totalVolume > 0 ? weightedPriceChanges / totalVolume : 0;
  
  // Calculate volume-to-price-change ratio (higher = more confidence)
  // High volume with small price change = high confidence
  // Low volume with large price change = low confidence
  const priceChangeMagnitude = totalAbsPriceChange;
  const volumePriceRatio = avgVolume > 0 && priceChangeMagnitude > 0 
    ? avgVolume / (priceChangeMagnitude * 1000) // Scale to normalize
    : 0;
  
  // Base confidence on liquidity too
  const liquidity = Number(market.liquidityUsd ?? 0);
  const liquidityScore = Math.min(1, Math.log10(liquidity + 1) / 6); // Normalize liquidity
  
  // Combine volume-weighting and liquidity
  const rawConfidence = Math.min(100, (volumePriceRatio * 50 + liquidityScore * 50));
  
  // If price changed significantly but volume is low, reduce confidence
  const priceVolatility = priceChangeMagnitude;
  if (priceVolatility > 0.05 && avgVolume < 1000) {
    // Thin move = low confidence
    const thinMovePenalty = Math.max(0, (0.05 - priceVolatility) * 1000);
    return {
      confidence: Math.max(0, rawConfidence - thinMovePenalty),
      label: "Low Confidence",
      description: "Thin volume move - price change with low volume",
      recommendation: "Low conviction - wait for higher volume confirmation",
      color: "high",
      avgVolume,
      priceChangeMagnitude
    };
  }
  
  // High volume moves = high conviction
  if (avgVolume > 5000 && priceVolatility > 0.01) {
    return {
      confidence: Math.min(100, rawConfidence + 20),
      label: "High Confidence",
      description: "Heavy volume move - strong market conviction",
      recommendation: "High conviction - volume supports price move",
      color: "calm",
      avgVolume,
      priceChangeMagnitude
    };
  }
  
  // Normal confidence
  const confidenceLevel = rawConfidence < 30 ? "Low" : rawConfidence < 60 ? "Moderate" : "High";
  const colorLevel = rawConfidence < 30 ? "high" : rawConfidence < 60 ? "moderate" : "calm";
  
  return {
    confidence: rawConfidence,
    label: `${confidenceLevel} Confidence`,
    description: avgVolume > 2000 ? "Volume supports current price" : "Normal trading volume",
    recommendation: confidenceLevel === "High" ? "Volume confirms price" : "Monitor volume trends",
    color: colorLevel,
    avgVolume,
    priceChangeMagnitude
  };
}

// Calculate Expected Drawdown from Entry
// Worst-case path risk before resolution using historical volatility paths
function calculateExpectedDrawdown(market, entryPrice = null) {
  const marketId = market.id ?? market.slug ?? market.title;
  const history = state.priceHistory.get(marketId);
  
  if (!history || history.length < 5) {
    return {
      maxDrawdown: null,
      label: "Insufficient Data",
      description: "Need historical price data for drawdown calculation",
      color: "muted"
    };
  }
  
  const currentPrice = resolveMarketProbability(market);
  const entry = entryPrice !== null ? entryPrice : currentPrice; // Use current as entry if not specified
  
  // Calculate historical price paths and drawdowns
  const pricePaths = history.map(entry => entry.price);
  const drawdowns = [];
  
  // For each point in history, calculate max drawdown from entry
  for (let i = 0; i < pricePaths.length; i++) {
    // Look ahead from this point to find worst price
    let minPrice = pricePaths[i];
    for (let j = i; j < pricePaths.length; j++) {
      minPrice = Math.min(minPrice, pricePaths[j]);
    }
    
    // Calculate drawdown from entry (assuming YES position)
    // Drawdown = entry - minPrice (how much price can drop)
    const drawdown = entry - minPrice;
    drawdowns.push(Math.max(0, drawdown));
  }
  
  // Calculate statistics
  const maxDrawdown = Math.max(...drawdowns);
  const avgDrawdown = drawdowns.reduce((sum, d) => sum + d, 0) / drawdowns.length;
  
  // Use volatility to estimate worst-case
  const volatility = calculateVolatility(marketId);
  let expectedDrawdown = maxDrawdown;
  
  if (volatility && volatility.stdDev) {
    // Estimate worst-case drawdown using 2-sigma (95% confidence)
    const worstCaseDrawdown = volatility.stdDev * 2;
    expectedDrawdown = Math.max(maxDrawdown, worstCaseDrawdown);
  }
  
  // Convert to percentage and dollars for $1 position
  const drawdownPercent = (expectedDrawdown / entry) * 100;
  const drawdownDollars = expectedDrawdown; // For $1 position, this is the dollar loss
  
  // Classify risk level
  let riskLevel, color, recommendation;
  if (expectedDrawdown < 0.05) {
    riskLevel = "Low Risk";
    color = "calm";
    recommendation = "Low drawdown risk - stable price path expected";
  } else if (expectedDrawdown < 0.15) {
    riskLevel = "Moderate Risk";
    color = "moderate";
    recommendation = "Moderate drawdown possible - monitor price movements";
  } else if (expectedDrawdown < 0.30) {
    riskLevel = "High Risk";
    color = "high";
    recommendation = "⚠️ High drawdown risk - potential significant price swings";
  } else {
    riskLevel = "Very High Risk";
    color = "shock";
    recommendation = "🚨 Very high drawdown risk - expect extreme volatility";
  }
  
  return {
    maxDrawdown: expectedDrawdown,
    maxDrawdownPercent: drawdownPercent,
    maxDrawdownDollars: drawdownDollars,
    avgDrawdown,
    label: riskLevel,
    description: `Worst-case path: up to ${(drawdownPercent).toFixed(1)}% drop possible`,
    recommendation,
    color,
    entryPrice: entry
  };
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
    // Update price history (needed for both analytics)
    updatePriceHistory(market);
    
    const marketId = market.id ?? market.slug ?? market.title;
    const volumeConfidence = calculateVolumeWeightedPriceConfidence(market);
    const volatilityRegime = getVolatilityRegime(marketId);
    
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
    
    // Volume-Weighted Price Confidence indicator
    const confidenceClass = `volatility-${volumeConfidence.color}`;
    const confidenceScore = volumeConfidence.confidence !== null ? Math.round(volumeConfidence.confidence) : '—';
    
    // Volatility Regime indicator
    const volatilityClass = `volatility-${volatilityRegime.color}`;
    const stdDevPercent = volatilityRegime.stdDev ? (volatilityRegime.stdDev * 100).toFixed(2) : '—';
    
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
      <div class="volatility-indicator ${confidenceClass}">
        <div class="volatility-header">
          <span class="volatility-label">Price Confidence</span>
          <span class="volatility-badge volatility-badge-${volumeConfidence.color}">${volumeConfidence.label}</span>
        </div>
        <div class="volatility-stats">
          <span class="volatility-stat">Score: ${confidenceScore}${confidenceScore !== '—' ? '/100' : ''}</span>
        </div>
        <div class="volatility-recommendation">${volumeConfidence.recommendation || volumeConfidence.description}</div>
      </div>
      <div class="volatility-indicator ${volatilityClass}">
        <div class="volatility-header">
          <span class="volatility-label">Volatility Regime</span>
          <span class="volatility-badge volatility-badge-${volatilityRegime.color}">${volatilityRegime.label}</span>
        </div>
        <div class="volatility-stats">
          <span class="volatility-stat">Std Dev: ${stdDevPercent}%</span>
        </div>
        <div class="volatility-recommendation">${volatilityRegime.recommendation}</div>
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

function calculatePnLFromPrices(market, shares = 1) {
  const marketProb = resolveMarketProbability(market);
  const yesPrice = marketProb; // Price = probability
  const noPrice = 1 - marketProb;
  
  // Polymarket: 1 share costs the price, resolves to $1 or $0
  // Cost to buy 1 YES share at current price
  const costToBuyYes = yesPrice * shares;
  
  // Cost to buy 1 NO share at current price
  const costToBuyNo = noPrice * shares;
  
  // If you buy YES at price p:
  // - Final P&L if YES happens: 1 - p (you get $1, paid p)
  // - Final P&L if NO happens: -p (you get $0, paid p)
  const finalPnLIfYesWins = (1 - yesPrice) * shares;
  const finalPnLIfNoWins = -yesPrice * shares; // loss
  
  // If you buy NO at price p:
  // - Final P&L if NO happens: 1 - p (you get $1, paid p)
  // - Final P&L if YES happens: -p (you get $0, paid p)
  const finalPnLIfNoWinsFromNo = (1 - noPrice) * shares;
  const finalPnLIfYesWinsFromNo = -noPrice * shares;
  
  return {
    market,
    marketProbability: marketProb,
    yesPrice,
    noPrice,
    shares,
    costToBuyYes,
    costToBuyNo,
    // Final P&L at resolution (buying YES at current price)
    finalPnLIfYesWins,
    finalPnLIfNoWins,
    // Final P&L at resolution (buying NO at current price)
    finalPnLIfNoWinsFromNo,
    finalPnLIfYesWinsFromNo,
    // ROI calculations
    roiIfYesWins: yesPrice > 0 ? (finalPnLIfYesWins / costToBuyYes) * 100 : 0,
    roiIfNoWins: noPrice > 0 ? (finalPnLIfNoWinsFromNo / costToBuyNo) * 100 : 0
  };
}

function renderPnLDashboard() {
  pnlDashboardList.innerHTML = "";
  
  if (!state.markets || state.markets.length === 0) {
    pnlDashboardList.innerHTML = '<div class="analytics-empty">No markets available. P&L calculations require live market data.</div>';
    return;
  }

  const markets = state.nfl ? filterMarketsForMatchup(state.markets, state.nfl) : state.markets;
  const topMarkets = markets.slice(0, 4);

  for (const market of topMarkets) {
    const pnl = calculatePnLFromPrices(market, 1); // 1 share
    const card = document.createElement("div");
    card.className = "pnl-compact-card";
    
    const marketProbPercent = Math.round(pnl.marketProbability * 100);
    const yesPriceFormatted = (pnl.yesPrice * 100).toFixed(1);
    const noPriceFormatted = (pnl.noPrice * 100).toFixed(1);
    
    // Format prices in dollars and cents
    const yesPriceDollars = pnl.yesPrice.toFixed(2);
    const noPriceDollars = pnl.noPrice.toFixed(2);
    
    // Calculate expected value: (prob * finalPnLIfYes) + ((1-prob) * finalPnLIfNo)
    const expectedValue = (pnl.marketProbability * pnl.finalPnLIfYesWins) + ((1 - pnl.marketProbability) * pnl.finalPnLIfNoWins);
    
    card.innerHTML = `
      <div class="pnl-compact-header">
        <h3 class="pnl-compact-title">${market.title}</h3>
        <div class="pnl-compact-price">YES: ${yesPriceFormatted}¢ | NO: ${noPriceFormatted}¢</div>
      </div>
      <div class="pnl-compact-stats">
        <div class="pnl-stat">
          <span class="pnl-stat-label">Cost</span>
          <span class="pnl-stat-value">$${pnl.costToBuyYes.toFixed(2)}</span>
        </div>
        <div class="pnl-stat">
          <span class="pnl-stat-label">If YES</span>
          <span class="pnl-stat-value pnl-positive">+$${pnl.finalPnLIfYesWins.toFixed(2)}</span>
        </div>
        <div class="pnl-stat">
          <span class="pnl-stat-label">If NO</span>
          <span class="pnl-stat-value pnl-negative">$${pnl.finalPnLIfNoWins.toFixed(2)}</span>
        </div>
        <div class="pnl-stat">
          <span class="pnl-stat-label">EV</span>
          <span class="pnl-stat-value ${expectedValue >= 0 ? 'pnl-positive' : 'pnl-negative'}">${expectedValue >= 0 ? '+' : ''}$${expectedValue.toFixed(2)}</span>
        </div>
      </div>
    `;
    
    pnlDashboardList.appendChild(card);
  }
}

function applySnapshot(snapshot) {
  state.markets = (snapshot.markets ?? []).slice(0, 4);
  state.transcripts = snapshot.transcripts ?? [];
  state.nfl = snapshot.nfl ?? state.nfl;
  if (snapshot.wsStatus) {
    wsStatus.textContent = snapshot.wsStatus;
  }
  // Initialize price history and trade activity for all markets
  for (const market of state.markets) {
    updatePriceHistory(market);
    updateTradeActivity(market);
  }
  renderContext(snapshot.context ?? null);
  renderNflInsight();
  renderMarkets();
  renderMarketAnalytics();
  renderPnLDashboard();
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
    renderMarketAnalytics();
    renderPnLDashboard();
  }
  if (message.type === "markets_refresh") {
    state.markets = message.payload.slice(0, 4);
    // Update price history and trade activity for all markets on refresh
    for (const market of state.markets) {
      updatePriceHistory(market);
      updateTradeActivity(market);
    }
    renderMarkets();
    renderMarketAnalytics();
    renderPnLDashboard();
  }
  if (message.type === "nfl_insight") {
    state.nfl = message.payload;
    renderNflInsight();
    renderMarketAnalytics(); // Re-analyze when NFL insight updates
    renderPnLDashboard();
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
