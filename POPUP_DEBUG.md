# Extension Popup Debugging Guide

## Quick Test: Open Popup DevTools

1. **Open the extension popup** (click extension icon)
2. **Right-click anywhere inside the popup**
3. **Select "Inspect"** (or press F12)
4. **Go to Console tab**
5. **Look for errors** (red text)

## Manual Demo Mode Test

In the popup console (after opening DevTools), paste:

```javascript
// Trigger demo mode manually
const demoGameData = {
  title: 'Denver Nuggets vs Los Angeles Lakers - LIVE',
  teams: ['Denver Nuggets', 'Los Angeles Lakers'],
  isLive: true,
  url: 'https://www.nba.com/watch/demo'
};

// Show live event UI
document.getElementById('liveEventBanner').classList.remove('hidden');
document.getElementById('timingIndicator').classList.remove('hidden');
document.getElementById('marketsSection').classList.remove('hidden');
document.getElementById('analyticsSection').classList.remove('hidden');
document.getElementById('noLiveEvent').classList.add('hidden');
document.getElementById('gameTitle').textContent = demoGameData.title;

// Load markets
chrome.runtime.sendMessage(
  { type: 'FETCH_POLYMARKET_MARKETS', keywords: ['NBA', 'basketball', 'moneyline', 'spread', 'totals'] },
  (response) => {
    if (response && response.markets) {
      console.log('Markets received:', response.markets);
      // Markets should display automatically
    } else {
      console.error('No markets received', response);
    }
  }
);
```

## Common Issues

### Issue: Charts Not Loading
**Check:** Is Chart.js loaded?
```javascript
console.log(typeof Chart); // Should be "function"
```
**Fix:** Check network tab for Chart.js CDN loading

### Issue: No Markets Showing
**Check:** Are markets being fetched?
```javascript
chrome.runtime.sendMessage({ type: 'FETCH_POLYMARKET_MARKETS', keywords: ['NBA'] }, console.log);
```
**Fix:** Check background script console for errors

### Issue: Button Not Working
**Check:** Is button element found?
```javascript
console.log(document.getElementById('demoBtn')); // Should show button element
```
**Fix:** Reload extension in chrome://extensions/

