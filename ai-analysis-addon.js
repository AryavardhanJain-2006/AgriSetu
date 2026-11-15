const ALLOWED_VEGETABLES = [
    "tomato",
    "potato",
    "onion",
    "carrot"
];
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
    const email = localStorage.getItem("agrisetuUser");

    if (!email) return "";

    return (
        localStorage.getItem("agrisetuRole_" + email) || ""
    ).trim();
}
function addControls() {
    const app = document.querySelector(".app-shell");
    const role = detectRole();

    const sessionActive =
        sessionStorage.getItem("agrisetuSession") === "true";

    const allowed =
        app &&
        sessionActive &&
        ["Farmer", "Cold Storage"].includes(role);

    // Hide button and shortcuts on landing page or restricted accounts
    if (!allowed) {
        document.getElementById("agri-ai-main-launch")?.remove();

        document.querySelectorAll(".agri-ai-batch-launch").forEach(btn => {
            btn.remove();
        });

        return;
    }

    // Create main AI button if it does not exist
    let button = document.getElementById("agri-ai-main-launch");

    if (!button) {
        button = document.createElement("button");
        button.id = "agri-ai-main-launch";
        button.className = "agri-ai-launch agri-ai-floating-launch";
        button.type = "button";
        button.innerHTML =
            '<span aria-hidden="true">✦</span> AI Produce Analysis';

        button.addEventListener("click", () => {
            const currentRole = detectRole();

            if (!["Farmer", "Cold Storage"].includes(currentRole)) {
                button.remove();
                return;
            }

            openModal({
                role: currentRole,
                crop: "",
                batchId: ""
            });
        });

        document.body.appendChild(button);
    }

    // Add shortcuts to monitoring cards
    document.querySelectorAll(
        ".monitoring-card[data-monitor-batch]"
    ).forEach(card => {
        if (card.querySelector(".agri-ai-batch-launch")) return;

        const heading = card.querySelector("h2")?.textContent || "";
        const crop = heading.split("·")[0].trim();
        const batchId = card.getAttribute("data-monitor-batch") || "";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn-outline agri-ai-batch-launch";
        btn.textContent = "Scan / Analyse this produce";

        btn.addEventListener("click", () => {
            const currentRole = detectRole();

            if (!["Farmer", "Cold Storage"].includes(currentRole)) return;

            openModal({
                role: currentRole,
                crop,
                batchId
            });
        });

        (card.querySelector(".section-header") || card)
            .appendChild(btn);
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
            <div class="agri-ai-label">AI detected produce
              <div id="agri-ai-detected-crop" class="agri-ai-detected-crop" aria-live="polite">Not identified yet</div>
              <small id="agri-ai-detection-status" class="agri-ai-detection-status">Upload or capture an image, then click Identify.</small>
            </div>
            <label class="agri-ai-label">Choose vegetable here if identified incorrectly (optional)
              <select id="agri-ai-crop">
                <option value="">Use AI prediction</option>
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
            <button type="button" id="agri-ai-run" class="btn btn-primary agri-ai-run">Identify produce & estimate shelf life</button>
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
      modal.querySelector("#agri-ai-result").innerHTML = "<p>Visible condition updated. Click Identify produce & estimate shelf life again to refresh the result.</p>";
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
    modal.querySelector("#agri-ai-file").value = "";
    modal.querySelector("#agri-ai-crop").value = "";
    stopCamera();
    modal.querySelector("#agri-ai-video").hidden = true;
    modal.querySelector("#agri-ai-image").hidden = true;
    modal.querySelector("#agri-ai-placeholder").hidden = false;
    modal.querySelector("#agri-ai-condition").value = "";
    try {
      const cfg = await loadConfig();
      
const labels = await loadClassNames();

const select = modal.querySelector("#agri-ai-crop");
const allowedDropdownLabels = labels.filter(label =>
    ALLOWED_VEGETABLES.includes(normaliseLabel(label))
);

select.innerHTML =
    `<option value="">Use AI prediction</option>` +
    allowedDropdownLabels.map(label => {
        const key = configKeyForLabel(label, cfg);
        const suffix = key ? " · shelf-life profile available" : "";

        return `<option value="${escapeHTML(label)}">
            ${escapeHTML(prettyLabel(label) + suffix)}
        </option>`;
    }).join("");


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
      if (status) status.textContent = "Image loaded. Click Identify produce & estimate shelf life to get an automatic suggestion.";
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
    if (status) status.textContent = "Frame captured. Click Identify produce & estimate shelf life to get an automatic suggestion.";
    stopCamera();
  }

  const MODEL_URL = "./tfjs_model/model.json";
  const CLASS_NAMES_URL = "./class_names.json";
  let trainedModel = null;
  let classNamesPromise = null;

  async function loadClassNames() {
    if (!classNamesPromise) {
      classNamesPromise = fetch(CLASS_NAMES_URL, { cache: "no-cache" }).then(async response => {
        if (!response.ok) throw new Error("Could not load class_names.json. Upload it beside index.html.");
        const labels = await response.json();
        if (!Array.isArray(labels) || labels.length !== 36) {
          throw new Error("class_names.json is invalid: expected the 36 labels used by the trained AgriSetu model.");
        }
        return labels;
      });
    }
    return classNamesPromise;
  }

  function prettyLabel(label) {
    return String(label || "").replace(/\b\w/g, c => c.toUpperCase());
  }

  function normaliseLabel(label) {
    return String(label || "").toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();
  }

  function configKeyForLabel(label, cfg) {
    const normalized = normaliseLabel(label);
    const aliases = {
      "bell pepper": "capsicum",
      "capsicum": "capsicum",
      "sweetcorn": "corn",
      "raddish": "radish",
      "jalepeno": "jalapeno"
    };
    const key = aliases[normalized] || normalized;
    return cfg && cfg.crops && cfg.crops[key] ? key : "";
  }

 
async function loadTrainedModel() {
    if (trainedModel) return trainedModel;

    await loadScript(
        "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js"
    );

    await tf.ready();

    // Load the converted TensorFlow.js GraphModel
    trainedModel = await tf.loadGraphModel(MODEL_URL);

    console.log("AgriSetu GraphModel loaded successfully");

    return trainedModel;
}


  async function identifyImage() {
    if (!currentImage) throw new Error("Choose an image or capture a camera frame first.");
    const labels = await loadClassNames();
    const model = await loadTrainedModel();
    const image = document.getElementById("agri-ai-image");
    if (image && image.decode) await image.decode();
    if (!image || !image.naturalWidth) throw new Error("The selected image is not ready. Please upload or capture it again.");

    const input = tf.tidy(() =>
      tf.browser.fromPixels(image)
        .resizeBilinear([224, 224])
        .toFloat()
        .expandDims(0)
    );
    let output;
    try {
      output = model.predict(input);
      const scores = await output.data();
      return Array.from(scores)
        .map((score, index) => ({ label: labels[index], probability: Number(score) }))
        .sort((a, b) => b.probability - a.probability)
        .slice(0, 36);
    } finally {
      input.dispose();
      if (output && typeof output.dispose === "function") output.dispose();
    }
  }

  function reref(score) { return String(Math.round(Number(score) * 100)); }

  async function analyse() {
    const modal = document.getElementById("agri-ai-modal");
    const result = modal.querySelector("#agri-ai-result");
    if (!currentImage) {
      result.innerHTML = '<p class="agri-ai-error">Upload an image or capture a camera frame first.</p>';
      return;
    }

    const run = modal.querySelector("#agri-ai-run");
    const reportButton = modal.querySelector("#agri-ai-report");
    const detectedLabel = modal.querySelector("#agri-ai-detected-crop");
    const detectionStatus = modal.querySelector("#agri-ai-detection-status");
    const cropSelect = modal.querySelector("#agri-ai-crop");
    const condition = modal.querySelector("#agri-ai-condition").value;

    run.disabled = true;
    run.textContent = "Loading trained AgriSetu model…";
    reportButton.disabled = true;
    result.innerHTML = '<p>Loading your trained 36-class model and analysing the image. The first load may take a little time.</p>';

    try {
      
const predictions = await identifyImage();

if (!predictions.length) {
    throw new Error("The model returned no predictions.");
}

const cfg = await loadConfig();
const manualLabel = cropSelect.value;

const allowedPredictions = predictions.filter(p =>
    ALLOWED_VEGETABLES.includes(normaliseLabel(p.label))
);

let best;

if (manualLabel) {
    if (!ALLOWED_VEGETABLES.includes(normaliseLabel(manualLabel))) {
        throw new Error("Only Tomato, Potato, Onion and Carrot are supported.");
    }

    best = predictions.find(p => p.label === manualLabel) || {
        label: manualLabel,
        probability: null
    };
} else {
    best = allowedPredictions[0];

    if (!best) {
        detectedLabel.textContent = "Unsupported vegetable";
        detectionStatus.textContent =
            "Please upload Tomato, Potato, Onion or Carrot.";

        result.innerHTML =
            '<p class="agri-ai-error">No supported vegetable was found in the model predictions.</p>';

        lastResult = null;
        reportButton.disabled = true;
        return;
    }
}

const chosenLabel = best.label;
const cropKey = configKeyForLabel(chosenLabel, cfg);

      const crop = cropKey ? cfg.crops[cropKey] : null;
      const top = predictions.slice(0, 5).map(p =>
        `${prettyLabel(p.label)} (${(p.probability * 100).toFixed(1)}% model score)`
      ).join(", ");

      detectedCrop = chosenLabel;
      detectedLabel.textContent = prettyLabel(chosenLabel);
      detectionStatus.textContent = manualLabel
        ? "You selected/corrected the model's suggested class. Confirm the result visually."
        : "Identified using your trained AgriSetu 36-class model. Model scores are not guaranteed real-world accuracy; please verify.";

      if (crop) {
        if (!condition) {
          lastResult = null;
          result.innerHTML = `
            <div class="agri-ai-result-head">
              <div><span class="agri-ai-kicker">VEGETABLE IDENTIFIED</span>
              <h3>${escapeHTML(crop.displayName)}</h3>
              <p>${manualLabel ? "Manually selected/corrected." : "Predicted by your trained AgriSetu model."}</p></div>
            </div>
            <p class="agri-ai-model-label">Top model predictions: ${escapeHTML(top)}</p>
            <p class="agri-ai-disclaimer">Select the visible condition above and click Identify produce & estimate shelf life again. The trained model identifies the produce; the condition is needed separately for the illustrative shelf-life estimate.</p>`;
          return;
        }

        const multiplier = Number(crop.visualAdjustments[condition] || 1);
        const estimate = Math.max(1, Math.round(Number(crop.baseShelfLifeDays) * multiplier));
        lastResult = {
          cropKey, cropName: crop.displayName, condition, estimate,
          baseShelfLifeDays: crop.baseShelfLifeDays,
          temperatureC: crop.temperatureC,
          humidityPercent: crop.humidityPercent,
          predictions: top,
          referenceScore: null,
          recognitionModel: "AgriSetu trained 36-class Keras model converted to TensorFlow.js",
          role: currentContext.role,
          batchId: currentContext.batchId || "",
          analysedAt: new Date().toLocaleString()
        };
        result.innerHTML = `
          <div class="agri-ai-result-head">
            <div><span class="agri-ai-kicker">IDENTIFICATION RESULT</span>
            <h3>${escapeHTML(crop.displayName)}</h3>
            <p>${manualLabel ? "Manually selected/corrected." : "Identified by the trained AgriSetu model."}</p></div>
            <div class="agri-ai-days"><b>${estimate}</b><span>illustrative days remaining</span></div>
          </div>
          <div class="agri-ai-facts">
            <div><span>Base shelf life</span><b>${crop.baseShelfLifeDays} days</b></div>
            <div><span>Demo storage temperature</span><b>${crop.temperatureC} °C</b></div>
            <div><span>Demo humidity</span><b>${crop.humidityPercent}%</b></div>
            <div><span>Visible condition</span><b>${escapeHTML(condition.replaceAll("_", " "))}</b></div>
          </div>
          <p class="agri-ai-model-label">Top model predictions: ${escapeHTML(top)}</p>
          <p class="agri-ai-disclaimer">${escapeHTML(cfg.disclaimer || "Shelf-life output is an illustrative estimate, not food-safety advice.")}</p>`;
        reportButton.disabled = false;
      } else {
        lastResult = {
          cropKey: normaliseLabel(chosenLabel).replace(/\s+/g, "-"),
          cropName: prettyLabel(chosenLabel),
          condition: "",
          estimate: null,
          predictions: top,
          recognitionModel: "AgriSetu trained 36-class Keras model converted to TensorFlow.js",
          role: currentContext.role,
          batchId: currentContext.batchId || "",
          analysedAt: new Date().toLocaleString()
        };
        result.innerHTML = `
          <div class="agri-ai-result-head">
            <div><span class="agri-ai-kicker">PRODUCE IDENTIFICATION RESULT</span>
            <h3>${escapeHTML(prettyLabel(chosenLabel))}</h3>
            <p>${manualLabel ? "Manually selected/corrected." : "Identified by your trained AgriSetu model."}</p></div>
          </div>
          <p class="agri-ai-model-label">Top model predictions: ${escapeHTML(top)}</p>
          <p class="agri-ai-disclaimer">This item is included in your trained model's 36 classes, but AgriSetu's current shelf-life configuration has no profile for it. The system identifies it without inventing a shelf-life estimate.</p>`;
        reportButton.disabled = false;
      }
    } catch (err) {
      console.error("AgriSetu trained model analysis failed:", err);
      result.innerHTML = `<p class="agri-ai-error">${escapeHTML(err.message || "Image identification failed.")}</p>`;
      detectionStatus.textContent = "The trained model could not be loaded or the image could not be analysed.";
    } finally {
      run.disabled = false;
      run.textContent = "Identify produce & estimate shelf life";
    }
  }

  function generateReport() {
    if (!lastResult) return;
    const r = lastResult;
    const report = `AGRiSETU — VISUAL PRODUCE ANALYSIS REPORT\n\nIdentified produce: ${r.cropName}\nRecognition model: ${r.recognitionModel || "AgriSetu trained image classifier"}\nTop model predictions: ${r.predictions || "Not available"}\nEstimated remaining shelf life (illustrative): ${r.estimate == null ? "Not available — no configured profile" : r.estimate + " days"}\nBase shelf life configured: ${r.baseShelfLifeDays ?? "Not available"}\nVisible condition selected: ${r.condition ? r.condition.replaceAll("_"," ") : "Not selected"}\nConfigured ideal temperature: ${r.temperatureC ?? "Not available"} °C\nConfigured ideal humidity: ${r.humidityPercent ?? "Not available"}%\nUser role: ${r.role}\nBatch ID: ${r.batchId || "Not linked to a stored batch"}\nAnalysis time: ${r.analysedAt}\n\nIMPORTANT: Model scores are not calibrated accuracy. Shelf-life values, where shown, are illustrative only. A photograph cannot establish internal quality, microbial safety or scientifically validated remaining shelf life. Confirm the produce identity and condition manually.\n`;
    const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `AgriSetu-${r.cropKey}-analysis-report.txt`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

const observer = new MutationObserver(() => addControls());

function monitorNavigation() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
        const result = originalPushState.apply(this, args);
        addControls();
        return result;
    };

    history.replaceState = function (...args) {
        const result = originalReplaceState.apply(this, args);
        addControls();
        return result;
    };

    window.addEventListener("popstate", addControls);
    window.addEventListener("hashchange", addControls);

    // Detect navigation that changes the dashboard without changing the URL
    document.addEventListener("click", () => {
        setTimeout(addControls, 100);
        setTimeout(addControls, 400);
    });
}

function init() {
    if (!document.querySelector('link[data-agrisetu-ai-addon="true"]')) {
        const css = document.createElement("link");
        css.rel = "stylesheet";
        css.href = "ai-analysis-addon.css";
        css.dataset.agrisetuAiAddon = "true";
        document.head.appendChild(css);
    }

    monitorNavigation();

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    addControls();
}
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
