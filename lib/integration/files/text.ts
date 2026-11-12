/**
 * Turns an uploaded syllabus into plain text, entirely in the browser.
 * The PDF library is loaded only when a PDF is actually opened, so the panel
 * does not pay for it on every start.
 */
export async function fileText(file: File): Promise<string> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return pdfText(await file.arrayBuffer());
  return file.text();
}

async function pdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    let line = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      line += item.str;
      if (item.hasEOL) { lines.push(line); line = ''; }
    }
    if (line) lines.push(line);
  }
  return lines.join('\n');
}
