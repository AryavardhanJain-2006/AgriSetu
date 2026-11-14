/* AgriSetu AI Analysis add-on. Additive only: does not edit app.js or Firebase data. */
(function () {
  "use strict";
  if (window.AgriSetuAIAddonLoaded) return;
  window.AgriSetuAIAddonLoaded = true;

  const CONFIG_URL = "ai-shelf-life-config.json";
  let config = null, model = null, cameraStream = null, currentImage = null;
  let currentContext = { role: "Farmer", crop: "", batchId: "" };
  let lastResult = null;
  let detectedCrop = "";

  const loadScript = src => new Promise((resolve, reject) => {
    const existing = [...document.scripts].find(s => s.src === src);
    if (existing) { resolve(); return; }
    const s = document.createElement("script"); s.src = src; s.onload = resolve;
    s.onerror = () => reject(new Error("Could not load image-recognition library. Check internet access."));
    document.head.appendChild(s);
  });

  async function loadConfig() {
    if (config) return config;
    const response = await fetch(CONFIG_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load ai-shelf-life-config.json. Upload it beside index.html.");
    config = await response.json();
    return config;
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
function detectRole() {
    // First check the role displayed by the existing dashboard
    const dashboardText = [
        document.querySelector(".side-brand .sub")?.innerText || "",
        document.querySelector(".app-top")?.innerText || ""
    ].join(" ").toLowerCase();

    if (/cold\s*storage/.test(dashboardText)) {
        return "Cold Storage";
    }

    if (/farmer/.test(dashboardText)) {
        return "Farmer";
    }

    if (/buyer/.test(dashboardText)) {
        return "Buyer";
    }

    if (/travel\s*partner|porter/.test(dashboardText)) {
        return "Travel Partner";
    }

    return "";
}
  function addControls() {
    // Add a persistent entry point on every authenticated app page. This avoids
    // depending on page-heading text, which differs between Farmer and Storage.
    const app = document.querySelector(".app-shell");
    if (!app) return;
    const role = detectRole();

if (role !== "Farmer" && role !== "Cold Storage") {
    document.getElementById("agri-ai-main-launch")?.remove();

    document.querySelectorAll(".agri-ai-batch-launch").forEach(button => {
        button.remove();
    });

    return;
}

    let button = document.getElementById("agri-ai-main-launch");
    if (!button) {
      button = document.createElement("button");
      button.id = "agri-ai-main-launch";
      button.className = "agri-ai-launch agri-ai-floating-launch";
      button.type = "button";
      button.setAttribute("aria-label", "Open AI Produce Analysis");
      button.innerHTML = '<span aria-hidden="true">✦</span> AI Produce Analysis';
      button.addEventListener("click", () => openModal({
        role: detectRole(), crop: "", batchId: ""
      }));
      document.body.appendChild(button);
    }

    // Add a contextual shortcut to monitoring cards when the current app
    // provides identifiable batch cards. This is optional; the main button works
    // independently of the app's card markup.
    document.querySelectorAll(".monitoring-card[data-monitor-batch]").forEach(card => {
      if (card.querySelector(".agri-ai-batch-launch")) return;
      const heading = card.querySelector("h2")?.textContent || "";
      const crop = heading.split("·")[0].trim();
      const batchId = card.getAttribute("data-monitor-batch") || "";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-outline agri-ai-batch-launch";
      btn.textContent = "Scan / Analyse this produce";
      btn.addEventListener("click", () => openModal({
        role: detectRole(), crop, batchId
      }));
      (card.querySelector(".section-header") || card).appendChild(btn);
    });
  }

  function ensureModal() {
    if (document.getElementById("agri-ai-modal")) return;
    const modal = document.createElement("div");
    modal.id = "agri-ai-modal";
    modal.className = "agri-ai-backdrop";
    modal.innerHTML = `
      <section class="agri-ai-dialog" role="dialog" aria-modal="true" aria-labelledby="agri-ai-title">
        <div class="agri-ai-head"><div><span class="agri-ai-kicker">AGRiSETU · VISUAL DEMO</span><h2 id="agri-ai-title">AI Produce Analysis</h2><p id="agri-ai-context"></p></div><button type="button" class="agri-ai-close" aria-label="Close">×</button></div>
        <div class="agri-ai-grid">
          <div class="agri-ai-preview">
            <video id="agri-ai-video" autoplay playsinline muted></video>
            <img id="agri-ai-image" alt="Selected produce preview" hidden>
            <div id="agri-ai-placeholder">Upload a produce photo or start the camera.</div>
          </div>
          <div class="agri-ai-controls">
            <label class="agri-ai-label">Upload image<input id="agri-ai-file" type="file" accept="image/*"></label>
            <div class="agri-ai-actions"><button type="button" id="agri-ai-camera" class="btn btn-outline">Start live camera</button><button type="button" id="agri-ai-capture" class="btn btn-outline" disabled>Capture frame</button></div>
            <div class="agri-ai-label">AI detected vegetable
              <div id="agri-ai-detected-crop" class="agri-ai-detected-crop" aria-live="polite">Not identified yet</div>
              <small id="agri-ai-detection-status" class="agri-ai-detection-status">Upload or capture an image, then click Identify.</small>
            </div>
            <label class="agri-ai-label">Choose vegetable here if identified incorrectly (optional)
              <select id="agri-ai-crop">
                <option value="">Select vegetables</option>
              </select>
            </label>
            <label class="agri-ai-label">Visible condition
              <select id="agri-ai-condition" required>
                <option value="" selected disabled>Select visible condition</option>
                <option value="fresh">Fresh-looking</option>
                <option value="slightly_aged">Minor blemishes / slightly aged</option>
                <option value="aging">Bruised, damaged or ageing</option>
                <option value="spoiling">Spoiling / severe damage</option>
              </select>
            </label>
            <button type="button" id="agri-ai-run" class="btn btn-primary agri-ai-run">Identify & estimate shelf life</button>
            <p class="agri-ai-hint">Image recognition is an indicative demo. Confirm the crop and visible condition before generating a report.</p>
          </div>
        </div>
        <div id="agri-ai-result" class="agri-ai-result" aria-live="polite"><p>Choose an image or use the camera to begin.</p></div>
        <div class="agri-ai-footer"><button type="button" id="agri-ai-report" class="btn btn-primary" disabled>Generate report</button><button type="button" id="agri-ai-done" class="btn btn-outline">Close</button></div>
      </section>`;
    document.body.appendChild(modal);
    modal.querySelector(".agri-ai-close").onclick = closeModal;
    modal.querySelector("#agri-ai-done").onclick = closeModal;
    modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
    modal.querySelector("#agri-ai-file").addEventListener("change", onFile);
    modal.querySelector("#agri-ai-camera").addEventListener("click", startCamera);
    modal.querySelector("#agri-ai-capture").addEventListener("click", captureFrame);
    modal.querySelector("#agri-ai-run").addEventListener("click", analyse);
    modal.querySelector("#agri-ai-condition").addEventListener("change", () => {
      lastResult = null;
      modal.querySelector("#agri-ai-report").disabled = true;
      modal.querySelector("#agri-ai-result").innerHTML = "<p>Visible condition updated. Click Identify & estimate shelf life again to refresh the result.</p>";
    });
    modal.querySelector("#agri-ai-report").addEventListener("click", generateReport);
  }

  async function openModal(context) {
    currentContext = context;
    ensureModal();
    const modal = document.getElementById("agri-ai-modal");
    modal.classList.add("open");
    modal.querySelector("#agri-ai-context").textContent =
      `${context.role} view${context.batchId ? " · Batch " + context.batchId : ""}${context.crop ? " · " + context.crop : ""}`;
    modal.querySelector("#agri-ai-result").innerHTML = "<p>Choose an image or use the camera to begin.</p>";
    modal.querySelector("#agri-ai-report").disabled = true;
    lastResult = null; currentImage = null; detectedCrop = "";
    stopCamera();
    modal.querySelector("#agri-ai-video").hidden = true;
    modal.querySelector("#agri-ai-image").hidden = true;
    modal.querySelector("#agri-ai-placeholder").hidden = false;
    modal.querySelector("#agri-ai-condition").value = "";
    try {
      const cfg = await loadConfig();
      const select = modal.querySelector("#agri-ai-crop");
      select.innerHTML = `<option value="">Select vegetables</option>` + Object.entries(cfg.crops).map(([key, item]) =>
        `<option value="${escapeHTML(key)}">${escapeHTML(item.displayName)}</option>`).join("");
      select.value = "";
      modal.querySelector("#agri-ai-detected-crop").textContent = "Not identified yet";
      modal.querySelector("#agri-ai-detection-status").textContent = "AI will suggest a crop after image analysis. Use the optional dropdown only if the suggestion is wrong.";
    } catch (err) {
      modal.querySelector("#agri-ai-result").innerHTML = `<p class="agri-ai-error">${escapeHTML(err.message)}</p>`;
    }
  }

  function closeModal() {
    const modal = document.getElementById("agri-ai-modal");
    if (modal) modal.classList.remove("open");
    stopCamera();
  }

  function showImage(src) {
    const modal = document.getElementById("agri-ai-modal");
    const img = modal.querySelector("#agri-ai-image");
    img.src = src; img.hidden = false;
    modal.querySelector("#agri-ai-video").hidden = true;
    modal.querySelector("#agri-ai-placeholder").hidden = true;
  }

  function onFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = async () => {
      currentImage = reader.result;
      showImage(currentImage);
      lastResult = null;
      const reportButton = document.getElementById("agri-ai-report");
      if (reportButton) reportButton.disabled = true;
      const status = document.getElementById("agri-ai-detection-status");
      if (status) status.textContent = "Image loaded. Click Identify & estimate shelf life to get an automatic suggestion.";
      const image = document.getElementById("agri-ai-image");
      if (image && image.decode) { try { await image.decode(); } catch (_) {} }
    };
    reader.readAsDataURL(file);
  }

  async function startCamera() {
    try {
      stopCamera();
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      const video = document.getElementById("agri-ai-video");
      video.srcObject = cameraStream; video.hidden = false;
      document.getElementById("agri-ai-image").hidden = true;
      document.getElementById("agri-ai-placeholder").hidden = true;
      document.getElementById("agri-ai-capture").disabled = false;
      await video.play();
    } catch (err) {
      document.getElementById("agri-ai-result").innerHTML = `<p class="agri-ai-error">Camera unavailable: ${escapeHTML(err.message)}. Use image upload instead. Camera access requires HTTPS or localhost.</p>`;
    }
  }

  function stopCamera() {
    if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
    const video = document.getElementById("agri-ai-video");
    if (video) { video.pause(); video.srcObject = null; }
    const capture = document.getElementById("agri-ai-capture");
    if (capture) capture.disabled = true;
  }

  function captureFrame() {
    const video = document.getElementById("agri-ai-video");
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    currentImage = canvas.toDataURL("image/jpeg", .88);
    showImage(currentImage);
    const status = document.getElementById("agri-ai-detection-status");
    if (status) status.textContent = "Frame captured. Click Identify & estimate shelf life to get an automatic suggestion.";
    stopCamera();
  }

  async function identifyImage() {
    if (!currentImage) return null;
    try {
      await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js");
      await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1");
      if (!model) model = await mobilenet.load({ version: 2, alpha: 1.0 });
      const img = document.getElementById("agri-ai-image");
      return await model.classify(img, 5);
    } catch (err) {
      console.warn("MobileNet recognition unavailable:", err);
      return [];
    }
  }

  function mapPrediction(predictions) {
    const text = predictions.map(p => p.className.toLowerCase()).join(" ");
    const matches = [
      ["tomato", /tomato/], ["potato", /potato/], ["onion", /onion/],
      ["capsicum", /bell pepper|sweet pepper|pepper/], ["carrot", /carrot/],
      ["cucumber", /cucumber|gherkin/], ["cauliflower", /cauliflower/]
    ];
    for (const [crop, regex] of matches) if (regex.test(text)) return crop;
    return "";
  }

  // Local reference-image matching for the user's supplied potato, onion and tomato photos.
  // Images are bundled with this add-on; no API key or external backend is required.
  const referenceSamples = [
    { crop: "potato", src: "ai-reference-images/potato-hand-1.jpg" },
    { crop: "potato", src: "ai-reference-images/potato-hand-2.jpg" },
    { crop: "potato", src: "ai-reference-images/potato-hand-3.jpg" },
    { crop: "potato", src: "ai-reference-images/potato-pile.jpg" },
    { crop: "onion", src: "ai-reference-images/onion-2.jpg" },
    { crop: "tomato", src: "ai-reference-images/tomato-1.jpg" },
    { crop: "tomato", src: "ai-reference-images/tomato-2.jpg" }
  ];
  let referenceEmbeddingsPromise = null;

  async function embeddingFor(imageElement) {
    const tensor = model.infer(imageElement, true);
    try {
      const values = await tensor.data();
      return Array.from(values);
    } finally {
      tensor.dispose();
    }
  }

  function cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
  }

  async function loadReferenceEmbeddings() {
    if (referenceEmbeddingsPromise) return referenceEmbeddingsPromise;
    referenceEmbeddingsPromise = (async () => {
      const entries = [];
      for (const sample of referenceSamples) {
        try {
          const image = new Image();
          image.src = new URL(sample.src, document.baseURI).href;
          await image.decode();
          entries.push({ crop: sample.crop, embedding: await embeddingFor(image) });
        } catch (error) {
          console.warn("Could not load AgriSetu reference image:", sample.src, error);
        }
      }
      return entries;
    })();
    return referenceEmbeddingsPromise;
  }

  async function matchReferenceImages() {
    if (!currentImage) return null;
    try {
      const entries = await loadReferenceEmbeddings();
      if (!entries.length) return null;
      const input = await embeddingFor(document.getElementById("agri-ai-image"));
      const scores = entries.map(entry => ({
        crop: entry.crop,
        score: cosineSimilarity(input, entry.embedding)
      })).sort((a, b) => b.score - a.score);
      const bestByCrop = {};
      for (const item of scores) {
        if (bestByCrop[item.crop] === undefined) bestByCrop[item.crop] = item.score;
      }
      const ranked = Object.entries(bestByCrop)
        .map(([crop, score]) => ({ crop, score }))
        .sort((a, b) => b.score - a.score);
      if (!ranked.length) return null;
      const margin = ranked.length > 1 ? ranked[0].score - ranked[1].score : 1;
      // For this demonstration, choose the nearest of the supplied reference photos.
      // This is a similarity-based suggestion, not a trained/validated classifier.
      return { ...ranked[0], margin, accepted: ranked[0].score >= 0.30 && margin >= 0.005 };
    } catch (error) {
      console.warn("AgriSetu reference matching unavailable:", error);
      return null;
    }
  }

  function reref(score) { return String(Math.round(Number(score) * 100)); }

  async function analyse() {
    const modal = document.getElementById("agri-ai-modal");
    const result = modal.querySelector("#agri-ai-result");
    if (!currentImage) {
      result.innerHTML = '<p class="agri-ai-error">Upload an image or capture a camera frame first.</p>'; return;
    }
    const selectedCondition = modal.querySelector("#agri-ai-condition").value;
    if (!selectedCondition) {
      result.innerHTML = '<p class="agri-ai-error">Please select the visible condition before estimating shelf life.</p>';
      modal.querySelector("#agri-ai-report").disabled = true;
      return;
    }
    const run = modal.querySelector("#agri-ai-run");
    run.disabled = true; run.textContent = "Analysing image…";
    const predictions = await identifyImage();
    const imageElement = modal.querySelector("#agri-ai-image");
    if (imageElement && imageElement.decode) {
      try { await imageElement.decode(); } catch (_) {}
    }
    const referenceMatch = await matchReferenceImages();
    const modelCrop = mapPrediction(predictions || []);
    const autoCrop = referenceMatch && referenceMatch.accepted
      ? referenceMatch.crop
      : modelCrop;
    const cropSelect = modal.querySelector("#agri-ai-crop");
    const detectionStatus = modal.querySelector("#agri-ai-detection-status");
    detectedCrop = autoCrop && cropSelect.querySelector(`option[value="${autoCrop}"]`) ? autoCrop : "";
    const detectedLabel = modal.querySelector("#agri-ai-detected-crop");
    if (detectedCrop) {
      const cfgForLabel = await loadConfig();
      detectedLabel.textContent = cfgForLabel.crops[detectedCrop]?.displayName || detectedCrop;
      detectionStatus.textContent = referenceMatch && referenceMatch.accepted
        ? "Suggested from supplied reference-photo similarity. Please verify; this is not a trained classifier."
        : "Suggested by the general image model. If incorrect, choose the right crop in the optional dropdown.";
    } else {
      detectedLabel.textContent = "No confident match";
      detectionStatus.textContent = "The image could not be identified confidently. Choose the vegetable in the optional dropdown to continue.";
    }
    const cropKey = cropSelect.value || detectedCrop;
    const condition = selectedCondition;
    try {
      const cfg = await loadConfig();
      if (!cropKey || !cfg.crops[cropKey]) {
        result.innerHTML = '<p class="agri-ai-error">No reliable crop suggestion. Please choose the correct vegetable from the optional dropdown.</p>';
        modal.querySelector("#agri-ai-report").disabled = true;
        return;
      }
      const crop = cfg.crops[cropKey];
      const multiplier = Number(crop.visualAdjustments[condition] || 1);
      const estimate = Math.max(1, Math.round(Number(crop.baseShelfLifeDays) * multiplier));
      const top = (predictions || []).slice(0, 3).map(p => `${p.className} (${Math.round(p.probability * 100)}%)`).join(", ");
      lastResult = {
        cropKey, cropName: crop.displayName, condition, estimate,
        baseShelfLifeDays: crop.baseShelfLifeDays, temperatureC: crop.temperatureC,
        humidityPercent: crop.humidityPercent, predictions: top,
        referenceScore: referenceMatch && referenceMatch.accepted ? Math.round(referenceMatch.score * 100) : null,
        role: currentContext.role, batchId: currentContext.batchId || "",
        analysedAt: new Date().toLocaleString()
      };
      result.innerHTML = `
        <div class="agri-ai-result-head"><div><span class="agri-ai-kicker">IDENTIFICATION RESULT</span><h3>${escapeHTML(crop.displayName)}</h3><p>${cropSelect.value ? "Crop manually corrected by user." : (referenceMatch && referenceMatch.accepted ? "Suggested by reference-photo similarity; please verify." : "Suggested by general image recognition; please verify.")}</p></div><div class="agri-ai-days"><b>${estimate}</b><span>estimated days remaining</span></div></div>
        <div class="agri-ai-facts"><div><span>Base shelf life</span><b>${crop.baseShelfLifeDays} days</b></div><div><span>Demo storage temperature</span><b>${crop.temperatureC} °C</b></div><div><span>Demo humidity</span><b>${crop.humidityPercent}%</b></div><div><span>Visible condition</span><b>${condition.replaceAll("_"," ")}</b></div></div>
        <p class="agri-ai-disclaimer">${escapeHTML(cfg.disclaimer)}</p>
        ${referenceMatch && referenceMatch.accepted ? `<p class="agri-ai-model-label">Reference-photo similarity: ${reref(referenceMatch.score)}% (demo match, not validated accuracy).</p>` : ""}${top ? `<p class="agri-ai-model-label">General image model top labels: ${escapeHTML(top)}</p>` : ""}
      `;
      modal.querySelector("#agri-ai-report").disabled = false;
    } catch (err) {
      result.innerHTML = `<p class="agri-ai-error">${escapeHTML(err.message)}</p>`;
    } finally {
      run.disabled = false; run.textContent = "Identify & estimate shelf life";
    }
  }

  function generateReport() {
    if (!lastResult) return;
    const r = lastResult;
    const report = `AGRiSETU — VISUAL PRODUCE ANALYSIS REPORT\n\nCrop: ${r.cropName}\nEstimated remaining shelf life (demo): ${r.estimate} days\nBase shelf life configured: ${r.baseShelfLifeDays} days\nVisible condition selected: ${r.condition.replaceAll("_"," ")}\nConfigured ideal temperature: ${r.temperatureC} °C\nConfigured ideal humidity: ${r.humidityPercent}%\nUser role: ${r.role}\nBatch ID: ${r.batchId || "Not linked to a stored batch"}\nAnalysis time: ${r.analysedAt}\nImage model labels: ${r.predictions || "No supported label confidently identified"}\nReference photo similarity: ${r.referenceScore == null ? "No accepted reference match" : r.referenceScore + "% (demo similarity, not validated accuracy)"}\n\nIMPORTANT: Demonstration estimate only. A photograph cannot establish internal quality, microbial safety or scientifically validated remaining shelf life. Confirm crop and condition manually. Sensor-based post-storage monitoring remains a separate workflow.\n`;
    const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `AgriSetu-${r.cropKey}-analysis-report.txt`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  const observer = new MutationObserver(() => addControls());
  function init() {
    if (!document.querySelector('link[data-agrisetu-ai-addon="true"]')) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "ai-analysis-addon.css";
      css.dataset.agrisetuAiAddon = "true";
      document.head.appendChild(css);
    }
    observer.observe(document.body, { childList: true, subtree: true });
    addControls();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
