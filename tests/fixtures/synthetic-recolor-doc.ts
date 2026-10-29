/**
 * Generates a minimal, valid 2-page PDF document in raw bytes without external tools.
 * - Page 1: Black text, 4 colored vector rectangles (Red, Green, Blue, Yellow), and embedded 2x2 RGB image.
 * - Page 2: Single 2x2 RGB image scaled to full page (612x792), simulating a scanned document page.
 */
export function createSyntheticRecolorPdf(): Uint8Array {
  // Image 1: 2x2 RGB (Red, Green, Blue, Yellow)
  const img1Data = "\xFF\x00\x00\x00\xFF\x00\x00\x00\xFF\xFF\xFF\x00";

  // Image 2 (scanned page simulation): 2x2 grayscale/sepia texture
  const img2Data = "\xEE\xEE\xEE\xCC\xCC\xCC\xAA\xAA\xAA\x88\x88\x88";

  const p1Stream = `
BT
/F1 16 Tf
50 720 Td
(Clio PDF Recoloring Test) Tj
ET
1 0 0 rg 50 620 80 40 re f
0 1 0 rg 150 620 80 40 re f
0 0 1 rg 250 620 80 40 re f
1 1 0 rg 350 620 80 40 re f
q
100 0 0 100 50 480 cm
/Im1 Do
Q
`.trim();

  const p2Stream = `
q
612 0 0 792 0 0 cm
/ImScan Do
Q
`.trim();

  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>";
  objects[3] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 7 0 R >> /XObject << /Im1 8 0 R >> >> >>";
  objects[4] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /XObject << /ImScan 9 0 R >> >> >>";
  objects[5] = `<< /Length ${p1Stream.length} >>\nstream\n${p1Stream}\nendstream`;
  objects[6] = `<< /Length ${p2Stream.length} >>\nstream\n${p2Stream}\nendstream`;
  objects[7] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[8] = `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${img1Data.length} >>\nstream\n${img1Data}\nendstream`;
  objects[9] = `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${img2Data.length} >>\nstream\n${img2Data}\nendstream`;

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const xref: number[] = [0];

  for (let i = 1; i <= 9; i += 1) {
    xref[i] = pdf.length;
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const startxref = pdf.length;
  pdf += "xref\n0 10\n0000000000 65535 f \n";
  for (let i = 1; i <= 9; i += 1) {
    pdf += `${xref[i].toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size 10 /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;

  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i += 1) {
    bytes[i] = pdf.charCodeAt(i) & 0xff;
  }
  return bytes;
}
