// Lectura local de PDF digitales (listados de material, facturas). El archivo no sale del navegador:
// PDF.js (carpeta vendor/) extrae el texto y aquí se reconstruyen las filas y columnas de la tabla.

let lib = null;
async function pdfjs() {
  if (!lib) {
    lib = await import("../vendor/pdf.min.mjs");
    lib.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdf.worker.min.mjs", import.meta.url).href;
  }
  return lib;
}

// Devuelve { rows: [[celda, …], …], pages } con todas las líneas del PDF separadas en columnas.
export async function pdfTable(file) {
  const { getDocument } = await pdfjs();
  const doc = await getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const its = tc.items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: i.height || Math.abs(i.transform[3]) || 10 }));
    its.sort((a, b) => b.y - a.y || a.x - b.x);
    let cur = null;
    for (const it of its) {
      if (!cur || Math.abs(cur.y - it.y) > Math.max(2.5, it.h * 0.45)) { cur = { y: it.y, items: [] }; lines.push(cur); }
      cur.items.push(it);
    }
  }
  // 1) dentro de cada línea, unir fragmentos contiguos en celdas
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.cells = [];
    for (const it of l.items) {
      const last = l.cells[l.cells.length - 1];
      const gap = last ? it.x - last.x1 : Infinity;
      if (last && gap < it.h * 0.9) { last.s += (gap > it.h * 0.12 && !/\s$/.test(last.s) && !/^\s/.test(it.s) ? " " : "") + it.s; last.x1 = it.x + it.w; }
      else l.cells.push({ s: it.s, x0: it.x, x1: it.x + it.w });
    }
    l.cells.forEach(c => c.s = c.s.replace(/\s+/g, " ").trim());
  }
  // 2) columnas: posiciones de inicio que se repiten en muchas líneas
  const multi = lines.filter(l => l.cells.length > 1);
  const xs = multi.flatMap(l => l.cells.map(c => c.x0)).sort((a, b) => a - b);
  const clusters = [];
  for (const v of xs) { const c = clusters[clusters.length - 1]; if (c && v - c.max <= 9) { c.max = v; c.n++; c.sum += v; } else clusters.push({ min: v, max: v, n: 1, sum: v }); }
  const need = Math.max(2, Math.round(multi.length * 0.12));
  const cols = clusters.filter(c => c.n >= need).map(c => c.min);
  if (cols.length < 2) return { rows: lines.map(l => [l.cells.map(c => c.s).join(" ")]).filter(r => r[0]), pages: doc.numPages, cols: 1 };
  const rows = lines.map(l => {
    const r = Array(cols.length).fill("");
    for (const c of l.cells) {
      let k = 0; for (let j = 0; j < cols.length; j++) if (c.x0 >= cols[j] - 9) k = j;
      r[k] = r[k] ? r[k] + " " + c.s : c.s;
    }
    return r;
  }).filter(r => r.some(Boolean));
  return { rows, pages: doc.numPages, cols: cols.length };
}
