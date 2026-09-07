// Generates the exportable inspection report as a PDF using jsPDF.
// Every value on the report is tagged with its provenance (measured /
// estimated / matched-to-standard) so nobody downstream mistakes a
// heuristic guess for a calibrated measurement.

const Report = (() => {

  const SRC_LABEL = { measured: "MEASURED", estimated: "AI-ESTIMATED", matched: "STANDARD-MATCH" };

  function generate(){
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const marginX = 16;
    let y = 18;

    doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    doc.text("Nebula Fastener Finder — Inspection Report", marginX, y);
    y += 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.setTextColor(90);
    doc.text(`Generated ${new Date().toLocaleString()}`, marginX, y);
    doc.setTextColor(0);
    y += 10;

    // component image
    const cap = AppState.captures[AppState.activeCaptureIndex] || AppState.captures[0];
    if (cap){
      const imgW = 80, imgH = 60;
      doc.addImage(cap.dataUrl, "JPEG", marginX, y, imgW, imgH);
      // side panel next to image: identification + PASS/FAIL badge
      const panelX = marginX + imgW + 8;
      doc.setFont("helvetica", "bold"); doc.setFontSize(12);
      doc.text(AppState.identification.label || "Unidentified component", panelX, y+6);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      doc.setTextColor(110);
      doc.text(`Identification confidence: ${pct(AppState.identification.confidence)}`, panelX, y+12);
      doc.text(`Source: ${AppState.identification.source}`, panelX, y+17);
      doc.setTextColor(0);

      const res = AppState.inspection.result || "INCONCLUSIVE";
      doc.setFont("helvetica", "bold"); doc.setFontSize(20);
      doc.setTextColor(res === "PASS" ? 40 : res === "FAIL" ? 200 : 170,
                        res === "PASS" ? 160 : res === "FAIL" ? 40 : 120, 40);
      doc.text(res, panelX, y+32);
      doc.setTextColor(0);
      y += imgH + 8;
    }

    y = section(doc, y, "Calibration");
    const c = AppState.calibration;
    y = kv(doc, y, "Method", c.method === "auto" ? "Automatic reference detection" : "Manual 2-point");
    y = kv(doc, y, "Reference object", c.referenceType || "—");
    y = kv(doc, y, "Scale resolved", c.mmPerPx ? `${c.mmPerPx.toFixed(5)} mm/px` : "—");
    y = kv(doc, y, "Calibration confidence", pct(c.confidence));
    y += 4;

    y = section(doc, y, "Measured dimensions");
    doc.setFontSize(9);
    AppState.measurements.forEach(m => {
      if (y > 270) { doc.addPage(); y = 18; }
      const valStr = m.valueMm != null ? `${m.valueMm.toFixed(2)} mm` : "not measurable from this capture";
      doc.setFont("helvetica", "bold");
      doc.text(`${m.name}:`, marginX, y);
      doc.setFont("helvetica", "normal");
      doc.text(valStr, marginX + 55, y);
      doc.setTextColor(140);
      doc.text(`[${SRC_LABEL[m.source] || m.source.toUpperCase()}]`, marginX + 100, y);
      doc.setTextColor(0);
      y += 5;
      if (m.note){
        doc.setFontSize(7.5); doc.setTextColor(130);
        doc.text(wrap(doc, m.note, 170), marginX + 4, y);
        y += 4;
        doc.setFontSize(9); doc.setTextColor(0);
      }
    });
    y += 3;

    if (AppState.fastener){
      y = section(doc, y, "Fastener match (vs. ISO metric reference table)");
      const f = AppState.fastener;
      y = kv(doc, y, "Standard", f.standard);
      y = kv(doc, y, "Estimated size", f.size);
      y = kv(doc, y, "Nominal diameter", `${f.nominalDiameterMm} mm`);
      y = kv(doc, y, "Thread pitch (coarse, table value)", `${f.pitchMm} mm`);
      y = kv(doc, y, "Matched from", `${f.matchedField} = ${f.measuredMm.toFixed(2)} mm (measured)`);
      y = kv(doc, y, "Match confidence", pct(f.confidence));
      if (f.note){ doc.setFontSize(8); doc.setTextColor(180,90,20); doc.text(wrap(doc,f.note,170), marginX, y); doc.setTextColor(0); y+=6; }
      y += 2;
    }

    y = section(doc, y, "Inspection findings");
    doc.setFontSize(9);
    AppState.inspection.findings.forEach(f => {
      if (y > 275) { doc.addPage(); y = 18; }
      doc.setTextColor(f.severity === "fail" ? 200 : f.severity === "warn" ? 170 : 90,
                        f.severity === "fail" ? 40 : f.severity === "warn" ? 120 : 90, 40);
      doc.text("•", marginX, y);
      doc.setTextColor(30);
      doc.text(wrap(doc, f.text, 172), marginX + 4, y);
      y += Math.ceil(f.text.length/95)*4.2 + 2;
    });

    y += 2;
    y = section(doc, y, "What this prototype does and doesn't measure reliably");
    doc.setFontSize(8); doc.setTextColor(70);
    const scope = [
      "Reliable from a single top-down photo: in-plane length, width, hole diameter, hole spacing (once calibrated against a reference object of known size).",
      "Not reliable / not attempted: true thickness or height (foreshortened perpendicular to camera axis), hole depth, out-of-plane angles, sub-millimeter surface defects (cracks, corrosion), thread pitch measurement.",
      "Accuracy depends directly on calibration confidence, focus/blur, lighting contrast against background, and how close to perpendicular the reference object and component both are to the camera.",
    ];
    scope.forEach(line => {
      if (y > 280) { doc.addPage(); y = 18; }
      doc.text(wrap(doc, "– " + line, 178), marginX, y);
      y += Math.ceil(line.length/100)*4 + 3;
    });

    doc.save(`nebula-inspection-report-${Date.now()}.pdf`);
  }

  function section(doc, y, title){
    if (y > 265) { doc.addPage(); y = 18; }
    y += 2;
    doc.setDrawColor(200); doc.setLineWidth(0.3);
    doc.line(16, y, 194, y);
    y += 5;
    doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text(title, 16, y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    return y + 6;
  }
  function kv(doc, y, k, v){
    doc.setFont("helvetica", "bold"); doc.text(`${k}:`, 16, y);
    doc.setFont("helvetica", "normal"); doc.text(String(v), 75, y);
    return y + 5.5;
  }
  function pct(x){ return x == null ? "—" : `${Math.round(x*100)}%`; }
  function wrap(doc, text, maxWidth){
    return doc.splitTextToSize(text, maxWidth);
  }

  return { generate };
})();
