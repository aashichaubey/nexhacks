import { promises as fs } from "fs";
import { watchFile } from "fs";
import path from "path";

// Load .env file if it exists
async function loadEnv() {
  const envFile = path.resolve(process.cwd(), ".env");
  try {
    const content = await fs.readFile(envFile, "utf-8");
    content.split("\n").forEach((line) => {
      line = line.trim();
      if (line && !line.startsWith("#")) {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          let value = match[2].trim();
          // Remove quotes if present
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          process.env[key] = value;
        }
      }
    });
    console.log("[generate-insights] ✓ Loaded environment variables from .env");
  } catch {
    // .env file doesn't exist, that's okay
  }
}
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODEL = "gemini-1.5-flash";
const TRANSCRIPTS_FILE = path.resolve(process.cwd(), "transcripts", "transcriptions.jsonl");
const INSIGHTS_FILE = path.resolve(process.cwd(), "transcripts", "insights.jsonl");
const MIN_WORDS = 10;

let accumulatedText = "";
let processedLines = 0;

// Ensure transcripts directory exists
async function ensureDir() {
  const dir = path.dirname(TRANSCRIPTS_FILE);
  await fs.mkdir(dir, { recursive: true });
}

// Count words in text
function countWords(text) {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

// Generate insight using Gemini API
async function generateInsight(text) {
  const geminiApiKey = process.env.GEMINI_API_KEY ?? "";
  if (!geminiApiKey) {
    console.warn("[generate-insights] GEMINI_API_KEY not set, skipping insight generation");
    return null;
  }

  const prompt = `Analyze the following transcript and provide a brief insight (2-3 sentences max). Focus on key points, sentiment, or notable information:\n\n${text}`;

  try {
    const url = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${geminiApiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const insight = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return insight || null;
  } catch (err) {
    console.error("[generate-insights] failed to generate insight", err);
    return null;
  }
}

// Save insight to file
async function saveInsight(transcriptText, insight) {
  await ensureDir();
  const entry = {
    type: "insight",
    payload: {
      transcript: transcriptText,
      insight: insight,
      wordCount: countWords(transcriptText)
    },
    ts: new Date().toISOString()
  };
  await fs.appendFile(INSIGHTS_FILE, `${JSON.stringify(entry)}\n`);
  console.log(`[generate-insights] 💡 Insight generated and saved (${countWords(transcriptText)} words)`);
}

// Process new lines from the transcriptions file
async function processNewLines() {
  try {
    // Check if file exists
    try {
      await fs.access(TRANSCRIPTS_FILE);
    } catch {
      // File doesn't exist yet, wait for it
      return;
    }

    const content = await fs.readFile(TRANSCRIPTS_FILE, "utf-8");
    const lines = content.split("\n").filter(line => line.trim());

    // Process only new lines
    for (let i = processedLines; i < lines.length; i++) {
      try {
        const entry = JSON.parse(lines[i]);
        const text = entry.text || "";
        
        if (text) {
          accumulatedText += (accumulatedText ? " " : "") + text;
          const wordCount = countWords(accumulatedText);
          
          // Generate insight once we have enough words
          if (wordCount >= MIN_WORDS) {
            console.log(`[generate-insights] 📝 Generating insight for ${wordCount} words...`);
            const insight = await generateInsight(accumulatedText);
            
            if (insight) {
              await saveInsight(accumulatedText, insight);
            }
            
            // Reset accumulated text after generating insight
            accumulatedText = "";
          }
        }
      } catch (err) {
        console.warn(`[generate-insights] failed to parse line ${i + 1}`, err);
      }
    }

    processedLines = lines.length;
  } catch (err) {
    console.error("[generate-insights] failed to process file", err);
  }
}

// Main function
async function main() {
  // Load environment variables from .env file
  await loadEnv();
  
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
  
  console.log(`[generate-insights] 🚀 Starting insight generator`);
  console.log(`[generate-insights] Watching: ${TRANSCRIPTS_FILE}`);
  console.log(`[generate-insights] Insights will be saved to: ${INSIGHTS_FILE}`);
  console.log(`[generate-insights] Minimum words before generating: ${MIN_WORDS}`);

  if (!GEMINI_API_KEY) {
    console.warn("[generate-insights] ⚠️  GEMINI_API_KEY not set - insights will not be generated");
  }

  // Process existing file if it exists
  await processNewLines();

  // Watch for file changes
  watchFile(TRANSCRIPTS_FILE, { interval: 1000 }, async () => {
    await processNewLines();
  });

  console.log("[generate-insights] ✅ Watching for new transcriptions...");
}

main().catch((err) => {
  console.error("[generate-insights] fatal error", err);
  process.exitCode = 1;
});
