import WebSocket, { WebSocketServer } from "ws";

const port = Number(process.env.WS_HUB_PORT ?? 8788);
const host = process.env.WS_HUB_HOST ?? "127.0.0.1";
const wss = new WebSocketServer({ port, host });

const clients = new Set<WebSocket>();

wss.on("connection", (socket) => {
  clients.add(socket);
  const clientId = clients.size;
  console.log(`[ws-hub] Client connected (total: ${clients.size})`);
  
  socket.on("message", (data) => {
    try {
      const envelope = JSON.parse(data.toString());
      // Log message types for visibility
      if (envelope.type === "transcript_packet") {
        console.log(`[ws-hub] 📡 Broadcasting transcription packet to ${clients.size} clients`);
      } else if (envelope.type === "signal") {
        console.log(`[ws-hub] 📡 Broadcasting signal to ${clients.size} clients`);
      } else if (envelope.type === "market") {
        console.log(`[ws-hub] 📡 Broadcasting market to ${clients.size} clients`);
      }
    } catch (e) {
      // Not JSON, skip logging
    }
    
    for (const client of clients) {
      if (client.readyState === client.OPEN) {
        client.send(data.toString());
      }
    }
  });
  socket.on("close", () => {
    clients.delete(socket);
    console.log(`[ws-hub] Client disconnected (remaining: ${clients.size})`);
  });
});

console.log(`[ws-hub] listening on ws://${host}:${port}`);
