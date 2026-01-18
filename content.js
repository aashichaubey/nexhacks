// Content script for NBA website detection and LiveKit integration

let liveKitRoom = null;
let transcriptionText = '';
let gameInfo = null;
let geminiAnalysis = null;

// Check if page has live game
function detectLiveGame() {
  // Look for LIVE banner or indicator
  const liveBanner = document.querySelector('[class*="live"], [class*="LIVE"], [data-live="true"]');
  const liveText = Array.from(document.querySelectorAll('*')).find(el => 
    el.textContent?.includes('LIVE') && el.textContent.length < 20
  );
  
  if (liveBanner || liveText) {
    // Extract game information
    const gameTitle = document.querySelector('h1, [class*="title"], [class*="game"]')?.textContent || 'Live Game';
    const teams = extractTeams();
    
    gameInfo = {
      title: gameTitle,
      teams: teams,
      isLive: true,
      url: window.location.href
    };
    
    // Find video element
    const videoElement = document.querySelector('video');
    console.log('[content] Video element found:', !!videoElement);
    if (videoElement) {
      console.log('[content] Video src:', videoElement.src || videoElement.currentSrc);
      startLiveKitTranscription(videoElement);
    } else {
      console.warn('[content] ⚠ No video element found on page');
    }
    
    // Notify background script
    chrome.runtime.sendMessage({
      type: 'LIVE_EVENT_DETECTED',
      gameData: gameInfo,
      videoUrl: window.location.href
    });
    
    return true;
  }
  return false;
}

function extractTeams() {
  // Extract team names from page
  const teamElements = document.querySelectorAll('[class*="team"], [class*="Team"]');
  const teams = [];
  
  teamElements.forEach(el => {
    const text = el.textContent?.trim();
    if (text && text.length < 30 && !teams.includes(text)) {
      teams.push(text);
    }
  });
  
  return teams.length >= 2 ? teams : ['Team A', 'Team B'];
}

// Initialize LiveKit transcription
async function startLiveKitTranscription(videoElement) {
  console.log('[content] Starting LiveKit transcription...');
  try {
    // Get LiveKit credentials from Chrome storage or environment
    const LIVEKIT_URL = await getStoredAPIKey('livekit_url') || 'wss://newhacks-wi12uwg4.livekit.cloud';
    const LIVEKIT_TOKEN = await getLiveKitToken(); // Generate token for browser
    
    console.log('[content] LiveKit URL:', LIVEKIT_URL);
    console.log('[content] LiveKit Token:', LIVEKIT_TOKEN ? 'Found (' + LIVEKIT_TOKEN.substring(0, 20) + '...)' : 'Missing');
    
    const { Room, RoomEvent, RemoteTrackPublication } = await import('https://unpkg.com/livekit-client@latest/dist/livekit-client.esm.js');
    
    liveKitRoom = new Room();
    
    // Connect to LiveKit room (use same room name as agent: "nexhacks")
    console.log('[content] Connecting to LiveKit room...');
    await liveKitRoom.connect(LIVEKIT_URL, LIVEKIT_TOKEN, {
      autoSubscribe: true,
    });
    console.log('[content] ✓ Connected to LiveKit room');
    
    // Set up transcription listener
    liveKitRoom.on(RoomEvent.TranscriptionReceived, (transcription) => {
      console.log('[content] 📝 Received transcription:', transcription.text);
      transcriptionText += transcription.text + ' ';
      
      // Analyze transcription with Gemini
      analyzeWithGemini(transcription.text);
    });
    
    // Capture audio from video element
    console.log('[content] Capturing audio from video element...');
    const stream = videoElement.captureStream();
    const audioTracks = stream.getAudioTracks();
    console.log('[content] Audio tracks found:', audioTracks.length);
    
    if (audioTracks.length > 0) {
      console.log('[content] Publishing audio track to LiveKit...');
      await liveKitRoom.localParticipant.publishTrack(audioTracks[0], {
        source: 'microphone',
        name: 'game-audio'
      });
      console.log('[content] ✓ Audio track published! LiveKit should now transcribe.');
    } else {
      console.warn('[content] ⚠ No audio tracks found in video stream');
    }
    
    console.log('[content] ✅ LiveKit transcription setup complete');
  } catch (error) {
    console.error('Error starting LiveKit transcription:', error);
    // Fallback: Use Web Speech API for development
    startFallbackTranscription(videoElement);
  }
}

// Fallback transcription using Web Speech API (for development)
function startFallbackTranscription(videoElement) {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    console.warn('Speech recognition not available');
    // Simulate transcription for demo
    simulateTranscription();
    return;
  }
  
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  
  recognition.onresult = (event) => {
    let interimTranscript = '';
    let finalTranscript = '';
    
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript + ' ';
        transcriptionText += transcript + ' ';
        analyzeWithGemini(transcript);
      } else {
        interimTranscript += transcript;
      }
    }
  };
  
  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    // Fallback to simulation
    simulateTranscription();
  };
  
  try {
    recognition.start();
  } catch (error) {
    console.error('Failed to start speech recognition:', error);
    simulateTranscription();
  }
}

// Simulate transcription for demo purposes
function simulateTranscription() {
  const demoTranscripts = [
    "Peyton Watson is giving them huge energy off the bench — he's locking down on defense and changing the pace of this game.",
    "Possible injury — Peyton Watson leaves the floor",
    "Denver's momentum is shifting with this defensive pressure",
    "The pace of the game is picking up significantly",
    "Key defender impact removed from the rotation"
  ];
  
  let index = 0;
  const interval = setInterval(() => {
    if (index < demoTranscripts.length) {
      const text = demoTranscripts[index];
      transcriptionText += text + ' ';
      analyzeWithGemini(text);
      index++;
    } else {
      clearInterval(interval);
    }
  }, 10000); // Every 10 seconds
}

// Analyze transcription with Gemini API
async function analyzeWithGemini(text) {
  const GEMINI_API_KEY = await getStoredAPIKey('gemini_api_key');
  if (!GEMINI_API_KEY) {
    console.warn('Gemini API key not set, using mock analysis');
    // Use mock analysis for demo
    useMockAnalysis(text);
    return;
  }
  
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Analyze this NBA game commentary and provide betting insights:
              
Commentary: "${text}"

Provide:
1. Key events (injuries, momentum shifts, player performance)
2. Impact on moneyline, spreads, and totals
3. Confidence level (High/Medium/Low)
4. Recommended action

Format as JSON with: {events: [], moneylineImpact: "", spreadImpact: "", totalsImpact: "", confidence: "", recommendation: ""}`
            }]
          }]
        })
      }
    );
    
    const data = await response.json();
    const analysisText = data.candidates[0].content.parts[0].text;
    
    // Parse JSON from response
    try {
      geminiAnalysis = JSON.parse(analysisText);
    } catch {
      // If not JSON, extract key info
      geminiAnalysis = {
        raw: analysisText,
        events: extractEvents(text),
        confidence: 'Medium'
      };
    }
    
    // Notify popup of new analysis
    chrome.runtime.sendMessage({
      type: 'ANALYSIS_UPDATE',
      analysis: geminiAnalysis,
      transcription: text
    });
    
  } catch (error) {
    console.error('Error analyzing with Gemini:', error);
    useMockAnalysis(text);
  }
}

// Mock analysis for demo
function useMockAnalysis(text) {
  const lowerText = text.toLowerCase();
  let moneylineImpact = 'Market activity spike / uncertainty';
  let spreadImpact = 'Defensive resistance likely reduced';
  let totalsImpact = 'Pace may increase → scoring pressure';
  let confidence = 'Medium';
  
  if (lowerText.includes('injury') || lowerText.includes('leaves') || lowerText.includes('ankle')) {
    moneylineImpact = 'Key defender impact removed. Rotation disruption visible. Market uncertainty increasing.';
    spreadImpact = 'Opponent scoring pressure increases. Defensive resistance likely reduced. Matchups shifting.';
    totalsImpact = 'Pace may increase → scoring pressure. Less defensive pressure. Faster possessions likely.';
    confidence = 'High';
  } else if (lowerText.includes('momentum') || lowerText.includes('energy') || lowerText.includes('defense')) {
    moneylineImpact = 'Momentum shift detected. Market activity increasing.';
    spreadImpact = 'Defensive pressure changing game dynamics.';
    totalsImpact = 'Game pace affecting scoring opportunities.';
    confidence = 'Medium';
  }
  
  geminiAnalysis = {
    events: extractEvents(text),
    moneylineImpact,
    spreadImpact,
    totalsImpact,
    confidence,
    recommendation: 'Monitor market closely'
  };
  
  chrome.runtime.sendMessage({
    type: 'ANALYSIS_UPDATE',
    analysis: geminiAnalysis,
    transcription: text
  });
}

function extractEvents(text) {
  const events = [];
  const injuryKeywords = ['injury', 'hurt', 'ankle', 'knee', 'out', 'leaves'];
  const momentumKeywords = ['momentum', 'energy', 'defense', 'offense', 'pressure'];
  
  injuryKeywords.forEach(keyword => {
    if (text.toLowerCase().includes(keyword)) {
      events.push({ type: 'injury', keyword, text });
    }
  });
  
  momentumKeywords.forEach(keyword => {
    if (text.toLowerCase().includes(keyword)) {
      events.push({ type: 'momentum', keyword, text });
    }
  });
  
  return events;
}

// Get stored API key
async function getStoredAPIKey(key) {
  return new Promise((resolve) => {
    chrome.storage.sync.get([key], (result) => {
      resolve(result[key]);
    });
  });
}

// Get LiveKit token (implement based on your LiveKit setup)
async function getLiveKitToken() {
  // Try to get token from storage first
  const storedToken = await getStoredAPIKey('livekit_token');
  if (storedToken && storedToken !== 'placeholder-token') {
    console.log('[content] Using LiveKit token from Chrome storage');
    return storedToken;
  }
  
  // TODO: Generate token on backend or use token from .env
  // For now, you need to set it in Chrome storage:
  // chrome.storage.sync.set({livekit_token: 'your-token-here'})
  console.error('[content] ❌ LiveKit token not found in Chrome storage!');
  console.error('[content] Set it with: chrome.storage.sync.set({livekit_token: "your-token-here"})');
  return 'placeholder-token';
}

// Monitor page for live game
function monitorPage() {
  // Check immediately
  if (detectLiveGame()) {
    return;
  }
  
  // Check periodically
  const observer = new MutationObserver(() => {
    if (!gameInfo?.isLive) {
      detectLiveGame();
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // Also check every 5 seconds
  setInterval(() => {
    if (!gameInfo?.isLive) {
      detectLiveGame();
    }
  }, 5000);
}

// Start monitoring when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', monitorPage);
} else {
  monitorPage();
}

