import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import type { Envelope, Signal, TranscriptPacket } from "@nexhacks/shared";

const hubUrl = process.env.WS_HUB_URL ?? "ws://127.0.0.1:8788";
let ws: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

function connectHub() {
  ws = new WebSocket(hubUrl);

  ws.on("open", () => {
    console.log(`[gemini-worker] connected to ${hubUrl}`);
  });

  ws.on("message", (data) => {
  try {
    const envelope = JSON.parse(data.toString()) as Envelope<TranscriptPacket>;
    if (envelope.type !== "transcript_packet") {
      return;
    }

    // Log received transcription
    const transcript = envelope.payload.transcript;
    console.log(`[gemini-worker] 📥 Received transcription: "${transcript}"`);
    console.log(`[gemini-worker]   Analyzing with Gemini...`);

    // TODO: Replace with Gemini API call + JSON schema validation.
    const signal: Signal = {
        id: uuidv4(),
        signalType: "momentum_shift",
        entity: "home_team",
        polarity: "supports_outcome",
        confidence: 0.78,
        timeHorizon: "short",
        explanation: "Simulated signal from transcript packet.",
        ts: new Date().toISOString()
      };

      const out: Envelope<Signal> = {
        type: "signal",
        payload: signal,
        ts: new Date().toISOString()
      };

      ws?.send(JSON.stringify(out));
      console.log(`[gemini-worker] ✅ Generated signal: ${signal.signalType} for ${signal.entity} (confidence: ${(signal.confidence * 100).toFixed(0)}%)`);
    } catch (err) {
      console.error("[gemini-worker] failed to parse message", err);
    }
  });

  ws.on("close", () => {
    console.log("[gemini-worker] disconnected from ws hub");
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    console.error("[gemini-worker] ws error", err);
    ws?.close();
  });
}

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectHub();
  }, 1000);
}

connectHub();
