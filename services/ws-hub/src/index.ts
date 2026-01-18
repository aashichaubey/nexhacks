import WebSocket, { WebSocketServer } from "ws";

const port = Number(process.env.WS_HUB_PORT ?? 8788);
const host = process.env.WS_HUB_HOST ?? "127.0.0.1";
const wss = new WebSocketServer({ port, host });

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

console.log(`[ws-hub] listening on ws://${host}:${port}`);
