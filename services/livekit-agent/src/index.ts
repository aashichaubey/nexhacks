import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import {
  Room,
  RoomEvent,
  TrackKind,
  type TranscriptionSegment
} from "@livekit/rtc-node";
import type { Envelope, TranscriptPacket } from "@nexhacks/shared";

const hubUrl = process.env.WS_HUB_URL ?? "ws://127.0.0.1:8788";
const livekitUrl = process.env.LIVEKIT_URL ?? "";
const livekitToken = process.env.LIVEKIT_TOKEN ?? "";
const transcriptSource = process.env.LIVEKIT_TRANSCRIPTION_SOURCE ?? "livekit";
const ws = new WebSocket(hubUrl);

const room = new Room({
  adaptiveStream: true,
  dynacast: true
});

function emitPacket(payload: TranscriptPacket) {
  const envelope: Envelope<TranscriptPacket> = {
    type: "transcript_packet",
    payload,
    ts: new Date().toISOString()
  };
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(envelope));
  }
}

function segmentToPacket(segment: any): TranscriptPacket {
  const now = Date.now();
  const startMs =
    segment.startTime !== undefined ? segment.startTime * 1000 : now - 2000;
  const endMs =
    segment.endTime !== undefined ? segment.endTime * 1000 : now - 500;
  const sttConfidence = segment.confidence ?? 0.9;

  return {
    id: segment.id ?? uuidv4(),
    windowStart: new Date(startMs).toISOString(),
    windowEnd: new Date(endMs).toISOString(),
    transcript: segment.text ?? "",
    sttConfidence,
    vadConfidence: Math.min(1, sttConfidence + 0.05),
    source: transcriptSource
  };
}

async function connectLiveKit() {
  if (!livekitUrl || !livekitToken) {
    console.warn("[livekit-agent] LIVEKIT_URL and LIVEKIT_TOKEN must be set to connect to LiveKit. Skipping connection.");
    return;
  }

  try {
    // Set up transcription listener
    room.on(RoomEvent.TranscriptionReceived, (segments: TranscriptionSegment[]) => {
      for (const segment of segments) {
        const packet = segmentToPacket(segment);
        if (packet.transcript.trim().length === 0) {
          continue;
        }
        
        // Log transcription to terminal so you can see it
        console.log(`[livekit-agent] 📝 Transcription: "${packet.transcript}"`);
        console.log(`[livekit-agent]   Confidence: ${(packet.sttConfidence * 100).toFixed(1)}% | Source: ${packet.source}`);
        
        emitPacket(packet);
      }
    });

    // Listen for track subscriptions
    room.on(RoomEvent.TrackSubscribed, (track: any, publication: any, participant: any) => {
      if (track.kind === TrackKind.Audio) {
        console.log(
          `[livekit-agent] audio track subscribed from ${participant.identity} (${publication.trackSid})`
        );
      }
    });

    room.on(RoomEvent.Disconnected, () => {
      console.warn("[livekit-agent] disconnected from LiveKit");
    });

    // Connect to LiveKit room using Node.js-compatible client
    await room.connect(livekitUrl, livekitToken, {
      autoSubscribe: true,
    });
    
    console.log(`[livekit-agent] ✓ Connected to LiveKit at ${livekitUrl}`);
  } catch (err) {
    console.error("[livekit-agent] Failed to connect to LiveKit:", err);
    throw err;
  }
}

ws.on("open", () => {
  console.log(`[livekit-agent] connected to ${hubUrl}`);
  connectLiveKit().catch((err) => {
    // Only log error details, don't throw - allows service to continue without LiveKit
    console.error("[livekit-agent] failed to connect to LiveKit", err);
  });
});

ws.on("close", () => {
  console.log("[livekit-agent] disconnected from ws hub");
});

ws.on("error", (err) => {
  console.error("[livekit-agent] ws error", err);
});
