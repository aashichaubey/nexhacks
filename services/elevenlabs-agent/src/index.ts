import WebSocket from "ws";
import { randomUUID } from "crypto";

type Envelope<T> = {
  type: string;
  payload: T;
  ts?: string;
};

type AudioChunk = {
  tabId?: number;
  mimeType?: string;
  data: string;
  ts: string;
  durationMs?: number;
};

type TranscriptPacket = {
  id: string;
  windowStart: string;
  windowEnd: string;
  transcript: string;
  sttConfidence: number;
  vadConfidence: number;
  source: string;
};

const hubUrl = process.env.WS_HUB_URL ?? "ws://127.0.0.1:8788";
const elevenLabsKey = process.env.ELEVENLABS_API_KEY ?? "";
const elevenLabsModel = process.env.ELEVENLABS_MODEL ?? "scribe_v1";

const ws = new WebSocket(hubUrl);

async function transcribeWithElevenLabs(chunk: AudioChunk) {
  if (!elevenLabsKey) {
    console.warn("[elevenlabs-agent] ELEVENLABS_API_KEY is not set.");
    return "";
  }
  const buffer = Buffer.from(chunk.data, "base64");
  const form = new FormData();
  form.append("model_id", elevenLabsModel);
  form.append(
    "file",
    new Blob([buffer], { type: chunk.mimeType ?? "audio/webm" }),
    "audio.webm"
  );

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: {
      "xi-api-key": elevenLabsKey
    },
    body: form
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ElevenLabs error ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { text?: string };
  return data?.text?.trim() ?? "";
}

function emitTranscript(payload: TranscriptPacket) {
  const envelope: Envelope<TranscriptPacket> = {
    type: "transcript_packet",
    payload,
    ts: new Date().toISOString()
  };
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(envelope));
  }
}

ws.on("open", () => {
  console.log(`[elevenlabs-agent] connected to ${hubUrl}`);
});

ws.on("message", (data) => {
  let envelope: Envelope<AudioChunk> | null = null;
  try {
    envelope = JSON.parse(data.toString());
  } catch {
    return;
  }
  if (envelope?.type !== "audio_chunk") {
    return;
  }
  const chunk = envelope.payload;
  const start = chunk.ts ? new Date(chunk.ts) : new Date();
  const durationMs = chunk.durationMs ?? 0;
  const end = new Date(start.getTime() + durationMs);
  transcribeWithElevenLabs(chunk)
    .then((transcript) => {
      if (!transcript) {
        return;
      }
      emitTranscript({
        id: randomUUID(),
        windowStart: start.toISOString(),
        windowEnd: end.toISOString(),
        transcript,
        sttConfidence: 0.7,
        vadConfidence: 0.7,
        source: "elevenlabs_stream"
      });
    })
    .catch((err) => {
      console.warn("[elevenlabs-agent] transcription failed", err);
    });
});

ws.on("close", () => {
  console.log("[elevenlabs-agent] disconnected from ws-hub");
});

ws.on("error", (err) => {
  console.error("[elevenlabs-agent] ws error", err);
});
