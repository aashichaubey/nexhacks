# Quick Setup Guide

## Step 1: Add Extension Icon

The extension needs an icon file. You have two options:

### Option A: Use the Icon Generator
1. Open `create_icon.html` in your browser
2. Click "Download Icon"
3. Move the downloaded `icon.png` to the `icons/` folder

### Option B: Use Your Own Icon
1. Create or download a 128x128 PNG image
2. Save it as `icons/icon.png`

**Note:** The extension will work without an icon, but Chrome will show a default puzzle piece icon.

## Step 2: Load Extension in Chrome

1. Open Chrome
2. Go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked**
5. Select the `nexhacks` folder

## Step 3: Configure API Key (Optional)

For full functionality with Gemini AI analysis:

1. Get API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Open Chrome DevTools Console (F12) on any page
3. Run:
   ```javascript
   chrome.storage.sync.set({gemini_api_key: 'YOUR_API_KEY_HERE'})
   ```

**Without API key:** Extension will use mock analysis (still functional for demo)

## Step 4: Test the Extension

1. Navigate to https://www.nba.com/watch/featured
2. Find a live game (look for "LIVE" indicator)
3. Click the extension icon in Chrome toolbar
4. You should see:
   - Live event banner
   - Top 3 Polymarket markets
   - Real-time analytics charts
   - Timing indicators

## Troubleshooting

- **Extension not loading:** Check `chrome://extensions/` for errors
- **No live event detected:** Make sure page has visible "LIVE" text
- **Charts not showing:** Check browser console for Chart.js loading errors
- **No markets:** Extension uses mock data - this is expected for development

## Next Steps

- Set up LiveKit server for production transcription
- Integrate real Polymarket API
- Customize market detection logic
- Add user preferences

