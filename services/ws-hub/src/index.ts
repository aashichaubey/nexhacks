import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import WebSocket, { WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultInsightsPath = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "data",
  "nfl-insights.jsonl"
);
const insightsPath = process.env.NFL_INSIGHTS_PATH ?? defaultInsightsPath;
fs.mkdirSync(path.dirname(insightsPath), { recursive: true });

const port = Number(process.env.WS_HUB_PORT ?? 8788);
const host = process.env.WS_HUB_HOST ?? "127.0.0.1";
const wss = new WebSocketServer({ port, host });

const clients = new Set<WebSocket>();

wss.on("connection", (socket) => {
  clients.add(socket);
  const clientId = clients.size;
  console.log(`[ws-hub] Client connected (total: ${clients.size})`);
  
  socket.on("message", (data) => {
    const messageText = data.toString();
    try {
      const envelope = JSON.parse(messageText);
      if (envelope?.type === "nfl_insight") {
        const line = `${JSON.stringify(envelope)}\n`;
        fs.promises.appendFile(insightsPath, line).catch((err) => {
          console.warn("[ws-hub] failed to write nfl insight", err);
        });
      }
      if (envelope?.type === "transcript_packet") {
        console.log(
          `[ws-hub] 📡 Broadcasting transcription packet to ${clients.size} clients`
        );
      } else if (envelope?.type === "signal") {
        console.log(
          `[ws-hub] 📡 Broadcasting signal to ${clients.size} clients`
        );
      } else if (envelope?.type === "market") {
        console.log(
          `[ws-hub] 📡 Broadcasting market to ${clients.size} clients`
        );
      }
    } catch {
      // ignore parse errors
    }
    for (const client of clients) {
      if (client.readyState === client.OPEN) {
        client.send(messageText);
      }
    }
  });
  socket.on("close", () => {
    clients.delete(socket);
    console.log(`[ws-hub] Client disconnected (remaining: ${clients.size})`);
  });
});

console.log(`[ws-hub] listening on ws://${host}:${port}`);
