// Wires the UI to the pipeline modules. Each pipeline stage (identify,
// measure, inspect, fastener-match, report) is now an independent action:
// pressing its button, or its step number, runs just that stage using
// whatever inputs are currently available, and shows that stage's result.
// Nothing is silently auto-chained anymore — this makes the tool easier to
// demo step-by-step and easier to debug (you can re-run just one stage
// after tweaking a photo, without redoing everything before it).

(function(){
  const el = id => document.getElementById(id);
  const toast = (msg, ms=2600) => {
    const t = el("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._h); toast._h = setTimeout(()=> t.hidden = true, ms);
  };
  const setStep = (name, cls) => {
    document.querySelectorAll(`.step[data-step="${name}"]`).forEach(s => s.classList.add(cls));
  };
  const clearStepStates = () => document.querySelectorAll(".step").forEach(s => s.classList.remove("active","done"));

  function setupIntroModal(){
    const overlay = el("introOverlay");
    if (!overlay) return;
    let dismissedBefore = false;
    try { dismissedBefore = localStorage.getItem("nebula_intro_dismissed") === "1"; } catch(e){ /* storage may be blocked; default to showing */ }

    if (dismissedBefore){
      overlay.hidden = true;
    }
    const dismiss = () => {
      overlay.hidden = true;
      if (el("introDontShow").checked){
        try { localStorage.setItem("nebula_intro_dismissed", "1"); } catch(e){ /* ignore if storage unavailable */ }
      }
    };
    el("introCloseBtn").addEventListener("click", dismiss);
    el("introCloseX").addEventListener("click", dismiss);
  }

  async function init(){
    setupIntroModal();
    try {
      await CvUtil.waitForOpenCv();
    } catch(e){
      toast("OpenCV.js failed to load — check your connection.", 5000);
    }
    try {
      await CameraModule.start();
    } catch(e){
      toast("Camera access failed — you can still use Upload image.", 5000);
    }
    window.addEventListener("resize", CameraModule.resizeOverlayToVideo);

    el("cameraSelect").addEventListener("change", e => CameraModule.start(e.target.value));

    document.querySelectorAll(".mode-btn").forEach(btn => {
      btn.addEventListener("click", () => setMode(btn.dataset.mode));
    });

    el("captureBtn").addEventListener("click", onCaptureClick);
    el("retakeBtn").addEventListener("click", onRetake);
    el("addViewBtn").addEventListener("click", onRetake);

    el("uploadBtn").addEventListener("click", () => el("uploadInput").click());
    el("uploadInput").addEventListener("change", onUploadFile);

    el("refSelect").addEventListener("change", onRefSelectChange);
    el("autoCalibBtn").addEventListener("click", onAutoCalibrate);
    el("manualCalibBtn").addEventListener("click", onManualCalibrate);

    el("identifyBtn").addEventListener("click", onIdentify);
    el("measureBtn").addEventListener("click", onMeasure);
    el("inspectBtn").addEventListener("click", onInspect);
    el("fastenerBtn").addEventListener("click", onFastener);
    el("reportBtn").addEventListener("click", () => Report.generate());

    // Every step's numbered circle is itself a button — clicking "3" runs
    // the same action as pressing that step's own button, so the numbers
    // double as quick-access controls even for steps that also have their
    // own dedicated buttons (2 and 7).
    document.querySelectorAll(".step-num[data-action]").forEach(btn => {
      btn.addEventListener("click", () => runStepAction(btn.dataset.action));
    });

    clearStepStates();
    setStep("capture", "active");
  }

  function runStepAction(action){
    switch(action){
      case "capture": onCaptureClick(); break;
      case "calibrate": onAutoCalibrate(); break;
      case "identify": onIdentify(); break;
      case "measure": onMeasure(); break;
      case "inspect": onInspect(); break;
      case "fastener": onFastener(); break;
      case "report": Report.generate(); break;
    }
  }

  function setMode(mode){
    AppState.mode = mode;
    document.querySelectorAll(".mode-btn").forEach(b => b.classList.toggle("active", b.dataset.mode===mode));
    el("captureBtn").textContent = mode === "photo" ? "Capture" : mode === "video" ? "Record 2s" : "Start live scan";
  }

  async function onCaptureClick(){
    if (AppState.mode === "photo"){
      capturePhotoFlow();
    } else if (AppState.mode === "video"){
      await captureVideoFlow();
    } else {
      startLiveFlow();
    }
  }

  function capturePhotoFlow(){
    const cap = CameraModule.capturePhoto();
    AppState.captures.push(cap);
    AppState.activeCaptureIndex = AppState.captures.length - 1;
    resetPipelineAfterNewCapture();
    CameraModule.showStill(cap.dataUrl);
    afterNewCapture();
  }

  async function captureVideoFlow(){
    el("captureBtn").disabled = true;
    toast("Recording 2s clip…");
    CameraModule.startRecording(async (blob) => {
      const url = URL.createObjectURL(blob);
      const off = document.createElement("video");
      off.src = url; off.muted = true; off.playsInline = true;
      await off.play().catch(()=>{});
      off.currentTime = Math.max(0, (off.duration||1.8) - 0.15);
      await new Promise(res => { off.onseeked = res; setTimeout(res, 800); });
      const c = document.createElement("canvas");
      c.width = off.videoWidth; c.height = off.videoHeight;
      c.getContext("2d").drawImage(off, 0, 0);
      const dataUrl = c.toDataURL("image/jpeg", 0.92);
      AppState.captures.push({ canvas: c, dataUrl, ts: Date.now() });
      AppState.activeCaptureIndex = AppState.captures.length - 1;
      resetPipelineAfterNewCapture();
      CameraModule.showStill(dataUrl);
      el("captureBtn").disabled = false;
      afterNewCapture();
      toast("Frame captured from video clip.");
    });
    setTimeout(() => CameraModule.stopRecording(), 2000);
  }

  function startLiveFlow(){
    toast("Live mode: auto-analyzing every ~0.7s. Press again to freeze a frame.");
    let frozen = false;
    el("captureBtn").textContent = "Freeze frame";
    CameraModule.startLive((canvas) => {
      if (frozen) return;
      if (AppState.calibration.done){
        const result = Measurement.analyze(canvas, AppState.calibration.mmPerPx, AppState.calibration.excludeRegion);
        Measurement.drawOverlay(CameraModule.overlay, canvas, AppState.calibration, result);
        if (result.ok) result.largestFeature.contour.delete();
      }
    });
    el("captureBtn").onclick = () => {
      frozen = true;
      CameraModule.stopLive();
      const cap = CameraModule.capturePhoto();
      AppState.captures.push(cap);
      AppState.activeCaptureIndex = AppState.captures.length - 1;
      resetPipelineAfterNewCapture();
      CameraModule.showStill(cap.dataUrl);
      afterNewCapture();
      el("captureBtn").onclick = onCaptureClick;
      el("captureBtn").textContent = "Start live scan";
    };
  }

  // --- upload-from-device: an alternative to the camera entirely ---
  function onUploadFile(e){
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        const dataUrl = c.toDataURL("image/jpeg", 0.92);
        AppState.captures.push({ canvas: c, dataUrl, ts: Date.now() });
        AppState.activeCaptureIndex = AppState.captures.length - 1;
        resetPipelineAfterNewCapture();
        CameraModule.showStill(dataUrl);
        afterNewCapture();
        toast("Image uploaded. Continue with calibration.");
      };
      img.onerror = () => toast("Could not read that image file.");
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = ""; // allow re-uploading the same file later
  }

  function onRetake(){
    resetPipelineAfterNewCapture();
    CameraModule.showLiveVideo();
    el("retakeBtn").hidden = true;
    el("addViewBtn").hidden = true;
    el("calibControls").hidden = true;
    el("measureTable").innerHTML = "";
    el("idDetail").textContent = "—";
    el("inspectResult").textContent = "—";
    el("fastenerResult").textContent = "—";
    el("identifyBtn").disabled = true;
    el("measureBtn").disabled = true;
    el("inspectBtn").disabled = true;
    el("fastenerBtn").disabled = true;
    el("reportBtn").disabled = true;
    clearStepStates();
    setStep("capture", "active");
  }

  function afterNewCapture(){
    el("retakeBtn").hidden = false;
    el("addViewBtn").hidden = false;
    el("calibControls").hidden = false;
    el("calibDetail").textContent = "Select the reference object visible in frame, then auto-detect.";
    // Identification doesn't need calibration (it works on shape alone), so
    // it's available as soon as there's an image — no need to wait for scale.
    el("identifyBtn").disabled = false;
    renderViewsStrip();
    clearStepStates();
    setStep("capture", "done");
    setStep("calibrate", "active");
    setStep("identify", "active");
  }

  function renderViewsStrip(){
    const strip = el("viewsStrip");
    strip.innerHTML = "";
    AppState.captures.forEach((c,i) => {
      const img = document.createElement("img");
      img.src = c.dataUrl;
      img.title = `View ${i+1}`;
      img.style.outline = i === AppState.activeCaptureIndex ? "2px solid var(--accent)" : "none";
      img.addEventListener("click", () => {
        AppState.activeCaptureIndex = i;
        CameraModule.showStill(c.dataUrl);
        renderViewsStrip();
      });
      strip.appendChild(img);
    });
  }

  function onRefSelectChange(){
    el("customMm").hidden = el("refSelect").value !== "custom";
  }

  function activeCanvas(){
    const cap = AppState.captures[AppState.activeCaptureIndex];
    if (!cap) return null;
    const c = document.createElement("canvas");
    c.width = cap.canvas.width; c.height = cap.canvas.height;
    c.getContext("2d").drawImage(cap.canvas, 0, 0);
    return c;
  }

  function readReferenceMm(){
    const refType = el("refSelect").value;
    const opt = el("refSelect").selectedOptions[0];
    const mm = refType === "custom" ? parseFloat(el("customMm").value) : parseFloat(opt.dataset.mm);
    return { refType, mm };
  }

  function onAutoCalibrate(){
    if (AppState.activeCaptureIndex < 0){ toast("Capture or upload an image first."); return; }
    const { refType, mm } = readReferenceMm();
    if (!mm || mm <= 0){ toast("Enter a valid reference size in mm first."); return; }

    const canvas = activeCanvas();
    const result = Calibration.autoDetect(canvas, refType, mm);
    const box = el("calibResult");
    box.classList.add("show");

    if (!result.ok){
      box.innerHTML = `<span class="warn">Auto-detect failed (${Math.round((result.confidence||0)*100)}% match).</span> ${result.reason} Try "Set manually" instead.`;
      return;
    }
    AppState.calibration = {
      done: true, method: "auto", referenceType: refType, referenceMm: mm,
      referencePx: result.referencePx, mmPerPx: result.mmPerPx, confidence: result.confidence,
      excludeRegion: result.excludeRegion,
    };
    const confPct = Math.round(result.confidence*100);
    box.innerHTML = `<span class="${confPct>=70?'ok':'warn'}">Calibrated: ${result.mmPerPx.toFixed(5)} mm/px (${confPct}% confidence)</span>`;
    finishCalibration();
  }

  function onManualCalibrate(){
    if (AppState.activeCaptureIndex < 0){ toast("Capture or upload an image first."); return; }
    const { refType, mm } = readReferenceMm();
    if (!mm || mm <= 0){ toast("Enter a valid reference size in mm first."); return; }
    toast("Tap the two ends of the known-length reference on the image.");
    Calibration.beginManualPick((pxDist) => {
      const mmPerPx = mm / pxDist;
      AppState.calibration = {
        done: true, method: "manual", referenceType: refType, referenceMm: mm,
        referencePx: pxDist, mmPerPx, confidence: 0.9,
        excludeRegion: null,
      };
      const box = el("calibResult");
      box.classList.add("show");
      box.innerHTML = `<span class="ok">Calibrated manually: ${mmPerPx.toFixed(5)} mm/px</span>`;
      finishCalibration();
    }, canvas);
  }

  function finishCalibration(){
    setStep("calibrate", "done");
    el("calibDetail").textContent = `${AppState.calibration.mmPerPx.toFixed(5)} mm/px via ${AppState.calibration.method} calibration`;
    el("measureBtn").disabled = false;
    setStep("measure", "active");
  }

  // --- Step 3: Identify (independent — doesn't require calibration) ---
  function onIdentify(){
    const canvas = activeCanvas();
    if (!canvas){ toast("Capture or upload an image first."); return; }

    setStep("identify", "active");
    const { mat, feature, diagnostic } = CvUtil.isolateComponent(canvas, AppState.calibration.excludeRegion);

    if (!feature){
      el("idDetail").textContent = CvUtil.describeIsolationFailure(diagnostic);
      mat.delete();
      return;
    }
    const circles = CvUtil.houghCircles(mat, Math.max(6, Math.round(Math.min(mat.rows,mat.cols)*0.015)));
    const br = feature.boundingRect;
    const holeCount = circles.filter(c =>
      c.x>br.x && c.x<br.x+br.width && c.y>br.y && c.y<br.y+br.height &&
      (c.r*2) < 0.7*Math.min(br.width,br.height)
    ).length;

    const id = Identify.classify(canvas, feature, holeCount);
    AppState.identification = id;
    el("idDetail").innerHTML = `<b>${id.label}</b> · ${Math.round(id.confidence*100)}% confidence<br><span style="opacity:.7">${id.notes.join("; ") || id.source}</span>`;
    setStep("identify", "done");

    feature.contour.delete();
    mat.delete();
  }

  // --- Step 4: Measure ---
  function onMeasure(){
    if (!AppState.calibration.done){ toast("Calibrate scale first (step 2)."); return; }
    const canvas = activeCanvas();
    if (!canvas){ toast("Capture or upload an image first."); return; }

    const result = Measurement.analyze(canvas, AppState.calibration.mmPerPx, AppState.calibration.excludeRegion);
    if (!result.ok){
      toast(result.reason, 4000);
      return;
    }
    AppState.measurements = result.measurements;
    AppState.lastFeatureSummary = { area: result.largestFeature.area, perimeter: result.largestFeature.perimeter };
    renderMeasureTable(result.measurements);
    Measurement.drawOverlay(CameraModule.overlay, canvas, AppState.calibration, result);
    setStep("measure","done");

    result.largestFeature.contour.delete();

    el("inspectBtn").disabled = false;
    el("fastenerBtn").disabled = false;
    el("reportBtn").disabled = false;
    AppState.reportReady = true;
    setStep("inspect", "active");
  }

  // --- Step 5: Inspect (re-derives its own contour, independent of Measure) ---
  function onInspect(){
    const canvas = activeCanvas();
    if (!canvas){ toast("Capture or upload an image first."); return; }
    const { mat, feature, diagnostic } = CvUtil.isolateComponent(canvas, AppState.calibration.excludeRegion);
    if (!feature){
      el("inspectResult").textContent = CvUtil.describeIsolationFailure(diagnostic);
      mat.delete();
      return;
    }
    const expectedShape = /washer|gear/i.test(AppState.identification.label||"") ? "round" : "other";
    const insp = Inspect.run(feature, expectedShape);
    AppState.inspection = insp;
    renderInspection(insp);
    setStep("inspect","done");
    setStep("fastener","active");

    feature.contour.delete();
    mat.delete();
  }

  // --- Step 6: Fastener match (numeric only, no OpenCV needed) ---
  function onFastener(){
    if (!AppState.measurements.length){ toast("Run Measure first (step 4)."); return; }
    const widthM = AppState.measurements.find(m=>m.name==="Overall width");
    const lengthM = AppState.measurements.find(m=>m.name==="Overall length");
    if (!widthM || widthM.valueMm == null){
      el("fastenerResult").textContent = "No usable diameter measurement to match against the fastener table.";
      return;
    }
    const looksLikeFastener = /fastener|bolt|screw/i.test(AppState.identification.label||"");
    const warning = looksLikeFastener ? "" :
      `<span style="color:var(--estimated)">Not identified as a fastener, but matching anyway since you asked:</span><br>`;
    // In a top-down view the measured overall width of a hex bolt is
    // normally the head across-flats (AF), not the shaft diameter.
    const f = FastenerDB.match(widthM.valueMm, "headAF", lengthM?.valueMm ?? null);
    AppState.fastener = f;
    renderFastener(f, warning);
    setStep("fastener","done");
    setStep("report","active");
  }

  function renderMeasureTable(measurements){
    const table = el("measureTable");
    table.innerHTML = "";
    measurements.forEach(m => {
      const row = document.createElement("div");
      row.className = "measure-row";
      const dotClass = m.source === "measured" ? "dot-measured" : m.source === "matched" ? "dot-matched" : "dot-estimated";
      row.innerHTML = `<span class="src ${dotClass}"></span>
        <span style="flex:1;margin-left:6px;">${m.name}</span>
        <span class="val">${m.valueMm!=null ? m.valueMm.toFixed(2)+' mm' : '—'}</span>`;
      row.title = m.note || "";
      table.appendChild(row);
    });
  }

  function renderInspection(insp){
    const cls = insp.result === "PASS" ? "pass" : insp.result === "FAIL" ? "fail" : "";
    el("inspectResult").innerHTML = `<span class="${cls}">${insp.result}</span> (${Math.round(insp.confidence*100)}% confidence)<br>` +
      insp.findings.map(f => `– ${f.text}`).join("<br>");
  }

  function renderFastener(f, warningHtml){
    if (!f){ el("fastenerResult").innerHTML = (warningHtml||"") + "Could not match against the fastener table."; return; }
    el("fastenerResult").innerHTML = (warningHtml||"") +
      `<b>${f.size}</b> (${f.standard})<br>` +
      `Pitch: ${f.pitchMm} mm · AF: ${f.wrenchAFmm} mm<br>` +
      `Confidence: ${Math.round(f.confidence*100)}%` +
      (f.note ? `<br><span style="color:var(--estimated)">${f.note}</span>` : "");
  }

  window.addEventListener("DOMContentLoaded", init);
})();
