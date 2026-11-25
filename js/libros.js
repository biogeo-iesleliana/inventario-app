// Inventario del Departamento — biblioteca del departamento (v1.3)
// Alta de libros por ISBN: se escribe, se pega una lista o se lee el código de barras de la contraportada.
// Para completar la ficha solo se envía el ISBN a Open Library y, si hace falta, a Google Books.
// La foto se lee en este dispositivo (lector de códigos del navegador o Tesseract.js) y no se guarda.

import { $, esc, norm, uniq, nowISO, store, commit, guard, who, dialog, confirmBox, items, opts, dl, sel, learn, blank, armariosFor,
  LIBRO, IDIOMAS, TIPOS_PUB, isbnLimpio, isbnValido, isbnNorm, esIsbn } from "./core.js";
import { barras, comprobarMotor, motor, lienzo } from "./foto.js";

const K_COLA = "inv.librosCola", K_DEF = "inv.librosDef";
const IDIOMA_COD = { es: "Castellano", spa: "Castellano", ca: "Valencià", cat: "Valencià", en: "Inglés", eng: "Inglés", fr: "Francés", fre: "Francés", fra: "Francés", pt: "Portugués", por: "Portugués", it: "Italiano", ita: "Italiano", de: "Alemán", ger: "Alemán", deu: "Alemán", gl: "Gallego", eu: "Euskera" };
const CAMPOS = ["titulo", "subtitulo", "autores", "editorial", "anio", "idioma", "portada", "paginas"];

/* ---------- búsqueda por ISBN ---------- */
async function getJSON(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctl.signal, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!r.ok) throw Object.assign(new Error("HTTP " + r.status), { status: r.status });
    return await r.json();
  } finally { clearTimeout(t); }
}
const anio = s => (/\b(1[5-9]\d\d|20\d\d)\b/.exec(String(s ?? "")) || [])[1] || "";
// «Ana Gómez» → «Gómez, Ana». Con tres palabras o más no se adivina (dos apellidos, nombres compuestos): se deja como viene.
export function autorOrden(nombre) {
  const n = String(nombre ?? "").trim().replace(/\s+/g, " ");
  if (!n || n.includes(",")) return n;
  const p = n.split(" ");
  // dos palabras, o iniciales delante («N. Sue Barnes»): la última es el apellido
  return p.length === 2 || (p.length > 2 && /^\p{L}\.$/u.test(p[0])) ? `${p.at(-1)}, ${p.slice(0, -1).join(" ")}` : n;
}
const isbn10 = d => { if (!/^978\d{10}$/.test(d)) return ""; const b = d.slice(3, 12); const r = (11 - [...b].reduce((a, c, k) => a + (+c) * (10 - k), 0) % 11) % 11; return b + (r === 10 ? "X" : r); };

// Devuelve { datos, fuentes, fallos }. «datos» es null si ningún servicio conoce el ISBN.
export async function buscarISBN(isbn) {
  const d = isbnNorm(isbn), out = {}, fuentes = [], fallos = [];
  const pon = o => { for (const k of CAMPOS) if (!out[k] && o[k]) out[k] = String(o[k]).trim(); };
  try {
    const keys = [d, isbn10(d)].filter(Boolean).map(x => "ISBN:" + x);
    const j = await getJSON(`https://openlibrary.org/api/books?bibkeys=${keys.join(",")}&format=json&jscmd=data`);
    const b = keys.map(k => j[k]).find(Boolean);
    if (b) {
      pon({ titulo: b.title, subtitulo: b.subtitle, autores: (b.authors || []).map(a => autorOrden(a.name)).join("; "), editorial: b.publishers?.[0]?.name, anio: anio(b.publish_date), portada: b.cover?.medium || b.cover?.small, paginas: b.number_of_pages });
      fuentes.push("Open Library");
    }
  } catch (e) { console.warn("Open Library", e); fallos.push("Open Library"); }
  if (["titulo", "autores", "editorial", "anio"].some(k => !out[k])) { // Google solo si Open Library no lo encuentra o le faltan datos básicos
    try {
      const j = await getJSON(`https://www.googleapis.com/books/v1/volumes?q=isbn:${d}&maxResults=1`);
      const v = j.items?.[0]?.volumeInfo;
      if (v) {
        pon({ titulo: v.title, subtitulo: v.subtitle, autores: (v.authors || []).map(autorOrden).join("; "), editorial: v.publisher, anio: anio(v.publishedDate), idioma: IDIOMA_COD[v.language] || "",
          portada: (v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || "").replace(/^http:/, "https:").replace(/&edge=curl/, ""), paginas: v.pageCount });
        fuentes.push("Google Books");
      }
    } catch (e) { console.warn("Google Books", e); fallos.push(e.status === 429 ? "Google Books (límite de consultas; prueba en un rato)" : "Google Books"); }
  }
  return { datos: out.titulo ? out : null, fuentes, fallos };
}

/* ---------- leer el ISBN de una foto de la contraportada ---------- */
export function isbnsEnTexto(t) {
  const out = [];
  for (const m of String(t).matchAll(/(?:97[89][\s‐-]?)?(?:\d[\s‐-]?){8,9}[\dXx]/g)) { const d = isbnLimpio(m[0]); if (esIsbn(d)) out.push(isbnNorm(d)); }
  // los números bajo el código de barras salen agrupados («9 788448 180959»): se buscan también juntando las cifras de cada línea
  for (const line of String(t).split(/\n/)) for (const m of line.replace(/[^\d]/g, "").matchAll(/97[89]\d{10}/g)) if (isbnValido(m[0])) out.push(m[0]);
  return uniq(out);
}
async function isbnsDeFoto(file, estado) {
  estado("Buscando el código de barras…");
  const cods = (await barras(file)).map(isbnLimpio).filter(esIsbn).map(isbnNorm); // los EAN-13 de libro empiezan por 978/979; el código pequeño del precio se descarta
  if (cods.length) return uniq(cods);
  if (!await comprobarMotor()) return [];
  estado("No se ve el código de barras: leyendo el texto (puede tardar unos segundos)…");
  const w = await motor();
  for (const rot of [0, 1, 3]) { // también de lado: en algunos libros el ISBN va en vertical
    const r = isbnsEnTexto((await w.recognize(await lienzo(file, rot))).data.text || "");
    if (r.length) return r;
  }
  return [];
}

/* ---------- bibliografía (APA 7) y RIS (Zotero, Mendeley…) ---------- */
const iniciales = n => n.split(/\s+/).filter(Boolean).map(p => p.split("-").filter(Boolean).map(x => x.charAt(0).toUpperCase() + ".").join("-")).join(" ");
const autorApa = a => { const [ap, nom] = a.split(/,(.*)/s).map(x => (x || "").trim()); return nom ? `${ap}, ${iniciales(nom)}` : ap; };
export const autoresLista = s => String(s ?? "").split(";").map(x => x.trim()).filter(Boolean);
export const tituloCompleto = i => [i.denominacion, i.libro?.subtitulo].filter(Boolean).join(": ");
function edicion(e) { e = String(e ?? "").trim(); if (!e || /^1(\.?ª|a)?$/.test(e)) return ""; return /^\d+$/.test(e) ? `${e}.ª ed.` : e.replace(/^\(|\)$/g, ""); }
export function apa(i) {
  const L = i.libro || {}, au = autoresLista(L.autores).map(autorApa);
  const autores = !au.length ? "" : au.length === 1 ? au[0] : au.length <= 20 ? au.slice(0, -1).join(", ") + ", & " + au.at(-1) : au.slice(0, 19).join(", ") + ", . . . " + au.at(-1);
  const fin = s => /[.?!]$/.test(s) ? s : s + ".";
  const tit = tituloCompleto(i), ed = edicion(L.edicion), pub = L.editorial && norm(L.editorial) !== norm(L.autores) ? fin(L.editorial) : "";
  const year = `(${L.anio || "s. f."}).`;
  const cab = autores ? `${fin(autores)} ${year}` : "";
  // sin autor, el título ocupa su lugar: «Título (2.ª ed.). (2003). Editorial.»
  const punto = ed || !/[.?!]$/.test(tit) ? "." : "";
  const texto = [cab, `${tit}${ed ? ` (${ed})` : ""}${punto}`, autores ? "" : year, pub].filter(Boolean).join(" ");
  const html = [esc(cab), `<em>${esc(tit)}</em>${ed ? ` (${esc(ed)})` : ""}${punto}`, autores ? "" : esc(year), esc(pub)].filter(Boolean).join(" ");
  return { texto, html };
}
export function ris(list) {
  const ty = t => t === "Revista" ? "JFULL" : t === "Audiovisual" ? "VIDEO" : "BOOK";
  return list.map(i => { const L = i.libro || {}; return [
    `TY  - ${ty(L.tipoPublicacion)}`, ...autoresLista(L.autores).map(a => `AU  - ${a}`), `TI  - ${tituloCompleto(i)}`, L.anio && `PY  - ${L.anio}`, L.editorial && `PB  - ${L.editorial}`,
    L.edicion && `ET  - ${L.edicion}`, L.isbn && `SN  - ${L.isbn}`, L.idioma && `LA  - ${L.idioma}`, L.materia && `KW  - ${L.materia}`, i.observaciones && `N1  - ${i.observaciones}`, "ER  - "
  ].filter(Boolean).join("\r\n"); }).join("\r\n\r\n") + "\r\n";
}

/* ---------- lista de libros por añadir (se guarda en este dispositivo) ---------- */
const cola = () => { try { return JSON.parse(store.get(K_COLA) || "[]"); } catch { return []; } };
const guardarCola = l => l.length ? store.set(K_COLA, JSON.stringify(l), true) : store.del(K_COLA);
const defs = () => { const b = { ubicacion: "Despacho", armario: "", origen: "Compra", categoria: "Biblioteca", tipoPublicacion: "Consulta", materia: "" }; try { return { ...b, ...JSON.parse(store.get(K_DEF) || "{}") }; } catch { return b; } };
const enInventario = isbn => items().find(x => x.estado !== "De baja" && x.libro?.isbn && x.libro.isbn === isbn);
let uid = 0;

export function vLibros(c) {
  const d = defs();
  const origenes = ["Compra", "Dotación", "Donación"];
  c.innerHTML = `<h1>Libros</h1>
  <p class="muted" style="max-width:980px">Biblioteca del departamento: libros de consulta, guías de campo, didáctica, lectura, revistas y audiovisuales. Escribe o lee el ISBN y la app propone título, autores, editorial y año. Para buscarlos solo se envía el ISBN a Open Library y Google Books. Si no lo encuentran (pasa a menudo con libros en valencià y de editoriales pequeñas), rellena la fila a mano.</p>
  <div class="sheet">
    <h2>Añadir por ISBN</h2>
    <form class="row" id="lb-f" autocomplete="off"><input id="lb-isbn" class="mono" inputmode="text" placeholder="978-84-…" aria-label="ISBN o ISSN" style="max-width:240px"><button class="btn" type="submit">Buscar</button>
      <button class="btn ghost" id="lb-b-cam" type="button">Leer el código de barras</button><button class="btn ghost" id="lb-b-files" type="button">Elegir fotos…</button><a class="btn ghost" href="#nuevo/${encodeURIComponent(LIBRO)}">Sin ISBN (a mano)</a></form>
    <input id="lb-cam" type="file" accept="image/*" capture="environment" hidden><input id="lb-files" type="file" accept="image/*" multiple hidden>
    <p class="msg" id="lb-msg" role="status"></p>
    <details><summary class="small">Pegar varios ISBN</summary><textarea id="lb-text" rows="5" placeholder="9788448180959&#10;978-84-7360-123-4"></textarea><div class="row" style="margin-top:8px"><button class="btn ghost" id="lb-paste" type="button">Buscarlos todos</button></div></details>
    <p class="muted small">Foto de la contraportada, con el código de barras recto y bien iluminado. Si el navegador no tiene lector de códigos (Safari en iPhone), la app lee los números impresos bajo el código.</p>
  </div>
  <div class="sheet" style="margin-top:16px;max-width:none"><h2>Libros por añadir (<span id="lb-n">0</span>)</h2>
    <p class="muted small">Revisa y corrige cada fila. Autores con el formato «Apellidos, Nombre», separados por punto y coma. La lista se guarda en este dispositivo hasta que la des de alta.</p>
    <details open><summary class="small">Datos comunes para todos los libros de la lista</summary><div class="grid">
      <div><label for="lb-d-ubic">Ubicación</label><input id="lb-d-ubic" list="lb-dl-ubic" value="${esc(d.ubicacion)}"></div>
      <div><label for="lb-d-arm">Armario / estante</label><input id="lb-d-arm" list="lb-dl-arm" value="${esc(d.armario)}"></div>
      <div><label for="lb-d-tipo">Tipo de publicación</label><input id="lb-d-tipo" list="lb-dl-tipo" value="${esc(d.tipoPublicacion)}"></div>
      <div><label for="lb-d-mat">Materia</label><input id="lb-d-mat" list="lb-dl-mat" value="${esc(d.materia)}"></div>
      <div><label for="lb-d-cat">Categoría</label><input id="lb-d-cat" list="lb-dl-cat" value="${esc(d.categoria)}"></div>
      <div><label for="lb-d-origen">Origen</label>${sel("lb-d-origen", origenes, d.origen, null)}</div></div></details>
    <div class="tablewrap rev" style="margin-top:10px"><table class="lb-t"><thead><tr><th></th><th>ISBN</th><th>Título *</th><th>Autores</th><th>Editorial</th><th>Año</th><th>Idioma</th><th>Ejempl.</th><th></th></tr></thead><tbody id="lb-body"></tbody></table></div>
    <div class="row" style="margin-top:10px"><button class="btn" id="lb-alta" type="button">Dar de alta en el inventario</button><button class="btn ghost" id="lb-vaciar" type="button">Vaciar la lista</button></div>
    <p class="msg" id="lb-msg2" role="status"></p>
    <p class="muted small">Subtítulo, edición, niveles y ejemplares con código se completan después en la ficha de cada libro (pestaña Inventario, tipo «${esc(LIBRO)}»).</p></div>
  ${dl("lb-dl-ubic", opts("ubicaciones", "ubicacion"))}${dl("lb-dl-arm", armariosFor(d.ubicacion))}${dl("lb-dl-tipo", uniq([...TIPOS_PUB, ...opts("tiposPublicacion")]))}${dl("lb-dl-mat", opts("materias"))}
  ${dl("lb-dl-cat", opts("categorias", "categoria"))}${dl("lb-dl-idioma", uniq([...IDIOMAS, ...opts("idiomas")]))}${dl("lb-dl-edit", opts("editoriales"))}`;

  const msg = (t, err, id = "#lb-msg") => { const m = $(id); if (!m) return; m.className = "msg" + (err ? " err" : ""); m.textContent = t; };
  const saveDefs = () => store.set(K_DEF, JSON.stringify({ ubicacion: $("#lb-d-ubic").value.trim(), armario: $("#lb-d-arm").value.trim(), origen: $("#lb-d-origen").value, categoria: $("#lb-d-cat").value.trim(), tipoPublicacion: $("#lb-d-tipo").value.trim(), materia: $("#lb-d-mat").value.trim() }), true);
  ["#lb-d-ubic", "#lb-d-arm", "#lb-d-origen", "#lb-d-cat", "#lb-d-tipo", "#lb-d-mat"].forEach(s => $(s).addEventListener("change", saveDefs));
  $("#lb-d-ubic").addEventListener("change", e => { $("#lb-dl-arm").outerHTML = dl("lb-dl-arm", armariosFor(e.target.value)); });

  /* --- tabla --- */
  const L = cola(); for (const r of L) { r.uid = ++uid; if (r.estado === "buscando") r.estado = "pendiente"; }
  const save = () => guardarCola(L.map(({ uid: _, ...r }) => r));
  const fila = r => {
    const ya = enInventario(r.isbn);
    const est = r.estado === "buscando" ? `<span class="pill">buscando…</span>` : r.estado === "pendiente" ? `<button class="btn ghost small" type="button" data-re="${r.uid}">Buscar datos</button>`
      : r.fuente ? `<span class="pill" title="Datos de ${esc(r.fuente)}">${esc(r.fuente)}</span>` : r.isbn && !r.issn ? `<span class="pill warn" title="Ningún servicio conoce este ISBN">no encontrado</span>` : "";
    const aut = r.autores && autoresLista(r.autores).some(a => !a.includes(",") && a.split(" ").length > 2) ? `<div class="sub">Revisa el formato: «Apellidos, Nombre»</div>` : "";
    return `<tr data-u="${r.uid}"><td class="lb-cov">${r.portada ? `<img src="${esc(r.portada)}" alt="" loading="lazy">` : ""}</td>
      <td class="mono small">${esc(r.isbn || "—")}<div>${est}</div>${ya ? `<div><span class="pill warn" title="${esc(ya.ubicacion)}">ya en inventario</span></div>` : ""}</td>
      <td><input data-f="titulo" value="${esc(r.titulo)}" aria-label="Título"></td><td><input data-f="autores" value="${esc(r.autores)}" aria-label="Autores">${aut}</td>
      <td><input data-f="editorial" value="${esc(r.editorial)}" list="lb-dl-edit" aria-label="Editorial"></td><td><input data-f="anio" value="${esc(r.anio)}" inputmode="numeric" aria-label="Año" style="width:68px"></td>
      <td><input data-f="idioma" value="${esc(r.idioma)}" list="lb-dl-idioma" aria-label="Idioma" style="width:110px"></td><td><input data-f="n" type="number" min="1" value="${esc(r.n)}" aria-label="Ejemplares" style="width:62px"></td>
      <td><button class="btn ghost small" type="button" data-x="${r.uid}" aria-label="Quitar de la lista">✕</button></td></tr>`;
  };
  const pinta = () => { if (!$("#lb-n")) return; $("#lb-n").textContent = L.length; $("#lb-body").innerHTML = L.map(fila).join("") || `<tr><td colspan="9" class="muted">Todavía no hay libros. Escribe o lee un ISBN.</td></tr>`; };
  const repinta = r => { const tr = $(`#lb-body tr[data-u="${r.uid}"]`); if (!tr) return; const foco = document.activeElement?.closest?.(`tr[data-u="${r.uid}"]`) ? document.activeElement.dataset.f : null; tr.outerHTML = fila(r); if (foco) $(`#lb-body tr[data-u="${r.uid}"] input[data-f="${foco}"]`)?.focus(); };
  $("#lb-body").addEventListener("input", e => { const tr = e.target.closest("tr[data-u]"), f = e.target.dataset.f; if (!tr || !f) return; const r = L.find(x => x.uid === +tr.dataset.u); if (r) { r[f] = f === "n" ? Math.max(1, Math.round(+e.target.value) || 1) : e.target.value; save(); } });
  $("#lb-body").addEventListener("click", e => {
    const x = e.target.dataset.x, re = e.target.dataset.re;
    if (x) { const k = L.findIndex(r => r.uid === +x); if (k >= 0) { L.splice(k, 1); save(); pinta(); } }
    if (re) { const r = L.find(z => z.uid === +re); if (r) completar(r); }
  });

  /* --- añadir ISBN --- */
  async function completar(r) {
    r.estado = "buscando"; repinta(r);
    const { datos, fuentes, fallos } = await buscarISBN(r.isbn);
    if (!L.includes(r)) return; // se quitó mientras se buscaba
    if (datos) for (const k of CAMPOS) if (!r[k] && datos[k]) r[k] = datos[k];
    r.fuente = fuentes.join(" + "); r.estado = fallos.length && !datos ? "pendiente" : "hecho";
    save(); repinta(r);
    return { datos, fallos };
  }
  async function anadir(raw, silencio) {
    const t = String(raw ?? "").trim(); if (!t) return;
    if (!isbnValido(t)) { if (!silencio) msg(`«${t}» no es un ISBN ni un ISSN válido (el dígito de control no cuadra). Revisa el número.`, true); return "mal"; }
    const isbn = isbnNorm(t), issn = isbnLimpio(t).length === 8;
    const ya = L.find(r => r.isbn === isbn);
    if (ya) { ya.n = (+ya.n || 1) + 1; save(); repinta(ya); if (!silencio) msg(`Ya estaba en la lista: ahora son ${ya.n} ejemplares.`); return "suma"; }
    const r = { uid: ++uid, isbn, issn, titulo: "", subtitulo: "", autores: "", editorial: "", anio: "", idioma: "", portada: "", n: 1, fuente: "", estado: issn ? "hecho" : "buscando" };
    L.unshift(r); save(); pinta();
    if (issn) { if (!silencio) msg("ISSN añadido. Las revistas no se buscan: escribe el título."); return "ok"; }
    const res = await completar(r);
    if (!silencio) msg(res.datos ? `Encontrado en ${r.fuente}. Revisa los datos.` : res.fallos.length ? `No se ha podido consultar ${res.fallos.join(" ni ")}. Comprueba la conexión y pulsa «Buscar datos» en la fila, o rellénala a mano.` : "Ningún servicio conoce este ISBN: rellena la fila a mano.", !res.datos);
    return res.datos ? "ok" : "nada";
  }
  $("#lb-f").addEventListener("submit", async e => { e.preventDefault(); const v = $("#lb-isbn").value; if ((await anadir(v)) !== "mal") $("#lb-isbn").value = ""; $("#lb-isbn").focus(); });
  $("#lb-paste").onclick = async () => {
    const lines = $("#lb-text").value.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean); if (!lines.length) return;
    const n = { ok: 0, nada: 0, mal: [], suma: 0 };
    for (const [k, l] of lines.entries()) { msg(`Buscando ${k + 1} de ${lines.length}…`); const r = await anadir(l, true); if (r === "mal") n.mal.push(l); else if (r) n[r]++; }
    $("#lb-text").value = n.mal.join("\n");
    msg(`${n.ok} encontrados · ${n.nada} sin datos (rellénalos a mano)${n.suma ? ` · ${n.suma} repetidos sumados como ejemplares` : ""}${n.mal.length ? ` · ${n.mal.length} no válidos (se quedan en el cuadro para que los revises)` : ""}.`, n.mal.length > 0);
  };

  /* --- fotos --- */
  $("#lb-b-cam").onclick = () => $("#lb-cam").click();
  $("#lb-b-files").onclick = () => $("#lb-files").click();
  const fotos = async e => {
    const fs = [...e.target.files]; e.target.value = ""; if (!fs.length) return;
    let ok = 0; const sin = [];
    for (const [k, f] of fs.entries()) {
      const pre = fs.length > 1 ? `Foto ${k + 1} de ${fs.length}: ` : "";
      try {
        const found = await isbnsDeFoto(f, t => msg(pre + t));
        if (!found.length) { sin.push(f.name); continue; }
        for (const i of found) { msg(pre + `ISBN ${i}: buscando los datos…`); await anadir(i, true); ok++; }
      } catch (err) { console.error(err); sin.push(f.name); }
    }
    const motorOk = await comprobarMotor();
    msg(ok ? `${ok} ${ok === 1 ? "ISBN leído" : "ISBN leídos"}${sin.length ? `; en ${sin.length} ${sin.length === 1 ? "foto" : "fotos"} no se ha encontrado ninguno` : ""}. Revisa la lista.`
      : `No se ha encontrado ningún ISBN en la foto. ${"BarcodeDetector" in window || motorOk ? "Prueba con más luz y el código recto, o escríbelo." : "Este navegador no tiene lector de códigos y el lector de texto no está instalado: escribe el ISBN."}`, !ok);
  };
  $("#lb-cam").onchange = fotos; $("#lb-files").onchange = fotos;

  /* --- alta --- */
  $("#lb-vaciar").onclick = async () => { if (L.length && await confirmBox("Vaciar la lista", "Se borran de este dispositivo los libros que aún no has dado de alta.", "Vaciar", true)) { L.length = 0; save(); pinta(); msg("", false, "#lb-msg2"); } };
  $("#lb-alta").onclick = async () => {
    if (!L.length) return;
    msg("", false, "#lb-msg2");
    if (L.some(r => r.estado === "buscando")) return msg("Espera a que terminen las búsquedas.", true, "#lb-msg2");
    const sinT = L.filter(r => !String(r.titulo).trim());
    if (sinT.length) return msg(`Faltan títulos en ${sinT.length} ${sinT.length === 1 ? "fila" : "filas"}${sinT[0].isbn ? ` (por ejemplo, ISBN ${sinT[0].isbn})` : ""}.`, true, "#lb-msg2");
    saveDefs(); const D = defs();
    if (!D.ubicacion) return msg("Indica la ubicación en «Datos comunes».", true, "#lb-msg2");
    const w = await who(); if (!w) return;
    const rep = L.map(r => [r, enInventario(r.isbn)]).filter(([, x]) => x);
    let sumar = false;
    if (rep.length) {
      const a = await dialog(`<h2>${rep.length === 1 ? "Un libro ya está" : `${rep.length} libros ya están`} en el inventario</h2><ul class="small">${rep.slice(0, 8).map(([r, x]) => `<li><strong>${esc(x.denominacion)}</strong> · ${esc([x.ubicacion, x.armario].filter(Boolean).join(" · "))} · ${esc(x.cantidad ?? "varios")} ejempl.</li>`).join("")}${rep.length > 8 ? `<li>…</li>` : ""}</ul>
        <p>¿Sumar los ejemplares nuevos a la línea que ya existe o crear líneas aparte (por ejemplo, si están en otra ubicación)?</p>
        <div class="row"><button class="btn" value="sum">Sumar a la existente</button><button class="btn ghost" value="new">Crear líneas aparte</button><button class="btn ghost" value="no">Cancelar</button></div>`);
      if (a !== "sum" && a !== "new") return;
      sumar = a === "sum";
    }
    const suma = new Map(sumar ? rep.map(([r, x]) => [r, x.id]) : []);
    const nuevos = L.filter(r => !suma.has(r)).map(r => {
      const i = blank(LIBRO);
      Object.assign(i, { categoria: D.categoria, denominacion: r.titulo.trim(), cantidad: +r.n || 1, ubicacion: D.ubicacion, armario: D.armario, origen: D.origen });
      Object.assign(i.libro, { isbn: r.isbn, subtitulo: r.subtitulo || "", autores: r.autores.trim(), editorial: r.editorial.trim(), anio: String(r.anio).trim(), idioma: r.idioma.trim(), tipoPublicacion: D.tipoPublicacion, materia: D.materia, portada: r.portada || "" });
      i.historial = [{ fecha: nowISO(), por: w, accion: r.isbn ? "Alta por ISBN" : "Alta en la pestaña Libros" }];
      return i;
    });
    const total = nuevos.length + suma.size;
    const ok = await guard(async () => {
      await commit("inv", d => {
        d.items.push(...structuredClone(nuevos));
        for (const [r, id] of suma) {
          const cur = d.items.find(x => x.id === id); if (!cur) throw new Error("Uno de los libros que se iban a sumar ya no existe. Pulsa «Actualizar» y repite el alta.");
          const a = cur.cantidad ?? 0, n = +r.n || 1; cur.cantidad = a + n;
          if (cur.libro?.ejemplares?.length) for (let k = 0; k < n; k++) cur.libro.ejemplares.push({ codigo: "", estante: "", estado: "Bueno", observaciones: "" });
          (cur.historial ||= []).push({ fecha: nowISO(), por: w, accion: `Entrada de ${n} ejempl.`, detalle: `cantidad: ${a} → ${cur.cantidad}` });
        }
      }, `Alta de ${total} libros (por ${w})`);
      await learn(nuevos);
    }, `${total} ${total === 1 ? "libro dado" : "libros dados"} de alta.`);
    if (ok) { L.length = 0; save(); pinta(); msg(`${total} ${total === 1 ? "libro dado" : "libros dados"} de alta. Los encontrarás en Inventario filtrando por tipo «${LIBRO}».`, false, "#lb-msg2"); }
  };

  pinta();
  for (const r of L) if (r.estado === "pendiente" && !r.titulo) completar(r);
}
