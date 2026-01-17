import WebSocket, { WebSocketServer } from "ws";

const port = Number(process.env.WS_HUB_PORT ?? 8787);
const wss = new WebSocketServer({ port });

const clients = new Set<WebSocket>();

wss.on("connection", (socket) => {
  clients.add(socket);
  socket.on("message", (data) => {
    for (const client of clients) {
      if (client.readyState === client.OPEN) {
        client.send(data.toString());
      }
    }
  });
  socket.on("close", () => {
    clients.delete(socket);
  });
});

console.log(`[ws-hub] listening on ws://localhost:${port}`);
