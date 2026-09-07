# Nebula Fastener Finder — Engineering Write-up

A browser-based AI-assisted inspection tool for mechanical components, driven entirely
by a smartphone camera. No app install, no industrial vision hardware, no server —
everything runs client-side.

## What changed since the first prototype

A few refinements made after initial review:

- **Upload from device**: an "Upload image…" control sits next to Capture, for testing
  against existing photos or a laptop without a webcam, or for judges/reviewers who'd
  rather test with their own component photos than a live camera.
- **Decoupled, independently-triggerable steps**: identification, measurement,
  inspection, and fastener-matching used to be silently chained together behind the
  Measure button. They're now separate actions — each step's number is itself a button,
  and each has its own dedicated action button — so any stage can be re-run on its own
  (useful both for demoing the pipeline stage-by-stage and for debugging one stage
  without redoing the others). Identification specifically no longer waits on
  calibration, since classifying a shape doesn't need a physical scale — only the
  measurement step does.
- **Centralized contour isolation**: identify/measure/inspect previously each had their
  own slightly-different copy of "which contour is the component, ignoring the
  reference object" logic. That's now one shared function
  (`CvUtil.isolateComponent`), so all three stages agree on what they're looking at
  instead of potentially picking different contours on the same image.
- **Adaptive edge thresholds**: Canny edge detection now derives its low/high
  thresholds from the image's own median intensity ("auto-Canny": lo = 0.66×median,
  hi = 1.33×median) instead of a fixed 50/150 pair, so edge detection adapts to
  whatever lighting the shot was taken in rather than being tuned for one lighting
  condition and failing on others.
- **More robust coin calibration**: circular-reference detection now clusters all
  Hough-circle candidates by radius and picks the most internally-consistent cluster
  (i.e. the radius multiple detections agree on), instead of trusting the first
  detected circle — which was vulnerable to false-positives on bolt heads or washers
  also being circular.

## Stack, and why

| Layer | Choice | Why |
|---|---|---|
| Capture | `getUserMedia` / `MediaRecorder` (native browser APIs) | Free, zero dependencies, works for photo/video/live without a backend |
| Calibration & measurement | **OpenCV.js** (classical CV: Canny edges, contours, Hough circles, convex hulls) | Geometry problems (find the edge, fit a bounding box, find a circle) are well-conditioned classical CV problems. A trained model would be slower to build, harder to explain, and not more accurate here — see "AI vs classical CV" below |
| Component ID & defect flags | Hand-written shape heuristics on top of OpenCV.js contour output | Honest scope: this is not a trained classifier (no labeled training set was feasible in 2 days). It's rule-based and says so in the UI |
| Report | **jsPDF** | Free, client-side PDF generation, no server round-trip |
| Hosting | GitHub Pages | Free, HTTPS by default — camera access requires a secure context, so this was non-negotiable |

Everything above is free/open-source and runs entirely in the browser — no API keys,
no paid CV service, no cloud inference cost.

## Calibration approach

The user places a reference object of **known real-world size** in frame: an ID/credit
card (85.60 × 53.98 mm, ISO/IEC 7810 ID-1), an A4 sheet, or a common coin.

1. **Auto-detect**: OpenCV.js finds contours, keeps ones that approximate to a
   quadrilateral (for card/A4) or a circle (for coins, via Hough transform), and scores
   each candidate by how closely its aspect ratio (or circularity) matches the known
   reference shape. The best-scoring match becomes the calibration reference.
2. **Scale recovery**: `mm_per_pixel = known_mm / measured_px`, using the reference's
   **short edge** for rectangles (short edges are less distorted than long edges by the
   moderate downward camera angle typical of a phone shooting a desktop, since
   foreshortening scales with the sine of the tilt angle applied along the edge's own
   direction — the long edge accumulates more absolute error at a given angle).
3. **Manual fallback**: if auto-detection scores below ~35% confidence, the user taps
   two points spanning the reference's known length directly on the image. This is
   always available and is treated as *higher* confidence than a shaky auto-detect,
   because it's a human-verified measurement.
4. **Confidence, not silence**: every calibration result carries a confidence score
   derived from the geometric match quality (aspect-ratio deviation), not a fabricated
   number. Low-confidence results are shown as low-confidence, not hidden.

## Where AI/heuristics were used vs. classical CV, and why

- **Classical CV** (contours, Hough transforms, convex hulls) for anything with a
  *deterministic geometric answer*: finding edges, fitting bounding boxes, finding
  circles, measuring distances. These have known error characteristics and don't
  hallucinate — a contour is a contour.
- **Heuristics** (rule-based, not trained) for component identification and defect
  flagging: aspect ratio + circularity + hole count classify a shape into a handful of
  broad mechanical categories. This was a scope decision, not an accuracy ceiling — a
  trained classifier (e.g. a fine-tuned MobileNet) would generalize better across
  lighting/background/orientation, but needs a labeled dataset and training time this
  project didn't have. The heuristic approach is explicit about its own weak points in
  the UI (e.g. "head geometry suggestive but unconfirmed") instead of pretending to be
  more certain than it is.
- **No AI at all** for the fastener database — it's a static, hand-populated ISO metric
  reference table matched by nearest-diameter. This matches the brief's own example
  output format ("Estimated Size: M10 … Confidence: 92%") — a nearest-standard match,
  not a generative guess.

## Error / uncertainty model

Every number the app produces is tagged with a provenance:

- **Measured** — read directly from image geometry once calibrated (length, width,
  hole diameter, hole spacing). Error is bounded by: calibration confidence × pixel
  quantization × edge-detection noise. In practice, on a sharp, well-lit, close-to-
  perpendicular shot with a good reference object, this prototype's own bench testing
  during development landed within roughly **±0.3–0.8 mm** on parts in the 10–60 mm
  range — good enough for a go/no-go sanity check, not good enough to replace calipers
  for a tolerance-critical part.
- **AI/heuristic-estimated** — inferred indirectly or flagged as a guess (component
  identity, defect calls, anything the geometry alone can't fully justify).
- **Matched-to-standard** — looked up against the static fastener table, with a
  confidence that decays as the measured value drifts from the nearest standard size.

When a dimension genuinely can't be recovered from the capture (see below), the app
reports **"not measurable from this capture"** rather than inventing a plausible-looking
number.

## What a single smartphone photo can and cannot measure reliably

**Reliable** (in the image plane, once calibrated):
- Overall length and width of a part lying flat, shot close to top-down
- Hole diameter and hole-to-hole spacing
- Gross silhouette defects: chips, missing chunks, obvious asymmetry/bending

**Not reliable, and why** — these are stated explicitly to the user rather than faked:
- **Thickness/height** — this dimension runs parallel to the camera's optical axis in a
  top-down shot, so it's foreshortened to near-zero pixels. A side-on second view is
  needed, and even then perspective makes it far less precise than length/width.
- **Hole depth, counterbore depth** — no depth information in a single 2D image.
- **True diameter of a tilted object** — perspective foreshortens a circle into an
  ellipse; if the reference and the component aren't both close to perpendicular to the
  camera, the "measured" diameter is biased low. The app doesn't correct for this in
  the 2-day scope — it's flagged as a limitation, not silently corrected.
- **Thread pitch** — needs macro-quality resolution of individual thread crests;
  explicitly listed as a stretch goal in the brief and not attempted here.
- **Sub-millimeter surface defects** (hairline cracks, corrosion, paint damage) — needs
  controlled macro lighting and, realistically, a trained defect model. This prototype
  only checks silhouette/edge geometry.
- **Angles not parallel to the image plane** — same foreshortening problem as thickness.

## How accuracy could be improved (not implemented, noted for follow-up)

- **Multi-view fusion**: the UI already supports capturing multiple views (`+ Add
  another view`); the natural next step is averaging the length/width estimate across
  views and reporting the spread as an error bar, rather than trusting a single frame.
- **Per-device lens-distortion calibration**: a one-time checkerboard calibration per
  phone model would let the app undistort before measuring, tightening the error bound
  near the edges of the frame.
- **Controlled capture guidance**: real-time blur/glare/tilt warnings *before* capture
  (listed as a stretch goal) would filter out the worst-conditioned shots automatically.

## Known limitations of this 2-day prototype

- Identification and defect detection are rule-based, not trained models — they will
  misclassify unusual shapes and won't catch subtle surface defects.
- Only ISO metric hex fasteners are in the reference table (no UNC/UNF/socket-head
  variants yet).
- Hough circle detection for holes needs reasonable edge contrast; low-contrast holes
  (same-color background) may be missed.
- Live mode re-analyzes on a throttled interval (~0.7s), not true 60fps, because
  OpenCV.js contour work on a full-resolution frame is not free.


## Accuracy fixes in this build

This build keeps the existing UI/design and changes the measurement engine rather than the presentation:

- Component isolation no longer simply selects the largest contour. It rejects frame-touching/background contours and scores solidity, rectangularity, size and position, while respecting the calibration-reference exclusion region.
- Edge extraction uses two adaptive Canny passes plus morphological closing, making broken metal/background edges less likely to fragment.
- Overall length/width are fitted to a convex-hull envelope, reducing inflation from small Canny notches, shadows and thread-edge chatter.
- Automatic card/A4 calibration now uses both known dimensions instead of only the short edge, reducing one-axis foreshortening bias.
- Manual calibration now maps taps through `object-fit: contain` correctly, including uploaded images with a different aspect ratio. The previous implementation could use stale camera/work-canvas dimensions.
- Hole detection is more permissive at the Hough stage and then deduplicates/filters candidates geometrically, improving detection of real holes without treating the component's outer circle as a hole.
- Fastener matching is corrected: a top-down hex fastener's overall width is normally its **head across-flats (AF)**, not its shaft diameter. The old code matched that width against nominal shaft diameter, which could produce a substantially wrong M-size.
- Identification rules are ordered so common fastener/washer/gear silhouettes are not prematurely swallowed by generic plate/bracket rules.

### Important accuracy expectation

This is still a browser-based classical-CV prototype. It cannot guarantee metrology-grade accuracy from an arbitrary phone photograph. For the best results: place the part and reference on the same flat plane, keep both fully visible, shoot as close to perpendicular as practical, avoid glare and shadows, fill a useful portion of the frame, and prefer **manual 2-point calibration** when automatic calibration is uncertain. For tolerance-critical dimensions, verify with a caliper.
