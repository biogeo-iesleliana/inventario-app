// Inventario del Departamento — interpretación del texto leído en la etiqueta de un frasco (v1.2)
// Funciones puras (sin DOM): reciben el texto del OCR y, si lo hay, el código de barras,
// y proponen el reactivo del catálogo y los datos del envase. Nada sale del navegador.

import { norm, casValido, normFecha } from "./core.js";

/* ---------- equivalencias de partida ----------
   Códigos de catálogo identificados en la prueba con fotos del almacén (14/11/2026).
   Son códigos públicos de los fabricantes, no datos del inventario. Las que se confirman
   en la app se guardan en data/equivalencias.json (repositorio privado) y tienen prioridad. */
export const SEMILLA = {
  "Panreac|231140": "Sulfato de amonio",
  "Panreac|231212": "Carbonato de calcio",
  "Panreac|231270": "Sulfato de cobre(II) pentahidrato",
  "Panreac|231385": "Sulfato de hierro(III) y amonio dodecahidrato",
  "Panreac|231494": "Cloruro de potasio",
  "Panreac|231509": "Dihidrogenofosfato de potasio",
  "Panreac|231515": "Hidróxido de potasio",
  "Panreac|231524": "Nitrato de potasio",
  "Panreac|232817": "Oxalato de estaño(II)",
  "Scharlau|AM0276": "Dicromato de amonio",
  "Scharlau|CA0230": "Nitrato de calcio tetrahidrato",
  "Scharlau|HI0350": "Sulfato de hierro(II) heptahidrato",
  "Scharlau|MA0084": "Sulfato de magnesio heptahidrato",
  "Scharlau|PO0259": "Dihidrogenofosfato de potasio"
};

export const FABRICANTES = [
  ["Panreac", /panreac|applichem|appli\s*chem/i],
  ["Scharlau", /scharlau|scharlab/i],
  ["Merck", /\bmerck\b|millipore/i],
  ["Sigma-Aldrich", /sigma|aldrich/i],
  ["Labkem", /labkem/i],
  ["Probus", /probus/i],
  ["Fisher Scientific", /fisher/i],
  ["VWR", /\bvwr\b/i],
  ["Carlo Erba", /carlo\s*erba/i],
  ["Acros Organics", /acros/i]
];

// El OCR confunde letras y números parecidos dentro de los códigos
const digitos = s => s.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/S/g, "5").replace(/B/g, "8");

/* ---------- códigos de catálogo del fabricante ---------- */
// Panreac: 6 dígitos (la línea DIDACTIC empieza por 23), a veces con el formato detrás: 231270.1209
// Scharlau: 2 letras + 4 dígitos, a veces con el formato detrás: MA0084 o MA00840500
export function codigos(texto, fabricante) {
  const out = [], vistos = new Set();
  const add = (fab, cod, seguro) => { const k = fab + "|" + cod; if (!vistos.has(k)) { vistos.add(k); out.push({ fab, cod, seguro }); } };
  const T = String(texto || "");
  const panreac = fabricante === "Panreac", scharlau = fabricante === "Scharlau";
  for (const m of T.matchAll(/(?<![\d.,\-/])([12][\dOoIl]{5})(?:\s?[.·]\s?\d{4})?(?![\d,\-/])/g)) {
    const cod = digitos(m[1]); if (!/^\d{6}$/.test(cod)) continue;
    if (/(?:lot(?:e)?|batch|ch\.?-?b)\s*(?:n[º°o.]*)?\s*[:.#]?\s*$/i.test(T.slice(Math.max(0, m.index - 14), m.index))) continue; // es el lote, no el código
    if (cod.startsWith("23")) add("Panreac", cod, true);          // DIDACTIC: patrón muy característico
    else if (panreac && /^1[2-9]|^2[01]/.test(cod)) add("Panreac", cod, false); // PRS, PA… solo si la etiqueta es de Panreac
  }
  for (const m of T.matchAll(/\b([A-Z]{2})\s?([\dOIl]{4})(\d{4})?\b/g)) {
    const cod = m[1] + digitos(m[2]); if (!/^[A-Z]{2}\d{4}$/.test(cod)) continue;
    if (/^(GHS|CAS|LOT|EC|UN|PH)/.test(m[1]) || ["CE", "EN", "ID", "NO", "DE", "EU"].includes(m[1])) continue;
    add("Scharlau", cod, scharlau || !!m[3]);
  }
  return out;
}

export function fabricante(texto) { for (const [n, re] of FABRICANTES) if (re.test(texto)) return n; return ""; }

/* ---------- CAS, lote, caducidad y envase ---------- */
export function cas(texto) {
  const out = [];
  for (const m of String(texto || "").matchAll(/(?<!\d)(\d{2,7})\s?[-–]\s?(\d{2})\s?[-–]\s?(\d)(?!\d)/g)) {
    const c = `${m[1]}-${m[2]}-${m[3]}`; if (casValido(c) && !out.includes(c)) out.push(c);
  }
  return out;
}
export function lote(texto) {
  const m = /\b(?:lote|lot(?:e)?\s*(?:n[º°o.]*)?|batch|ch\.?\s*-?\s*b\.?)\s*[:.#]?\s*([A-Z0-9][A-Z0-9\-/]{3,15})\b/i.exec(texto || "");
  return m && /\d/.test(m[1]) ? m[1].toUpperCase() : "";
}
export function caducidad(texto) {
  const m = /\b(?:cad(?:ucidad)?|caduca|exp(?:iry|iration)?(?:\s*date)?|use\s*by|best\s*before|consumir\s*preferentemente\s*antes\s*de|fecha\s*l[ií]mite)\b\.?\s*[:.]?\s*(\d{4}[/.-]\d{1,2}(?:[/.-]\d{1,2})?|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}[/.-]\d{2,4})/i.exec(texto || "");
  return m ? fechaEtiqueta(m[1]) : "";
}
// Fechas de etiqueta: 05/2028, 05.28, 2028-05, 31/05/2028
export function fechaEtiqueta(s) {
  s = String(s || "").trim();
  let m = /^(\d{1,2})[/.-](\d{2})$/.exec(s); if (m) s = `${m[1]}/20${m[2]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/.exec(s); if (m) s = `${m[1]}/${m[2]}/20${m[3]}`;
  return normFecha(s) || "";
}
export function envase(texto) {
  const c = [];
  for (const m of String(texto || "").matchAll(/(?<![\d,.])(\d{1,4}(?:[.,]\d{1,3})?)\s?(kg|g|gr|mg|ml|mL|cl|l|L|lt|litros?)(?![a-zA-Z]|\s?\/)/g)) {
    if (/[=:]\s*$|\b(?:pm|mw|m)\s*$/i.test(String(texto).slice(Math.max(0, m.index - 4), m.index))) continue; // masa molar, no envase
    const n = +m[1].replace(",", "."), u = m[2].toLowerCase().replace(/^gr$/, "g").replace(/^(lt|litros?)$/, "l");
    if (!n) continue;
    // tamaños de envase habituales; descarta masas molares, concentraciones, etc.
    const ok = { g: [1, 5000], kg: [0.1, 25], mg: [1, 1000], ml: [1, 5000], cl: [1, 100], l: [0.1, 25] }[u];
    if (!ok || n < ok[0] || n > ok[1]) continue;
    c.push(`${String(n).replace(".", ",")} ${u === "l" ? "L" : u === "ml" ? "mL" : u}`);
  }
  return c[0] || "";
}

/* ---------- códigos de barras (GS1) ---------- */
// GS1 DataMatrix / GS1-128: (01) GTIN, (10) lote, (17) caducidad AAMMDD. Separador FNC1 = \x1d
export function gs1(raw) {
  let s = String(raw || "").replace(/^\]([dCQe])\d/, "");
  const out = {};
  if (/^\d{8}$|^\d{12,14}$/.test(s)) { out.gtin = s.padStart(14, "0"); return out; } // EAN-8/13, UPC, GTIN-14
  s = s.replace(/\((\d{2,4})\)/g, "\x1d$1").replace(/^\x1d/, "");
  const FIJO = { "00": 18, "01": 14, "02": 14, "11": 6, "13": 6, "15": 6, "17": 6 };
  let i = 0, vuelta = 0;
  while (i < s.length && vuelta++ < 20) {
    const ai = s.slice(i, i + 2); i += 2;
    let val;
    if (FIJO[ai]) { val = s.slice(i, i + FIJO[ai]); i += FIJO[ai]; }
    else { const j = s.indexOf("\x1d", i); val = s.slice(i, j < 0 ? s.length : j); i = j < 0 ? s.length : j; }
    if (s[i] === "\x1d") i++;
    if (ai === "01") out.gtin = val;
    else if (ai === "10") out.lote = val;
    else if (ai === "17" && /^\d{6}$/.test(val)) { const dd = val.slice(4, 6); out.caducidad = `20${val.slice(0, 2)}-${val.slice(2, 4)}` + (dd !== "00" ? "-" + dd : ""); }
    else if (!/^\d{2}$/.test(ai)) break;
  }
  return out;
}

/* ---------- nombre aproximado contra el catálogo ---------- */
const HIDRATOS = { 1: "monohidrato", 2: "dihidrato", 3: "trihidrato", 4: "tetrahidrato", 5: "pentahidrato", 6: "hexahidrato", 7: "heptahidrato", 8: "octahidrato", 10: "decahidrato", 12: "dodecahidrato" };
const VACIAS = new Set(["de", "del", "y", "en", "la", "el", "para", "con", "sal", "acido"].map(norm));
export function palabras(t) {
  return norm(t)
    .replace(/(\d{1,2})\s?-?\s?(?:hidrato|hydrate)/g, (_, n) => " " + (HIDRATOS[+n] || "hidrato") + " ")
    .replace(/sulphate|sulfate/g, "sulfato").replace(/\banhydrous\b/g, "anhidro")
    .replace(/\b(i{1,3}|iv)\b/g, " ")          // (II), (III): el OCR los pierde a menudo
    .split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !VACIAS.has(w));
}
const cerca = (a, b) => { // distancia de edición ≤ 1 (≤ 2 en palabras largas)
  if (a === b) return true; const tol = Math.max(a.length, b.length) >= 9 ? 2 : 1;
  if (Math.abs(a.length - b.length) > tol || Math.min(a.length, b.length) < 5) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[b.length] <= tol;
};
// Puntuación de 0 a 1: qué parte del nombre del catálogo aparece en la etiqueta (sin importar el orden: «Potasio cloruro»)
export function puntuar(nombre, enEtiqueta) {
  const p = palabras(nombre); if (!p.length) return 0;
  const hits = p.filter(w => enEtiqueta.has(w) || [...enEtiqueta].some(x => cerca(w, x))).length;
  return hits / p.length - (p.length === 1 ? 0.15 : 0); // un nombre de una sola palabra es menos fiable
}
const formulaPlana = f => String(f || "").replace(/[·\s()[\]]/g, "").replace(/\(aq\)/g, "");

/* ---------- análisis completo ---------- */
// cat: catálogo [{nombre, sinonimos, formula, cas, …}]; eq: { "Fabricante|código": "Nombre del catálogo" }
export function analizar(texto, { cat = [], eq = {}, barras = [] } = {}) {
  const T = String(texto || "");
  const fab = fabricante(T);
  const res = { fabricante: fab, codigo: "", codigos: codigos(T, fab), cas: cas(T), lote: lote(T), caducidad: caducidad(T), envase: envase(T), gtin: "", candidatos: [] };
  for (const b of barras) { const g = gs1(b); res.gtin ||= g.gtin || ""; res.lote ||= g.lote || ""; res.caducidad ||= g.caducidad || ""; }
  const porNombre = n => cat.find(r => r.nombre === n) || cat.find(r => norm(r.nombre) === norm(n));
  const cand = new Map();
  const add = (r, score, via) => { if (!r) return; const c = cand.get(r.nombre); if (!c || c.score < score) cand.set(r.nombre, { r, score, via }); };
  // 1) código de barras ya confirmado
  if (res.gtin && eq["GTIN|" + res.gtin]) add(porNombre(eq["GTIN|" + res.gtin]), 1.2, `código de barras ${res.gtin}`);
  // 2) código de catálogo del fabricante
  for (const c of res.codigos) {
    const n = eq[`${c.fab}|${c.cod}`];
    if (n) { add(porNombre(n), 1.1, `código ${c.fab} ${c.cod}`); res.fabricante ||= c.fab; res.codigo ||= c.cod; }
  }
  if (!res.codigo) { const c = res.codigos.find(x => x.seguro) || (res.codigos.length === 1 ? res.codigos[0] : null); if (c) { res.codigo = c.cod; res.fabricante ||= c.fab; } }
  // 3) CAS con dígito de control correcto
  for (const c of res.cas) for (const r of cat.filter(x => x.cas === c)) add(r, 1, `CAS ${c}`);
  // 4) nombre o sinónimo, en cualquier orden y tolerando errores de lectura
  const w = new Set(palabras(T)), plana = formulaPlana(T);
  for (const r of cat) {
    let s = Math.max(puntuar(r.nombre, w), ...String(r.sinonimos || "").split(/[,;]/).filter(Boolean).map(x => puntuar(x, w) - 0.05));
    const f = formulaPlana(r.formula); if (f.length >= 4 && plana.includes(f)) s += 0.2;
    if (s >= 0.5) add(r, Math.min(s, 0.99), s >= 0.99 ? "nombre" : `nombre (${Math.round(Math.min(s, 0.99) * 100)} %)`);
  }
  res.candidatos = [...cand.values()].sort((a, b) => b.score - a.score || a.r.nombre.length - b.r.nombre.length).slice(0, 6);
  return res;
}
