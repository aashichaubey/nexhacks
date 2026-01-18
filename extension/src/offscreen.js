let mediaRecorder = null;
let captureStream = null;
let activeTabId = null;

async function startRecording({ streamId, tabId, mimeType }) {
  if (mediaRecorder) {
    stopRecording();
  }
  activeTabId = tabId;
  captureStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  const recorderMime = mimeType ?? "audio/webm;codecs=opus";
  mediaRecorder = new MediaRecorder(captureStream, { mimeType: recorderMime });

  mediaRecorder.addEventListener("dataavailable", async (event) => {
    if (!event.data || event.data.size === 0) {
      return;
    }
    const arrayBuffer = await event.data.arrayBuffer();
    const base64 = arrayBufferToBase64(arrayBuffer);
    chrome.runtime.sendMessage({
      type: "audio_chunk",
      payload: {
        tabId: activeTabId,
        mimeType: recorderMime,
        data: base64,
        ts: new Date().toISOString(),
        durationMs: 15000
      }
    });
  });

  mediaRecorder.start(15000);
}

function stopRecording() {
  if (mediaRecorder) {
    mediaRecorder.stop();
    mediaRecorder = null;
  }
  if (captureStream) {
    captureStream.getTracks().forEach((track) => track.stop());
    captureStream = null;
  }
  activeTabId = null;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "start_capture") {
    startRecording(message.payload).catch((err) => {
      chrome.runtime.sendMessage({
        type: "capture_error",
        payload: { message: err?.message ?? String(err) }
      });
    });
  }
  if (message?.type === "stop_capture") {
    stopRecording();
  }
});

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
