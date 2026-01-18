const WS_URL = process.env.WS_HUB_URL ?? "ws://127.0.0.1:8788";

if (typeof WebSocket === "undefined") {
  console.error("WebSocket is not available in this Node version.");
  process.exit(1);
}

const ws = new WebSocket(WS_URL);

ws.addEventListener("open", () => {
  console.log(`[print-transcripts] connected to ${WS_URL}`);
});

ws.addEventListener("message", (event) => {
  try {
    const envelope = JSON.parse(event.data);
    if (envelope.type !== "transcript_packet") {
      return;
    }
    const payload = envelope.payload ?? {};
    const ts = payload.windowEnd ?? envelope.ts ?? "";
    const transcript = payload.transcript ?? "";
    if (!transcript) {
      return;
    }
    console.log(`${ts} ${transcript}`.trim());
  } catch (err) {
    console.warn("[print-transcripts] failed to parse message", err);
  }
});

ws.addEventListener("close", () => {
  console.log("[print-transcripts] disconnected");
});

ws.addEventListener("error", (err) => {
  console.error("[print-transcripts] ws error", err);
});
