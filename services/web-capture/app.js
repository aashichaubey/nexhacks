import {
  Room,
  RoomEvent,
  Track
} from "https://unpkg.com/livekit-client/dist/livekit-client.esm.mjs";

const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const statusEl = document.getElementById("status");
const urlInput = document.getElementById("lk-url");
const tokenInput = document.getElementById("lk-token");

let room;
let captureStream;
let audioTrack;

function setStatus(text) {
  statusEl.textContent = text;
}

async function startCapture() {
  const url = urlInput.value.trim();
  const token = tokenInput.value.trim();
  if (!url || !token) {
    setStatus("LiveKit URL and token are required.");
    return;
  }

  try {
    console.log("[web-capture] requesting display media");
    captureStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    });
    console.log("[web-capture] capture stream", captureStream);

    const [audioStreamTrack] = captureStream.getAudioTracks();
    if (!audioStreamTrack) {
      setStatus("No audio track detected. Select a tab with audio.");
      captureStream.getTracks().forEach((track) => track.stop());
      captureStream = null;
      console.warn("[web-capture] no audio track in capture stream");
      return;
    }

    console.log("[web-capture] audio track", audioStreamTrack);
    audioTrack = audioStreamTrack;
    room = new Room();

    room.on(RoomEvent.Connected, () => {
      setStatus("Connected to LiveKit.");
    });

    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      console.log("[web-capture] connection state", state);
    });

    room.on(RoomEvent.Disconnected, (reason) => {
      console.log("[web-capture] disconnected", reason);
      setStatus(`Disconnected${reason ? `: ${reason}` : ""}.`);
    });

    await room.connect(url, token);
    console.log("[web-capture] connected to LiveKit");
    await room.localParticipant.publishTrack(audioTrack, {
      source: Track.Source.Microphone
    });
    console.log("[web-capture] published audio track");

    setStatus("Publishing audio track.");
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } catch (err) {
    console.error(err);
    setStatus(`Failed to start capture: ${err.message ?? err}`);
  }
}

async function stopCapture() {
  try {
    if (audioTrack) {
      audioTrack.stop();
      audioTrack = null;
    }
    if (captureStream) {
      captureStream.getTracks().forEach((track) => track.stop());
      captureStream = null;
    }
    if (room) {
      await room.disconnect();
      room = null;
    }
    setStatus("Stopped.");
  } catch (err) {
    console.error(err);
    setStatus(`Failed to stop: ${err.message ?? err}`);
  } finally {
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

startBtn.addEventListener("click", startCapture);
stopBtn.addEventListener("click", stopCapture);
