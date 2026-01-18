# NexPlaybook

A Chrome extension that detects sports searches or live tabs, surfaces relevant Polymarket markets, and shows matchup context from ESPN. It can also capture live tab audio and transcribe it via ElevenLabs (optional).

## What it does

- Detects Google search context from the active tab.
- Pulls Polymarket markets (Gamma API) and shows live probabilities, volume, and liquidity.
- Pulls ESPN NFL data for basic matchup context.
- Optional live tab audio capture + transcription (ElevenLabs).

## Prereqs

- Node.js 18+
- Chrome (MV3)
- Optional: ElevenLabs API key (`ELEVENLABS_API_KEY`)

## Install

```
cd /Users/mansikatarey/NexHacks/nexhacks
npm install
```

## Run the backend services

Start the local WebSocket hub (required for market updates and transcripts):

```
npx tsx services/ws-hub/src/index.ts
```

Optional: start the ElevenLabs agent for live tab audio transcription:

```
npx tsx services/elevenlabs-agent/src/index.ts
```

## Load the extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `nexhacks/extension`
5. Enable **Allow access to file URLs** (needed for offscreen capture)

## Usage

1. Search a matchup like `seahawks vs 49ers score` on Google.
2. Open the extension popup to see:
   - Polymarket markets and analytics
   - NFL matchup context

### Live tab audio (optional)

1. Open a YouTube or Pluto TV live tab with audio.
2. The extension attempts to auto-capture tab audio.
3. Transcripts are written to `data/transcripts.jsonl`.

## Output files

- `data/nfl-insights.jsonl` — ESPN matchup snapshots
- `data/transcripts.jsonl` — transcript packets (if transcription is enabled)

## Environment variables

Create `.env` (ignored by git) for optional services:

```
ELEVENLABS_API_KEY="your-key"
ELEVENLABS_MODEL="scribe_v1"
NFL_INSIGHTS_PATH="data/nfl-insights.jsonl"
TRANSCRIPTS_PATH="data/transcripts.jsonl"
```

## Notes

- Polymarket probabilities come from the Gamma API.
- ESPN data is pulled from public endpoints.
- Live tab audio capture requires user permission per Chrome tab.
