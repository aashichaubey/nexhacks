// Background service worker for Chrome extension

let liveEventDetected = false;
let currentGameData = null;
let transcriptionActive = false;

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'LIVE_EVENT_DETECTED') {
    liveEventDetected = true;
    currentGameData = request.gameData;
    startTranscription(request.videoUrl);
    sendResponse({ success: true });
  } else if (request.type === 'GET_GAME_DATA') {
    sendResponse({ gameData: currentGameData, liveEventDetected });
  } else if (request.type === 'FETCH_POLYMARKET_MARKETS') {
    fetchPolymarketMarkets(request.keywords)
      .then(markets => sendResponse({ markets }))
      .catch(error => sendResponse({ error: error.message }));
    return true; // Keep channel open for async response
  }00
});

// Detect live game on NBA website
async function startTranscription(videoUrl) {
  if (transcriptionActive) return;
  
  transcriptionActive = true;
  console.log('Starting LiveKit transcription for:', videoUrl);
  
  // LiveKit transcription will be handled in content script
  // This is a placeholder for service worker coordination
}

// Fetch Polymarket markets based on keywords
async function fetchPolymarketMarkets(keywords) {
  try {
    // Polymarket API endpoint (adjust based on actual API)
    const searchQuery = keywords.join(' ');
    const response = await fetch(
      `https://clob.polymarket.com/markets?search=${encodeURIComponent(searchQuery)}&active=true`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        }
      }
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch Polymarket data');
    }
    
    const data = await response.json();
    return data.markets || [];
  } catch (error) {
    console.error('Error fetching Polymarket markets:', error);
    // Return mock data for development
    return getMockMarkets(keywords);
  }
}

// Mock markets for development/testing
function getMockMarkets(keywords) {
  return [
    {
      id: 'market-1',
      question: 'Denver Nuggets Moneyline',
      slug: 'denver-nuggets-moneyline',
      outcomes: [
        { name: 'Denver Wins', price: 0.63 },
        { name: 'Opponent Wins', price: 0.37 }
      ],
      volume24h: 125000,
      liquidity: 50000
    },
    {
      id: 'market-2',
      question: 'Game Spread - Denver -5.5',
      slug: 'denver-spread-5-5',
      outcomes: [
        { name: 'Denver Covers', price: 0.55 },
        { name: 'Opponent Covers', price: 0.45 }
      ],
      volume24h: 89000,
      liquidity: 35000
    },
    {
      id: 'market-3',
      question: 'Total Points Over/Under 225.5',
      slug: 'total-points-225-5',
      outcomes: [
        { name: 'Over', price: 0.48 },
        { name: 'Under', price: 0.52 }
      ],
      volume24h: 110000,
      liquidity: 42000
    }
  ];
}

