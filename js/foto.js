// Inventario del Departamento — alta de reactivos por foto de la etiqueta (v1.2)
// La foto se lee en este dispositivo (Tesseract.js en vendor/tesseract y, si el navegador lo
// permite, el lector de códigos de barras del sistema). Ni la imagen ni el texto salen del navegador
// y la foto no se guarda: solo se guardan los datos que se confirman.

import { VERSION, $, $$, esc, norm, uniq, today, nowISO, finMes, S, store, commit, guard, who, dialog, confirmBox, items, opts, dl, ghsSvg, learn, blank, mismo, download, armariosFor } from "./core.js";
import { analizar, SEMILLA, FABRICANTES } from "./etiqueta.js";

const BASE = new URL("vendor/tesseract/", location.href).href;
const K_LISTA = "inv.fotoLista", K_DEF = "inv.fotoDef";
const F = { cola: [], actual: null, motor: null, hayMotor: null, prog: null };

/* ---------- datos guardados en este dispositivo (por si se corta la conexión o se cierra la pestaña) ---------- */
const lista = () => { try { return JSON.parse(store.get(K_LISTA) || "[]"); } catch { return []; } };
const guardarLista = l => l.length ? store.set(K_LISTA, JSON.stringify(l), true) : store.del(K_LISTA);
const defs = () => { try { return { ubicacion: "Laboratorio", armario: "", armarioSeguridad: "", ...JSON.parse(store.get(K_DEF) || "{}") }; } catch { return { ubicacion: "Laboratorio", armario: "", armarioSeguridad: "" }; } };

/* ---------- equivalencias: las confirmadas en el repositorio de datos tienen prioridad sobre las de partida ---------- */
export function equivalencias() {
  const out = { ...SEMILLA };
  for (const [k, v] of Object.entries(S.eq?.codigos || {})) if (v?.nombre) out[k] = v.nombre;
  return out;
}
const delCatalogo = n => S.cat.find(r => r.nombre === n) || S.cat.find(r => norm(r.nombre) === norm(n)) || null;

/* ---------- motor de lectura ---------- */
async function comprobarMotor() {
  if (F.hayMotor !== null) return F.hayMotor;
  try { const r = await fetch(BASE + "tesseract.min.js", { method: "HEAD", cache: "no-store" }); F.hayMotor = r.ok; } catch { F.hayMotor = false; }
  return F.hayMotor;
}
function script(src) {
  return new Promise((ok, ko) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => ko(new Error("No se ha podido cargar " + src)); document.head.appendChild(s); });
}
function motor() {
  F.motor ||= (async () => {
    if (!window.Tesseract) await script(BASE + "tesseract.min.js?v=" + VERSION);
    return window.Tesseract.createWorker(["spa", "eng"], 1, { // 1 = LSTM: el modelo de los datos incluidos
      workerPath: BASE + "worker.min.js", corePath: BASE + "core", langPath: BASE + "lang", gzip: true, workerBlobURL: false,
      logger: m => F.prog?.(m)
    });
  })().catch(e => { F.motor = null; throw e; });
  return F.motor;
}

/* ---------- imagen ---------- */
// Reduce la foto, aplica el giro y prepara una versión en grises con más contraste para leerla mejor
async function lienzo(file, rot) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement("canvas"), g = c.getContext("2d", { willReadFrequently: true }), q = rot % 2;
  c.width = q ? h : w; c.height = q ? w : h;
  g.translate(c.width / 2, c.height / 2); g.rotate(rot * Math.PI / 2); g.drawImage(bmp, -w / 2, -h / 2, w, h);
  bmp.close?.();
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data, hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) { const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; d[i] = y; hist[y]++; }
  let lo = 0, hi = 255, n = 0, tot = d.length / 4; // estira el contraste entre los percentiles 1 y 99
  for (; lo < 255 && (n += hist[lo]) < tot * 0.01; lo++);
  n = 0; for (; hi > 0 && (n += hist[hi]) < tot * 0.01; hi--);
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) { const v = Math.max(0, Math.min(255, (d[i] - lo) * 255 / span)); d[i] = d[i + 1] = d[i + 2] = v; }
  g.setTransform(1, 0, 0, 1, 0, 0); g.putImageData(img, 0, 0);
  return c;
}
async function barras(file) {
  if (!("BarcodeDetector" in window)) return [];
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats(); if (!formats.length) return [];
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const r = await new window.BarcodeDetector({ formats }).detect(bmp); bmp.close?.();
    return r.map(x => x.rawValue).filter(Boolean);
  } catch { return []; }
}

/* ---------- vista ---------- */
export function vFoto(c) {
  const d = defs();
  c.innerHTML = `<h1>Alta por foto</h1>
  <p class="muted" style="max-width:980px">Fotografía la etiqueta de un frasco: la app lee el código del fabricante, el nombre, el CAS, el lote, la caducidad y el envase, y te propone el reactivo del catálogo. Revisas, confirmas y pasas al siguiente. La foto se lee en este dispositivo, no se envía a ningún sitio y no se guarda.</p>
  <div id="fo-motor"></div>
  <div class="sheet">
    <div class="row"><button class="btn" id="fo-b-cam" type="button">Hacer foto</button><button class="btn ghost" id="fo-b-files" type="button">Elegir imágenes…</button><button class="btn ghost" id="fo-b-manual" type="button">Sin foto (a mano)</button><span class="muted small" id="fo-cola" role="status"></span></div>
    <input id="fo-cam" type="file" accept="image/*" capture="environment" hidden><input id="fo-files" type="file" accept="image/*" multiple hidden>
    <p class="muted small">Un frasco por foto, con el código y el nombre bien visibles. Buena luz y la parte más plana de la etiqueta. Desde el ordenador puedes elegir varias fotos a la vez y se revisan una detrás de otra.</p>
    <details><summary class="small">Ubicación de los frascos que vas a fotografiar</summary><div class="grid">
      <div><label for="fo-d-ubic">Ubicación</label><input id="fo-d-ubic" list="fo-dl-ubic" value="${esc(d.ubicacion)}"></div>
      <div><label for="fo-d-arm">Armario / estante</label><input id="fo-d-arm" list="fo-dl-arm" value="${esc(d.armario)}"></div>
      <div><label for="fo-d-seg">Armario de seguridad</label><input id="fo-d-seg" list="fo-dl-seg" value="${esc(d.armarioSeguridad)}"></div></div>
      <p class="muted small">Se aplica a cada foto nueva. También cambia sola con lo último que confirmes.</p></details>
  </div>
  <div id="fo-actual"></div>
  <div class="sheet" style="margin-top:16px"><h2>Frascos confirmados (<span id="fo-total">0</span>)</h2>
    <p class="muted small">La lista se guarda en este dispositivo hasta que la des de alta o la exportes, así que no se pierde si se corta la conexión o cierras la pestaña.</p>
    <div id="fo-lista"></div>
    <div class="row" style="margin-top:10px"><button class="btn" id="fo-alta" type="button">Dar de alta en el inventario</button><button class="btn ghost" id="fo-csv" type="button">Exportar CSV</button><button class="btn ghost" id="fo-vaciar" type="button">Vaciar la lista</button></div><p class="msg" id="fo-msg" role="status"></p></div>
  ${dl("fo-dl-ubic", opts("ubicaciones", "ubicacion"))}${dl("fo-dl-arm", armariosFor(d.ubicacion))}${dl("fo-dl-seg", opts("armariosSeguridad"))}
  ${dl("fo-dl-cat", S.cat.map(r => r.nombre))}${dl("fo-dl-fab", uniq([...opts("fabricantes"), ...FABRICANTES.map(f => f[0])]))}`;

  const saveDefs = () => store.set(K_DEF, JSON.stringify({ ubicacion: $("#fo-d-ubic").value.trim(), armario: $("#fo-d-arm").value.trim(), armarioSeguridad: $("#fo-d-seg").value.trim() }), true);
  ["#fo-d-ubic", "#fo-d-arm", "#fo-d-seg"].forEach(s => $(s).addEventListener("change", saveDefs));
  $("#fo-d-ubic").addEventListener("change", e => { $("#fo-dl-arm").outerHTML = dl("fo-dl-arm", armariosFor(e.target.value)); });
  $("#fo-b-cam").onclick = () => $("#fo-cam").click();
  $("#fo-b-files").onclick = () => $("#fo-files").click();
  $("#fo-b-manual").onclick = () => { if (F.actual) { $("#fo-nombre")?.focus(); return; } F.actual = { file: null, res: { candidatos: [] }, texto: "" }; ficha(F.actual.res, ""); };
  const add = e => { const fs = [...e.target.files]; e.target.value = ""; if (!fs.length) return; F.cola.push(...fs); if (!F.actual) siguiente(); else cola(); };
  $("#fo-cam").onchange = add; $("#fo-files").onchange = add;
  $("#fo-alta").onclick = alta; $("#fo-csv").onclick = csv;
  $("#fo-vaciar").onclick = async () => { if (lista().length && await confirmBox("Vaciar la lista", "Se borran de este dispositivo los frascos confirmados que aún no has dado de alta ni exportado.", "Vaciar", true)) { guardarLista([]); pintarLista(); } };

  avisoMotor(); pintarLista(); cola();
  if (F.actual?.res) ficha(F.actual.res, F.actual.texto); else if (F.actual) siguiente(true);
}

async function avisoMotor() {
  const ok = await comprobarMotor(), el = $("#fo-motor"); if (!el) return;
  el.innerHTML = ok ? "" : `<div class="sheet aviso warn" style="margin-bottom:12px"><h2>Falta instalar el lector de etiquetas</h2>
    <p>La pantalla funciona, pero sin el motor de lectura tendrás que buscar cada reactivo a mano. El lector de códigos de barras del navegador sí funciona si tu móvil lo admite. Para instalarlo una sola vez:</p>
    <ol class="small"><li>En GitHub, abre el repositorio <code>${esc(S.cfg?.owner || "biogeo-iesleliana")}/inventario-app</code> → pestaña <strong>Actions</strong>.</li>
    <li>Elige <strong>«Instalar el lector de etiquetas (OCR)»</strong> → <strong>Run workflow</strong>.</li>
    <li>Cuando termine (unos 2 minutos), espera a que se actualice GitHub Pages y recarga la app.</li></ol></div>`;
}
const cola = () => { const el = $("#fo-cola"); if (el) el.textContent = F.cola.length ? `${F.cola.length} ${F.cola.length === 1 ? "foto pendiente" : "fotos pendientes"} después de esta` : ""; };

/* ---------- leer una foto ---------- */
async function siguiente(repetir) {
  if (!repetir) {
    if (F.actual?.url) URL.revokeObjectURL(F.actual.url);
    const file = F.cola.shift();
    F.actual = file ? { file, url: URL.createObjectURL(file), rot: 0 } : null;
  }
  cola();
  const box = $("#fo-actual"); if (!box) return;
  if (!F.actual) { box.innerHTML = ""; return; }
  const a = F.actual;
  box.innerHTML = `<div class="sheet foto" style="margin-top:16px"><div class="foto-grid"><figure><img src="${a.url}" alt="Foto de la etiqueta" style="transform:rotate(${a.rot * 90}deg)"></figure>
    <div><p class="msg" id="fo-est" role="status">Preparando la imagen…</p><progress id="fo-prog" max="1" value="0"></progress></div></div></div>`;
  box.scrollIntoView({ block: "start", behavior: "smooth" });
  const est = t => { const e = $("#fo-est"); if (e) e.textContent = t; };
  let texto = "", cods = [];
  try {
    const cv = await lienzo(a.file, a.rot);
    cods = await barras(a.file);
    if (await comprobarMotor()) {
      est("Cargando el lector (la primera vez tarda un poco)…");
      F.prog = m => { const p = $("#fo-prog"); if (!p) return; if (m.status === "recognizing text") { est("Leyendo la etiqueta…"); p.value = m.progress; } else if (/load|initializ/.test(m.status)) est("Cargando el lector (la primera vez tarda un poco)…"); };
      const w = await motor();
      if (F.actual !== a) return;
      texto = (await w.recognize(cv)).data.text || "";
    }
  } catch (e) { console.error(e); est("No se ha podido leer la foto: " + (e.message || e) + ". Puedes identificar el frasco a mano."); }
  if (F.actual !== a) return;
  a.texto = texto; a.barras = cods;
  a.res = analizar(texto, { cat: S.cat, eq: equivalencias(), barras: cods });
  ficha(a.res, texto);
}

/* ---------- confirmar los datos de un frasco ---------- */
function ficha(res, texto) {
  const a = F.actual, d = defs(), box = $("#fo-actual"); if (!box || !a) return;
  const top = res.candidatos[0], seguro = top && (top.score >= 0.8 || (res.candidatos.length === 1 && top.score >= 0.6));
  const v = a.form || { nombre: seguro ? top.r.nombre : "", fabricante: res.fabricante || "", refFabricante: res.codigo || "", lote: res.lote || "", caducidad: finMes(res.caducidad), envase: res.envase || "", n: 1, ubicacion: d.ubicacion, armario: d.armario, armarioSeguridad: d.armarioSeguridad, observaciones: "" };
  a.form = v;
  const nada = a.file && !texto && !res.gtin ? `<p class="msg err">No se ha leído nada en la foto. Busca el reactivo a mano o prueba con otra foto más cerca y con más luz.</p>` : "";
  box.innerHTML = `<div class="sheet foto" style="margin-top:16px"><div class="foto-grid">
    ${a.file ? `<figure><img src="${a.url}" alt="Foto de la etiqueta" style="transform:rotate(${(a.rot || 0) * 90}deg)">
      <div class="row" style="margin-top:6px"><button class="btn ghost small" type="button" id="fo-girar">Girar y volver a leer</button></div>
      ${texto ? `<details><summary class="small">Texto leído</summary><pre class="ocr">${esc(texto.trim())}</pre></details>` : ""}${a.barras?.length ? `<p class="sub">Código de barras: <span class="mono">${esc(a.barras.join(" · "))}</span></p>` : ""}</figure>` : ""}
    <form id="fo-form" autocomplete="off">
      <h2>${a.file ? "¿Qué frasco es?" : "Frasco sin foto"}</h2>${nada}
      ${res.candidatos.length ? `<p class="small muted" style="margin:0 0 4px">Propuestas (pulsa para elegir):</p><div class="chips" id="fo-cand">${res.candidatos.map((c, k) => `<button type="button" class="chip" data-k="${k}" aria-pressed="${c.r.nombre === v.nombre}">${esc(c.r.nombre)} <span class="sub">· ${esc(c.via)}</span></button>`).join("")}</div>`
      : a.file && texto ? `<p class="small muted">No se ha reconocido ningún reactivo del catálogo: escribe el nombre para buscarlo.</p>` : ""}
      <label for="fo-nombre">Reactivo *</label><input id="fo-nombre" list="fo-dl-cat" value="${esc(v.nombre)}" required placeholder="Escribe para buscar en el catálogo">
      <div class="sub" id="fo-info"></div>
      <div class="grid">
        <div><label for="fo-fab">Fabricante</label><input id="fo-fab" list="fo-dl-fab" value="${esc(v.fabricante)}"></div>
        <div><label for="fo-ref">Código del fabricante</label><input id="fo-ref" class="mono" value="${esc(v.refFabricante)}"></div>
        <div><label for="fo-env">Envase y contenido</label><input id="fo-env" value="${esc(v.envase)}" placeholder="500 g"></div>
        <div><label for="fo-n">N.º de envases</label><input id="fo-n" type="number" min="1" step="1" value="${esc(v.n)}"></div>
        <div><label for="fo-lote">Lote</label><input id="fo-lote" value="${esc(v.lote)}"></div>
        <div><label for="fo-cad">Caducidad</label><input id="fo-cad" type="date" value="${esc(v.caducidad)}"></div>
        <div><label for="fo-ubic">Ubicación *</label><input id="fo-ubic" list="fo-dl-ubic" value="${esc(v.ubicacion)}" required></div>
        <div><label for="fo-arm">Armario / estante</label><input id="fo-arm" list="fo-dl-arm" value="${esc(v.armario)}"></div>
        <div><label for="fo-seg">Armario de seguridad</label><input id="fo-seg" list="fo-dl-seg" value="${esc(v.armarioSeguridad)}"></div>
        <div class="span2"><label for="fo-obs">Observaciones</label><input id="fo-obs" value="${esc(v.observaciones)}" placeholder="Etiqueta deteriorada, frasco casi vacío…"></div>
      </div>
      <div class="row" style="margin-top:14px"><button class="btn" type="submit">Confirmar${F.cola.length ? " y pasar a la siguiente" : ""}</button><button class="btn ghost" type="button" id="fo-desc">Descartar ${a.file ? "foto" : ""}</button></div>
    </form></div></div>`;

  const form = $("#fo-form");
  const leer = () => { Object.assign(v, { nombre: $("#fo-nombre").value.trim(), fabricante: $("#fo-fab").value.trim(), refFabricante: $("#fo-ref").value.trim().toUpperCase(), envase: $("#fo-env").value.trim(), n: Math.max(1, Math.round(+$("#fo-n").value) || 1), lote: $("#fo-lote").value.trim(), caducidad: $("#fo-cad").value, ubicacion: $("#fo-ubic").value.trim(), armario: $("#fo-arm").value.trim(), armarioSeguridad: $("#fo-seg").value.trim(), observaciones: $("#fo-obs").value.trim() }); return v; };
  const info = () => {
    const r = delCatalogo($("#fo-nombre").value.trim()), el = $("#fo-info");
    el.innerHTML = !$("#fo-nombre").value.trim() ? "" : r ? `<span class="mono">${esc(r.formula)}</span>${r.cas && r.cas !== "—" ? ` · <span class="mono">CAS ${esc(r.cas)}</span>` : ""} ${(r.pictogramas || []).map(ghsSvg).join("")}${r.notas ? ` <span class="pill warn">${esc(r.notas)}</span>` : ""}`
      : `<span class="pill warn">no está en el catálogo</span> Se dará de alta con este nombre; completa el CAS y los pictogramas en la ficha.`;
    $$("#fo-cand .chip").forEach(b => b.setAttribute("aria-pressed", res.candidatos[+b.dataset.k].r.nombre === $("#fo-nombre").value.trim()));
  };
  form.addEventListener("input", () => { leer(); });
  $("#fo-nombre").addEventListener("input", info); info();
  $("#fo-ubic").addEventListener("change", e => { $("#fo-dl-arm").outerHTML = dl("fo-dl-arm", armariosFor(e.target.value)); });
  $("#fo-cand")?.addEventListener("click", e => { const b = e.target.closest(".chip"); if (!b) return; $("#fo-nombre").value = res.candidatos[+b.dataset.k].r.nombre; leer(); info(); });
  $("#fo-girar")?.addEventListener("click", () => { leer(); a.rot = ((a.rot || 0) + 1) % 4; delete a.form; siguiente(true); });
  $("#fo-desc").onclick = () => siguiente();
  form.addEventListener("submit", e => {
    e.preventDefault(); leer();
    const r = delCatalogo(v.nombre);
    const ent = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), nombre: r?.nombre || v.nombre, enCatalogo: !!r, cas: r?.cas && r.cas !== "—" ? r.cas : "", formula: r?.formula || "", pictogramas: [...(r?.pictogramas || [])], notas: r?.notas || "",
      fabricante: v.fabricante, refFabricante: v.refFabricante, gtin: res.gtin || "", lote: v.lote, caducidad: v.caducidad, envase: v.envase, n: v.n, ubicacion: v.ubicacion, armario: v.armario, armarioSeguridad: v.armarioSeguridad, observaciones: v.observaciones,
      leido: res.codigo ? `${res.fabricante} ${res.codigo}` : "" };
    guardarLista([...lista(), ent]);
    store.set(K_DEF, JSON.stringify({ ubicacion: v.ubicacion, armario: v.armario, armarioSeguridad: v.armarioSeguridad }), true);
    pintarLista();
    $("#fo-msg").textContent = `Añadido: ${ent.n} × ${ent.nombre}.`;
    if (F.cola.length) siguiente(); else { if (a.url) URL.revokeObjectURL(a.url); F.actual = null; $("#fo-actual").innerHTML = ""; window.scrollTo({ top: 0, behavior: "smooth" }); }
  });
  if (!seguro) $("#fo-nombre").focus({ preventScroll: true });
}

/* ---------- lista de frascos confirmados ---------- */
const comoItem = (e, w) => {
  const i = blank("Reactivos");
  Object.assign(i, { categoria: "Reactivos", denominacion: e.nombre, cantidad: e.n, ubicacion: e.ubicacion, armario: e.armario, origen: "Dotación", observaciones: [e.notas, e.observaciones].filter(Boolean).join(" · ") });
  Object.assign(i.reactivo, { formula: e.formula, cas: e.cas, fabricante: e.fabricante, refFabricante: e.refFabricante, lote: e.lote, envase: e.envase, fechaCaducidad: e.caducidad, pictogramas: [...e.pictogramas], armarioSeguridad: e.armarioSeguridad });
  i.historial = [{ fecha: nowISO(), por: w, accion: "Alta por foto", detalle: [e.fabricante, e.refFabricante].filter(Boolean).join(" ") }];
  return i;
};
const yaEsta = e => { const i = comoItem(e, ""); return items().find(x => x.estado !== "De baja" && !x.cantidadIndeterminada && !x.ref && mismo(x, i)) || null; };

function pintarLista() {
  const l = lista(), el = $("#fo-lista"); if (!el) return;
  $("#fo-total").textContent = l.length;
  ["#fo-alta", "#fo-csv", "#fo-vaciar"].forEach(s => $(s).disabled = !l.length);
  el.innerHTML = !l.length ? `<p class="muted small">Todavía no hay ningún frasco confirmado.</p>` : `<div class="tablewrap rev"><table><thead><tr><th>Reactivo</th><th>Fabricante · código</th><th>Envase</th><th>Lote · caducidad</th><th>N.º</th><th>Ubicación</th><th></th></tr></thead><tbody>${l.map(e => {
    const ya = yaEsta(e);
    return `<tr data-id="${esc(e.id)}"><td data-l="Reactivo"><strong>${esc(e.nombre)}</strong> ${(e.pictogramas || []).map(ghsSvg).join("")}<div class="sub">${e.cas ? `<span class="mono">CAS ${esc(e.cas)}</span>` : ""}${e.enCatalogo ? "" : ` <span class="pill warn">no está en el catálogo</span>`}${e.notas ? ` <span class="pill warn">${esc(e.notas)}</span>` : ""}${ya ? ` <span class="pill">ya hay ${esc(ya.cantidad)} en esta ubicación</span>` : ""}</div></td>
      <td data-l="Fabricante" class="mono">${esc([e.fabricante, e.refFabricante].filter(Boolean).join(" "))}</td><td data-l="Envase">${esc(e.envase)}</td><td data-l="Lote">${esc([e.lote, e.caducidad].filter(Boolean).join(" · "))}</td>
      <td data-l="N.º"><input type="number" min="1" step="1" value="${esc(e.n)}" data-n="${esc(e.id)}" aria-label="Número de envases" style="width:70px"></td><td data-l="Ubicación">${esc([e.ubicacion, e.armario].filter(Boolean).join(" · "))}</td>
      <td><button type="button" class="btn ghost small" data-x="${esc(e.id)}" aria-label="Quitar ${esc(e.nombre)}">✕</button></td></tr>`;
  }).join("")}</tbody></table></div>`;
  el.onchange = e => { const id = e.target.dataset.n; if (!id) return; guardarLista(lista().map(x => x.id === id ? { ...x, n: Math.max(1, Math.round(+e.target.value) || 1) } : x)); };
  el.onclick = e => { const id = e.target.closest("[data-x]")?.dataset.x; if (!id) return; guardarLista(lista().filter(x => x.id !== id)); pintarLista(); };
}

async function alta() {
  const l = lista(); if (!l.length) return;
  const w = await who(); if (!w) return;
  const dup = l.map(yaEsta), nd = dup.filter(Boolean).length;
  let sumar = false;
  if (nd) {
    const r = await dialog(`<h2>${nd === 1 ? "Un frasco ya está" : `${nd} frascos ya están`} en el inventario</h2><p>Hay líneas del mismo reactivo en la misma ubicación y armario. ¿Sumas los envases a esas líneas o creas líneas nuevas (por ejemplo, si son de otro lote)?</p>
      <div class="row"><button class="btn" value="sum">Sumar a las existentes</button><button class="btn ghost" value="new">Crear líneas nuevas</button><button class="btn ghost" value="no">Cancelar</button></div>`);
    if (r !== "sum" && r !== "new") return;
    sumar = r === "sum";
  }
  const nuevos = l.map(e => comoItem(e, w));
  // equivalencias nuevas o corregidas: el mismo frasco se reconocerá solo la próxima vez
  const eq = equivalencias(), cambios = {};
  for (const e of l) {
    if (!e.enCatalogo) continue;
    const fab = FABRICANTES.find(f => norm(f[0]) === norm(e.fabricante))?.[0] || e.fabricante;
    if (fab && /^[A-Z0-9][A-Z0-9.\-]{3,}$/i.test(e.refFabricante)) { const k = `${fab}|${e.refFabricante.toUpperCase().replace(/\.\d{4}$/, "")}`; if (eq[k] !== e.nombre) cambios[k] = e.nombre; }
    if (e.gtin && eq["GTIN|" + e.gtin] !== e.nombre) cambios["GTIN|" + e.gtin] = e.nombre;
  }
  let sumados = 0;
  const ok = await guard(async () => {
    await commit("inv", d => {
      sumados = 0;
      nuevos.forEach((i, k) => {
        const cur = sumar && dup[k] ? d.items.find(x => x.id === dup[k].id) : null;
        if (!cur) { d.items.push(structuredClone(i)); return; }
        const a0 = cur.cantidad ?? 0; cur.cantidad = a0 + i.cantidad; sumados++;
        (cur.historial ||= []).push({ fecha: nowISO(), por: w, accion: `Entrada de ${i.cantidad} ud. (alta por foto)`, detalle: `cantidad: ${a0} → ${cur.cantidad}${i.reactivo.lote ? " · lote " + i.reactivo.lote : ""}` });
      });
    }, `Alta por foto: ${nuevos.length} frascos (por ${w})`);
    await learn(nuevos);
    if (Object.keys(cambios).length) await commit("eq", d => { d.version = 1; d.codigos ||= {}; for (const [k, n] of Object.entries(cambios)) d.codigos[k] = { nombre: n, por: w, fecha: today() }; }, `Equivalencias de códigos de fabricante (por ${w})`);
  }, "Frascos dados de alta.");
  if (ok) {
    guardarLista([]); pintarLista();
    const m = $("#fo-msg"); if (m) m.textContent = `${nuevos.length} frascos registrados${sumados ? ` (${sumados} sumados a líneas que ya existían)` : ""}. Origen marcado como «Dotación»: cámbialo en la ficha si alguno es una compra.${Object.keys(cambios).length ? ` ${Object.keys(cambios).length} códigos nuevos aprendidos.` : ""}`;
  }
}

function csv() {
  const l = lista(); if (!l.length) return;
  const cab = ["Denominación", "Cantidad", "Ubicación", "Armario", "Tipo de registro", "Categoría", "Origen", "CAS", "Fórmula", "Fabricante", "Referencia del fabricante", "Lote", "Envase", "Caducidad", "Armario de seguridad", "Pictogramas", "Observaciones"];
  const filas = l.map(e => [e.nombre, e.n, e.ubicacion, e.armario, "Reactivos", "Reactivos", "Dotación", e.cas, e.formula, e.fabricante, e.refFabricante, e.lote, e.envase, e.caducidad, e.armarioSeguridad, (e.pictogramas || []).join(" "), [e.notas, e.observaciones].filter(Boolean).join(" · ")]);
  const cel = v => /[;"\n\r]/.test(String(v ?? "")) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? "");
  download(`altas-por-foto-${today()}.csv`, "﻿" + [cab, ...filas].map(r => r.map(cel).join(";")).join("\r\n"), "text/csv;charset=utf-8");
  $("#fo-msg").textContent = "CSV descargado. Se importa en «Importar → Leer un archivo» y las columnas se reconocen solas. La lista sigue aquí hasta que la vacíes.";
}
