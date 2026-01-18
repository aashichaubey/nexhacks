import { Room, RoomEvent } from "https://unpkg.com/livekit-client/dist/livekit-client.esm.mjs";

const connectBtn = document.getElementById("connect");
const disconnectBtn = document.getElementById("disconnect");
const statusEl = document.getElementById("status");
const urlInput = document.getElementById("lk-url");
const tokenInput = document.getElementById("lk-token");
const listEl = document.getElementById("transcript-list");
const emptyEl = document.getElementById("empty");

let room;

function setStatus(text) {
  statusEl.textContent = text;
}

function renderTranscripts(metadata) {
  listEl.innerHTML = "";
  if (!metadata) {
    emptyEl.style.display = "block";
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(metadata);
  } catch {
    emptyEl.style.display = "none";
    const li = document.createElement("li");
    li.textContent = metadata;
    listEl.appendChild(li);
    return;
  }

  const transcripts = Array.isArray(parsed?.transcripts) ? parsed.transcripts : [];
  if (transcripts.length === 0) {
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.style.display = "none";
  for (const entry of transcripts) {
    const li = document.createElement("li");
    li.textContent = `${entry.ts ?? ""} ${entry.text ?? ""}`.trim();
    listEl.appendChild(li);
  }
}

async function connect() {
  const url = urlInput.value.trim();
  const token = tokenInput.value.trim();
  if (!url || !token) {
    setStatus("LiveKit URL and token are required.");
    return;
  }
  room = new Room();
  room.on(RoomEvent.Connected, () => {
    setStatus("Connected.");
    renderTranscripts(room.metadata);
  });
  room.on(RoomEvent.Disconnected, () => {
    setStatus("Disconnected.");
  });
  room.on(RoomEvent.RoomMetadataChanged, (metadata) => {
    renderTranscripts(metadata);
  });

  try {
    await room.connect(url, token);
    connectBtn.disabled = true;
    disconnectBtn.disabled = false;
  } catch (err) {
    console.error(err);
    setStatus(`Failed to connect: ${err.message ?? err}`);
  }
}

async function disconnect() {
  if (!room) {
    return;
  }
  await room.disconnect();
  room = null;
  connectBtn.disabled = false;
  disconnectBtn.disabled = true;
  setStatus("Disconnected.");
}

connectBtn.addEventListener("click", connect);
disconnectBtn.addEventListener("click", disconnect);
