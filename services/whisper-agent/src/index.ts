import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import {
  Room,
  RoomEvent,
  TrackKind,
  AudioStream,
  type AudioFrame,
  type RemoteAudioTrack
} from "@livekit/rtc-node";
import { RoomServiceClient } from "livekit-server-sdk";
import type { Envelope, TranscriptPacket } from "@nexhacks/shared";

const hubUrl = process.env.WS_HUB_URL ?? "ws://127.0.0.1:8788";
const livekitUrl = process.env.LIVEKIT_URL ?? "";
const livekitToken = process.env.LIVEKIT_TOKEN ?? "";
const openaiKey = process.env.OPENAI_API_KEY ?? "";
const openaiModel = process.env.OPENAI_WHISPER_MODEL ?? "whisper-1";
const chunkSeconds = Number(process.env.WHISPER_CHUNK_SECONDS ?? 12);
const livekitHost = process.env.LIVEKIT_HOST ?? "";
const livekitApiKey = process.env.LIVEKIT_API_KEY ?? "";
const livekitApiSecret = process.env.LIVEKIT_API_SECRET ?? "";
const livekitRoom = process.env.LIVEKIT_ROOM ?? "nexhacks";

const ws = new WebSocket(hubUrl);
const room = new Room({ adaptiveStream: true, dynacast: true });
const roomService =
  livekitHost && livekitApiKey && livekitApiSecret
    ? new RoomServiceClient(livekitHost, livekitApiKey, livekitApiSecret)
    : null;

let activeTrackSid: string | null = null;
let bufferParts: Buffer[] = [];
let bufferSamples = 0;
let bufferStartMs: number | null = null;
let sampleRate = 48000;
let channels = 1;
let sendQueue: Promise<void> = Promise.resolve();
let metadataQueue: Promise<void> = Promise.resolve();
const transcriptHistory: Array<{ ts: string; text: string }> = [];
const MAX_TRANSCRIPT_HISTORY = 20;

function emitPacket(payload: TranscriptPacket) {
  const envelope: Envelope<TranscriptPacket> = {
    type: "transcript_packet",
    payload,
    ts: new Date().toISOString()
  };
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(envelope));
  }
  updateRoomMetadata(payload).catch((err) => {
    console.warn("[whisper-agent] failed to update room metadata", err);
  });
}

function appendFrame(frame: AudioFrame) {
  const frameChannels =
    frame.channels ?? (frame as { numChannels?: number }).numChannels ?? 1;
  const frameSampleRate = frame.sampleRate ?? sampleRate;
  const samplesPerChannel =
    frame.samplesPerChannel ?? Math.floor(frame.data.length / frameChannels);

  channels = frameChannels;
  sampleRate = frameSampleRate;

  if (bufferStartMs === null) {
    bufferStartMs = Date.now();
  }

  const dataBuffer = Buffer.from(
    frame.data.buffer,
    frame.data.byteOffset,
    frame.data.byteLength
  );
  bufferParts.push(dataBuffer);
  bufferSamples += samplesPerChannel;

  const durationSeconds = bufferSamples / sampleRate;
  if (durationSeconds >= chunkSeconds) {
    flushBuffer();
  }
}

function flushBuffer() {
  if (bufferParts.length === 0 || bufferStartMs === null) {
    return;
  }
  const audioBuffer = Buffer.concat(bufferParts);
  const durationMs = Math.round((bufferSamples / sampleRate) * 1000);
  const windowStart = new Date(bufferStartMs).toISOString();
  const windowEnd = new Date(bufferStartMs + durationMs).toISOString();

  bufferParts = [];
  bufferSamples = 0;
  bufferStartMs = null;

  const wav = encodeWav(audioBuffer, sampleRate, channels);
  sendQueue = sendQueue
    .then(() => transcribeAndEmit(wav, windowStart, windowEnd))
    .catch((err) => {
      console.error("[whisper-agent] failed to transcribe", err);
    });
}

function encodeWav(audio: Buffer, rate: number, channelCount: number) {
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const byteRate = rate * blockAlign;
  const dataSize = audio.length;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  audio.copy(buffer, 44);
  return buffer;
}

async function transcribeAndEmit(wav: Buffer, windowStart: string, windowEnd: string) {
  if (!openaiKey) {
    console.warn("[whisper-agent] OPENAI_API_KEY is not set.");
    return;
  }

  const form = new FormData();
  form.append("model", openaiModel);
  form.append("file", new Blob([wav], { type: "audio/wav" }), "audio.wav");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`
    },
    body: form
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { text?: string };
  const transcript = data.text?.trim();
  if (!transcript) {
    return;
  }

  emitPacket({
    id: uuidv4(),
    windowStart,
    windowEnd,
    transcript,
    sttConfidence: 0.7,
    vadConfidence: 0.7,
    source: "openai_whisper"
  });
}

async function updateRoomMetadata(packet: TranscriptPacket) {
  if (!roomService) {
    return;
  }
  transcriptHistory.push({ ts: packet.windowEnd, text: packet.transcript });
  if (transcriptHistory.length > MAX_TRANSCRIPT_HISTORY) {
    transcriptHistory.splice(0, transcriptHistory.length - MAX_TRANSCRIPT_HISTORY);
  }
  const metadata = JSON.stringify({ transcripts: transcriptHistory });
  metadataQueue = metadataQueue.then(() =>
    roomService.updateRoomMetadata(livekitRoom, metadata)
  );
  await metadataQueue;
}

async function connectLiveKit() {
  if (!livekitUrl || !livekitToken) {
    console.error("[whisper-agent] LIVEKIT_URL and LIVEKIT_TOKEN must be set.");
    return;
  }

  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (track.kind !== TrackKind.Audio) {
      return;
    }
    if (activeTrackSid && activeTrackSid !== publication.trackSid) {
      console.log("[whisper-agent] ignoring extra audio track", publication.trackSid);
      return;
    }
    activeTrackSid = publication.trackSid;
    console.log(
      `[whisper-agent] audio track subscribed from ${participant.identity} (${publication.trackSid})`
    );

    const stream = new AudioStream(track as RemoteAudioTrack);
    (async () => {
      let frameCount = 0;
      for await (const frame of stream) {
        appendFrame(frame);
        frameCount += 1;
        if (frameCount % 50 === 0) {
          console.log(
            "[whisper-agent] audio frames received",
            frameCount,
            "samples",
            bufferSamples
          );
        }
      }
    })().catch((err) => {
      console.error("[whisper-agent] audio stream error", err);
    });
  });

  room.on(RoomEvent.Disconnected, (reason) => {
    console.warn("[whisper-agent] disconnected from LiveKit", reason);
  });

  await room.connect(livekitUrl, livekitToken);
  console.log(`[whisper-agent] connected to LiveKit at ${livekitUrl}`);
}

ws.on("open", () => {
  console.log(`[whisper-agent] connected to ${hubUrl}`);
  connectLiveKit().catch((err) => {
    console.error("[whisper-agent] failed to connect to LiveKit", err);
  });
});

ws.on("close", () => {
  console.log("[whisper-agent] disconnected from ws hub");
});

ws.on("error", (err) => {
  console.error("[whisper-agent] ws error", err);
});
