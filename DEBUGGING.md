# Debugging Guide - Why Nothing Is Changing

## ✅ Quick Fix Steps

### Step 1: Fix the LiveKit Agent Crash

I just fixed the `TrackKind` import error. **Restart your services:**

1. In terminal where services are running, press **Ctrl+C** to stop
2. Kill any existing processes:
   ```bash
   lsof -ti:8787 | xargs kill -9 2>/dev/null || true
   ```
3. Restart services:
   ```bash
   export LIVEKIT_URL="wss://your-url"
   export LIVEKIT_TOKEN="your-token"
   npm run demo
   ```

### Step 2: Check Extension Console

1. Go to the NBA live page (e.g., https://www.nba.com/watch/featured)
2. **Open Chrome DevTools** (F12)
3. Click **Console** tab
4. Look for:
   - ✅ `"Live game detected"` or similar messages
   - ❌ Any red error messages
   - ✅ Network requests to your backend

### Step 3: Check Extension Background Page

1. Go to `chrome://extensions/`
2. Find your extension
3. Click **"service worker"** (or "background page")
4. Check the console for:
   - ✅ WebSocket connection messages
   - ❌ Connection errors
   - ✅ Messages about detecting live events

### Step 4: Verify Services Are Running

Check your terminal logs:

**Good signs:**
- ✅ `[ws-hub] listening on ws://localhost:8787`
- ✅ `[gemini-worker] connected to ws://localhost:8787`
- ✅ `[market-matcher] connected to ws://localhost:8787`
- ✅ `[livekit-agent] connected to ws://localhost:8787` (after fix)

**Bad signs:**
- ❌ `SyntaxError` (crash)
- ❌ `EADDRINUSE` (port conflict)
- ❌ `LIVEKIT_URL and LIVEKIT_TOKEN must be set`

### Step 5: Test Live Detection Manually

On the NBA page, open Console (F12) and run:

```javascript
// Check if extension detected live game
chrome.runtime.sendMessage({type: 'GET_GAME_DATA'}, console.log);

// Check if "LIVE" text is on page
console.log('LIVE text found:', document.body.textContent.includes('LIVE'));
```

## 🔍 Common Issues

### Issue: Content Script Not Running

**Check:**
- Is extension enabled in `chrome://extensions/`?
- Does the page URL match `https://www.nba.com/*`?
- Reload the page after installing extension

**Fix:**
- Reload extension in `chrome://extensions/`
- Reload the NBA page

### Issue: No "LIVE" Text Detected

The extension looks for the word "LIVE" on the page. If it's not found:

**Check:**
- Open Console on NBA page
- Run: `document.body.textContent.includes('LIVE')`
- If false, the page doesn't have "LIVE" text

**Fix:**
- Try a different NBA page
- Or use "Try Demo Mode" button in extension popup

### Issue: WebSocket Not Connecting

The extension background script connects to `ws://localhost:8787`.

**Check:**
1. Open extension background page console
2. Look for WebSocket connection messages
3. Check if port 8787 is listening:
   ```bash
   lsof -i :8787
   ```

**Fix:**
- Make sure `ws-hub` service is running
- Check firewall isn't blocking localhost connections

### Issue: Services Crashed

**Check logs:**
```bash
cat .demo-ws-hub.log
cat .demo-livekit-agent.log
cat .demo-gemini-worker.log
cat .demo-market-matcher.log
```

**Fix:**
- Restart services
- Fix any errors shown in logs

## 🧪 Test Flow

1. ✅ Services running (check terminal)
2. ✅ Extension loaded (check `chrome://extensions/`)
3. ✅ On NBA live page (check URL)
4. ✅ Console open (F12)
5. ✅ Click extension icon - does popup show?
6. ✅ Check background page console for errors
7. ✅ Check network tab for requests

## 🚨 Still Not Working?

**Check these in order:**

1. **Extension service worker console** - Any errors?
2. **Page console** - Any errors from content script?
3. **Terminal logs** - Are all services actually running?
4. **WebSocket connection** - Is extension connecting to ws://localhost:8787?
5. **Live detection** - Is the page actually detecting "LIVE" text?

**Share what you see in:**
- Extension background page console
- NBA page console
- Terminal logs

This will help identify the exact issue!

