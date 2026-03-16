const cameraEl = document.getElementById("camera");
const photoPreviewEl = document.getElementById("photoPreview");
const snapshotEl = document.getElementById("snapshot");
const modelNameEl = document.getElementById("modelName"); // <select> element — .value gives the chosen model id
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
let captureLocked = false;
let videoWidth = 0;
let videoHeight = 0;

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

function setAnalyzePreviewVisual(isAnalyzing) {
  cameraWrapEl.classList.toggle("is-analyzing", isAnalyzing);
}

function showLiveCamera() {
  cameraEl.style.display = "";
  photoPreviewEl.style.display = "none";
}

function showCapturedPreview() {
  if (capturedDataUrl) {
    photoPreviewEl.src = capturedDataUrl;
  }
  photoPreviewEl.style.display = "";
  cameraEl.style.display = "none";
}

function setCaptureLocked(locked) {
  captureLocked = locked;
  capturePanelEl.classList.toggle("is-locked", locked);
  startCameraBtn.disabled = locked;
  captureBtn.disabled = locked || !stream || Boolean(capturedDataUrl);
  retakeBtn.disabled = locked || !Boolean(capturedDataUrl);
  analyzeBtn.disabled = locked || !Boolean(capturedDataUrl);
}

function stopCameraStream() {
  if (!stream) {
    return;
  }

  stream.getTracks().forEach((track) => track.stop());
  stream = null;
  cameraEl.srcObject = null;
  videoWidth = 0;
  videoHeight = 0;
}

function updateCameraToggleLabel() {
  startCameraBtn.textContent = stream ? "Stop Camera" : "Start Camera";
}

function resetResultPanel() {
  setResult("pending", "Waiting for photo", "Take a photo, then tap Analyze.");
}

function setResult(state, title, text, issues = []) {
  resultBadgeEl.classList.remove("pending", "pass", "warning");
  resultBadgeEl.classList.add(state);
  resultTitleEl.textContent = title;
  resultTextEl.textContent = text;
  resultIconEl.textContent = state === "pass" ? "✓" : state === "warning" ? "!" : "…";

  issuesListEl.innerHTML = "";
  issues.forEach((issue) => {
    const li = document.createElement("li");
    li.textContent = `${issue.type}: ${issue.description} (confidence ${Number(issue.confidence).toFixed(2)})`;
    issuesListEl.appendChild(li);
  });
}

async function startCamera() {
  if (captureLocked) {
    return;
  }

  if (stream) {
    stopCameraStream();
    updateCameraToggleLabel();

    cameraEl.style.display = "none";
    captureBtn.disabled = true;
    retakeBtn.disabled = !capturedDataUrl;
    analyzeBtn.disabled = !capturedDataUrl;

    setStatus(capturedDataUrl ? "Camera stopped. You can Analyze, or Start Camera and retake." : "Camera stopped.");
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("Camera API is not available in this browser.");
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });

    cameraEl.srcObject = stream;

    // Pre-allocate dimensions once the stream metadata is available
    await new Promise((resolve, reject) => {
      let settled = false;

      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        cameraEl.onloadedmetadata = null;
        cameraEl.onerror = null;
        reject(new Error("Timed out waiting for camera metadata."));
      }, 5000);

      cameraEl.onloadedmetadata = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        cameraEl.onloadedmetadata = null;
        cameraEl.onerror = null;
        videoWidth = cameraEl.videoWidth;
        videoHeight = cameraEl.videoHeight;
        resolve();
      };

      cameraEl.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        cameraEl.onloadedmetadata = null;
        cameraEl.onerror = null;
        const mediaErr = cameraEl.error;
        reject(new Error(mediaErr ? `Video error (code ${mediaErr.code}): ${mediaErr.message}` : "Unknown video element error."));
      };
    });

    await cameraEl.play();
    updateCameraToggleLabel();

    showLiveCamera();
    setAnalyzePreviewVisual(false);

    captureBtn.disabled = false;
    retakeBtn.disabled = true;
    analyzeBtn.disabled = true;

    capturedDataUrl = "";
    photoPreviewEl.src = "";
    setStatus("Camera ready. Frame the object and tap Take Photo.");
  } catch (error) {
    stopCameraStream();
    updateCameraToggleLabel();
    setStatus(`Could not access camera: ${error.message}`);
  }
}

function capturePhoto() {
  if (!stream) {
    setStatus("Start camera first.");
    return;
  }

  const width = videoWidth || cameraEl.videoWidth;
  const height = videoHeight || cameraEl.videoHeight;

  if (!width || !height) {
    setStatus("Camera stream not ready yet. Try again.");
    return;
  }

  // Draw the current frame to the hidden canvas for data-URL generation
  snapshotEl.width = width;
  snapshotEl.height = height;
  const ctx = snapshotEl.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(cameraEl, 0, 0, width, height);

  capturedDataUrl = snapshotEl.toDataURL("image/jpeg", 0.9);

  // Show the captured image; the camera stream stays running for retakes
  showCapturedPreview();

  captureBtn.disabled = true;
  retakeBtn.disabled = false;
  analyzeBtn.disabled = false;

  setStatus("Photo captured. Tap Analyze or Retake.");
}

async function retakePhoto() {
  if (captureLocked) {
    return;
  }

  capturedDataUrl = "";
  photoPreviewEl.src = "";
  setAnalyzePreviewVisual(false);

  if (stream) {
    // Camera stream is still running — just switch back to the live feed
    showLiveCamera();
    captureBtn.disabled = false;
    retakeBtn.disabled = true;
    analyzeBtn.disabled = true;
    setStatus("Camera ready. Frame the object and tap Take Photo.");
  } else {
    // Stream was stopped; reinitialise the camera
    setStatus("Retake mode active. Opening camera...");
    await startCamera();
  }
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
  const modelName = modelNameEl.value.trim();

  if (!modelName) {
    setStatus("Enter a model name.");
    return;
  }

  if (!capturedDataUrl) {
    setStatus("Capture a photo before analysis.");
    return;
  }

  showCapturedPreview();
  setAnalyzePreviewVisual(true);
  setCaptureLocked(true);

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
    setAnalyzePreviewVisual(false);
    stopCameraStream();
    updateCameraToggleLabel();
  }
}

function clearScreen() {
  stopCameraStream();
  updateCameraToggleLabel();

  capturedDataUrl = "";
  photoPreviewEl.src = "";
  photoPreviewEl.style.display = "none";
  cameraEl.style.display = "none";
  setAnalyzePreviewVisual(false);

  setCaptureLocked(false);
  resetResultPanel();
  setStatus("Screen cleared. Tap Start Camera to begin.");
}

startCameraBtn.addEventListener("click", startCamera);
captureBtn.addEventListener("click", capturePhoto);
retakeBtn.addEventListener("click", retakePhoto);
analyzeBtn.addEventListener("click", analyzePhoto);
clearResultBtn.addEventListener("click", clearScreen);

updateCameraToggleLabel();
cameraEl.style.display = "none";
photoPreviewEl.style.display = "none";
setAnalyzePreviewVisual(false);

window.addEventListener("beforeunload", () => {
  stopCameraStream();
});
