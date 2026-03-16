const cameraEl = document.getElementById("camera");
const snapshotEl = document.getElementById("snapshot");
const modelNameEl = document.getElementById("modelName");
const capturePanelEl = document.getElementById("capturePanel");
const cameraWrapEl = document.getElementById("cameraWrap");

const startCameraBtn = document.getElementById("startCameraBtn");
const captureBtn = document.getElementById("captureBtn");
const retakeBtn = document.getElementById("retakeBtn");
const analyzeBtn = document.getElementById("analyzeBtn");
const clearResultBtn = document.getElementById("clearResultBtn");

const cameraStatusEl = document.getElementById("cameraStatus");
const resultBadgeEl = document.getElementById("resultBadge");
const resultIconEl = document.getElementById("resultIcon");
const resultTitleEl = document.getElementById("resultTitle");
const resultTextEl = document.getElementById("resultText");
const issuesListEl = document.getElementById("issuesList");

let stream = null;
let capturedDataUrl = "";
// State machine: "idle" | "live" | "captured" | "analyzing"
// idle      – no stream, camera area hidden
// live      – stream active, video playing
// captured  – stream STILL ACTIVE but video paused; srcObject stays set so frozen frame is visible
// analyzing – locked while waiting for API response
let appState = "idle";

const SYSTEM_PROMPT = `You are a strict visual quality inspector.
Task: inspect ONE photographed object expected to be a circle with uniform texture.
Output only valid JSON.
Rules:
1) If object appears circular and texture is homogeneous (no cracks, stains, spots, or anomalies), status must be "pass".
2) Otherwise status must be "warning" and include likely issue types.
3) Be conservative: if uncertain, report warning.
4) Do not include markdown or extra prose.`;

const USER_PROMPT = `Return JSON exactly with this schema:
{
  "status": "pass" | "warning",
  "is_perfect_circle": boolean,
  "texture_homogeneous": boolean,
  "short_reason": string,
  "issues": [
    {
      "type": "shape" | "crack" | "texture" | "stain" | "other",
      "description": string,
      "confidence": number
    }
  ]
}
If status is pass, issues can be an empty array.
If status is warning, include one or more issues.
confidence must be between 0 and 1.`;

function setStatus(message) {
  cameraStatusEl.textContent = message;
}

function setAnalyzeVisual(isAnalyzing) {
  cameraWrapEl.classList.toggle("is-analyzing", isAnalyzing);
}

// Single source of truth for all button/panel state — called whenever appState changes.
function applyState(state) {
  appState = state;
  const isIdle      = state === "idle";
  const isLive      = state === "live";
  const isCaptured  = state === "captured";
  const isAnalyzing = state === "analyzing";

  cameraEl.hidden = isIdle;

  // Start/Stop Camera: disabled in "captured" (would destroy preview) and during analysis
  startCameraBtn.textContent = isLive ? "Stop Camera" : "Start Camera";
  startCameraBtn.disabled = isCaptured || isAnalyzing;

  captureBtn.disabled  = !isLive;
  retakeBtn.disabled   = !isCaptured;
  analyzeBtn.disabled  = !isCaptured;

  capturePanelEl.classList.toggle("is-locked", isAnalyzing);
  setAnalyzeVisual(isAnalyzing);
}

function stopCameraStream() {
  if (!stream) {
    return;
  }

  stream.getTracks().forEach((track) => track.stop());
  stream = null;
  cameraEl.srcObject = null;
}

function resetResultPanel() {
  setResult("pending", "Waiting for photo", "Take a photo, then tap Analyze.");
}

function setResult(state, title, text, issues = []) {
  resultBadgeEl.classList.remove("pending", "pass", "warning");
  resultBadgeEl.classList.add(state);
  resultTitleEl.textContent = title;
  resultTextEl.textContent = text;
  resultIconEl.textContent = state === "pass" ? "\u2713" : state === "warning" ? "!" : "\u2026";

  issuesListEl.innerHTML = "";
  issues.forEach((issue) => {
    const li = document.createElement("li");
    li.textContent = `${issue.type}: ${issue.description} (confidence ${Number(issue.confidence).toFixed(2)})`;
    issuesListEl.appendChild(li);
  });
}

async function startCamera() {
  // Only allow toggle from "live" or "idle" states
  if (appState === "live") {
    stopCameraStream();
    capturedDataUrl = "";
    applyState("idle");
    setStatus("Camera stopped. Tap Start Camera to begin.");
    return;
  }

  if (appState !== "idle") return;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("Camera API not available in this browser.");
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    cameraEl.srcObject = stream;
    await cameraEl.play();
    capturedDataUrl = "";
    applyState("live");
    setStatus("Camera ready. Frame the object and tap Take Photo.");
  } catch (error) {
    stopCameraStream();
    applyState("idle");
    setStatus(`Could not access camera: ${error.message}`);
  }
}

function capturePhoto() {
  if (appState !== "live") {
    return;
  }

  const width = cameraEl.videoWidth;
  const height = cameraEl.videoHeight;

  if (!width || !height) {
    setStatus("Camera stream not ready yet. Try again.");
    return;
  }

  // Draw current frame to the hidden canvas — generates the API payload only, never shown.
  snapshotEl.width = width;
  snapshotEl.height = height;
  snapshotEl.getContext("2d", { willReadFrequently: true }).drawImage(cameraEl, 0, 0, width, height);
  capturedDataUrl = snapshotEl.toDataURL("image/jpeg", 0.9);

  // Pause WITHOUT stopping the stream. srcObject stays set → frozen frame remains visible.
  cameraEl.pause();

  applyState("captured");
  setStatus("Photo captured. Tap Analyze to inspect, or Retake.");
}

async function retakePhoto() {
  if (appState !== "captured") {
    return;
  }

  capturedDataUrl = "";
  // Stream is still alive — just resume playback, no getUserMedia needed.
  await cameraEl.play();
  applyState("live");
  setStatus("Camera ready. Frame the object and tap Take Photo.");
}

function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("No JSON object found in model response.");
    }
    return JSON.parse(match[0]);
  }
}

function normalizeResponse(payload) {
  const status = payload.status === "pass" ? "pass" : "warning";
  const shortReason = typeof payload.short_reason === "string" ? payload.short_reason : "Model did not provide a reason.";
  const issues = Array.isArray(payload.issues) ? payload.issues : [];

  return {
    status,
    shortReason,
    isPerfectCircle: Boolean(payload.is_perfect_circle),
    textureHomogeneous: Boolean(payload.texture_homogeneous),
    issues: issues.map((issue) => ({
      type: String(issue.type || "other"),
      description: String(issue.description || "No description provided."),
      confidence: Math.max(0, Math.min(1, Number(issue.confidence) || 0.5))
    }))
  };
}

async function analyzePhoto() {
  if (appState !== "captured") {
    return;
  }
  const modelName = modelNameEl.value.trim();
  if (!modelName) {
    setStatus("Select a model.");
    return;
  }

  applyState("analyzing");
  setStatus("Analyzing image with model...");
  setResult("pending", "Analyzing", "Please wait while the model inspects the photo.");

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: modelName,
        imageDataUrl: capturedDataUrl,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: USER_PROMPT
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API error ${response.status}: ${body}`);
    }

    const data = await response.json();
    const content = data?.content;
    if (!content) {
      throw new Error("No model content returned.");
    }

    const parsed = extractJson(content);
    const verdict = normalizeResponse(parsed);

    const reasons = [];
    reasons.push(verdict.isPerfectCircle ? "shape: circular" : "shape: not circular");
    reasons.push(verdict.textureHomogeneous ? "texture: homogeneous" : "texture: anomaly detected");

    if (verdict.status === "pass") {
      setResult("pass", "Pass", `${verdict.shortReason} (${reasons.join("; ")})`, verdict.issues);
    } else {
      setResult("warning", "Warning", `${verdict.shortReason} (${reasons.join("; ")})`, verdict.issues);
    }

    setStatus("Analysis complete. Tap Clear Screen to start a new check.");
  } catch (error) {
    setResult("warning", "Analysis failed", error.message);
    setStatus("Analysis failed. Tap Clear Screen to reset, then try again.");
  } finally {
    stopCameraStream();
    applyState("idle");
  }
}

function clearScreen() {
  stopCameraStream();
  capturedDataUrl = "";
  applyState("idle");
  resetResultPanel();
  setStatus("Screen cleared. Tap Start Camera to begin.");
}

startCameraBtn.addEventListener("click", startCamera); // startCamera renamed to handle toggle
captureBtn.addEventListener("click", capturePhoto);
retakeBtn.addEventListener("click", retakePhoto);
analyzeBtn.addEventListener("click", analyzePhoto);
clearResultBtn.addEventListener("click", clearScreen);

applyState("idle");
resetResultPanel();

window.addEventListener("beforeunload", () => {
  stopCameraStream();
});
