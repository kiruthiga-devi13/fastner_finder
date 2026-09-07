// ISO metric coarse-thread reference table.
// The important correction here is that a top-down hex fastener normally gives
// you HEAD ACROSS-FLATS (AF), not shaft diameter. The old implementation fed
// overall width into the nominal shaft-diameter column, which could turn an
// M10 head (~17 mm AF) into an M16/M20-sized shaft match. This version matches
// top-view width against AF and reports the result as an estimated standard.

const FastenerDB = (() => {
  const ISO_METRIC_HEX=[
    {size:"M3",diameter:3,pitch:0.50,wrenchAF:5.5},
    {size:"M4",diameter:4,pitch:0.70,wrenchAF:7.0},
    {size:"M5",diameter:5,pitch:0.80,wrenchAF:8.0},
    {size:"M6",diameter:6,pitch:1.00,wrenchAF:10.0},
    {size:"M8",diameter:8,pitch:1.25,wrenchAF:13.0},
    {size:"M10",diameter:10,pitch:1.50,wrenchAF:17.0},
    {size:"M12",diameter:12,pitch:1.75,wrenchAF:19.0},
    {size:"M14",diameter:14,pitch:2.00,wrenchAF:22.0},
    {size:"M16",diameter:16,pitch:2.00,wrenchAF:24.0},
    {size:"M20",diameter:20,pitch:2.50,wrenchAF:30.0},
    {size:"M24",diameter:24,pitch:3.00,wrenchAF:36.0}
  ];

  function nearest(measured,field){
    let best=null,bestDelta=Infinity;
    for(const row of ISO_METRIC_HEX){
      const d=Math.abs(row[field]-measured);
      if(d<bestDelta){best=row;bestDelta=d;}
    }
    return {best,bestDelta};
  }

  function match(measuredMm,byField="diameter",lengthMm=null){
    if(!Number.isFinite(measuredMm)||measuredMm<=0)return null;
    const field=byField==="headAF"?"wrenchAF":byField;
    const {best,bestDelta}=nearest(measuredMm,field);
    if(!best)return null;
    const ref=best[field],relError=bestDelta/ref;
    const confidence=Math.max(0.05,Math.min(0.97,1-relError*3.5));
    return {
      standard:"ISO metric coarse-thread hex reference table",
      matchedField:field==="wrenchAF"?"head across flats":"nominal shaft diameter",
      size:best.size,nominalDiameterMm:best.diameter,pitchMm:best.pitch,
      wrenchAFmm:best.wrenchAF,measuredMm,deltaMm:bestDelta,confidence,lengthMm,
      note:relError>0.08?
        "Measured head size is more than 8% from the nearest standard. Verify the shaft diameter/thread with calipers or a side/macro view."
        :null
    };
  }

  return {ISO_METRIC_HEX,match};
})();
