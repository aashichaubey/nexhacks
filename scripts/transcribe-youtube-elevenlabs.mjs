import { promises as fs } from "fs";
import { spawn } from "child_process";
import path from "path";
import os from "os";

const YOUTUBE_URL = "https://www.youtube.com/watch?v=TPcHcYdBEw4";
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? "";
const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL ?? "scribe_v1";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENAI_WHISPER_MODEL = process.env.OPENAI_WHISPER_MODEL ?? "whisper-1";
const OUTPUT_DIR = path.resolve(process.cwd(), "data");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "transcripts.jsonl");

async function runCommand(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

async function downloadAudio(url) {
  const base = path.join(os.tmpdir(), `yt-audio-${Date.now()}`);
  const outTemplate = `${base}.%(ext)s`;
  const wavPath = `${base}.wav`;
  await runCommand("yt-dlp", [
    "-x",
    "--audio-format",
    "wav",
    "-o",
    outTemplate,
    url
  ]);
  return wavPath;
}

async function transcribeWithElevenLabs(wavPath) {
  if (!ELEVENLABS_API_KEY) {
    return "";
  }
  const audio = await fs.readFile(wavPath);
  const form = new FormData();
  form.append("model_id", ELEVENLABS_MODEL);
  form.append("file", new Blob([audio], { type: "audio/wav" }), "audio.wav");

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY
    },
    body: form
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ElevenLabs error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data?.text?.trim() ?? "";
}

async function transcribeWithOpenAI(wavPath) {
  if (!OPENAI_API_KEY) {
    return "";
  }
  const audio = await fs.readFile(wavPath);
  const form = new FormData();
  form.append("model", OPENAI_WHISPER_MODEL);
  form.append("file", new Blob([audio], { type: "audio/wav" }), "audio.wav");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: form
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data?.text?.trim() ?? "";
}

async function appendTranscript(transcript, provider) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const entry = {
    type: "transcript",
    payload: {
      provider,
      source: "youtube",
      url: YOUTUBE_URL,
      transcript
    },
    ts: new Date().toISOString()
  };
  await fs.appendFile(OUTPUT_FILE, `${JSON.stringify(entry)}\n`);
}

async function main() {
  console.log(`[elevenlabs] downloading audio from ${YOUTUBE_URL}`);
  const wavPath = await downloadAudio(YOUTUBE_URL);
  try {
    let transcript = "";
    if (ELEVENLABS_API_KEY) {
      console.log("[elevenlabs] transcribing");
      try {
        transcript = await transcribeWithElevenLabs(wavPath);
        if (transcript) {
          await appendTranscript(transcript, "elevenlabs");
          console.log(`[elevenlabs] saved transcript to ${OUTPUT_FILE}`);
          return;
        }
      } catch (err) {
        console.warn("[elevenlabs] failed, falling back to OpenAI", err);
      }
    }
    if (OPENAI_API_KEY) {
      console.log("[openai] transcribing");
      transcript = await transcribeWithOpenAI(wavPath);
      if (!transcript) {
        console.log("[openai] no transcript returned");
        return;
      }
      await appendTranscript(transcript, "openai");
      console.log(`[openai] saved transcript to ${OUTPUT_FILE}`);
      return;
    }
    console.log("[transcribe] no API key available for ElevenLabs or OpenAI");
  } finally {
    await fs.unlink(wavPath).catch(() => {});
  }
}

main().catch((err) => {
  console.error("[elevenlabs] failed", err);
  process.exitCode = 1;
});
