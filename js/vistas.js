// Inventario del Departamento — vistas de catálogo de reactivos, importación (PDF, CSV, lista), listados y ajustes (v1.3)

import { VERSION, $, $$, esc, norm, uniq, today, nowISO, finMes, TIPOS, ESTADOS, S, store, commit, sync, guard, who, items, opts, dl, sel, ghsSvg, label, learn, normFecha, cursoActual,
  filtrar, ordenar, cant, filterBar, bindFilters, blank, ensureSub, fld, mismo, minimo, bajoMinimo, download, parseCSV, fillWho, LIBRO, isbnValido, isbnNorm } from "./core.js";
import { apa, ris, tituloCompleto, autorOrden } from "./libros.js";
import { xlsxBlob } from "./xlsx-mini.js";

/* ---------- vista: catálogo de reactivos ---------- */
export function vCatalogo(c) {
  const grupos = uniq(S.cat.map(r => r.grupo)); let g = "", q = "";
  const enInv = r => items().some(i => i.tipo === "Reactivos" && i.estado !== "De baja" && ((r.cas && i.reactivo?.cas === r.cas) || norm(i.denominacion) === norm(r.nombre)));
  c.innerHTML = `<h1>Catálogo de reactivos</h1><p class="muted">Marca los reactivos que tenéis, completa envase, número de envases y ubicación, y añádelos al inventario de una vez. Los que ya están en el inventario aparecen atenuados.</p>
    <div class="cat-layout"><div><input id="c-q" type="search" placeholder="Buscar por nombre, sinónimo, fórmula o CAS" aria-label="Buscar en el catálogo"><div class="chips" id="c-chips"></div><div id="c-list"></div></div>
    <aside class="tray"><h2>Seleccionados (<span id="c-n">0</span>)</h2><div id="c-tray"></div>
    <div class="row" style="margin-top:10px"><button class="btn" id="c-add" disabled>Añadir al inventario</button></div><p class="msg" id="c-msg"></p></aside></div>
    ${dl("dl-ubic", opts("ubicaciones", "ubicacion"))}${dl("dl-armseg", opts("armariosSeguridad"))}`;
  if (!S.cat.length) $("#c-list").innerHTML = `<p class="muted">El catálogo está vacío: falta el archivo <code>data/catalogo-reactivos.json</code> en el repositorio de datos.</p>`;
  $("#c-chips").innerHTML = [["", "Todos"], ...grupos.map(x => [x, x])].map(([v, t]) => `<button class="chip" aria-pressed="${v === g}" data-g="${esc(v)}">${esc(t)}</button>`).join("");
  $("#c-chips").onclick = e => { const b = e.target.closest(".chip"); if (!b) return; g = b.dataset.g; $$(".chip", c).forEach(x => x.setAttribute("aria-pressed", x === b)); draw(); };
  $("#c-q").oninput = e => { q = norm(e.target.value); draw(); };
  const draw = () => {
    if (!S.cat.length) return;
    const qs = q.split(/\s+/).filter(Boolean);
    const list = S.cat.map((r, k) => ({ ...r, k })).filter(r => (!g || r.grupo === g) && qs.every(t => norm([r.nombre, r.sinonimos, r.formula, r.cas].join(" ")).includes(t)));
    $("#c-list").innerHTML = list.map(r => { const ya = enInv(r); return `<div class="crow${S.sel.has(r.k) ? " sel" : ""}${ya ? " have" : ""}" data-k="${r.k}"><input type="checkbox" ${S.sel.has(r.k) ? "checked" : ""} aria-label="Seleccionar ${esc(r.nombre)}">
      <div><strong>${esc(r.nombre)}</strong>${ya ? ` <span class="pill">ya en inventario</span>` : ""}${r.sinonimos ? `<div class="sub">${esc(r.sinonimos)}</div>` : ""}<div class="sub"><span class="mono">${esc(r.formula)}</span> ${r.cas ? `· <span class="mono">CAS ${esc(r.cas)}</span>` : ""} ${r.notas ? `· <span class="pill warn">${esc(r.notas)}</span>` : ""}</div></div>
      <div>${(r.pictogramas || []).map(ghsSvg).join("")}</div></div>`; }).join("") || `<p class="muted">Ningún reactivo coincide. Puedes darlo de alta a mano desde «Nuevo elemento» con tipo Reactivos.</p>`;
  };
  $("#c-list").onclick = e => {
    const row = e.target.closest(".crow"); if (!row) return; const k = +row.dataset.k;
    if (S.sel.has(k)) S.sel.delete(k); else S.sel.set(k, { envase: "", n: 1, ubic: store.get("inv.lastUbic") || "Laboratorio", armseg: "" });
    draw(); tray();
  };
  const tray = () => {
    $("#c-n").textContent = S.sel.size; $("#c-add").disabled = !S.sel.size;
    $("#c-tray").innerHTML = [...S.sel].filter(([k]) => S.cat[k]).map(([k, v]) => `<div class="it" data-k="${k}"><div class="row" style="justify-content:space-between"><strong>${esc(S.cat[k].nombre)}</strong><button class="btn ghost small" data-x="${k}" aria-label="Quitar">✕</button></div>
      <div class="f3"><input data-f="envase" value="${esc(v.envase)}" placeholder="Envase (500 g)" aria-label="Envase"><input data-f="ubic" value="${esc(v.ubic)}" list="dl-ubic" aria-label="Ubicación"><input data-f="n" type="number" min="1" value="${esc(v.n)}" aria-label="N.º de envases"></div>
      <input data-f="armseg" value="${esc(v.armseg)}" list="dl-armseg" placeholder="Armario de seguridad (opcional)" style="margin-top:6px;padding:4px 6px;font-size:.85rem" aria-label="Armario de seguridad"></div>`).join("") || `<p class="muted small">Marca reactivos en la lista.</p>`;
  };
  $("#c-tray").oninput = e => { const it = e.target.closest(".it"); if (it) S.sel.get(+it.dataset.k)[e.target.dataset.f] = e.target.value; };
  $("#c-tray").onclick = e => { const x = e.target.dataset.x; if (x !== undefined) { S.sel.delete(+x); draw(); tray(); } };
  $("#c-add").onclick = async () => {
    const w = await who(); if (!w) return;
    const nuevos = [...S.sel].filter(([k]) => S.cat[k]).map(([k, v]) => { const r = S.cat[k]; const i = blank("Reactivos"); Object.assign(i, { categoria: "Reactivos", denominacion: r.nombre, cantidad: Math.max(1, Math.round(+v.n) || 1), ubicacion: v.ubic.trim() || "Laboratorio", origen: "Dotación", observaciones: r.notas || "" }); Object.assign(i.reactivo, { formula: r.formula || "", cas: r.cas || "", envase: v.envase.trim(), pictogramas: [...(r.pictogramas || [])], armarioSeguridad: v.armseg.trim() }); i.historial = [{ fecha: nowISO(), por: w, accion: "Alta desde el catálogo" }]; return i; });
    if (!nuevos.length) return;
    const ok = await guard(async () => { await commit("inv", d => { d.items.push(...nuevos); }, `Alta de ${nuevos.length} reactivos desde el catálogo (por ${w})`); await learn(nuevos); }, `${nuevos.length} reactivos añadidos.`);
    if (ok) { store.set("inv.lastUbic", nuevos[0].ubicacion, true); S.sel.clear(); $("#c-msg").textContent = `${nuevos.length} reactivos añadidos al inventario. Origen marcado como «Dotación»: cámbialo en la ficha si alguno es una compra.`; draw(); tray(); }
  };
  draw(); tray();
}

/* ---------- vista: importar ---------- */
const CAMPOS = [["ref", "N.º referencia"], ["denominacion", "Denominación *"], ["especificacion", "Especificación"], ["marca", "Marca / modelo"], ["cantidad", "Cantidad"], ["cantidadIndeterminada", "Cantidad indeterminada (Sí)"], ["ubicacion", "Ubicación"], ["armario", "Armario"], ["tipo", "Tipo de registro"], ["categoria", "Categoría"], ["estado", "Estado"], ["origen", "Origen (Compra / Dotación)"], ["fechaAlta", "Fecha de alta"], ["fechaBaja", "Fecha de baja"], ["motivoBaja", "Motivo de baja"], ["codigoProveedor", "Código de artículo del proveedor"], ["precio", "Precio unitario"], ["observaciones", "Observaciones"], ["r.cas", "CAS (reactivos)"], ["r.formula", "Fórmula (reactivos)"], ["r.fabricante", "Fabricante (reactivos)"], ["r.refFabricante", "Código del fabricante (reactivos)"], ["r.lote", "Lote (reactivos)"], ["r.envase", "Envase (reactivos)"], ["r.fechaCaducidad", "Caducidad (reactivos)"], ["r.armarioSeguridad", "Armario de seguridad (reactivos)"], ["r.pictogramas", "Pictogramas SGA (reactivos)"],
  ["b.isbn", "ISBN / ISSN (libros)"], ["b.autores", "Autores (libros)"], ["b.editorial", "Editorial (libros)"], ["b.anio", "Año (libros)"], ["b.edicion", "Edición (libros)"], ["b.idioma", "Idioma (libros)"], ["b.materia", "Materia (libros)"], ["b.tipoPublicacion", "Tipo de publicación (libros)"]];
// Nombres de columna habituales para proponer la correspondencia (primero coincidencia exacta; después, por comienzo)
const SIN = { ref: ["n.º referencia", "nº referencia", "n. referencia", "referencia", "n.º ref.", "ref.", "ref"], denominacion: ["denominacion", "descripcion", "articulo", "concepto", "material", "producto", "nombre", "titulo", "title"], especificacion: ["especificacion"], marca: ["marca"], cantidad: ["cantidad", "unidades", "uds", "ud.", "cant"], cantidadIndeterminada: ["cantidad indeterminada"], ubicacion: ["ubicacion"], armario: ["armario"], tipo: ["tipo de registro", "tipo"], categoria: ["categoria"], estado: ["estado"], origen: ["origen", "dotacion / compra", "dotacion/compra", "dotacion"], fechaAlta: ["fecha de alta", "fecha alta", "f. alta"], fechaBaja: ["fecha de baja", "fecha baja", "f. baja"], motivoBaja: ["motivo de baja", "motivo"], codigoProveedor: ["codigo", "cod."], precio: ["precio unitario", "precio", "p. unit", "pvp"], observaciones: ["observaciones"], "r.cas": ["cas", "n.º cas"], "r.formula": ["formula"],
  "r.fabricante": ["fabricante"], "r.refFabricante": ["referencia del fabricante", "codigo del fabricante", "ref. fabricante"], "r.lote": ["lote", "n.º de lote", "lot"], "r.envase": ["envase", "envase y contenido", "contenido"], "r.fechaCaducidad": ["caducidad", "fecha de caducidad"], "r.armarioSeguridad": ["armario de seguridad"], "r.pictogramas": ["pictogramas", "pictogramas sga"],
  "b.isbn": ["isbn", "issn", "isbn/issn", "isbn / issn"], "b.autores": ["autores", "autor", "author", "authors"], "b.editorial": ["editorial", "publisher"], "b.anio": ["ano", "anio", "year", "publication year", "ano de edicion"], "b.edicion": ["edicion", "edition"], "b.idioma": ["idioma", "lengua", "language"], "b.materia": ["materia", "tema"], "b.tipoPublicacion": ["tipo de publicacion"] };
const CAB = ["denominacion", "descripcion", "articulo", "concepto", "cantidad", "unidades", "ubicacion", "referencia", "n.º ref", "codigo", "precio", "importe"];
const numero = s => { const t = String(s).replace(/[\s€]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."); return t !== "" && isFinite(+t) ? +t : null; };
const frase = s => /[A-ZÁÉÍÓÚÑ]/.test(s) && s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s;

export function vImportar(c) {
  c.innerHTML = `<h1>Importar</h1>
  <div class="sheet"><h2>Leer un archivo (PDF o CSV)</h2><p class="muted">Listados de material o facturas en PDF digital, o tablas en CSV. El archivo se lee en este navegador y no se envía a ningún sitio. Después indicas qué columna es cada campo y revisas las filas una a una antes de guardar nada.</p>
   <input id="imp-file" type="file" accept=".pdf,.csv,application/pdf,text/csv" aria-label="Archivo PDF o CSV"><p class="msg" id="imp-msg" role="status"></p><div id="imp-out"></div></div>
  <div class="sheet" style="margin-top:16px"><h2>Pegar una lista</h2><p class="muted">Un elemento por línea. Si empieza por un número, se toma como cantidad («3 Vaso de precipitados 250 mL»). Los reactivos se buscan en el catálogo para completar fórmula, CAS y pictogramas.</p>
   <div class="grid"><div><label for="p-tipo">Tipo</label>${sel("p-tipo", TIPOS, "Reactivos", null)}</div>${fld("p-ubic", "Ubicación", store.get("inv.lastUbic") || "Laboratorio", 'list="dl-ubic"')}${fld("p-cat", "Categoría", "Reactivos", 'list="dl-cat"')}</div>
   <label for="p-text">Lista</label><textarea id="p-text" rows="8" placeholder="Sulfato de cobre pentahidratado&#10;2 Hidróxido de sodio&#10;Azul de metileno"></textarea>
   <div class="row" style="margin-top:10px"><button class="btn" id="p-prev" type="button">Revisar antes de importar</button></div><div id="p-out"></div></div>
   ${dl("dl-ubic", opts("ubicaciones", "ubicacion"))}${dl("dl-cat", opts("categorias", "categoria"))}${dl("dl-prov", opts("proveedores", "proveedor"))}`;

  /* --- pegar lista --- */
  const matchCat = name => { const n = norm(name); if (!n) return null; return S.cat.find(r => norm(r.nombre) === n) || S.cat.find(r => norm(r.sinonimos).split(/,\s*/).includes(n)) || S.cat.find(r => norm(r.nombre).startsWith(n) || n.startsWith(norm(r.nombre))) || null; };
  $("#p-tipo").onchange = e => { const cat = $("#p-cat"); if (e.target.value !== "Reactivos" && cat.value === "Reactivos") cat.value = ""; };
  $("#p-prev").onclick = () => {
    const tipo = $("#p-tipo").value, ubic = $("#p-ubic").value.trim(), cat = $("#p-cat").value.trim();
    const rows = $("#p-text").value.split(/\n/).map(l => l.trim()).filter(Boolean).map(l => { const m = /^(\d+)\s+(.+)$/.exec(l); const name = m ? m[2] : l; return { n: m ? +m[1] : 1, name, m: tipo === "Reactivos" ? matchCat(name) : null }; });
    if (!rows.length) return;
    if (!ubic) { $("#p-out").innerHTML = `<p class="msg err">Indica la ubicación.</p>`; return; }
    $("#p-out").innerHTML = `<div class="tablewrap" style="margin-top:12px"><table><thead><tr><th>Cant.</th><th>Escrito</th><th>Se registrará como</th></tr></thead><tbody>${rows.map(r => `<tr><td class="num">${r.n}</td><td>${esc(r.name)}</td><td>${r.m ? `<strong>${esc(r.m.nombre)}</strong> <span class="sub mono">${esc(r.m.cas)}</span>` : tipo === "Reactivos" ? `${esc(r.name)} <span class="pill warn">no está en el catálogo</span>` : esc(r.name)}</td></tr>`).join("")}</tbody></table></div>
      <div class="row" style="margin-top:10px"><button class="btn" id="p-go" type="button">Importar ${rows.length} elementos</button></div>`;
    $("#p-go").onclick = async () => {
      const w = await who(); if (!w) return;
      const nuevos = rows.map(r => { const i = blank(tipo); Object.assign(i, { denominacion: r.m?.nombre || r.name, cantidad: r.n, ubicacion: ubic, categoria: cat, origen: "Dotación" }); if (i.reactivo && r.m) Object.assign(i.reactivo, { formula: r.m.formula || "", cas: r.m.cas || "", pictogramas: [...(r.m.pictogramas || [])] }); i.historial = [{ fecha: nowISO(), por: w, accion: "Alta por lista pegada" }]; return i; });
      const ok = await guard(async () => { await commit("inv", d => { d.items.push(...nuevos); }, `Alta de ${nuevos.length} elementos por lista (por ${w})`); await learn(nuevos); }, `${nuevos.length} elementos importados.`);
      if (ok) { store.set("inv.lastUbic", ubic, true); $("#p-out").innerHTML = `<p class="msg">${nuevos.length} elementos importados.</p>`; $("#p-text").value = ""; }
    };
  };

  /* --- archivo PDF o CSV --- */
  const msg = (t, err) => { const m = $("#imp-msg"); m.className = "msg" + (err ? " err" : ""); m.textContent = t; };
  $("#imp-file").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    $("#imp-out").innerHTML = ""; let head, data, pdf = false;
    try {
      if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") {
        pdf = true; msg("Leyendo el PDF…");
        const { pdfTable } = await import("./pdf-import.js");
        const t = await pdfTable(f);
        if (!t.rows.length) return msg("Este PDF no contiene texto: parece escaneado. Hace falta un PDF digital.", true);
        if (t.cols < 2) { $("#p-text").value = t.rows.map(r => r[0]).join("\n"); $("#p-tipo").value = "Material de laboratorio reutilizable"; $("#p-cat").value = ""; $("#p-text").scrollIntoView({ block: "center" }); return msg(`No se han detectado columnas. Las ${t.rows.length} líneas del PDF se han copiado en «Pegar una lista», más abajo, para que las revises.`); }
        const hi = t.rows.slice(0, 30).findIndex(r => r.filter(x => CAB.some(w => norm(x).startsWith(w))).length >= 2);
        if (hi >= 0) { head = t.rows[hi]; const key = head.join("|"); data = t.rows.slice(hi + 1).filter(r => r.join("|") !== key); }
        else { head = t.rows[0].map((_, j) => `Columna ${j + 1}`); data = t.rows; }
        msg(`PDF leído: ${t.pages} ${t.pages === 1 ? "página" : "páginas"}, ${data.length} filas y ${head.length} columnas detectadas.`);
      } else {
        const rows = parseCSV((await f.text()).replace(/^﻿/, ""));
        if (rows.length < 2) return msg("El archivo no tiene filas de datos.", true);
        head = rows[0]; data = rows.slice(1).filter(r => r.some(x => x.trim()));
        msg(`${data.length} filas, ${head.length} columnas.`);
      }
    } catch (e2) { console.error(e2); return msg("No se ha podido leer el archivo: " + (e2.message || e2), true); }
    mapper(head, data, f.name, pdf);
  };

  function mapper(head, data, fname, pdf) {
    const used = new Set(), g = {};
    for (const paso of [0, 1]) for (const [k] of CAMPOS) {
      if (g[k] !== undefined) continue;
      for (const s of SIN[k] || []) { const j = head.findIndex((h, jj) => !used.has(jj) && (paso ? norm(h).startsWith(s) : norm(h) === s)); if (j >= 0) { g[k] = j; used.add(j); break; } }
    }
    const ej = j => { const v = data.find(r => String(r[j] ?? "").trim())?.[j]; return v ? ` — p. ej. «${String(v).trim().slice(0, 28)}»` : ""; };
    $("#imp-out").innerHTML = `<h3 style="margin-top:14px">1. ¿Qué es cada columna?</h3><div class="grid">${CAMPOS.map(([k, t]) => `<div><label for="m-${k}">${t}</label><select id="m-${k}" data-k="${k}"><option value="-1">— no importar —</option>${head.map((h, j) => `<option value="${j}"${g[k] === j ? " selected" : ""}>${esc(h + ej(j))}</option>`).join("")}</select></div>`).join("")}</div>
      <h3 style="margin-top:14px">2. Valores para lo que el archivo no trae</h3>
      <div class="grid"><div><label for="m-deftipo">Tipo</label>${sel("m-deftipo", TIPOS, "Material de laboratorio reutilizable", null)}</div>${fld("m-defcat", "Categoría", "", 'list="dl-cat"')}${fld("m-defubic", "Ubicación", store.get("inv.lastUbic") || "Laboratorio", 'list="dl-ubic"')}
        <div><label for="m-deforigen">Origen</label>${sel("m-deforigen", ["Compra", "Dotación"], pdf ? "Compra" : "", "(sin indicar)")}</div>${fld("m-defprov", "Proveedor (facturas)", "", 'list="dl-prov"')}${fld("m-deffact", "N.º de factura", "")}${fld("m-defalta", "Fecha de alta", "", 'type="date"')}</div>
      <label class="check"><input type="checkbox" id="m-minus" checked> Pasar a minúsculas las denominaciones escritas en MAYÚSCULAS</label>
      <div class="row" style="margin-top:10px"><button class="btn" id="m-rev" type="button">Revisar las filas</button></div><div id="m-out"></div>`;
    $("#m-rev").onclick = () => {
      const map = Object.fromEntries($$("select[data-k]", $("#imp-out")).map(s => [s.dataset.k, +s.value]));
      const out = $("#m-out");
      if (map.denominacion < 0) { out.innerHTML = `<p class="msg err">Indica qué columna es la denominación.</p>`; return; }
      const get = (r, k) => map[k] >= 0 ? String(r[map[k]] ?? "").trim() : "";
      const def = { tipo: $("#m-deftipo").value, cat: $("#m-defcat").value.trim(), ubic: $("#m-defubic").value.trim(), origen: $("#m-deforigen").value, prov: $("#m-defprov").value.trim(), fact: $("#m-deffact").value.trim(), alta: $("#m-defalta").value };
      const minus = $("#m-minus").checked, nuevos = [];
      for (const r of data) {
        const llenas = r.map(x => String(x ?? "").trim()).filter(Boolean);
        if (pdf && llenas.length === 1) { // pies de página y denominaciones partidas en dos líneas
          if (/^(p[aá]g(ina)?\.?\s*\d+.*|\d+\s*(\/|de)\s*\d+)$/i.test(llenas[0])) continue;
          if (nuevos.length && get(r, "denominacion")) { nuevos[nuevos.length - 1].denominacion += " " + get(r, "denominacion"); continue; }
        }
        const den = get(r, "denominacion"); if (!den) continue;
        const tipo = TIPOS.find(t => norm(t) === norm(get(r, "tipo"))) || def.tipo, i = blank(tipo), cn = get(r, "cantidad"), n = numero(cn);
        const indet = /^(s[ií]|x|true|varios)$/i.test(get(r, "cantidadIndeterminada")) || (cn !== "" && n == null);
        const fa = normFecha(get(r, "fechaAlta")), fb = normFecha(get(r, "fechaBaja")), est = ESTADOS.find(x => norm(x) === norm(get(r, "estado")));
        const og = norm(get(r, "origen")), obs = [get(r, "observaciones"), fa === null && `Fecha de alta original: ${get(r, "fechaAlta")}`, fb === null && `Fecha de baja original: ${get(r, "fechaBaja")}`].filter(Boolean).join(" · ");
        Object.assign(i, { ref: get(r, "ref"), categoria: get(r, "categoria") || def.cat, denominacion: den, especificacion: get(r, "especificacion"), marca: get(r, "marca"),
          cantidad: indet ? null : (n != null && n >= 0 ? n : (cn === "" && map.cantidad >= 0 ? null : 1)), cantidadIndeterminada: indet, ubicacion: get(r, "ubicacion") || def.ubic, armario: get(r, "armario"),
          estado: est || (fb ? "De baja" : "Operativo"), origen: og.startsWith("compra") ? "Compra" : og.startsWith("dotac") ? "Dotación" : def.origen, fechaAlta: fa || def.alta || "", fechaBaja: fb || "", motivoBaja: get(r, "motivoBaja"),
          proveedor: def.prov, factura: def.fact, codigoProveedor: get(r, "codigoProveedor"), precio: numero(get(r, "precio")), observaciones: obs });
        if (i.reactivo) {
          const cad = normFecha(get(r, "r.fechaCaducidad"));
          Object.assign(i.reactivo, { cas: get(r, "r.cas"), formula: get(r, "r.formula"), fabricante: get(r, "r.fabricante"), refFabricante: get(r, "r.refFabricante"), lote: get(r, "r.lote"), envase: get(r, "r.envase"),
            fechaCaducidad: finMes(cad || ""), armarioSeguridad: get(r, "r.armarioSeguridad"), pictogramas: uniq(get(r, "r.pictogramas").toUpperCase().match(/GHS0\d/g) || []) });
          if (cad === null) i.observaciones = [i.observaciones, `Caducidad original: ${get(r, "r.fechaCaducidad")}`].filter(Boolean).join(" · ");
        }
        if (i.libro) {
          const isbn = get(r, "b.isbn");
          // en exportaciones de Zotero o LibraryThing los autores van separados por «;» o «,»; se respeta el «;»
          Object.assign(i.libro, { isbn: isbn && isbnValido(isbn) ? isbnNorm(isbn) : isbn, autores: get(r, "b.autores").split(/\s*;\s*/).filter(Boolean).map(autorOrden).join("; "), editorial: get(r, "b.editorial"),
            anio: (/\d{4}/.exec(get(r, "b.anio")) || [""])[0], edicion: get(r, "b.edicion"), idioma: get(r, "b.idioma"), materia: get(r, "b.materia"), tipoPublicacion: get(r, "b.tipoPublicacion") });
          if (!i.categoria) i.categoria = "Biblioteca";
        }
        nuevos.push(i);
      }
      if (minus) nuevos.forEach(i => { i.denominacion = frase(i.denominacion); });
      if (!nuevos.length) { out.innerHTML = `<p class="msg err">Con esa correspondencia no sale ninguna fila con denominación.</p>`; return; }
      const dup = i => (i.ref && items().some(x => x.ref === i.ref)) ? `ya existe la referencia ${i.ref}` : items().some(x => x.estado !== "De baja" && mismo(x, i)) ? "ya hay una línea igual en esa ubicación" : "";
      const notas = nuevos.map(dup), nd = notas.filter(Boolean).length;
      out.innerHTML = `<h3 style="margin-top:14px">3. Revisa las filas</h3><p class="muted small">Puedes corregir la denominación y la cantidad, y desmarcar lo que no deba entrar.${nd ? ` <strong>${nd} filas parecen estar ya en el inventario</strong> y salen desmarcadas.` : ""}</p>
        <div class="tablewrap rev"><table><thead><tr><th><input type="checkbox" id="rv-all" aria-label="Marcar todas" ${nd ? "" : "checked"}></th><th>N.º ref.</th><th>Denominación</th><th>Especificación · marca</th><th>Cant.</th><th>Ubicación</th><th>Aviso</th></tr></thead><tbody>${nuevos.map((i, k) => `<tr>
          <td><input type="checkbox" data-rv="${k}" ${notas[k] ? "" : "checked"} aria-label="Importar fila ${k + 1}"></td><td class="mono">${esc(i.ref)}</td>
          <td><input data-den="${k}" value="${esc(i.denominacion)}" aria-label="Denominación"></td><td class="sub">${esc([i.especificacion, i.marca].filter(Boolean).join(" · "))}</td>
          <td><input data-cn="${k}" type="number" min="0" step="any" value="${esc(i.cantidad ?? "")}" ${i.cantidadIndeterminada ? 'placeholder="varios"' : ""} aria-label="Cantidad" style="width:76px"></td>
          <td>${esc(i.ubicacion)}</td><td>${notas[k] ? `<span class="pill warn">${esc(notas[k])}</span>` : i.estado === "De baja" ? `<span class="pill baja">de baja</span>` : ""}</td></tr>`).join("")}</tbody></table></div>
        <div class="row" style="margin-top:10px"><button class="btn" id="m-go" type="button">Importar las filas marcadas</button><span class="muted small" id="rv-n"></span></div><p class="msg" id="m-msg"></p>`;
      const count = () => { $("#rv-n").textContent = `${$$("input[data-rv]:checked", out).length} de ${nuevos.length} filas marcadas`; };
      $("#rv-all").onchange = e => { $$("input[data-rv]", out).forEach(x => x.checked = e.target.checked); count(); };
      out.onchange = count; count();
      $("#m-go").onclick = async () => {
        const w = await who(); if (!w) return;
        const elegidos = $$("input[data-rv]:checked", out).map(x => +x.dataset.rv).map(k => {
          const i = nuevos[k], den = $(`input[data-den="${k}"]`, out).value.trim(), cn = $(`input[data-cn="${k}"]`, out).value;
          i.denominacion = den; if (cn !== "") { i.cantidad = +cn; i.cantidadIndeterminada = false; } else if (!i.cantidadIndeterminada) i.cantidad = null;
          i.historial = [{ fecha: nowISO(), por: w, accion: `Alta por importación de ${fname}` }]; return i;
        }).filter(i => i.denominacion);
        if (!elegidos.length) { $("#m-msg").textContent = "No hay ninguna fila marcada."; return; }
        if (elegidos.some(i => !i.ubicacion)) { $("#m-msg").className = "msg err"; $("#m-msg").textContent = "Hay filas sin ubicación: indica una ubicación en el paso 2 y vuelve a «Revisar las filas»."; return; }
        const ok = await guard(async () => { await commit("inv", d => { d.items.push(...elegidos); }, `Importación de ${fname}: ${elegidos.length} elementos (por ${w})`); await learn(elegidos); }, `${elegidos.length} elementos importados.`);
        if (ok) { store.set("inv.lastUbic", def.ubic, true); $("#imp-out").innerHTML = ""; $("#imp-file").value = ""; msg(`${elegidos.length} elementos importados de ${fname}.`); }
      };
    };
  }
}

/* ---------- vista: listados y exportación ---------- */
const lugar = i => [i.ubicacion, i.armario].filter(Boolean).join(" · ");
const FORMATOS = {
  completo: { t: "Listado completo", cols: [["N.º ref.", i => i.ref], ["Tipo", i => i.tipo], ["Categoría", i => i.categoria], ["Denominación", i => i.denominacion], ["Especificación", i => i.especificacion], ["Marca / modelo", i => i.marca], ["Cantidad", cant], ["Ubicación", i => i.ubicacion], ["Armario", i => i.armario], ["Estado", i => i.estado], ["Origen", i => i.origen], ["Proveedor", i => i.proveedor], ["Fecha alta", i => i.fechaAlta], ["Fecha baja", i => i.fechaBaja], ["Motivo baja", i => i.motivoBaja], ["Observaciones", i => i.observaciones]] },
  secretaria: { t: "Formato Secretaría", cols: [["N.º Referencia", i => i.ref], ["Denominación", label], ["Cantidad", cant], ["Ubicación", i => i.ubicacion], ["Dotación / Compra", i => i.origen], ["Fecha Alta", i => i.fechaAlta], ["Fecha Baja", i => i.fechaBaja]] },
  recuento: { t: "Hoja de recuento (comprobación física)", grupo: "ubicacion", cols: [["Ubicación", lugar], ["N.º ref.", i => i.ref], ["Denominación", label], ["Cantidad registrada", cant], ["Cantidad real", () => ""], ["Estado / observaciones", () => ""]] },
  reactivos: { t: "Reactivos", filtro: i => i.tipo === "Reactivos", cols: [["Reactivo", i => i.denominacion], ["Fórmula", i => i.reactivo?.formula], ["CAS", i => i.reactivo?.cas], ["Envase", i => i.reactivo?.envase], ["N.º envases", cant], ["Ubicación", lugar], ["Armario de seguridad", i => i.reactivo?.armarioSeguridad], ["Pictogramas", i => (i.reactivo?.pictogramas || []).join(" ")], ["Caducidad", i => i.reactivo?.fechaCaducidad], ["Observaciones", i => i.observaciones]] },
  fungible: { t: "Material fungible", filtro: i => i.tipo === "Material fungible", cols: [["Denominación", label], ["Cantidad", cant], ["Unidad", i => i.fungible?.unidadStock], ["Uds. por envase", i => i.fungible?.unidadesEnvase], ["Stock mínimo", i => i.fungible?.stockMinimo], ["Caducidad", i => i.fungible?.caducidad], ["Ubicación", lugar], ["Proveedor", i => i.proveedor]] },
  reposicion: { t: "Reposición (por debajo del mínimo)", filtro: bajoMinimo, cols: [["Denominación", label], ["Tipo", i => i.tipo], ["Cantidad actual", cant], ["Stock mínimo", minimo], ["Unidad / envase", i => i.fungible?.unidadStock || i.reactivo?.envase], ["Proveedor", i => i.proveedor], ["Código proveedor", i => i.codigoProveedor], ["Ubicación", lugar]] },
  biblioteca: { t: "Biblioteca del departamento", filtro: i => i.tipo === LIBRO, cols: [["Título", tituloCompleto], ["Autores", i => i.libro?.autores], ["Editorial", i => i.libro?.editorial], ["Año", i => i.libro?.anio], ["Edición", i => i.libro?.edicion], ["ISBN / ISSN", i => i.libro?.isbn], ["Idioma", i => i.libro?.idioma], ["Tipo", i => i.libro?.tipoPublicacion], ["Materia", i => i.libro?.materia], ["Nivel", i => (i.libro?.niveles || []).join(", ")], ["Ejemplares", cant], ["Ubicación", lugar]] },
  apa: { t: "Bibliografía (APA 7)", filtro: i => i.tipo === LIBRO, cols: [["Referencia (APA 7)", i => apa(i).texto]] },
  colecciones: { t: "Colecciones con ejemplares", filtro: i => i.tipo === "Colecciones", cols: [["Colección / ejemplar", i => i._ej ? "   " + [i._ej.n, i._ej.nombre].filter(Boolean).join(" · ") : label(i)], ["Tipo / clasificación", i => i._ej ? i._ej.clasificacion : i.coleccion?.tipoColeccion], ["N.º ejemplares / localidad", i => i._ej ? i._ej.localidad : (i.coleccion?.ejemplares?.length || i.coleccion?.nEjemplares || "")], ["Edad", i => i._ej?.edad], ["Estado", i => i._ej ? i._ej.estado : i.estado], ["Ubicación", i => i._ej ? "" : lugar(i)]] }
};
const GRUPOS = { "": "Sin agrupar", ubicacion: "Ubicación", categoria: "Categoría", tipo: "Tipo de registro", materia: "Materia (libros)", tipoPublicacion: "Tipo de publicación (libros)" };
// Los dos últimos agrupamientos leen datos de la ficha de libro
const gval = (i, g) => (g === "materia" || g === "tipoPublicacion" ? i.libro?.[g] : i[g]) ?? "";
const ORDENES = { denominacion: "Denominación", ref: "N.º de referencia", ubicacion: "Ubicación", categoria: "Categoría", fechaAlta: "Fecha de alta", fechaBaja: "Fecha de baja" };

export function vListados(c, preset) {
  const f = { q: "", tipo: "", cat: "", ubic: "", estado: "activos" };
  let fmt = FORMATOS[preset] ? preset : "completo", grupo = FORMATOS[fmt].grupo || "", ordenK = "denominacion", desde = "", hasta = "", campoFecha = "fechaAlta", bajasCurso = false;
  const [ci, cf, cl] = cursoActual();
  c.innerHTML = `<h1>Listados</h1>
   <div class="row" style="margin-bottom:10px"><span class="muted small">Listados frecuentes:</span><button class="btn ghost small" id="l-anual" type="button">Inventario anual para Secretaría (${cl})</button><button class="btn ghost small" id="l-curso" type="button">Bajas del curso ${cl}</button><button class="btn ghost small" id="l-rec" type="button">Hoja de recuento por ubicación</button><button class="btn ghost small" id="l-rep" type="button">Reposición</button></div>
   ${filterBar(f, "l-")}
   <div class="grid" style="margin-bottom:10px"><div><label for="l-fmt">Formato</label><select id="l-fmt">${Object.entries(FORMATOS).map(([k, v]) => `<option value="${k}">${v.t}</option>`).join("")}</select></div>
    <div><label for="l-grupo">Agrupar por</label><select id="l-grupo">${Object.entries(GRUPOS).map(([k, t]) => `<option value="${k}">${t}</option>`).join("")}</select></div>
    <div><label for="l-orden">Ordenar por</label><select id="l-orden">${Object.entries(ORDENES).map(([k, t]) => `<option value="${k}">${t}</option>`).join("")}</select></div>
    <div><label for="l-campo">Filtrar por fecha de</label><select id="l-campo"><option value="fechaAlta">alta</option><option value="fechaBaja">baja</option></select></div>
    ${fld("l-desde", "Desde", "", 'type="date"')}${fld("l-hasta", "Hasta", "", 'type="date"')}</div>
   <label class="check"><input type="checkbox" id="l-bc"> Añadir también las bajas del curso ${cl} (con su fecha de baja)</label>
   <div class="row" style="margin-top:10px"><button class="btn" id="l-pdf" type="button">PDF / imprimir</button><button class="btn ghost" id="l-xlsx" type="button">Excel</button><button class="btn ghost" id="l-csv" type="button">CSV</button><button class="btn ghost" id="l-ris" type="button" title="Para Zotero, Mendeley o EndNote" hidden>RIS (Zotero)</button><span class="muted small" id="l-n"></span></div>
   <p class="muted small">Para el PDF, elige «Guardar como PDF» en la ventana de impresión. Sale en horizontal.</p>
   <div class="tablewrap" style="margin-top:10px"><table id="l-prev"></table></div>`;
  const rows = () => {
    const conBajas = bajasCurso && f.estado === "activos";
    let l = filtrar(items(), conBajas ? { ...f, estado: "todos" } : f);
    if (conBajas) l = l.filter(i => i.estado !== "De baja" || (i.fechaBaja >= ci.slice(0, 7) && i.fechaBaja <= cf));
    if (desde) l = l.filter(i => (i[campoFecha] || "") >= desde); if (hasta) l = l.filter(i => i[campoFecha] && i[campoFecha] <= hasta);
    if (FORMATOS[fmt].filtro) l = l.filter(FORMATOS[fmt].filtro);
    l = ordenar(l, { k: ordenK, dir: 1 });
    if (fmt === "apa") { const vistos = new Set(); l = l.map(i => [i, apa(i).texto]).filter(([, t]) => !vistos.has(t) && vistos.add(t)).sort((a, b) => a[1].localeCompare(b[1], "es", { sensitivity: "base" })).map(([i]) => i); } // el mismo libro en dos ubicaciones sale una sola vez
    if (grupo) l.sort((a, b) => String(gval(a, grupo)).localeCompare(String(gval(b, grupo)), "es", { numeric: true }));
    if (fmt === "colecciones") l = l.flatMap(i => [i, ...(i.coleccion?.ejemplares || []).map(e => ({ ...i, _ej: e }))]);
    return l;
  };
  const table = l => {
    const cols = FORMATOS[fmt].cols, n = {}; let prev;
    if (grupo) for (const i of l) n[gval(i, grupo)] = (n[gval(i, grupo)] || 0) + 1;
    return `<thead><tr>${cols.map(([t]) => `<th>${esc(t)}</th>`).join("")}</tr></thead><tbody>${l.map(i => {
      const k = gval(i, grupo), cab = grupo && k !== prev ? `<tr class="grp"><td colspan="${cols.length}">${esc(GRUPOS[grupo])}: ${esc(k || "(sin indicar)")} · ${n[k]} líneas</td></tr>` : ""; prev = k;
      return `${cab}<tr>${cols.map(([, g]) => `<td>${esc(g(i) ?? "")}</td>`).join("")}</tr>`;
    }).join("")}</tbody>`;
  };
  const uds = l => l.reduce((s, i) => s + (i._ej || i.cantidadIndeterminada ? 0 : +i.cantidad || 0), 0);
  const draw = () => { const l = rows(); $("#l-n").textContent = `${l.length} líneas · ${uds(l)} unidades`; $("#l-prev").innerHTML = table(l.slice(0, 60)) + (l.length > 60 ? `<tfoot><tr><td colspan="${FORMATOS[fmt].cols.length}" class="muted">Vista previa de las primeras 60 líneas de ${l.length}.</td></tr></tfoot>` : "") || ""; };
  const pinta = () => { $("#l-ris").hidden = !["biblioteca", "apa"].includes(fmt); $("#l-fmt").value = fmt; $("#l-grupo").value = grupo; $("#l-orden").value = ordenK; $("#l-campo").value = campoFecha; $("#l-desde").value = desde; $("#l-hasta").value = hasta; $("#l-bc").checked = bajasCurso; $("#l-estado").value = f.estado; $("#l-tipo").value = f.tipo; draw(); };
  bindFilters(f, "l-", draw);
  $("#l-fmt").onchange = e => { fmt = e.target.value; grupo = FORMATOS[fmt].grupo || ""; pinta(); };
  $("#l-grupo").onchange = e => { grupo = e.target.value; draw(); };
  $("#l-orden").onchange = e => { ordenK = e.target.value; draw(); };
  $("#l-campo").onchange = e => { campoFecha = e.target.value; draw(); };
  $("#l-desde").onchange = e => { desde = e.target.value; draw(); };
  $("#l-hasta").onchange = e => { hasta = e.target.value; draw(); };
  $("#l-bc").onchange = e => { bajasCurso = e.target.checked; draw(); };
  const base = () => { desde = ""; hasta = ""; campoFecha = "fechaAlta"; bajasCurso = false; f.estado = "activos"; f.tipo = ""; grupo = ""; ordenK = "denominacion"; };
  $("#l-anual").onclick = () => { base(); fmt = "secretaria"; bajasCurso = true; pinta(); };
  $("#l-curso").onclick = () => { base(); fmt = "secretaria"; campoFecha = "fechaBaja"; desde = ci; hasta = cf; f.estado = "De baja"; ordenK = "fechaBaja"; pinta(); };
  $("#l-rec").onclick = () => { base(); fmt = "recuento"; grupo = "ubicacion"; pinta(); };
  $("#l-rep").onclick = () => { base(); fmt = "reposicion"; pinta(); };
  const matrix = () => { const cols = FORMATOS[fmt].cols; return [cols.map(([t]) => t), ...rows().map(i => cols.map(([, g]) => { const v = g(i); return v == null ? "" : v; }))]; };
  const fname = ext => `inventario-${fmt}-${today()}.${ext}`;
  $("#l-csv").onclick = () => download(fname("csv"), "﻿" + matrix().map(r => r.map(v => /[;"\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(";")).join("\r\n"), "text/csv;charset=utf-8");
  $("#l-ris").onclick = () => download(fname("ris"), ris(rows()), "application/x-research-info-systems");
  $("#l-xlsx").onclick = () => download(fname("xlsx"), xlsxBlob(matrix(), FORMATOS[fmt].t));
  $("#l-pdf").onclick = () => {
    const ce = S.listas.centro || {}; const l = rows();
    const fecha = new Date().toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
    const filtrosTxt = [f.q && `«${f.q}»`, f.tipo, f.cat, f.ubic, f.estado === "activos" ? (bajasCurso ? `en uso y bajas del curso ${cl}` : "en uso") : f.estado === "todos" ? "" : f.estado, desde && `desde ${desde}`, hasta && `hasta ${hasta}`].filter(Boolean).join(" · ");
    $("#print-area").innerHTML = fmt === "apa"
      ? `<div class="p-apa"><h2>Bibliografía · ${esc(ce.departamento || "")}${ce.nombre ? " · " + esc(ce.nombre) : ""}</h2><p class="small">${esc(fecha)} · ${l.length} referencias (APA 7)${filtrosTxt ? " · " + esc(filtrosTxt) : ""}</p><div class="apa">${l.map(i => `<p>${apa(i).html}</p>`).join("")}</div></div>`
      : fmt === "secretaria"
      ? `<div class="p-head"><div><strong>INVENTARIO ${esc((ce.nombre || "").toUpperCase())}</strong><br>Departamento: <strong>${esc(ce.departamento)}</strong><br>${esc(fecha)}${filtrosTxt ? `<br><small>${esc(filtrosTxt)}</small>` : ""}</div><div>Jefe/a de Departamento: <strong>${esc(ce.jefeDepartamento)}</strong><br><br>Firma:</div></div><table>${table(l)}</table>`
      : `<h2>${esc(FORMATOS[fmt].t)} · ${esc(ce.nombre)} · ${esc(ce.departamento)}</h2><p>${esc(fecha)} · ${l.length} líneas${filtrosTxt ? " · " + esc(filtrosTxt) : ""}${fmt === "recuento" ? " · Comprobado por: ____________________  Fecha: ____________" : ""}</p><table class="${fmt === "recuento" ? "recuento" : ""}">${table(l)}</table>`;
    window.print();
  };
  pinta();
}

/* ---------- vista: ajustes ---------- */
export function vAjustes(c) {
  const L = S.listas, ce = L.centro || {};
  const listas = [["personas", "Personas del departamento («Registrado por»)"], ["ubicaciones", "Ubicaciones"], ["categorias", "Categorías"], ["motivosBaja", "Motivos de baja"], ["proveedores", "Proveedores"], ["fabricantes", "Fabricantes de reactivos"], ["armariosSeguridad", "Armarios de seguridad"], ["unidadesStock", "Unidades de stock (fungible)"], ["concentraciones", "Concentraciones"], ["tiposColeccion", "Tipos de colección"], ["editoriales", "Editoriales (libros)"], ["materias", "Materias (libros)"], ["tiposPublicacion", "Tipos de publicación propios (libros)"], ["idiomas", "Idiomas adicionales (libros)"]];
  c.innerHTML = `<h1>Ajustes</h1>
  <form class="sheet" id="f-aj"><h2>Centro (cabecera de los listados)</h2><div class="grid">${fld("a-nombre", "Centro", ce.nombre)}${fld("a-dep", "Departamento", ce.departamento)}${fld("a-jefe", "Jefe/a de departamento", ce.jefeDepartamento)}</div>
  <h2 style="margin-top:18px">Valores de los desplegables</h2><p class="muted small">Uno por línea. Los valores nuevos que se escriben en las fichas se añaden aquí solos.</p>
  <div class="grid">${listas.map(([k, t]) => `<div><label for="a-${k}">${t}</label><textarea id="a-${k}" rows="6">${esc((L[k] || []).join("\n"))}</textarea></div>`).join("")}</div>
  <div class="actions"><button class="btn" type="submit">Guardar ajustes</button></div></form>
  <div class="sheet" style="margin-top:16px"><h2>Copia de seguridad</h2><p>Descarga un archivo con todo el inventario, su historial y los desplegables. Conviene guardar una copia al cerrar cada curso, además del historial que ya conserva GitHub.</p><button class="btn ghost" id="a-backup" type="button">Descargar copia de seguridad</button></div>
  <div class="sheet" style="margin-top:16px"><h2>Acceso</h2><p>Para cambiar la contraseña del departamento o renovar el token de GitHub, genera un nuevo <code>config.json</code> y súbelo al repositorio <code>inventario-app</code>.</p><a class="btn ghost" href="#configurar">Configurar el acceso</a>
  <p class="muted small">Datos en <code>${esc(S.cfg.owner)}/${esc(S.cfg.repo)}</code> (rama ${esc(S.cfg.branch)}). Cada cambio queda en el historial de GitHub.${S.cfg.caduca ? ` El token caduca el ${esc(S.cfg.caduca)}.` : " No consta la fecha de caducidad del token: indícala la próxima vez que configures el acceso y la app avisará un mes antes."} Versión ${VERSION}.</p></div>`;
  $("#f-aj").onsubmit = async e => {
    e.preventDefault();
    const w = await who(); if (!w) return;
    const centro = { nombre: $("#a-nombre").value.trim(), departamento: $("#a-dep").value.trim(), jefeDepartamento: $("#a-jefe").value.trim() };
    const vals = Object.fromEntries(listas.map(([k]) => [k, uniq($("#a-" + k).value.split("\n").map(s => s.trim()))]));
    await guard(() => commit("listas", l => { l.centro = centro; Object.assign(l, vals); }, `Ajustes actualizados (por ${w})`), "Ajustes guardados.");
    fillWho();
  };
  $("#a-backup").onclick = () => download(`copia-inventario-${today()}.json`, JSON.stringify({ exportado: nowISO(), version: VERSION, inventario: S.inv, listas: S.listas, equivalencias: S.eq }, null, 1), "application/json");
}
