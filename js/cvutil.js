// Computer-vision utilities tuned for inspection accuracy.
// Classical CV only: adaptive edges, contour scoring, robust geometry.
// All Mats returned to callers are explicitly owned by the caller.

const CvUtil = (() => {
  function waitForOpenCv(timeoutMs = 20000){
    return new Promise((resolve,reject)=>{
      const start=Date.now();
      (function check(){
        if(window.cv && cv.Mat) return resolve();
        if(Date.now()-start>timeoutMs) return reject(new Error("OpenCV.js failed to load"));
        setTimeout(check,100);
      })();
    });
  }

  function canvasToMat(canvas){ return cv.imread(canvas); }

  // More stable than a single fixed Canny setting. We keep thresholds away
  // from 0/255 so dark or very bright workshop photos still produce usable
  // edges. Morphological CLOSE connects small shadow/glare breaks without
  // growing the object as aggressively as a dilation.
  function edgeMap(mat, sigma=0.33){
    const gray=new cv.Mat(), blur=new cv.Mat();
    cv.cvtColor(mat,gray,cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray,blur,new cv.Size(5,5),0);

    const median=medianIntensity(blur);
    const lo=Math.max(20,(1-sigma)*median);
    const hi=Math.max(lo+20,Math.min(245,(1+sigma)*median));

    const edges=new cv.Mat();
    cv.Canny(blur,edges,lo,hi);
    const kernel=cv.Mat.ones(3,3,cv.CV_8U);
    const closed=new cv.Mat();
    cv.morphologyEx(edges,closed,cv.MORPH_CLOSE,kernel);

    gray.delete(); blur.delete(); edges.delete(); kernel.delete();
    return closed;
  }

  function medianIntensity(grayMat){
    const hist=new cv.Mat(), vec=new cv.MatVector(), mask=new cv.Mat();
    vec.push_back(grayMat);
    cv.calcHist(vec,[0],mask,hist,[256],[0,256]);
    const total=grayMat.rows*grayMat.cols;
    let run=0, med=128;
    for(let i=0;i<256;i++){
      run+=hist.data32F[i];
      if(run>=total/2){med=i;break;}
    }
    hist.delete();vec.delete();mask.delete();
    return med;
  }

  function findContourFeatures(edges,minArea=400){
    const contours=new cv.MatVector(), hierarchy=new cv.Mat();
    cv.findContours(edges,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    const out=[];
    for(let i=0;i<contours.size();i++){
      const c=contours.get(i), area=cv.contourArea(c);
      if(area<minArea){c.delete();continue;}
      const perimeter=cv.arcLength(c,true);
      const approx=new cv.Mat();
      cv.approxPolyDP(c,approx,Math.max(1.2,0.015*perimeter),true);
      const rect=cv.boundingRect(c), rotated=cv.minAreaRect(c);
      const boxArea=Math.max(1,rotated.size.width*rotated.size.height);
      const hull=new cv.Mat();
      cv.convexHull(c,hull,false,true);
      const hullArea=Math.max(1,cv.contourArea(hull));
      const solidity=Math.min(1,area/hullArea);
      const rectangularity=Math.min(1,area/boxArea);
      hull.delete();
      out.push({contour:c,area,perimeter,approxPoly:approx,boundingRect:rect,
        rotatedRect:rotated,solidity,rectangularity});
    }
    hierarchy.delete();contours.delete();
    out.sort((a,b)=>b.area-a.area);
    return out;
  }

  // Hough settings are deliberately permissive, followed by geometric
  // filtering/deduplication at the call site. A high param2 misses real
  // holes on brushed metal; false circles are easier to reject geometrically.
  function houghCircles(mat,minRadius=8,maxRadius=0,param2=30){
    const gray=new cv.Mat();
    cv.cvtColor(mat,gray,cv.COLOR_RGBA2GRAY);
    cv.medianBlur(gray,gray,5);
    const circles=new cv.Mat();
    cv.HoughCircles(gray,circles,cv.HOUGH_GRADIENT,1,Math.max(12,gray.rows/12),
      110,param2,minRadius,maxRadius||Math.floor(Math.min(gray.rows,gray.cols)*0.45));
    const out=[];
    for(let i=0;i<circles.cols;i++){
      const x=circles.data32F[i*3],y=circles.data32F[i*3+1],r=circles.data32F[i*3+2];
      if(Number.isFinite(x)&&Number.isFinite(y)&&Number.isFinite(r)&&r>0) out.push({x,y,r});
    }
    gray.delete();circles.delete();
    return out;
  }

  function aspectScore(measured,expected){
    if(!Number.isFinite(measured)||!Number.isFinite(expected)||expected<=0)return 0;
    const diff=Math.abs(measured-expected)/expected;
    return Math.max(0,1-diff*2);
  }
  function circularity(area,perimeter){
    return perimeter>0?(4*Math.PI*area)/(perimeter*perimeter):0;
  }

  function rectIoU(a,b){
    if(!a||!b)return 0;
    const x1=Math.max(a.x,b.x),y1=Math.max(a.y,b.y);
    const x2=Math.min(a.x+a.width,b.x+b.width),y2=Math.min(a.y+a.height,b.y+b.height);
    const inter=Math.max(0,x2-x1)*Math.max(0,y2-y1);
    const ua=a.width*a.height+b.width*b.height-inter;
    return ua>0?inter/ua:0;
  }

  // Select the component using several independent geometric signals rather
  // than "largest contour". This avoids the classic failures where a table
  // edge, phone shadow, reference card, or image border becomes the object.
  function isolateComponent(canvas,excludeRegion,minAreaFrac=0.001){
    const mat=canvasToMat(canvas);
    const edges=buildBestEdgeMap(mat);
    const minArea=Math.max(250,mat.rows*mat.cols*minAreaFrac);
    const features=findContourFeatures(edges,minArea);
    edges.delete();

    let componentFeature=null,bestScore=-Infinity;
    const imageArea=mat.rows*mat.cols;
    const frameMargin=Math.max(4,Math.round(Math.min(mat.rows,mat.cols)*0.012));

    for(const f of features){
      const r=f.boundingRect;
      const touchesFrame=(r.x<=frameMargin||r.y<=frameMargin||
        r.x+r.width>=mat.cols-frameMargin||r.y+r.height>=mat.rows-frameMargin);
      const overlap=excludeRegion?rectIoU(r,excludeRegion):0;
      const cx=r.x+r.width/2,cy=r.y+r.height/2;
      const areaFrac=f.area/imageArea;
      if(touchesFrame || overlap>0.55) continue;

      // Favor substantial, compact contours, but don't require a particular
      // object size because a small bolt can legitimately occupy a small frame.
      const sizeScore=Math.min(1,Math.sqrt(Math.max(0,areaFrac)/0.12));
      const centerScore=0.65+0.35*(1-Math.min(1,Math.hypot(cx-mat.cols/2,cy-mat.rows/2)/
        (0.75*Math.hypot(mat.cols/2,mat.rows/2))));
      const compactScore=0.55*f.solidity+0.45*f.rectangularity;
      const score=0.48*sizeScore+0.30*compactScore+0.22*centerScore;

      if(score>bestScore){bestScore=score;componentFeature=f;}
    }

    // If all strong candidates were rejected (common with a part touching the
    // frame), use the best non-frame candidate with a softer rule.
    if(!componentFeature){
      for(const f of features){
        const r=f.boundingRect;
        const touchesFrame=(r.x<=frameMargin||r.y<=frameMargin||
          r.x+r.width>=mat.cols-frameMargin||r.y+r.height>=mat.rows-frameMargin);
        if(touchesFrame)continue;
        if(!componentFeature||f.area>componentFeature.area)componentFeature=f;
      }
    }

    const keep=componentFeature;
    for(const f of features){
      if(f===keep) f.approxPoly.delete();
      else {f.contour.delete();f.approxPoly.delete();}
    }

    const rawContours=countRawContours(mat);
    const diagnostic={
      rawContourCount:rawContours.count,
      largestRawArea:Math.round(rawContours.largest),
      minAreaRequired:Math.round(minArea),
      imagePixels:imageArea,
      afterFilterCount:features.length,
      selectedScore:Number.isFinite(bestScore)?bestScore:0
    };
    return {mat,feature:keep||null,diagnostic};
  }

  function buildBestEdgeMap(mat){
    // Two Canny passes are unioned. The low-threshold pass catches real,
    // low-contrast metal edges; the normal pass keeps the map from exploding
    // with texture. A close operation is applied inside edgeMap.
    const a=edgeMap(mat,0.25), b=edgeMap(mat,0.45), out=new cv.Mat();
    cv.bitwise_or(a,b,out);
    a.delete();b.delete();
    return out;
  }

  function countRawContours(mat){
    const edges=buildBestEdgeMap(mat);
    const cs=new cv.MatVector(),h=new cv.Mat();
    cv.findContours(edges,cs,h,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    let largest=0;
    for(let i=0;i<cs.size();i++){
      const c=cs.get(i);largest=Math.max(largest,cv.contourArea(c));c.delete();
    }
    const count=cs.size();
    cs.delete();h.delete();edges.delete();
    return {count,largest};
  }

  function describeIsolationFailure(diag){
    if(!diag)return "Could not isolate the component from the background.";
    if(diag.rawContourCount===0)
      return "No usable edges were detected. Use stronger, even lighting and a contrasting background.";
    if(diag.afterFilterCount===0)
      return `Edges were found, but no stable component contour survived filtering. Keep the part fully inside the frame and separate it from the reference object.`;
    return "The component outline is ambiguous. Move closer, keep the part flat, and use a plain contrasting background.";
  }

  return {waitForOpenCv,canvasToMat,edgeMap,findContourFeatures,houghCircles,
    aspectScore,circularity,rectIoU,isolateComponent,describeIsolationFailure};
})();
