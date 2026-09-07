// Handles getUserMedia camera access and the three capture modes.
// Runs entirely client-side; requires HTTPS or localhost (browser security
// requirement for camera access - this is why deployment target is
// GitHub Pages / Vercel / localhost, not an http:// host).

const CameraModule = (() => {
  const video = document.getElementById("video");
  const overlay = document.getElementById("overlay");
  const workCanvas = document.getElementById("workCanvas");
  const stillFrame = document.getElementById("stillFrame");
  let mediaRecorder = null;
  let recordedChunks = [];
  let liveTimer = null;

  async function listCameras(){
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d => d.kind === "videoinput");
    const sel = document.getElementById("cameraSelect");
    sel.innerHTML = "";
    cams.forEach((c, i) => {
      const opt = document.createElement("option");
      opt.value = c.deviceId;
      opt.textContent = c.label || `Camera ${i+1}`;
      sel.appendChild(opt);
    });
    return cams;
  }

  async function start(deviceId){
    if (AppState.stream) {
      AppState.stream.getTracks().forEach(t => t.stop());
    }
    const constraints = {
      video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        facingMode: deviceId ? undefined : { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1440 },
      },
      audio: false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    AppState.stream = stream;
    video.srcObject = stream;
    video.hidden = false;
    stillFrame.hidden = true;
    await video.play();
    resizeOverlayToVideo();
    await listCameras(); // labels populate only after permission granted
  }

  function resizeOverlayToVideo(){
    const rect = video.getBoundingClientRect();
    overlay.width = rect.width;
    overlay.height = rect.height;
    workCanvas.width = video.videoWidth || rect.width;
    workCanvas.height = video.videoHeight || rect.height;
  }

  function grabFrameToCanvas(){
    // Draws the current video frame (or the still image, for retake flows)
    // into workCanvas at native camera resolution — measurement always
    // happens on full-resolution pixels, never the downscaled display size.
    const ctx = workCanvas.getContext("2d");
    if (!video.hidden && video.videoWidth) {
      workCanvas.width = video.videoWidth;
      workCanvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, workCanvas.width, workCanvas.height);
    } else if (!stillFrame.hidden) {
      workCanvas.width = stillFrame.naturalWidth;
      workCanvas.height = stillFrame.naturalHeight;
      ctx.drawImage(stillFrame, 0, 0, workCanvas.width, workCanvas.height);
    }
    return workCanvas;
  }

  function capturePhoto(){
    const canvas = grabFrameToCanvas();
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    return { canvas, dataUrl, ts: Date.now() };
  }

  function showStill(dataUrl){
    stillFrame.src = dataUrl;
    stillFrame.hidden = false;
    video.hidden = true;
    requestAnimationFrame(resizeOverlayToVisibleImage);
  }

  function resizeOverlayToVisibleImage(){
    const rect = document.getElementById("viewport").getBoundingClientRect();
    overlay.width = Math.max(1, Math.round(rect.width));
    overlay.height = Math.max(1, Math.round(rect.height));
  }

  // Convert a click in the CSS overlay into native image pixels, accounting
  // for object-fit: contain letterboxing. This fixes manual calibration on
  // uploaded images and on cameras whose aspect ratio differs from the 4:3
  // viewport.
  function displayPointToImage(clientX,clientY,targetCanvas){
    if(!targetCanvas||clientX==null||clientY==null)return null;
    const rect=overlay.getBoundingClientRect();
    const x=clientX-rect.left,y=clientY-rect.top;
    const iw=targetCanvas.width,ih=targetCanvas.height;
    const scale=Math.min(rect.width/iw,rect.height/ih);
    const dw=iw*scale,dh=ih*scale;
    const ox=(rect.width-dw)/2,oy=(rect.height-dh)/2;
    if(x<ox||y<oy||x>ox+dw||y>oy+dh)return null;
    const imageX=(x-ox)/scale,imageY=(y-oy)/scale;
    return {imageX,imageY,displayX:x,displayY:y};
  }

  function showLiveVideo(){
    stillFrame.hidden = true;
    video.hidden = false;
  }

  // --- video mode: short clip, then we sample a sharp frame from it ---
  function startRecording(onStop){
    recordedChunks = [];
    const rec = new MediaRecorder(AppState.stream, { mimeType: pickMimeType() });
    rec.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    rec.onstop = () => onStop(new Blob(recordedChunks, { type: rec.mimeType }));
    rec.start();
    mediaRecorder = rec;
  }
  function stopRecording(){
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  }
  function pickMimeType(){
    const candidates = ["video/webm;codecs=vp9", "video/webm", "video/mp4"];
    return candidates.find(t => MediaRecorder.isTypeSupported(t)) || "";
  }

  // --- live mode: continuously re-run the pipeline at low frequency ---
  function startLive(onFrame){
    stopLive();
    liveTimer = setInterval(() => {
      const canvas = grabFrameToCanvas();
      onFrame(canvas);
    }, 700); // throttled: OpenCV.js contour work is not free-running-60fps cheap
  }
  function stopLive(){
    if (liveTimer) clearInterval(liveTimer);
    liveTimer = null;
  }

  return {
    start, listCameras, resizeOverlayToVideo, grabFrameToCanvas,
    capturePhoto, showStill, showLiveVideo,
    startRecording, stopRecording, startLive, stopLive,
    get video(){ return video; }, get overlay(){ return overlay; },
    get workCanvas(){ return workCanvas; }, displayPointToImage,
    resizeOverlayToVisibleImage,
  };
})();
