// Calibration with geometry-aware reference selection.
// Rectangular references are scored by aspect ratio + rectangularity +
// solidity. Circular references are scored by Hough support and isolation.
// Manual calibration remains the highest-confidence fallback.

const Calibration = (() => {
  const KNOWN_RATIOS={card:85.60/53.98,a4:297/210};

  function autoDetect(canvas,referenceType,referenceMm){
    const mat=CvUtil.canvasToMat(canvas);
    try{
      if(["coin1","coin5","coin10"].includes(referenceType))
        return detectCircleReference(mat,referenceMm);
      return detectRectReference(mat,referenceType,referenceMm);
    }finally{mat.delete();}
  }

  function detectRectReference(mat,referenceType,referenceMm){
    const edges=CvUtil.edgeMap(mat);
    const features=CvUtil.findContourFeatures(edges,Math.max(500,mat.rows*mat.cols*0.003));
    edges.delete();
    const expected=KNOWN_RATIOS[referenceType]||KNOWN_RATIOS.card;
    let best=null,bestScore=0,bestRatio=null,quadCandidates=0;

    for(const f of features){
      if(f.approxPoly.rows<4||f.approxPoly.rows>6){f.contour.delete();f.approxPoly.delete();continue;}
      quadCandidates++;
      const w=f.rotatedRect.size.width,h=f.rotatedRect.size.height;
      if(w<=0||h<=0){f.contour.delete();f.approxPoly.delete();continue;}
      const ratio=Math.max(w,h)/Math.min(w,h);
      const ratioScore=CvUtil.aspectScore(ratio,expected);
      const shapeScore=0.58*f.rectangularity+0.42*f.solidity;
      // A real card/sheet should occupy a useful but not frame-filling area.
      const frac=f.area/(mat.rows*mat.cols);
      const sizeScore=frac<0.002?0:frac>0.55?0.15:Math.min(1,Math.sqrt(frac/0.015));
      const score=0.58*ratioScore+0.30*shapeScore+0.12*sizeScore;
      if(score>bestScore){
        bestScore=score;bestRatio=ratio;
        best={shortPx:Math.min(w,h),longPx:Math.max(w,h),boundingRect:f.boundingRect};
      }
      f.contour.delete();f.approxPoly.delete();
    }

    if(!best||bestScore<0.52){
      let reason;
      if(!features.length) reason="No stable rectangular reference contour was found.";
      else if(!quadCandidates) reason=`Found ${features.length} contour(s), but none had a clean rectangular outline.`;
      else reason=`The best rectangular candidate matched the expected ${expected.toFixed(2)}:1 ratio only weakly (${bestRatio?.toFixed(2)||"—"}:1).`;
      return {ok:false,confidence:bestScore||0,reason:
        reason+" Use a flat, fully visible reference with its edges separated from the background, or use manual calibration."};
    }

    const shortMm=referenceType==="card"?53.98:210.0;
    const longMm=referenceType==="card"?85.60:297.0;
    // Use both known dimensions. If the phone is not perfectly top-down,
    // averaging the two scale estimates reduces one-axis foreshortening bias
    // compared with trusting only the short edge.
    const scaleShort=shortMm/best.shortPx;
    const scaleLong=longMm/best.longPx;
    const consistency=Math.min(scaleShort,scaleLong)/Math.max(scaleShort,scaleLong);
    const mmPerPx=(scaleShort+scaleLong)/2;
    const confidence=Math.min(0.98,bestScore*(0.82+0.18*consistency));
    return {ok:true,mmPerPx,referencePx:(best.shortPx+best.longPx)/2,
      confidence,excludeRegion:best.boundingRect};
  }

  function detectCircleReference(mat,diameterMm){
    const minDim=Math.min(mat.rows,mat.cols);
    const circles=CvUtil.houghCircles(mat,Math.max(6,Math.round(minDim*0.012)),
      Math.max(12,Math.round(minDim*0.22)),32);
    if(!circles.length)
      return {ok:false,confidence:0,reason:"No circular reference object detected."};

    const edges=CvUtil.edgeMap(mat);
    const scored=circles.map(c=>{
      const circumference=Math.max(24,Math.round(2*Math.PI*c.r));
      let hits=0;
      for(let i=0;i<circumference;i++){
        const a=2*Math.PI*i/circumference;
        const x=Math.round(c.x+Math.cos(a)*c.r),y=Math.round(c.y+Math.sin(a)*c.r);
        if(x>=0&&y>=0&&x<edges.cols&&y<edges.rows&&edges.ucharPtr(y,x)[0]>0)hits++;
      }
      const support=hits/circumference;
      return {...c,support};
    });
    edges.delete();

    // Prefer a circle with strong edge support and enough radius to be a
    // reference object, not a tiny specular highlight. Reject candidates near
    // the frame because partially visible circles calibrate badly.
    const margin=Math.max(8,Math.round(minDim*0.02));
    const valid=scored.filter(c=>c.x-c.r>margin&&c.y-c.r>margin&&
      c.x+c.r<mat.cols-margin&&c.y+c.r<mat.rows-margin&&c.r>minDim*0.015);
    const pool=valid.length?valid:scored;
    pool.sort((a,b)=>b.support-a.support);
    const best=pool[0];
    if(!best||best.support<0.18)
      return {ok:false,confidence:best?.support||0,
        reason:"Circular edges were too weak or broken to trust for automatic calibration. Use manual calibration."};

    const mmPerPx=diameterMm/(2*best.r);
    const confidence=Math.min(0.96,0.45+0.5*best.support);
    return {ok:true,mmPerPx,referencePx:2*best.r,confidence,
      excludeRegion:{x:best.x-best.r,y:best.y-best.r,width:2*best.r,height:2*best.r}};
  }

  function beginManualPick(onComplete,targetCanvas=CameraModule.workCanvas){
    const overlay=CameraModule.overlay,points=[];
    function draw(){
      const ctx=overlay.getContext("2d");
      ctx.clearRect(0,0,overlay.width,overlay.height);
      ctx.fillStyle="#3b6cf4";
      points.forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,5,0,Math.PI*2);ctx.fill();});
      if(points.length===2){
        ctx.strokeStyle="#3b6cf4";ctx.lineWidth=2;ctx.beginPath();
        ctx.moveTo(points[0].x,points[0].y);ctx.lineTo(points[1].x,points[1].y);ctx.stroke();
      }
    }
    function onClick(e){
      const p=CameraModule.displayPointToImage(
        e.clientX??e.touches?.[0]?.clientX,
        e.clientY??e.touches?.[0]?.clientY,targetCanvas);
      if(!p)return;
      points.push({x:p.displayX,y:p.displayY});
      draw();
      if(points.length===2){
        overlay.removeEventListener("click",onClick);
        const dx=points[1].imageX-points[0].imageX;
        const dy=points[1].imageY-points[0].imageY;
        onComplete(Math.hypot(dx,dy));
      }
    }
    overlay.addEventListener("click",onClick);
    draw();
  }

  return {autoDetect,beginManualPick};
})();
