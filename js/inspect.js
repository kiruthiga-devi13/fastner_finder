// Visual inspection
// -------------------
// Honest scope: this looks for GROSS geometric anomalies using convex-hull
// defect analysis (a classical CV technique) — not a trained defect-detection
// model. It will catch: chipped/jagged edges, missing chunks, obviously bent
// or non-symmetric parts. It will NOT reliably catch: hairline cracks,
// surface corrosion/rust, paint defects, or sub-millimeter burrs — those need
// controlled macro lighting and ideally a trained defect classifier, which is
// out of scope for a 2-day prototype. This limitation is stated explicitly
// in the report rather than glossed over.

const Inspect = (() => {

  function run(feature, expectedShape){
    const findings = [];
    let confidence = 0.6;

    const hull = new cv.Mat();
    cv.convexHull(feature.contour, hull, false, true);
    const hullIdx = new cv.Mat();
    cv.convexHull(feature.contour, hullIdx, false, false);

    let jaggedScore = 0;
    try {
      if (feature.contour.rows > 3 && hullIdx.rows > 3) {
        const defects = new cv.Mat();
        cv.convexityDefects(feature.contour, hullIdx, defects);
        let significant = 0;
        for (let i = 0; i < defects.rows; i++){
          const depth = defects.data32S[i*4+3] / 256.0; // depth in px
          if (depth > feature.perimeter * 0.015) significant++;
        }
        jaggedScore = significant;
        defects.delete();
      }
    } catch (e) {
      // convexityDefects can throw on degenerate contours; treat as inconclusive
      findings.push({ text: "Edge-defect analysis inconclusive on this contour.", severity: "info" });
    }
    hull.delete(); hullIdx.delete();

    if (jaggedScore >= 3) {
      findings.push({ text: `${jaggedScore} significant convexity defects detected — edge may be chipped, jagged, or the part may have a non-standard notch.`, severity: "fail" });
      confidence = 0.55;
    } else if (jaggedScore >= 1) {
      findings.push({ text: `${jaggedScore} minor edge irregularity detected — could be a real defect or just image noise/shadow. Recommend a second, better-lit capture.`, severity: "warn" });
      confidence = 0.45;
    }

    // Symmetry check for shapes expected to be round (washers, gears, round heads)
    if (expectedShape === "round") {
      const circ = CvUtil.circularity(feature.area, feature.perimeter);
      if (circ < 0.75) {
        findings.push({ text: `Circularity ${circ.toFixed(2)} (1.0 = perfect circle) — lower than expected for a round part. May indicate deformation, or the shot wasn't top-down (perspective distortion also lowers this score).`, severity: "warn" });
      }
    }

    if (findings.length === 0) {
      findings.push({ text: "No gross geometric anomalies detected against the outer silhouette.", severity: "info" });
    }

    const hasFail = findings.some(f => f.severity === "fail");
    const hasWarn = findings.some(f => f.severity === "warn");
    const result = hasFail ? "FAIL" : (hasWarn ? "INCONCLUSIVE" : "PASS");

    findings.push({
      text: "Scope note: this checks silhouette/edge geometry only. Surface defects (cracks, corrosion, paint damage) are not detected by this prototype.",
      severity: "info",
    });

    return { result, findings, confidence };
  }

  return { run };
})();
