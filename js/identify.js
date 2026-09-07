// Shape-based component identification.
// This is intentionally a heuristic classifier, not a trained ML model.
// Accuracy is improved by considering envelope geometry, solidity,
// rectangularity, circularity and hole count together, with fastener logic
// evaluated before generic plate/bracket rules.

const Identify = (() => {
  function classify(canvas,feature,holeCount){
    const rr=feature.rotatedRect;
    const w=rr.size.width,h=rr.size.height;
    const long=Math.max(w,h),short=Math.max(1,Math.min(w,h));
    const aspect=long/short;
    const circ=CvUtil.circularity(feature.area,feature.perimeter);

    const approx=new cv.Mat();
    cv.approxPolyDP(feature.contour,approx,Math.max(1.0,0.012*feature.perimeter),true);
    const vertices=approx.rows;
    approx.delete();

    let label="Unclassified mechanical component",confidence=0.30,notes=[];

    // Washers/rings: a round outer envelope plus one internal circular hole.
    if(holeCount===1 && circ>0.72 && aspect<1.45){
      label="Washer";confidence=0.86;
      notes.push("round annular silhouette with one internal opening");
    }
    // Gears: many boundary vertices + round-ish envelope. Hole count is not
    // required because some gears are solid or the bore is not detected.
    else if(circ>0.68 && vertices>=12 && aspect<1.55){
      label="Gear";confidence=0.78;
      notes.push(`${vertices} outer contour vertices suggest radial teeth`);
    }
    // Hex/round fastener head. A compact 5–10 sided contour with no hole is
    // a stronger fastener signal than the old generic "looksLikeFastener"
    // fallback and is evaluated before plate/bracket classification.
    else if(holeCount===0 && aspect<2.8 &&
      ((vertices>=5&&vertices<=10&&circ<0.88) || circ>0.86)){
      label="Fastener (bolt / screw)";confidence=0.82;
      notes.push("head silhouette is consistent with a bolt/screw; shaft and thread type require another view");
    }
    // Long, narrow objects.
    else if(aspect>4.0 && feature.rectangularity>0.35){
      label="Shaft / rod";confidence=0.86;
      notes.push("long, narrow envelope");
    }
    // Plates/brackets/flanges: holes + non-round body, or a strong rectangular
    // body. Avoid calling a single round hole a washer unless the outer body
    // is actually circular.
    else if(holeCount>=1 && aspect<4.0){
      label=holeCount>=2?"Plate / bracket (multi-hole)":"Plate / bracket";
      confidence=holeCount>=2?0.84:0.68;
      notes.push(`${holeCount} internal opening${holeCount===1?"":"s"} detected`);
    }
    else if(aspect<3.5 && feature.rectangularity>0.55 && feature.solidity>0.82){
      label="Plate / bracket";confidence=0.65;
      notes.push("compact rigid plate-like silhouette");
    }
    else{
      notes.push("shape does not uniquely identify the component; use the measured geometry and a second view");
    }

    return {label,confidence,notes,source:"shape-heuristic (classical CV)"};
  }
  return {classify};
})();
