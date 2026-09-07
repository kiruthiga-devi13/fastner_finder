// Measurement pipeline.
// Dimensions are derived from the isolated component contour in native image
// pixels and converted using the selected reference scale. The algorithm
// deliberately avoids "guessing" thickness/depth from a 2-D frame.

const Measurement = (() => {
  function analyze(canvas,mmPerPx,excludeRegion){
    const {mat,feature,diagnostic}=CvUtil.isolateComponent(canvas,excludeRegion);
    if(!feature){mat.delete();return {ok:false,reason:CvUtil.describeIsolationFailure(diagnostic)};}

    // Use a convex hull for the outer envelope. This suppresses small Canny
    // notches and thread/shadow chatter that otherwise inflate minAreaRect.
    const hull=new cv.Mat();
    cv.convexHull(feature.contour,hull,false,true);
    const rr=cv.minAreaRect(hull);
    const lengthPx=Math.max(rr.size.width,rr.size.height);
    const widthPx=Math.min(rr.size.width,rr.size.height);

    const results=[
      mk("Overall length",lengthPx*mmPerPx,"measured",
        "convex-hull envelope; best for the part's overall in-plane extent"),
      mk("Overall width",widthPx*mmPerPx,"measured",
        "convex-hull envelope; best for the part's overall in-plane extent")
    ];

    const circles=findReliableHoles(mat,feature,lengthPx,widthPx);
    circles.forEach((h,i)=>{
      results.push(mk(`Hole ${i+1} diameter`,h.r*2*mmPerPx,"measured",
        "circle fit from the native-resolution image; use a sharp, top-down view"));
    });
    if(circles.length>=2){
      // Use the two largest distinct holes, which is much more stable than
      // relying on Hough's arbitrary detection order.
      const [a,b]=[...circles].sort((x,y)=>y.r-x.r).slice(0,2);
      results.push(mk("Hole-to-hole distance",Math.hypot(a.x-b.x,a.y-b.y)*mmPerPx,
        "measured","centre-to-centre distance between the two largest holes"));
    }

    results.push(mk("Thickness / height",null,"estimated",
      "not measurable from a single top-down photo — use a side-on view"));

    const circ=CvUtil.circularity(feature.area,feature.perimeter);
    const hullArea=Math.max(1,cv.contourArea(hull));
    const solidity=Math.min(1,feature.area/hullArea);
    hull.delete();mat.delete();

    return {ok:true,measurements:results,holeCount:circles.length,
      circularity:circ,solidity,largestFeature:feature,
      overlay:{rotatedRect:rr,holes:circles,boundingRect:feature.boundingRect}};
  }

  function findReliableHoles(mat,feature,lengthPx,widthPx){
    const br=feature.boundingRect;
    const minR=Math.max(4,Math.min(widthPx,lengthPx)*0.015);
    const maxR=Math.max(minR+2,Math.min(br.width,br.height)*0.38);
    let circles=CvUtil.houghCircles(mat,minR,maxR,27);

    // Keep circles whose centres are inside the component and whose size is
    // plausible for a hole. Then deduplicate overlapping Hough detections.
    circles=circles.filter(c=>{
      const inside=c.x>br.x+c.r*0.25&&c.x<br.x+br.width-c.r*0.25&&
        c.y>br.y+c.r*0.25&&c.y<br.y+br.height-c.r*0.25;
      return inside&&c.r>=minR&&c.r<=maxR;
    }).sort((a,b)=>b.r-a.r);

    const kept=[];
    for(const c of circles){
      const duplicate=kept.some(k=>{
        const d=Math.hypot(k.x-c.x,k.y-c.y);
        return d<Math.max(6,0.45*Math.min(k.r,c.r)) &&
          Math.abs(k.r-c.r)/Math.max(k.r,c.r)<0.30;
      });
      if(!duplicate)kept.push(c);
    }
    return kept.slice(0,12);
  }

  function mk(name,valueMm,source,note){return {name,valueMm,source,note};}

  function drawOverlay(overlayCanvas,sourceCanvas,calib,result){
    const ctx=overlayCanvas.getContext("2d");
    ctx.clearRect(0,0,overlayCanvas.width,overlayCanvas.height);
    if(!result||!result.ok)return;

    const mapping=getContainMapping(overlayCanvas,sourceCanvas);
    const rr=result.overlay.rotatedRect;
    const pts=cv.RotatedRect.points(rr).map(p=>mapPoint(p.x,p.y,mapping));
    ctx.strokeStyle="#22b8cf";ctx.lineWidth=2;ctx.beginPath();
    ctx.moveTo(pts[0].x,pts[0].y);
    for(let i=1;i<4;i++)ctx.lineTo(pts[i].x,pts[i].y);
    ctx.closePath();ctx.stroke();

    ctx.font="12px 'IBM Plex Mono', monospace";ctx.fillStyle="#22b8cf";
    const lengthMm=result.measurements.find(m=>m.name==="Overall length")?.valueMm;
    if(lengthMm!=null)ctx.fillText(`${lengthMm.toFixed(2)} mm`,pts[0].x+4,Math.max(14,pts[0].y-6));

    ctx.strokeStyle="#3b6cf4";
    result.overlay.holes.forEach((h)=>{
      const p=mapPoint(h.x,h.y,mapping);
      const radius=h.r*mapping.scale;
      ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.stroke();
      ctx.fillStyle="#3b6cf4";
      ctx.fillText(`⌀${(h.r*2*calib.mmPerPx).toFixed(2)}`,p.x+radius,p.y);
    });
  }

  function getContainMapping(overlay,source){
    const scale=Math.min(overlay.width/source.width,overlay.height/source.height);
    return {scale,ox:(overlay.width-source.width*scale)/2,oy:(overlay.height-source.height*scale)/2};
  }
  function mapPoint(x,y,m){return {x:x*m.scale+m.ox,y:y*m.scale+m.oy};}

  return {analyze,drawOverlay};
})();
