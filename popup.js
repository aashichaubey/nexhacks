// Popup script for Chrome extension

let probabilityChart = null;
let pnlChart = null;
let currentMarkets = [];
let currentAnalysis = null;

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadGameData();
  setupCharts();
  setupMessageListener();
  
  // Refresh every 2 seconds
  setInterval(loadGameData, 2000);
});

// Load game data from background script
async function loadGameData() {
  chrome.runtime.sendMessage({ type: 'GET_GAME_DATA' }, async (response) => {
    if (response && response.liveEventDetected && response.gameData) {
      showLiveEvent(response.gameData);
      await loadMarkets(response.gameData);
    } else {
      showNoLiveEvent();
    }
  });
}

// Show live event UI
function showLiveEvent(gameData) {
  document.getElementById('liveEventBanner').classList.remove('hidden');
  document.getElementById('timingIndicator').classList.remove('hidden');
  document.getElementById('marketsSection').classList.remove('hidden');
  document.getElementById('analyticsSection').classList.remove('hidden');
  document.getElementById('noLiveEvent').classList.add('hidden');
  
  document.getElementById('gameTitle').textContent = gameData.title || 'Live NBA Game';
}

// Show no live event message
function showNoLiveEvent() {
  document.getElementById('liveEventBanner').classList.add('hidden');
  document.getElementById('timingIndicator').classList.add('hidden');
  document.getElementById('marketsSection').classList.add('hidden');
  document.getElementById('analyticsSection').classList.add('hidden');
  document.getElementById('noLiveEvent').classList.remove('hidden');
}

// Load markets from Polymarket
async function loadMarkets(gameData) {
  const keywords = [
    ...gameData.teams,
    'NBA',
    'basketball',
    'moneyline',
    'spread',
    'totals'
  ];
  
  chrome.runtime.sendMessage(
    { type: 'FETCH_POLYMARKET_MARKETS', keywords },
    (response) => {
      if (response && response.markets) {
        currentMarkets = response.markets;
        displayMarkets(response.markets);
      }
    }
  );
}

// Display markets in UI
function displayMarkets(markets) {
  const marketsList = document.getElementById('marketsList');
  marketsList.innerHTML = '';
  
  // Show top 3 markets
  const topMarkets = markets.slice(0, 3);
  
  topMarkets.forEach((market, index) => {
    const marketCard = createMarketCard(market, index + 1);
    marketsList.appendChild(marketCard);
  });
}

// Create market card element
function createMarketCard(market, index) {
  const card = document.createElement('div');
  card.className = 'market-card';
  
  const insights = generateInsights(market, index);
  
  card.innerHTML = `
    <div class="market-title">${index}. ${market.question}</div>
    <div class="market-insights">${insights}</div>
    <div class="market-stats">
      <span>24h Volume: $${formatNumber(market.volume24h)}</span>
      <span>Liquidity: $${formatNumber(market.liquidity)}</span>
    </div>
    <a href="https://polymarket.com/event/${market.slug}" target="_blank" class="market-link">
      View on Polymarket →
    </a>
  `;
  
  return card;
}

// Generate insights based on market type and analysis
function generateInsights(market, index) {
  if (currentAnalysis) {
    if (index === 1) {
      return currentAnalysis.moneylineImpact || 'Market activity spike / uncertainty';
    } else if (index === 2) {
      return currentAnalysis.spreadImpact || 'Defensive resistance likely reduced';
    } else if (index === 3) {
      return currentAnalysis.totalsImpact || 'Pace may increase → scoring pressure';
    }
  }
  
  // Default insights
  const defaultInsights = [
    'Denver momentum uncertain. Key defender impact removed. Rotation disruption visible.',
    'Opponent scoring pressure increases. Defensive resistance likely reduced. Matchups shifting.',
    'Pace may increase → scoring pressure. Less defensive pressure. Faster possessions likely.'
  ];
  
  return defaultInsights[index - 1] || 'Market analysis available';
}

// Format number with commas
function formatNumber(num) {
  return num.toLocaleString();
}

// Setup charts
function setupCharts() {
  const probCtx = document.getElementById('probabilityChart').getContext('2d');
  const pnlCtx = document.getElementById('pnlChart').getContext('2d');
  
  // Probability Shock Band Chart
  probabilityChart = new Chart(probCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Market Price',
        data: [],
        borderColor: 'rgb(102, 126, 234)',
        backgroundColor: 'rgba(102, 126, 234, 0.1)',
        fill: true
      }, {
        label: 'Upper Bound',
        data: [],
        borderColor: 'rgb(255, 99, 132)',
        borderDash: [5, 5],
        fill: false
      }, {
        label: 'Lower Bound',
        data: [],
        borderColor: 'rgb(75, 192, 192)',
        borderDash: [5, 5],
        fill: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      scales: {
        y: {
          beginAtZero: false,
          min: 0,
          max: 1,
          ticks: {
            callback: function(value) {
              return (value * 100).toFixed(0) + '%';
            }
          }
        }
      },
      plugins: {
        legend: {
          display: true,
          position: 'bottom'
        }
      }
    }
  });
  
  // P&L vs Time Chart
  pnlChart = new Chart(pnlCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'P&L',
        data: [],
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.1)',
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              return '$' + value.toFixed(2);
            }
          }
        }
      },
      plugins: {
        legend: {
          display: true,
          position: 'bottom'
        }
      }
    }
  });
  
  // Simulate data updates
  simulateChartData();
  
  // Update charts periodically
  setInterval(updateCharts, 3000);
}

// Simulate chart data (replace with real data)
function simulateChartData() {
  updateCharts();
}

// Update charts with new data
function updateCharts() {
  const now = Date.now();
  const timePoints = [];
  const marketPrices = [];
  const upperBounds = [];
  const lowerBounds = [];
  const pnlData = [];
  const pnlLabels = [];
  
  // Generate data for last 5 minutes
  for (let i = 20; i >= 0; i--) {
    const time = new Date(now - i * 15000); // 15 second intervals
    timePoints.push(time.toLocaleTimeString());
    pnlLabels.push(time.toLocaleTimeString());
    
    // Simulate market price around 0.63
    const basePrice = 0.63;
    const shock = i < 5 ? -0.15 : 0; // Injury shock in last 5 points
    const price = basePrice + shock + (Math.random() - 0.5) * 0.05;
    marketPrices.push(Math.max(0, Math.min(1, price)));
    
    // Confidence band
    upperBounds.push(Math.max(0, Math.min(1, price + 0.1)));
    lowerBounds.push(Math.max(0, Math.min(1, price - 0.1)));
    
    // P&L simulation
    const pnl = (price - basePrice) * 1000;
    pnlData.push(pnl);
  }
  
  if (probabilityChart) {
    probabilityChart.data.labels = timePoints;
    probabilityChart.data.datasets[0].data = marketPrices;
    probabilityChart.data.datasets[1].data = upperBounds;
    probabilityChart.data.datasets[2].data = lowerBounds;
    probabilityChart.update('none'); // 'none' for smooth updates
  }
  
  if (pnlChart) {
    pnlChart.data.labels = pnlLabels;
    pnlChart.data.datasets[0].data = pnlData;
    pnlChart.update('none');
  }
  
  // Update timing indicator
  updateTimingIndicator(marketPrices);
}

// Update timing indicator based on volatility
function updateTimingIndicator(prices) {
  const recentPrices = prices.slice(-5);
  const volatility = calculateVolatility(recentPrices);
  
  const indicatorDot = document.getElementById('indicatorDot');
  const timingText = document.getElementById('timingText');
  
  if (!indicatorDot || !timingText) return;
  
  if (volatility < 0.02) {
    indicatorDot.className = 'indicator-dot';
    timingText.textContent = '🟢 Stable – little change happening';
  } else if (volatility < 0.05) {
    indicatorDot.className = 'indicator-dot yellow';
    timingText.textContent = '🟡 Moderate volatility — situation developing';
  } else {
    indicatorDot.className = 'indicator-dot red';
    timingText.textContent = '🔴 Resolving Soon – decision moment';
  }
}

// Calculate volatility
function calculateVolatility(prices) {
  if (prices.length < 2) return 0;
  
  const mean = prices.reduce((a, b) => a + b) / prices.length;
  const variance = prices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / prices.length;
  return Math.sqrt(variance);
}

// Listen for analysis updates from content script
function setupMessageListener() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'ANALYSIS_UPDATE') {
      currentAnalysis = request.analysis;
      // Update UI with new analysis
      if (currentMarkets.length > 0) {
        displayMarkets(currentMarkets);
      }
      
      // Update timing indicator based on analysis
      if (request.analysis.confidence === 'High') {
        const indicatorDot = document.getElementById('indicatorDot');
        const timingText = document.getElementById('timingText');
        if (indicatorDot && timingText) {
          indicatorDot.className = 'indicator-dot red';
          timingText.textContent = '🔴 High confidence signal — action recommended';
        }
      }
    }
  });
}

// Demo mode button
document.getElementById('demoBtn')?.addEventListener('click', () => {
  // Show demo data
  const demoGameData = {
    title: 'Denver Nuggets vs Los Angeles Lakers - LIVE',
    teams: ['Denver Nuggets', 'Los Angeles Lakers'],
    isLive: true,
    url: 'https://www.nba.com/watch/demo'
  };
  
  showLiveEvent(demoGameData);
  loadMarkets(demoGameData);
  
  // Simulate analysis update
  setTimeout(() => {
    currentAnalysis = {
      events: [{ type: 'injury', keyword: 'ankle', text: 'Possible injury — Peyton Watson leaves the floor' }],
      moneylineImpact: 'Key defender impact removed. Rotation disruption visible. Market uncertainty increasing.',
      spreadImpact: 'Opponent scoring pressure increases. Defensive resistance likely reduced. Matchups shifting.',
      totalsImpact: 'Pace may increase → scoring pressure. Less defensive pressure. Faster possessions likely.',
      confidence: 'High',
      recommendation: 'Monitor market closely'
    };
    
    if (currentMarkets.length > 0) {
      displayMarkets(currentMarkets);
    }
    
    // Update timing indicator to show volatility
    const indicatorDot = document.getElementById('indicatorDot');
    const timingText = document.getElementById('timingText');
    if (indicatorDot && timingText) {
      indicatorDot.className = 'indicator-dot yellow';
      timingText.textContent = '🟡 Moderate volatility — situation developing';
    }
  }, 500);
});

// Settings button
document.getElementById('settingsBtn')?.addEventListener('click', () => {
  // Open settings page (implement as needed)
  // For now, just show an alert
  alert('Settings: Add your Gemini API key in Chrome storage with key "gemini_api_key"');
});

