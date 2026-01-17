# Polymarket Live Betting Assistant

A Chrome extension that provides real-time Polymarket betting recommendations based on live NBA game commentary.

## Features

- 🔴 **Live Event Detection** - Automatically detects live NBA games on NBA.com
- 🎤 **Real-time Audio Transcription** - Uses LiveKit (or Web Speech API fallback) to transcribe game commentary
- 🤖 **AI-Powered Analysis** - Google Gemini API analyzes commentary for betting insights
- 📊 **Real-time Market Analytics** - Visualizations showing probability shock bands and P&L curves
- 🎯 **Top 3 Relevant Markets** - Displays the most relevant Polymarket markets for the live game
- ⚡ **Timing Indicators** - Shows market volatility and optimal betting moments

## Setup Instructions

### 1. Install the Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `nexhacks` folder

### 2. Configure API Keys

#### Gemini API Key (Optional but Recommended)

1. Get your API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Open Chrome DevTools Console (F12) on any page
3. Run this command:
   ```javascript
   chrome.storage.sync.set({gemini_api_key: 'YOUR_API_KEY_HERE'})
   ```
4. Or click the Settings button in the extension popup for instructions

#### LiveKit Setup (Optional)

For production use, set up a LiveKit server:
- Use [LiveKit Cloud](https://cloud.livekit.io/) or self-host
- Configure token generation endpoint
- Update `LIVEKIT_URL` and `getLiveKitToken()` in `content.js`

**Note:** The extension will work without LiveKit using Web Speech API fallback for development.

### 3. Usage

1. Navigate to [NBA.com Watch](https://www.nba.com/watch/featured)
2. Open a live game (look for "LIVE" indicator)
3. Click the extension icon in Chrome toolbar
4. View real-time betting recommendations and analytics

## How It Works

1. **Detection**: Content script monitors NBA.com for live game indicators
2. **Transcription**: Captures and transcribes audio commentary from the live stream
3. **Analysis**: Gemini API analyzes commentary for key events (injuries, momentum shifts)
4. **Market Matching**: Fetches relevant Polymarket markets based on game context
5. **Visualization**: Displays probability shock bands, P&L curves, and timing indicators

## File Structure

```
nexhacks/
├── manifest.json          # Extension manifest
├── background.js          # Service worker for background tasks
├── content.js            # Content script for NBA site detection
├── popup.html            # Extension popup UI
├── popup.css             # Popup styling
├── popup.js              # Popup functionality
├── icons/                # Extension icons
│   └── icon.png          # (Add your icon here)
└── README.md             # This file
```

## Development Notes

- **Mock Data**: The extension uses mock Polymarket data for development. Replace `getMockMarkets()` in `background.js` with actual API calls for production.
- **Speech Recognition**: Falls back to Web Speech API if LiveKit is not configured
- **Demo Mode**: Includes simulated transcription for testing without live games

## API Integration

### Polymarket API

Update the `fetchPolymarketMarkets()` function in `background.js` with the correct Polymarket API endpoint and authentication.

### Gemini API

The extension uses Google's Gemini Pro model. Ensure you have:
- Valid API key
- API enabled in Google Cloud Console
- Sufficient quota

## Troubleshooting

- **No live event detected**: Make sure you're on a page with a visible "LIVE" indicator
- **No markets showing**: Check browser console for API errors
- **Transcription not working**: Verify microphone permissions or configure LiveKit
- **Charts not displaying**: Ensure Chart.js CDN is accessible

## Future Enhancements

- [ ] Real Polymarket API integration
- [ ] LiveKit server setup guide
- [ ] Settings page UI
- [ ] Historical data analysis
- [ ] User preference profiles
- [ ] Mobile notifications

## License

MIT License - Feel free to modify and use for your projects.
