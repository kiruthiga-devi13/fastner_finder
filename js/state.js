// Central, plain-object app state. Kept deliberately simple (no framework)
// so the whole pipeline is traceable by reading these fields in the console.
const AppState = {
  mode: "photo",              // photo | video | live
  stream: null,
  captures: [],                // [{canvas, dataUrl, ts}] - one or more views
  activeCaptureIndex: -1,

  calibration: {
    done: false,
    method: null,              // "auto" | "manual"
    referenceType: null,       // "card" | "a4" | "coin1" ...
    referenceMm: null,
    referencePx: null,
    mmPerPx: null,
    confidence: null,          // 0-1, how sure we are the reference was found correctly
  },

  identification: {
    label: null,
    confidence: null,
    source: "heuristic",       // classical-CV shape heuristic, not a trained classifier
  },

  measurements: [],            // [{name, valueMm, source: 'measured'|'estimated', note}]

  inspection: {
    result: null,               // "PASS" | "FAIL" | "INCONCLUSIVE"
    findings: [],
    confidence: null,
  },

  fastener: null,               // result from fastener-db matching, or null if not a fastener

  reportReady: false,
};

function resetPipelineAfterNewCapture(){
  AppState.calibration = { done:false, method:null, referenceType:null, referenceMm:null,
    referencePx:null, mmPerPx:null, confidence:null };
  AppState.identification = { label:null, confidence:null, source:"heuristic" };
  AppState.measurements = [];
  AppState.inspection = { result:null, findings:[], confidence:null };
  AppState.fastener = null;
  AppState.reportReady = false;
}
