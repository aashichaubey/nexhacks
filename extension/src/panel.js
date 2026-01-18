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

function analyzeMarketWithNflInsight(market, nflInsight) {
  if (!nflInsight || !nflInsight.teams || nflInsight.teams.length < 2) {
    return null;
  }

  const [teamA, teamB] = nflInsight.teams;
  const marketTitle = market.title.toLowerCase();
  const marketProb = market.probability;
  
  // Try to match market to teams
  const matchesTeamA = marketTitle.includes(teamA.abbreviation.toLowerCase()) || 
                       marketTitle.includes(teamA.shortName.toLowerCase()) ||
                       marketTitle.includes(teamA.location.toLowerCase());
  const matchesTeamB = marketTitle.includes(teamB.abbreviation.toLowerCase()) || 
                       marketTitle.includes(teamB.shortName.toLowerCase()) ||
                       marketTitle.includes(teamB.location.toLowerCase());
  
  if (!matchesTeamA && !matchesTeamB) {
    return null; // Market doesn't match these teams
  }

  const lean = nflInsight.lean ?? {};
  const recentA = nflInsight.recent?.[teamA.abbreviation] ?? {};
  const recentB = nflInsight.recent?.[teamB.abbreviation] ?? {};
  const headToHead = nflInsight.headToHead ?? {};

  // Calculate ESPN prediction based on lean
  let espnProbability = 0.5;
  if (lean.team === teamA.abbreviation) {
    espnProbability = 0.5 + (lean.confidence ?? 0) * 0.3; // Boost based on confidence
  } else if (lean.team === teamB.abbreviation) {
    espnProbability = 0.5 - (lean.confidence ?? 0) * 0.3;
  } else {
    // Use recent form as proxy
    const winRateA = recentA.games > 0 ? recentA.wins / recentA.games : 0.5;
    const winRateB = recentB.games > 0 ? recentB.wins / recentB.games : 0.5;
    const pointDiffDelta = (recentA.avgPointDiff ?? 0) - (recentB.avgPointDiff ?? 0);
    espnProbability = 0.5 + (winRateA - winRateB) * 0.2 + Math.min(0.15, Math.max(-0.15, pointDiffDelta / 20));
  }

  // Adjust based on which team the market favors
  if (matchesTeamB && !matchesTeamA) {
    espnProbability = 1 - espnProbability; // Flip if market is about team B
  }

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
  let confidence = Math.abs(probabilityGap) * 2; // Base confidence from gap
  if (lean.confidence) {
    confidence = (confidence + lean.confidence) / 2; // Factor in ESPN lean confidence
  }
  confidence = Math.min(1, confidence);

  // Profit likelihood (0-100%)
  const profitLikelihood = Math.max(0, Math.min(100, 50 + (roiPercent * 2)));

  return {
    market,
    matchedTeam: matchesTeamA ? teamA : teamB,
    espnProbability,
    marketProbability: marketProb,
    probabilityGap,
    edgeDirection,
    expectedValue,
    roiPercent,
    riskRewardRatio,
    confidence,
    profitLikelihood,
    recentStats: matchesTeamA ? recentA : recentB,
    headToHead
  };
}

function generatePlainEnglishExplanation(market, nflInsight, pnl) {
  if (!nflInsight || !nflInsight.teams) return null;
  
  const [teamA, teamB] = nflInsight.teams;
  const lean = nflInsight.lean ?? {};
  const marketProb = market.probability;
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

function calculatePnL(market, espnProbability, betAmount = 100) {
  // Calculate Profit & Loss for a $100 bet (standard in prediction markets)
  const marketProb = market.probability;
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

function calculateOverallMarketState(marketAnalyses, nflInsight) {
  if (!marketAnalyses || marketAnalyses.length === 0) return null;
  
  // Calculate overall market state from all matching markets
  const avgExpectedValue = marketAnalyses.reduce((sum, a) => sum + (a.pnl?.expectedValue || 0), 0) / marketAnalyses.length;
  const avgConfidence = marketAnalyses.reduce((sum, a) => sum + (a.confidence || 0), 0) / marketAnalyses.length;
  const positiveMarkets = marketAnalyses.filter(a => (a.pnl?.expectedValue || 0) > 0).length;
  const totalMarkets = marketAnalyses.length;
  
  // Calculate market state score (0-100)
  let state = 'neutral';
  let recommendation = 'Markets are fairly priced';
  let score = 50; // Start neutral
  
  if (avgExpectedValue > 0.1 && positiveMarkets >= totalMarkets * 0.6) {
    state = 'favorable';
    recommendation = 'Good time to bet - Markets show value opportunities';
    score = Math.min(100, 60 + (avgExpectedValue * 100) + (avgConfidence * 30));
  } else if (avgExpectedValue > 0.05) {
    state = 'moderate';
    recommendation = 'Some value exists - Selective betting recommended';
    score = Math.min(85, 50 + (avgExpectedValue * 80) + (avgConfidence * 20));
  } else if (avgExpectedValue < -0.05) {
    state = 'expensive';
    recommendation = 'Markets look expensive - Wait for better prices';
    score = Math.max(0, 40 + (avgExpectedValue * 60));
  } else {
    state = 'neutral';
    recommendation = 'Markets fairly priced - Limited edge';
    score = 45 + (avgExpectedValue * 40);
  }
  
  return {
    state,
    recommendation,
    score: Math.max(0, Math.min(100, score)),
    avgExpectedValue,
    positiveMarkets,
    totalMarkets
  };
}

function renderMarketState(marketState) {
  const stateEl = document.getElementById('market-state');
  if (!stateEl || !marketState) {
    if (stateEl) stateEl.innerHTML = '';
    return;
  }
  
  const stateColors = {
    'favorable': 'var(--accent-2)',
    'moderate': 'var(--accent-2)',
    'neutral': 'var(--muted)',
    'expensive': 'var(--accent)'
  };
  
  const stateLabels = {
    'favorable': 'Favorable',
    'moderate': 'Moderate',
    'neutral': 'Neutral',
    'expensive': 'Expensive'
  };
  
  const color = stateColors[marketState.state] || 'var(--muted)';
  const scorePercent = Math.round(marketState.score);
  
  stateEl.innerHTML = `
    <div class="market-state-card">
      <div class="market-state-header">
        <span class="market-state-label">NFL Market State</span>
        <span class="market-state-badge" style="background: ${color}20; color: ${color};">
          ${stateLabels[marketState.state]}
        </span>
      </div>
      <div class="market-state-bar">
        <div class="market-state-bar-fill" style="width: ${scorePercent}%; background: ${color};"></div>
      </div>
      <div class="market-state-rec">${marketState.recommendation}</div>
      <div class="market-state-stats">
        <span>${marketState.positiveMarkets}/${marketState.totalMarkets} markets favorable</span>
        <span>Avg EV: ${marketState.avgExpectedValue >= 0 ? '+' : ''}$${marketState.avgExpectedValue.toFixed(2)}</span>
      </div>
    </div>
  `;
}

function renderMarketAnalytics() {
  marketAnalyticsList.innerHTML = "";
  const stateEl = document.getElementById('market-state');
  if (stateEl) stateEl.innerHTML = '';
  
  if (!state.nfl || !state.markets || state.markets.length === 0) {
    marketAnalyticsList.innerHTML = '<div class="analytics-empty">No NFL insights or markets available. Search for an NFL game to see P&L analytics.</div>';
    return;
  }

  // Get top 2 markets and calculate P&L based on ESPN data
  const topMarkets = state.markets.slice(0, 2);
  const marketAnalyses = topMarkets
    .map(market => {
      const analysis = analyzeMarketWithNflInsight(market, state.nfl);
      if (!analysis) return null;
      
      const pnl = calculatePnL(market, analysis.espnProbability, 100);
      const explanation = generatePlainEnglishExplanation(market, state.nfl, pnl);
      
      return { ...analysis, pnl, explanation };
    })
    .filter(a => a !== null);

  if (marketAnalyses.length === 0) {
    marketAnalyticsList.innerHTML = '<div class="analytics-empty">Markets don\'t match current NFL matchup. Try searching for a game with the teams shown in NFL Insight.</div>';
    return;
  }

  // Render overall market state
  const marketState = calculateOverallMarketState(marketAnalyses, state.nfl);
  renderMarketState(marketState);

  for (const analysis of marketAnalyses) {
    const card = document.createElement("div");
    card.className = "pnl-card";
    
    const pnl = analysis.pnl;
    const marketProb = analysis.marketProbability;
    const probPercent = Math.round(marketProb * 100);
    const profitColor = pnl.profitIfYes > 0 ? "var(--accent-2)" : "var(--accent)";
    const lossColor = "var(--accent)";
    
    card.innerHTML = `
      <div class="pnl-card-header">
        <h3 class="pnl-market-title">${analysis.market.title}</h3>
        <div class="pnl-probability">${probPercent}% probability</div>
      </div>

      <div class="pnl-quick-view">
        <div class="pnl-mini-graph">
          <div class="pnl-mini-bar profit-mini" style="height: ${Math.min(100, (Math.abs(pnl.profitIfYes) / 50) * 100)}%; background: ${profitColor};">
            <span class="pnl-mini-label">+$${pnl.profitIfYes.toFixed(0)}</span>
          </div>
          <div class="pnl-mini-bar loss-mini" style="height: ${Math.min(100, (Math.abs(pnl.lossIfNo) / 50) * 100)}%; background: ${lossColor};">
            <span class="pnl-mini-label">-$${Math.abs(pnl.lossIfNo).toFixed(0)}</span>
          </div>
        </div>
      </div>

      <div class="pnl-numbers">
        <div class="pnl-number">
          <span class="pnl-number-label">Profit if YES</span>
          <span class="pnl-number-value" style="color: ${profitColor}">+$${pnl.profitIfYes.toFixed(0)}</span>
        </div>
        <div class="pnl-number">
          <span class="pnl-number-label">Loss if NO</span>
          <span class="pnl-number-value" style="color: ${lossColor}">$${pnl.lossIfNo.toFixed(0)}</span>
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
