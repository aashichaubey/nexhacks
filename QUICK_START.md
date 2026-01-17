# Quick Start Guide - See Your Extension in Action! 🚀

## Step 1: Load the Extension (2 minutes)

1. **Open Chrome** and go to: `chrome://extensions/`
   - Or: Menu (⋮) → Extensions → Manage Extensions

2. **Enable Developer Mode**
   - Toggle the switch in the top-right corner

3. **Click "Load unpacked"**
   - Select the `nexhacks` folder
   - The extension should appear in your extensions list

4. **Pin the Extension** (optional but helpful)
   - Click the puzzle piece icon (🧩) in Chrome toolbar
   - Find "Polymarket Live Betting Assistant"
   - Click the pin icon to keep it visible

## Step 2: See It in Action (3 ways)

### Option A: Demo Mode (Instant - No setup needed!)

1. **Click the extension icon** in your Chrome toolbar
2. **Click "🎮 Try Demo Mode"** button
3. **See the full UI** with:
   - Live event banner
   - Top 3 markets
   - Real-time charts
   - Timing indicators

### Option B: Test on NBA.com

1. Go to: https://www.nba.com/watch/featured
2. Look for any page with "LIVE" text visible
3. Click the extension icon
4. The extension will detect it and show markets

### Option C: Simulate Live Game Detection

1. Go to any webpage
2. Open Chrome DevTools (F12)
3. Run this in the console:
   ```javascript
   // Create a fake LIVE element
   const liveDiv = document.createElement('div');
   liveDiv.textContent = 'LIVE';
   liveDiv.style.cssText = 'position:fixed;top:10px;right:10px;background:red;color:white;padding:10px;z-index:9999;';
   document.body.appendChild(liveDiv);
   ```
4. Click the extension icon - it should detect the "LIVE" text!

## Step 3: Explore the Features

Once you see the popup, you'll see:

### 🔴 Live Event Banner
- Red pulsing banner when live event detected
- Game title displayed

### ⚡ Timing Indicator
- 🟢 Green = Stable market
- 🟡 Yellow = Moderate volatility  
- 🔴 Red = High volatility / action needed

### 🎯 Top 3 Markets
- Moneyline bets
- Spread bets
- Totals (Over/Under)
- Each with insights and links to Polymarket

### 📊 Real-Time Charts
- **Probability Shock Band**: Shows how events affect win probability
- **P&L vs Time**: Profit/Loss simulation over time
- Charts update every 3 seconds

## Troubleshooting

### Extension icon not showing?
- Make sure you pinned it (see Step 1)
- Check `chrome://extensions/` - is it enabled?

### "No live event detected"?
- Use Demo Mode (Option A above) to see it immediately
- Or simulate a LIVE element (Option C)

### Charts not loading?
- Check browser console (F12) for errors
- Make sure you have internet (Chart.js loads from CDN)

### Popup is blank?
- Open DevTools on the popup:
  1. Right-click extension icon
  2. Select "Inspect popup"
  3. Check console for errors

## What You're Seeing

The extension is fully functional with:
- ✅ Mock Polymarket data (3 markets)
- ✅ Simulated analytics charts
- ✅ Demo mode for instant preview
- ✅ Real-time chart updates
- ✅ Beautiful UI with animations

## Next Steps

1. **Add Gemini API key** for real AI analysis:
   - Get key: https://makersuite.google.com/app/apikey
   - Run in console: `chrome.storage.sync.set({gemini_api_key: 'YOUR_KEY'})`

2. **Test on real NBA game**:
   - Visit nba.com during a live game
   - Extension will auto-detect

3. **Customize**:
   - Edit `background.js` for different markets
   - Modify `popup.css` for styling
   - Update `content.js` for detection logic

## Screenshots of What You'll See

- **Demo Mode**: Full UI with all features visible
- **Live Detection**: Automatic detection on NBA.com
- **Charts**: Animated probability and P&L visualizations
- **Markets**: Clickable cards linking to Polymarket

Enjoy exploring your extension! 🎉

