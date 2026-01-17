import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import { registerGlobals } from "@livekit/rtc-node";
import {
  Room,
  RoomEvent,
  TrackKind,
  type TranscriptionSegment
} from "livekit-client";
import type { Envelope, TranscriptPacket } from "@nexhacks/shared";

const hubUrl = process.env.WS_HUB_URL ?? "ws://localhost:8787";
const livekitUrl = process.env.LIVEKIT_URL ?? "";
const livekitToken = process.env.LIVEKIT_TOKEN ?? "";
const transcriptSource = process.env.LIVEKIT_TRANSCRIPTION_SOURCE ?? "livekit";
const ws = new WebSocket(hubUrl);

registerGlobals();

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

function segmentToPacket(segment: TranscriptionSegment): TranscriptPacket {
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
    console.error(
      "[livekit-agent] LIVEKIT_URL and LIVEKIT_TOKEN must be set."
    );
    return;
  }

  room.on(RoomEvent.TranscriptionReceived, (segments) => {
    for (const segment of segments) {
      const packet = segmentToPacket(segment);
      if (packet.transcript.trim().length === 0) {
        continue;
      }
      emitPacket(packet);
    }
  });

  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (track.kind !== TrackKind.Audio) {
      return;
    }
    console.log(
      `[livekit-agent] audio track subscribed from ${participant.identity} (${publication.trackSid})`
    );
  });

  room.on(RoomEvent.Disconnected, () => {
    console.warn("[livekit-agent] disconnected from LiveKit");
  });

  await room.connect(livekitUrl, livekitToken);
  console.log(`[livekit-agent] connected to LiveKit at ${livekitUrl}`);
}

ws.on("open", () => {
  console.log(`[livekit-agent] connected to ${hubUrl}`);
  connectLiveKit().catch((err) => {
    console.error("[livekit-agent] failed to connect to LiveKit", err);
  });
});

ws.on("close", () => {
  console.log("[livekit-agent] disconnected from ws hub");
});

ws.on("error", (err) => {
  console.error("[livekit-agent] ws error", err);
});
