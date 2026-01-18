# API Keys Setup Guide

Complete step-by-step instructions to configure all required API keys for the NexHacks project.

---

## 📋 Overview

This project requires API keys for:
1. **Gemini API** - For Chrome extension AI analysis (optional, has mock fallback)
2. **LiveKit** - For live transcription service (URL and Token)

---

## 🔑 Step 1: Gemini API Key (Chrome Extension)

The Gemini API key is used by the Chrome extension for AI-powered game commentary analysis.

### 1.1 Get Your Gemini API Key

1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Click **"Create API Key"** or **"Get API Key"**
4. Select your Google Cloud project (or create a new one)
5. Copy the API key (looks like: `AIzaSyD...`)

### 1.2 Store the API Key in Chrome

You'll store the key in Chrome's sync storage using the browser console:

1. **Open Chrome** and navigate to any webpage (e.g., `https://www.google.com`)
2. **Open Chrome DevTools**:
   - Press `F12` (Windows/Linux) or `Cmd+Option+I` (Mac)
   - Or right-click the page → "Inspect"
3. **Open the Console tab** (or press `Ctrl+Shift+J` / `Cmd+Option+J`)
4. **Run this command** (replace `YOUR_API_KEY_HERE` with your actual key):
   ```javascript
   chrome.storage.sync.set({gemini_api_key: 'AIzaSyD...YOUR_API_KEY_HERE'}, function() {
     console.log('Gemini API key saved!');
   });
   ```
5. **Verify it was saved**:
   ```javascript
   chrome.storage.sync.get(['gemini_api_key'], function(result) {
     console.log('Saved key:', result.gemini_api_key ? '✓ Found' : '✗ Not found');
   });
   ```

### ✅ Verification

1. Load/reload the extension in Chrome (`chrome://extensions/`)
2. Navigate to a page with live content
3. Open DevTools Console (F12) - you should NOT see: `"Gemini API key not set, using mock analysis"`

**Note:** Without the API key, the extension will use mock analysis (still functional for demo purposes).

---

## 🎙️ Step 2: LiveKit Configuration (Live Transcription Service)

LiveKit is used for real-time audio transcription. You need a **LiveKit URL** and **Token**.

### 2.1 Option A: Use LiveKit Cloud (Recommended for Quick Start)

1. Sign up at [LiveKit Cloud](https://cloud.livekit.io/)
2. Create a new project
3. Go to **Settings** → **API Keys**
4. Copy:
   - **URL**: Something like `wss://your-project.livekit.cloud`
   - **API Key**: Your API key
   - **API Secret**: Your API secret

5. **Generate a token** for your agent:
   - Use LiveKit's [token generator](https://docs.livekit.io/realtime/server/access-tokens/)
   - Or use their SDK to generate one programmatically
   - Token should have permissions for: `roomJoin`, `canSubscribe`, `canPublish`

### 2.2 Option B: Self-Hosted LiveKit Server

If you're running your own LiveKit server:

1. Get your server URL (e.g., `wss://your-livekit-server.com`)
2. Generate an access token using your server's API key/secret
3. Follow LiveKit's [self-hosting guide](https://docs.livekit.io/home/self-hosting/)

### 2.3 Configure Environment Variables

Set environment variables when running the `livekit-agent` service:

**On macOS/Linux (Terminal):**
```bash
export LIVEKIT_URL="wss://your-project.livekit.cloud"
export LIVEKIT_TOKEN="your-token-here"
export LIVEKIT_TRANSCRIPTION_SOURCE="livekit"  # Optional, defaults to "livekit"
export WS_HUB_URL="ws://localhost:8787"  # Optional, defaults to this
```

**On Windows (Command Prompt):**
```cmd
set LIVEKIT_URL=wss://your-project.livekit.cloud
set LIVEKIT_TOKEN=your-token-here
set LIVEKIT_TRANSCRIPTION_SOURCE=livekit
set WS_HUB_URL=ws://localhost:8787
```

**On Windows (PowerShell):**
```powershell
$env:LIVEKIT_URL="wss://your-project.livekit.cloud"
$env:LIVEKIT_TOKEN="your-token-here"
$env:LIVEKIT_TRANSCRIPTION_SOURCE="livekit"
$env:WS_HUB_URL="ws://localhost:8787"
```

### 2.4 Using .env Files (Recommended for Development)

Create a `.env` file in the `services/livekit-agent/` directory:

```bash
# services/livekit-agent/.env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_TOKEN=your-token-here
LIVEKIT_TRANSCRIPTION_SOURCE=livekit
WS_HUB_URL=ws://localhost:8787
```

**Then use a package like `dotenv`** (if using Node.js with dotenv support):

1. Install dotenv in the service:
   ```bash
   cd services/livekit-agent
   npm install dotenv
   ```

2. Update the service to load .env (if needed - check if already configured)

**Or use a tool like `source` on Unix systems** (requires shell integration)

### ✅ Verification

Run the livekit-agent service:
```bash
cd services/livekit-agent
node --experimental-strip-types src/index.ts
```

You should see:
- `[livekit-agent] connected to ws://localhost:8787`
- `[livekit-agent] connected to LiveKit at wss://your-project.livekit.cloud`

**If you see:** `"[livekit-agent] LIVEKIT_URL and LIVEKIT_TOKEN must be set."`
→ Your environment variables are not set correctly.

---

## 🚀 Step 3: Running Services with API Keys

### 3.1 Using the Demo Script

If using `scripts/dev-demo.sh`, set environment variables before running:

```bash
export LIVEKIT_URL="wss://your-project.livekit.cloud"
export LIVEKIT_TOKEN="your-token-here"
./scripts/dev-demo.sh
```

### 3.2 Running Individual Services

**WebSocket Hub** (no API keys needed):
```bash
cd services/ws-hub
node --experimental-strip-types src/index.ts
```

**LiveKit Agent** (requires LIVEKIT_URL and LIVEKIT_TOKEN):
```bash
cd services/livekit-agent
export LIVEKIT_URL="wss://your-project.livekit.cloud"
export LIVEKIT_TOKEN="your-token-here"
node --experimental-strip-types src/index.ts
```

**Gemini Worker** (currently uses mock data, TODO for future):
```bash
cd services/gemini-worker
node --experimental-strip-types src/index.ts
```

**Market Matcher** (uses public Polymarket API, no key needed):
```bash
cd services/market-matcher
node --experimental-strip-types src/index.ts
```

---

## 📝 Quick Reference

### Chrome Extension (Gemini API Key)
```javascript
// In Chrome DevTools Console:
chrome.storage.sync.set({gemini_api_key: 'YOUR_KEY'});
```

### LiveKit Agent (Environment Variables)
```bash
export LIVEKIT_URL="wss://your-project.livekit.cloud"
export LIVEKIT_TOKEN="your-token-here"
```

### All Services (if using dev-demo.sh)
```bash
export LIVEKIT_URL="wss://your-project.livekit.cloud"
export LIVEKIT_TOKEN="your-token-here"
export WS_HUB_URL="ws://localhost:8787"  # Optional
./scripts/dev-demo.sh
```

---

## 🔒 Security Best Practices

1. **Never commit API keys** to version control
2. **Use `.env` files** and add them to `.gitignore`
3. **Rotate keys regularly** if exposed
4. **Use environment variables** in production deployments
5. **Restrict API key permissions** where possible (e.g., Gemini API usage limits)

---

## ❓ Troubleshooting

### Gemini API Key Issues

**Problem:** "Gemini API key not set" in console
- **Solution:** Make sure you ran the `chrome.storage.sync.set()` command correctly
- Check: Open console and run `chrome.storage.sync.get(['gemini_api_key'])` to verify

**Problem:** API key saved but still using mock data
- **Solution:** Reload the extension at `chrome://extensions/` after saving the key

### LiveKit Connection Issues

**Problem:** "LIVEKIT_URL and LIVEKIT_TOKEN must be set"
- **Solution:** Export environment variables in the same terminal session where you run the service
- Verify with: `echo $LIVEKIT_URL` (macOS/Linux) or `echo %LIVEKIT_URL%` (Windows)

**Problem:** Connection timeout or authentication errors
- **Solution:** Verify your token is valid and has correct permissions
- Check: Token expiration time, room name, and participant permissions

---

## 📚 Additional Resources

- [Google AI Studio - Get API Key](https://makersuite.google.com/app/apikey)
- [LiveKit Cloud](https://cloud.livekit.io/)
- [LiveKit Documentation](https://docs.livekit.io/)
- [LiveKit Access Tokens Guide](https://docs.livekit.io/realtime/server/access-tokens/)

---

## ✅ Checklist

- [ ] Gemini API key obtained from Google AI Studio
- [ ] Gemini API key stored in Chrome storage (via console)
- [ ] LiveKit account created (or self-hosted server setup)
- [ ] LiveKit URL and Token obtained
- [ ] Environment variables set for LiveKit agent
- [ ] Services tested and connecting successfully

