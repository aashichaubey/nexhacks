# NexHacks Polymarket Companion

Real-time assistive analytics for live content using LiveKit, Gemini, and Polymarket.

## Repo layout

```
./extension
  manifest.json
  src/
    background.js
    content.js
    panel.html
    panel.css
    panel.js
./services
  livekit-agent
  gemini-worker
  market-matcher
  ws-hub
./shared
  src/contracts.ts
./infra
./scripts
```

## What is implemented

- WebSocket hub to fan out realtime events.
- LiveKit agent scaffold (simulated transcript packets).
- Gemini worker scaffold (simulated signals).
- Market matcher scaffold (simulated Polymarket markets).
- Chrome extension side panel UI with realtime updates.

## How data flows

1. LiveKit agent emits transcript packets.
2. Gemini worker converts packets to signals.
3. Market matcher converts signals to markets.
4. WebSocket hub broadcasts to extension.
5. Extension shows signals + markets in side panel.

## Running locally (scaffold)

1. Start the WebSocket hub.
2. Start the LiveKit agent, Gemini worker, and market matcher.
3. Load the Chrome extension.

Each service reads `WS_HUB_URL` (default `ws://localhost:8787`).

### One-command demo

```bash
npm run demo
```

### API placeholders

See `.env.example` for the placeholders to wire LiveKit and Gemini.

### LiveKit agent env

- `LIVEKIT_URL` (required)
- `LIVEKIT_TOKEN` (required)
- `LIVEKIT_TRANSCRIPTION_SOURCE` (optional, default `livekit`)

### Live feed note (YouTube or other streams)

The extension cannot directly capture or decode YouTube audio/video. To use live audio,
pipe the stream into a LiveKit room using LiveKit Ingress (RTMP) or a desktop capture
tool (OBS) that publishes to LiveKit. The `livekit-agent` then listens for transcription
events from that room.

### Polymarket matcher env

- `POLYMARKET_GAMMA_BASE` (optional, default `https://gamma-api.polymarket.com`)

## Next build steps

- Replace simulated packet generation with LiveKit room + STT/VAD pipeline.
- Implement Gemini API call with JSON schema validation.
- Implement Polymarket discovery + pricing.
- Add real user profiling from browsing context.
- Add real-time charts for probability movement.
