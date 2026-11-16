// Inventario del Departamento de Biología y Geología — versión 1.1
// App estática (GitHub Pages). Los datos viven en un repositorio privado y se leen/escriben
// con la API de contenidos de GitHub usando un token cifrado con la contraseña del departamento.
// Este archivo: arranque, acceso, enrutado, inventario, fichas y avisos.

import { VERSION, $, $$, esc, norm, uniq, today, nowISO, newId, TIPOS, ESTADOS, GHS, NOMBRES, S, encryptToken, decryptToken, store, api, ghError, commit, sync, guard, loadAll, fillWho, onWho, who,
  dialog, info, confirmBox, items, opts, specsFor, armariosFor, dl, sel, ghsSvg, casValido, label, learn, normFecha, filtrar, ordenar, cant, estadoPill, filterBar, bindFilters,
  blank, ensureSub, fld, mismo, minimo, bajoMinimo, caducidad, avisos, nUrgentes, download } from "./core.js";
import { vCatalogo, vImportar, vListados, vAjustes } from "./vistas.js";

/* ---------- arranque y acceso ---------- */
let lastHash = location.hash, reverting = false;
async function boot() {
  try { const r = await fetch("config.json?t=" + Date.now(), { cache: "no-store" }); S.cfg = r.ok ? await r.json() : null; } catch { S.cfg = null; }
  S.route = route;
  $("#ver").textContent = "v" + VERSION;
  window.addEventListener("hashchange", onHash);
  window.addEventListener("beforeunload", e => { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });
  document.addEventListener("visibilitychange", () => { // al volver a la pestaña tras un rato, se releen los datos por si un compañero ha cambiado algo
    const view = location.hash.slice(1).split("/")[0];
    if (!document.hidden && S.inv && S.token && !S.dirty && !$("#dlg").open && ["", "inventario", "avisos"].includes(view) && Date.now() - S.cargado > 5 * 60e3) refresh();
  });
  $("#f-login").addEventListener("submit", onLogin);
  $("#login-retry").addEventListener("click", async () => { if (await loadAll()) { loginMsg(""); route(); } else loginMsg($("#sync").textContent, true); });
  $("#f-setup").addEventListener("submit", onSetup);
  $("#btn-logout").addEventListener("click", async () => { if (!await limpio()) return; S.dirty = false; store.del("inv.token"); S.token = null; location.hash = ""; location.reload(); });
  $("#btn-refresh").addEventListener("click", async () => { if (await limpio()) refresh(); });
  $("#who-sel").addEventListener("change", onWho);
  const t = store.get("inv.token");
  if (t && S.cfg?.cifrado) { S.token = t; if (!await loadAll()) loginMsg($("#sync").textContent, true); }
  route();
}
function show(id) { $$(".view").forEach(v => v.hidden = v.id !== id); }
function loginMsg(txt, err) { const m = $("#login-msg"); m.className = "msg" + (err ? " err" : ""); m.textContent = txt; $("#login-retry").hidden = !(err && S.token); }
async function refresh() { if (await loadAll()) { sync("Datos actualizados."); setTimeout(() => sync(""), 3000); } route(); }
function go(h) { S.dirty = false; if (location.hash === h) route(); else location.hash = h; }
async function limpio() { return !S.dirty || await confirmBox("Cambios sin guardar", "Has modificado esta ficha y no la has guardado. Si continúas, esos cambios se pierden.", "Continuar sin guardar", true); }

async function onLogin(e) {
  e.preventDefault();
  loginMsg("Comprobando…");
  if (!S.cfg?.cifrado) return loginMsg("Todavía no hay acceso configurado. Usa «Configurar el acceso».", true);
  try { S.token = await decryptToken(S.cfg.cifrado, $("#login-pass").value); }
  catch { return loginMsg("Contraseña incorrecta.", true); }
  store.set("inv.token", S.token, $("#login-remember").checked);
  $("#login-pass").value = "";
  if (await loadAll()) { loginMsg(""); if (!location.hash) location.hash = "#inventario"; else route(); }
  else loginMsg($("#sync").textContent, true);
}

async function onSetup(e) {
  e.preventDefault();
  const m = $("#setup-msg"); m.className = "msg";
  const p1 = $("#s-pass").value, p2 = $("#s-pass2").value;
  if (p1 !== p2) { m.className = "msg err"; m.textContent = "Las contraseñas no coinciden."; return; }
  const cfg = { owner: $("#s-owner").value.trim(), repo: $("#s-repo").value.trim(), branch: $("#s-branch").value.trim() || "main" };
  if ($("#s-caduca").value) cfg.caduca = $("#s-caduca").value;
  const token = $("#s-token").value.trim();
  m.textContent = "Comprobando el token con GitHub…";
  const prev = { cfg: S.cfg, token: S.token };
  S.cfg = cfg; S.token = token;
  try {
    let r; try { r = await api(""); } catch { throw new Error("No hay conexión con GitHub."); }
    if (!r.ok) throw ghError(r.status);
    const j = await r.json();
    if (!j.private) throw new Error("El repositorio de datos NO es privado. Cámbialo a privado en GitHub antes de continuar.");
    if (j.permissions && !j.permissions.push) throw new Error("El token solo tiene permiso de lectura. Necesita «Contents: read and write».");
    m.textContent = "Token correcto. Cifrando…";
    cfg.cifrado = await encryptToken(token, p1);
    const json = JSON.stringify(cfg, null, 2);
    $("#setup-json").value = json; $("#setup-out").hidden = false; m.textContent = "";
    $("#s-token").value = ""; $("#s-pass").value = ""; $("#s-pass2").value = "";
    $("#setup-copy").onclick = async () => { try { await navigator.clipboard.writeText(json); m.textContent = "Copiado."; } catch { $("#setup-json").select(); m.textContent = "Selecciona el texto y cópialo a mano."; } };
    $("#setup-download").onclick = () => download("config.json", json, "application/json");
  } catch (err) { m.className = "msg err"; m.textContent = err.message; }
  finally { S.cfg = prev.cfg; S.token = prev.token; }
}

/* ---------- enrutado ---------- */
async function onHash() {
  if (reverting) { reverting = false; return; }
  if (S.dirty && !await confirmBox("Cambios sin guardar", "Has modificado esta ficha y no la has guardado. ¿Salir y perder los cambios?", "Salir sin guardar", true)) { reverting = true; location.hash = lastHash; return; }
  route();
}
function route() {
  S.dirty = false; lastHash = location.hash;
  if (location.hash === "#configurar") return show("v-setup");
  if (!S.token || !S.inv) return show("v-login");
  show("v-main");
  const [view, arg] = location.hash.slice(1).split("/");
  $$(".tabs a").forEach(a => a.classList.toggle("on", a.dataset.tab === (view === "ficha" || view === "nuevo" ? "inventario" : view || "inventario")));
  const n = nUrgentes(); $("#badge").textContent = n || ""; $("#badge").hidden = !n;
  const c = $("#content");
  ({ inventario: vInventario, ficha: () => vFicha(arg), nuevo: () => vFicha(null, arg), avisos: vAvisos, reactivos: vCatalogo, importar: vImportar, listados: () => vListados(c, arg), ajustes: vAjustes }[view] || vInventario)(c);
  window.scrollTo(0, 0);
}

/* ---------- vista: inventario ---------- */
function vInventario(c) {
  const f = S.filtros; let shown = [];
  for (const id of S.marcados) if (!items().some(i => i.id === id)) S.marcados.delete(id);
  c.innerHTML = `<h1>Inventario</h1>${filterBar(f, "f-")}<div class="summary" id="inv-sum"></div><div class="bulk" id="inv-bulk" hidden></div><div class="tablewrap"><table class="inv"><thead><tr>
    <th class="ck"><input type="checkbox" id="inv-all" aria-label="Seleccionar todos los mostrados"></th>
    ${[["ref", "N.º ref."], ["denominacion", "Denominación"], ["cantidad", "Cant."], ["ubicacion", "Ubicación"], ["categoria", "Categoría"], ["estado", "Estado"]].map(([k, t]) => `<th data-k="${k}" tabindex="0" aria-sort="${S.orden.k === k ? (S.orden.dir > 0 ? "ascending" : "descending") : "none"}">${t}</th>`).join("")}
    </tr></thead><tbody id="inv-body"></tbody></table></div>`;
  const bulk = () => {
    const n = S.marcados.size, b = $("#inv-bulk"); b.hidden = !n;
    b.innerHTML = n ? `<strong>${n}</strong> seleccionados <button class="btn small" id="bk-edit" type="button">Cambiar ubicación, categoría o estado…</button><button class="btn ghost small" id="bk-baja" type="button">Dar de baja…</button><button class="btn ghost small" id="bk-none" type="button">Quitar selección</button>` : "";
    $("#inv-all").checked = shown.length > 0 && shown.every(i => S.marcados.has(i.id));
  };
  const draw = () => {
    shown = ordenar(filtrar(items(), f));
    const act = items().filter(i => i.estado !== "De baja"), uds = shown.reduce((s, i) => s + (i.cantidadIndeterminada ? 0 : +i.cantidad || 0), 0);
    $("#inv-sum").innerHTML = `<span><strong>${shown.length}</strong> líneas mostradas · ${uds} unidades</span><span>${act.length} en uso en total</span><span>${items().length - act.length} de baja</span><span>Actualizado: ${esc((S.inv.actualizado || "").replace("T", " "))}</span>`;
    $("#inv-body").innerHTML = shown.map(i => `<tr data-id="${esc(i.id)}">
      <td class="ck"><input type="checkbox" data-ck="${esc(i.id)}" ${S.marcados.has(i.id) ? "checked" : ""} aria-label="Seleccionar ${esc(i.denominacion)}"></td>
      <td data-l="Ref." class="mono">${esc(i.ref)}</td>
      <td data-l="Denominación"><a href="#ficha/${esc(i.id)}"><strong>${esc(i.denominacion)}</strong></a>${i.especificacion || i.marca ? `<div class="sub">${esc([i.especificacion, i.marca].filter(Boolean).join(" · "))}</div>` : ""}${i.reactivo?.pictogramas?.length ? `<div>${i.reactivo.pictogramas.map(ghsSvg).join("")}</div>` : ""}</td>
      <td data-l="Cantidad" class="num">${esc(cant(i))}${bajoMinimo(i) ? ` <span class="pill baja" title="Por debajo del stock mínimo (${minimo(i)})">reponer</span>` : ""}</td>
      <td data-l="Ubicación">${esc(i.ubicacion)}${i.armario ? `<div class="sub">${esc(i.armario)}</div>` : ""}</td>
      <td data-l="Categoría">${esc(i.categoria)}<div class="sub">${esc(i.tipo)}</div></td>
      <td data-l="Estado">${estadoPill(i.estado)}</td></tr>`).join("") || `<tr><td colspan="7" class="muted">No hay elementos con estos filtros.</td></tr>`;
    bulk();
  };
  bindFilters(f, "f-", draw);
  const sortBy = th => { const k = th.dataset.k; S.orden = { k, dir: S.orden.k === k ? -S.orden.dir : 1 }; vInventario(c); };
  $$("th[data-k]", c).forEach(th => { th.addEventListener("click", () => sortBy(th)); th.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sortBy(th); } }); });
  $("#inv-all").addEventListener("change", e => { shown.forEach(i => e.target.checked ? S.marcados.add(i.id) : S.marcados.delete(i.id)); draw(); });
  $("#inv-body").addEventListener("click", e => {
    const ck = e.target.closest("input[data-ck]");
    if (ck) { ck.checked ? S.marcados.add(ck.dataset.ck) : S.marcados.delete(ck.dataset.ck); bulk(); return; }
    if (e.target.closest("td.ck") || e.target.closest("a")) return;
    const tr = e.target.closest("tr[data-id]"); if (tr) location.hash = "#ficha/" + tr.dataset.id;
  });
  $("#inv-bulk").addEventListener("click", e => { if (e.target.id === "bk-none") { S.marcados.clear(); draw(); } if (e.target.id === "bk-edit") bulkEdit(); if (e.target.id === "bk-baja") bulkBaja(); });
  draw();
}

// Cambios en bloque sobre los elementos marcados (reorganizar un armario, cambiar de aula, etc.)
async function bulkEdit() {
  const w = await who(); if (!w) return;
  const n = S.marcados.size;
  const r = await dialog(`<h2>Cambiar ${n} elementos</h2><p class="muted">Rellena solo lo que quieras cambiar; lo que dejes vacío no se toca. Los elementos de baja no se modifican.</p>
    <label for="bk-ubic">Ubicación</label><input id="bk-ubic" list="bk-dl-u">${dl("bk-dl-u", opts("ubicaciones", "ubicacion"))}
    <label for="bk-arm">Armario / estante</label><input id="bk-arm">
    <label for="bk-cat">Categoría</label><input id="bk-cat" list="bk-dl-c">${dl("bk-dl-c", opts("categorias", "categoria"))}
    <label for="bk-est">Estado</label><select id="bk-est"><option value="">— no cambiar —</option>${ESTADOS.filter(e => e !== "De baja").map(e => `<option>${esc(e)}</option>`).join("")}</select>
    <div class="row" style="margin-top:12px"><button class="btn" value="ok">Aplicar</button><button class="btn ghost" value="no">Cancelar</button></div>`);
  if (r !== "ok") return;
  const ch = Object.fromEntries(Object.entries({ ubicacion: $("#bk-ubic").value.trim(), armario: $("#bk-arm").value.trim(), categoria: $("#bk-cat").value.trim(), estado: $("#bk-est").value }).filter(([, v]) => v));
  if (!Object.keys(ch).length) return;
  let hechos = 0;
  const ok = await guard(async () => {
    await commit("inv", d => {
      hechos = 0;
      for (const it of d.items) {
        if (!S.marcados.has(it.id) || it.estado === "De baja") continue;
        const det = Object.entries(ch).filter(([k, v]) => (it[k] ?? "") !== v).map(([k, v]) => `${NOMBRES[k]}: «${it[k] ?? ""}» → «${v}»`);
        if (!det.length) continue;
        Object.assign(it, ch); (it.historial ||= []).push({ fecha: nowISO(), por: w, accion: "Modificación en bloque", detalle: det.join("; ") }); hechos++;
      }
    }, `Cambio en bloque de ${n} elementos (por ${w})`);
    await learn([ch]);
  }, "Cambios aplicados.");
  if (ok) { sync(`${hechos} elementos modificados.`); S.marcados.clear(); route(); }
}
async function bulkBaja() {
  const w = await who(); if (!w) return;
  const n = S.marcados.size;
  const r = await dialog(`<h2>Dar de baja ${n} elementos</h2><p class="muted">Se da de baja la línea completa de cada elemento marcado. Para bajas parciales, entra en la ficha.</p>
    <label for="bj-f">Fecha de baja</label><input id="bj-f" type="date" value="${today()}">
    <label for="bj-m">Motivo</label><input id="bj-m" list="dl-motivo2" required>${dl("dl-motivo2", S.listas.motivosBaja || [])}
    <label for="bj-o">Observaciones</label><input id="bj-o">
    <div class="row" style="margin-top:12px"><button class="btn danger" value="ok">Dar de baja</button><button class="btn ghost" value="no" formnovalidate>Cancelar</button></div>`);
  if (r !== "ok") return;
  const fecha = $("#bj-f").value || today(), motivo = $("#bj-m").value.trim() || "Otro", obs = $("#bj-o").value.trim();
  const ok = await guard(async () => {
    await commit("inv", d => { for (const it of d.items) if (S.marcados.has(it.id) && it.estado !== "De baja") { Object.assign(it, { estado: "De baja", fechaBaja: fecha, motivoBaja: motivo }); (it.historial ||= []).push({ fecha: nowISO(), por: w, accion: "Baja", detalle: `${motivo}${obs ? " · " + obs : ""}` }); } }, `Baja en bloque de ${n} elementos (${motivo}, por ${w})`);
    await learn([{ motivoBaja: motivo }]);
  }, "Bajas registradas.");
  if (ok) { S.marcados.clear(); route(); }
}

/* ---------- vista: ficha ---------- */
function vFicha(id, tipoNuevo, preset) {
  const c = $("#content");
  const orig = preset ? preset.orig : id ? items().find(i => i.id === id) : null;
  if (id && !orig && !preset) { c.innerHTML = `<p>No se encuentra este elemento.</p><a href="#inventario">Volver al inventario</a>`; return; }
  const it = ensureSub(preset ? preset.obj : structuredClone(orig || blank(decodeURIComponent(tipoNuevo || ""))));
  const r = it.tipo === "Reactivos" ? it.reactivo : null, fu = it.tipo === "Material fungible" ? it.fungible : null, co = it.tipo === "Colecciones" ? it.coleccion : null;
  const cad = orig ? caducidad(orig) : "";
  c.innerHTML = `<p><a href="#inventario">← Inventario</a></p>
  <form class="sheet" id="f-item" autocomplete="off">
    <h1>${orig ? esc(label(orig)) : "Nuevo elemento"} ${orig ? estadoPill(orig.estado) : ""}${orig && bajoMinimo(orig) ? ` <span class="pill baja">por debajo del stock mínimo</span>` : ""}${cad && orig.estado !== "De baja" && cad < today() ? ` <span class="pill baja">caducado</span>` : ""}</h1>
    <div class="grid">
      <div><label for="i-tipo">Tipo de registro</label>${sel("i-tipo", TIPOS, it.tipo, null)}</div>
      ${fld("i-cat", "Categoría", it.categoria, 'list="dl-cat"')}
      ${fld("i-ref", "N.º de referencia (Secretaría)", it.ref, 'class="mono"')}
      ${fld("i-den", "Denominación *", it.denominacion, 'list="dl-den" required', "span2")}
      ${fld("i-spec", "Especificación / capacidad", it.especificacion, 'list="dl-spec"')}
      ${fld("i-marca", "Marca / modelo", it.marca, 'list="dl-marca"')}
      <div><label for="i-cant">Cantidad</label><input id="i-cant" type="number" min="0" step="1" value="${esc(it.cantidad ?? "")}" ${it.cantidadIndeterminada ? "disabled" : ""}></div>
      <div><label class="check" style="margin-top:32px"><input id="i-indet" type="checkbox" ${it.cantidadIndeterminada ? "checked" : ""}> Cantidad indeterminada (varios)</label></div>
      ${fld("i-ubic", "Ubicación *", it.ubicacion, 'list="dl-ubic" required')}
      ${fld("i-arm", "Armario / estante", it.armario, 'list="dl-arm"')}
      <div><label for="i-estado">Estado</label>${sel("i-estado", ESTADOS.filter(e => e !== "De baja" || it.estado === "De baja"), it.estado, null)}</div>
      <div><label>Origen</label><div class="row" style="padding-top:6px">${["Compra", "Dotación"].map(o => `<label class="check" style="margin:0"><input type="radio" name="i-origen" value="${o}" ${it.origen === o ? "checked" : ""}> ${o}</label>`).join("")}</div></div>
      ${fld("i-alta", "Fecha de alta", it.fechaAlta, 'placeholder="aaaa-mm-dd (o solo aaaa-mm / aaaa)"')}
      ${fld("i-prov", "Proveedor", it.proveedor, 'list="dl-prov"')}
      ${fld("i-codprov", "Código de artículo del proveedor", it.codigoProveedor)}
      ${fld("i-fact", "N.º de factura", it.factura)}
      ${fld("i-precio", "Precio unitario (€)", it.precio ?? "", 'type="number" min="0" step="0.01"')}
      <div class="span2"><label for="i-obs">Observaciones</label><textarea id="i-obs" rows="2">${esc(it.observaciones)}</textarea></div>
    </div>
    ${it.estado === "De baja" ? `<fieldset><legend>Baja</legend><div class="grid">${fld("i-fbaja", "Fecha de baja", it.fechaBaja, 'placeholder="aaaa-mm-dd"')}${fld("i-mbaja", "Motivo de baja", it.motivoBaja, 'list="dl-motivo"')}</div></fieldset>` : ""}
    ${r ? `<fieldset><legend>Reactivo</legend><div class="grid">
      ${fld("r-formula", "Fórmula", r.formula, 'class="mono"')}
      <div><label for="r-cas">N.º CAS</label><input id="r-cas" class="mono" value="${esc(r.cas)}" placeholder="0000-00-0"><div class="sub" id="r-cas-msg"></div></div>
      ${fld("r-fab", "Fabricante", r.fabricante, 'list="dl-fab"')}
      ${fld("r-reffab", "Referencia del fabricante", r.refFabricante, 'class="mono"')}
      ${fld("r-lote", "N.º de lote", r.lote)}
      ${fld("r-conc", "Concentración / pureza", r.concentracion, 'list="dl-conc"')}
      <div><label for="r-fis">Estado físico</label>${sel("r-fis", ["Sólido", "Líquido", "Gas", "Disolución"], r.estadoFisico, "—")}</div>
      ${fld("r-env", "Envase y contenido", r.envase, 'placeholder="Frasco de 500 g"')}
      ${fld("r-rest", "Cantidad restante aprox.", r.cantidadRestante)}
      ${fld("r-min", "Stock mínimo de envases (aviso)", r.stockMinimo ?? "", 'type="number" min="0"')}
      ${fld("r-armseg", "Armario de seguridad", r.armarioSeguridad, 'list="dl-armseg"')}
      ${fld("r-fap", "Fecha de apertura", r.fechaApertura, 'type="date"')}
      ${fld("r-fcad", "Fecha de caducidad", r.fechaCaducidad, 'type="date"')}
      ${fld("r-fds", "Ficha de seguridad del proveedor (enlace)", r.fds, 'type="url"', "span2")}
      <div class="span2"><label for="r-hp">Frases H/P</label><input id="r-hp" value="${esc(r.frasesHP)}"></div>
      </div><label>Pictogramas de peligro (SGA)</label><div class="picts">${Object.keys(GHS).map(g => `<label><input type="checkbox" name="r-ghs" value="${g}" ${r.pictogramas.includes(g) ? "checked" : ""}>${ghsSvg(g)} ${GHS[g]}</label>`).join("")}</div>
      <p class="small" id="r-links"></p></fieldset>` : ""}
    ${fu ? `<fieldset><legend>Material fungible</legend><div class="grid">
      ${fld("u-unidad", "Unidad de stock", fu.unidadStock, 'list="dl-unid"')}
      ${fld("u-porenv", "Unidades por envase", fu.unidadesEnvase ?? "", 'type="number" min="1"')}
      ${fld("u-min", "Stock mínimo (aviso)", fu.stockMinimo ?? "", 'type="number" min="0"')}
      ${fld("u-cad", "Fecha de caducidad", fu.caducidad, 'type="date"')}</div></fieldset>` : ""}
    ${co ? `<fieldset><legend>Colección</legend><div class="grid">
      ${fld("c-tipo", "Tipo de colección", co.tipoColeccion, 'list="dl-tcol"')}
      <div><label for="c-n">N.º de ejemplares</label><input id="c-n" type="number" min="0" value="${esc(co.ejemplares.length || co.nEjemplares || "")}" ${co.ejemplares.length ? "disabled" : ""}><div class="sub">Se calcula solo si registras ejemplares.</div></div></div>
      <h3 style="margin-top:12px">Ejemplares (opcional)</h3>
      <div class="tablewrap"><table class="ej-table"><thead><tr><th>N.º muestra</th><th>Nombre</th><th>Clasificación</th><th>Localidad</th><th>Edad / época</th><th>Estado</th><th></th></tr></thead><tbody id="ej-body"></tbody></table></div>
      <button class="btn ghost small" type="button" id="ej-add" style="margin-top:8px">+ Añadir ejemplar</button></fieldset>` : ""}
    ${orig?.historial?.length ? `<fieldset><legend>Historial</legend><ul class="hist">${orig.historial.slice().reverse().map(h => `<li>${esc(String(h.fecha || "").replace("T", " "))} · <strong>${esc(h.por)}</strong> · ${esc(h.accion)}${h.detalle ? ` · ${esc(h.detalle)}` : ""}</li>`).join("")}</ul></fieldset>` : ""}
    <div class="actions">
      <button class="btn" type="submit">Guardar</button>
      ${orig && orig.estado !== "De baja" && !orig.cantidadIndeterminada ? `<button class="btn ghost" type="button" id="b-cant">Ajustar cantidad (consumo / entrada)</button>` : ""}
      ${orig && orig.estado !== "De baja" ? `<button class="btn ghost" type="button" id="b-baja">Dar de baja</button>` : ""}
      ${orig?.estado === "De baja" ? `<button class="btn ghost" type="button" id="b-alta">Reactivar</button>` : ""}
      ${orig ? `<button class="btn ghost" type="button" id="b-dup">Duplicar</button>` : ""}
      ${orig ? `<button class="btn ghost" type="button" id="b-del" style="margin-left:auto;color:var(--bad);border-color:var(--bad)">Eliminar (error de registro)</button>` : ""}
    </div>
    ${dl("dl-cat", opts("categorias", "categoria"))}${dl("dl-den", uniq(items().map(i => i.denominacion)))}${dl("dl-spec", specsFor(it.denominacion))}${dl("dl-marca", uniq(items().map(i => i.marca)))}
    ${dl("dl-ubic", opts("ubicaciones", "ubicacion"))}${dl("dl-arm", armariosFor(it.ubicacion))}${dl("dl-prov", opts("proveedores", "proveedor"))}${dl("dl-motivo", S.listas.motivosBaja || [])}
    ${dl("dl-fab", opts("fabricantes"))}${dl("dl-conc", opts("concentraciones"))}${dl("dl-armseg", opts("armariosSeguridad"))}${dl("dl-unid", opts("unidadesStock"))}${dl("dl-tcol", opts("tiposColeccion"))}
  </form>`;

  const form = $("#f-item");
  const touch = () => { S.dirty = true; };
  form.addEventListener("input", touch); form.addEventListener("change", touch);
  // dependencias de los desplegables
  $("#i-den").addEventListener("change", e => { $("#dl-spec").outerHTML = dl("dl-spec", specsFor(e.target.value)); });
  $("#i-ubic").addEventListener("change", e => { $("#dl-arm").outerHTML = dl("dl-arm", armariosFor(e.target.value)); });
  $("#i-indet").addEventListener("change", e => { $("#i-cant").disabled = e.target.checked; });
  // al cambiar de tipo se conservan los datos específicos ya escritos, por si se vuelve atrás
  $("#i-tipo").addEventListener("change", () => { collect(it); ensureSub(it); if (it.tipo === "Reactivos" && !it.categoria) it.categoria = "Reactivos"; vFicha(null, null, { obj: it, orig }); S.dirty = true; });
  if (r) {
    const casMsg = () => { const v = $("#r-cas").value.trim(); $("#r-cas-msg").textContent = !v ? "" : casValido(v) ? "✓ CAS válido" : "El dígito de control no cuadra: revisa el número."; $("#r-links").innerHTML = v && casValido(v) ? `Información de seguridad: <a href="https://pubchem.ncbi.nlm.nih.gov/compound/${encodeURIComponent(v)}" target="_blank" rel="noopener noreferrer">PubChem</a>` : ""; };
    $("#r-cas").addEventListener("input", casMsg); casMsg();
  }
  if (co) {
    const body = $("#ej-body");
    const drawEj = () => {
      body.innerHTML = co.ejemplares.map((e, k) => `<tr data-k="${k}">${["n", "nombre", "clasificacion", "localidad", "edad", "estado"].map(f => `<td><input data-f="${f}" value="${esc(e[f])}" aria-label="${f}"></td>`).join("")}<td><button type="button" class="btn ghost small" data-del="${k}" aria-label="Quitar ejemplar">✕</button></td></tr>`).join("") || `<tr><td colspan="7" class="muted">Sin ejemplares registrados.</td></tr>`;
      $("#c-n").disabled = co.ejemplares.length > 0; if (co.ejemplares.length) $("#c-n").value = co.ejemplares.length;
    };
    body.addEventListener("input", e => { const tr = e.target.closest("tr[data-k]"); if (tr) co.ejemplares[+tr.dataset.k][e.target.dataset.f] = e.target.value; });
    body.addEventListener("click", e => { const k = e.target.dataset.del; if (k !== undefined) { co.ejemplares.splice(+k, 1); touch(); drawEj(); } });
    $("#ej-add").addEventListener("click", () => { co.ejemplares.push({ n: String(co.ejemplares.length + 1), nombre: "", clasificacion: "", localidad: "", edad: "", estado: "Completo", observaciones: "" }); touch(); drawEj(); });
    drawEj();
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const rec = structuredClone(collect(it));
    if (rec.tipo !== "Reactivos") delete rec.reactivo;
    if (rec.tipo !== "Material fungible") delete rec.fungible;
    if (rec.tipo !== "Colecciones") delete rec.coleccion;
    for (const k of ["fechaAlta", "fechaBaja"]) {
      const n = normFecha(rec[k]);
      if (n === null) { await info("Fecha no válida", `La ${NOMBRES[k]} «${rec[k]}» no se entiende. Escríbela como aaaa-mm-dd (también vale aaaa-mm, aaaa o dd/mm/aaaa).`); return; }
      rec[k] = n;
    }
    const w = await who(); if (!w) return;
    if (rec.ref && items().some(x => x.ref === rec.ref && x.id !== rec.id)) { if (!await confirmBox("Referencia repetida", `Ya hay otro elemento con el n.º de referencia ${rec.ref}. ¿Guardar igualmente?`, "Guardar")) return; }
    if (!orig && !rec.ref && !rec.cantidadIndeterminada && rec.cantidad != null) { // alta de algo que ya existe en el mismo sitio: proponer sumar
      const ex = items().find(x => x.estado !== "De baja" && !x.cantidadIndeterminada && !x.ref && mismo(x, rec));
      if (ex) {
        const ans = await dialog(`<h2>Ya hay una línea igual</h2><p><strong>${esc(label(ex))}</strong> · ${esc(ex.ubicacion)}${ex.armario ? " · " + esc(ex.armario) : ""} · ${esc(cant(ex) || 0)} ud.</p><p>¿Sumar las ${rec.cantidad} unidades a esa línea o crear una línea aparte?</p>
          <div class="row"><button class="btn" value="sum">Sumar a la existente</button><button class="btn ghost" value="new">Crear línea aparte</button><button class="btn ghost" value="no">Cancelar</button></div>`);
        if (ans === "sum") {
          const ok = await guard(() => commit("inv", d => {
            const cur = d.items.find(x => x.id === ex.id); if (!cur) throw new Error("Esa línea ya no existe. Pulsa «Actualizar» y repite el alta.");
            const a = cur.cantidad ?? 0; cur.cantidad = a + rec.cantidad;
            (cur.historial ||= []).push({ fecha: nowISO(), por: w, accion: `Entrada de ${rec.cantidad} ud.`, detalle: `cantidad: ${a} → ${cur.cantidad}${rec.factura ? " · factura " + rec.factura : ""}` });
          }, `Entrada: ${rec.cantidad} × ${label(ex)} (por ${w})`), "Cantidad sumada a la línea existente.");
          if (ok) go("#ficha/" + ex.id);
          return;
        }
        if (ans !== "new") return;
      }
    }
    const accion = orig ? "Modificación" : "Alta";
    const cambios = orig ? diff(orig, rec) : "";
    if (orig && !cambios) { S.dirty = false; sync("No hay cambios que guardar."); return; }
    const entry = { fecha: nowISO(), por: w, accion, detalle: cambios };
    const ok = await guard(async () => {
      await commit("inv", d => {
        const k = d.items.findIndex(x => x.id === rec.id);
        if (orig && k < 0) throw new Error("Este elemento ya no existe en el inventario (otra persona lo ha eliminado). Pulsa «Actualizar».");
        // el historial se toma de la versión más reciente: así no se pierde lo que haya anotado otra persona entretanto
        const out = { ...rec, historial: [...(k >= 0 ? d.items[k].historial || [] : []), entry] };
        if (k >= 0) d.items[k] = out; else d.items.push(out);
      }, `${accion}: ${label(rec)} (por ${w})`);
      await learn([rec]);
    }, `${accion} guardada.`);
    if (ok) go("#ficha/" + rec.id);
  });

  $("#b-cant")?.addEventListener("click", async () => {
    if (!await limpio()) return;
    const w = await who(); if (!w) return;
    const r2 = await dialog(`<h2>Ajustar cantidad</h2><p>${esc(label(orig))} · ahora hay <strong>${esc(orig.cantidad ?? 0)}</strong></p>
      <div class="row"><label class="check" style="margin:0"><input type="radio" name="aj-t" value="-1" checked> Consumo / salida</label><label class="check" style="margin:0"><input type="radio" name="aj-t" value="1"> Entrada / reposición</label></div>
      <label for="aj-n">Unidades</label><input id="aj-n" type="number" min="1" step="1" value="1" required>
      <label for="aj-o">Nota (opcional)</label><input id="aj-o" placeholder="Práctica de 1.º Bach., n.º de factura…">
      <div class="row" style="margin-top:12px"><button class="btn" value="ok">Registrar</button><button class="btn ghost" value="no" formnovalidate>Cancelar</button></div>`);
    if (r2 !== "ok") return;
    const sg = +$("input[name=aj-t]:checked").value, n = Math.abs(Math.round(+$("#aj-n").value || 0)), nota = $("#aj-o").value.trim();
    if (!n) return;
    await guard(() => commit("inv", d => {
      const cur = d.items.find(x => x.id === orig.id); if (!cur) throw new Error("Este elemento ya no existe. Pulsa «Actualizar».");
      const a = cur.cantidad ?? 0, b = Math.max(0, a + sg * n); cur.cantidad = b;
      (cur.historial ||= []).push({ fecha: nowISO(), por: w, accion: sg < 0 ? `Consumo de ${n} ud.` : `Entrada de ${n} ud.`, detalle: `cantidad: ${a} → ${b}${nota ? " · " + nota : ""}` });
    }, `${sg < 0 ? "Consumo" : "Entrada"}: ${n} × ${label(orig)} (por ${w})`), "Cantidad actualizada.");
    route();
  });
  $("#b-baja")?.addEventListener("click", async () => {
    if (!await limpio()) return;
    const w = await who(); if (!w) return;
    const r2 = await dialog(`<h2>Dar de baja</h2><p>${esc(label(orig))}</p>
      <label for="bj-f">Fecha de baja</label><input id="bj-f" type="date" value="${today()}">
      <label for="bj-m">Motivo</label><input id="bj-m" list="dl-motivo2" required>${dl("dl-motivo2", S.listas.motivosBaja || [])}
      ${orig.cantidad > 1 && !orig.cantidadIndeterminada ? `<label for="bj-n">Unidades que se dan de baja (de ${orig.cantidad})</label><input id="bj-n" type="number" min="1" max="${orig.cantidad}" value="${orig.cantidad}">` : ""}
      <label for="bj-o">Observaciones</label><input id="bj-o">
      <div class="row" style="margin-top:12px"><button class="btn danger" value="ok">Dar de baja</button><button class="btn ghost" value="no" formnovalidate>Cancelar</button></div>`);
    if (r2 !== "ok") return;
    const fecha = $("#bj-f").value || today(), motivo = $("#bj-m").value.trim() || "Otro", n = +($("#bj-n")?.value || orig.cantidad || 0), obs = $("#bj-o").value.trim();
    await guard(async () => {
      await commit("inv", d => {
        const cur = d.items.find(x => x.id === orig.id); if (!cur) throw new Error("Este elemento ya no existe. Pulsa «Actualizar».");
        cur.historial ||= [];
        const h = { fecha: nowISO(), por: w, accion: "Baja", detalle: `${motivo}${obs ? " · " + obs : ""}` };
        if (n && cur.cantidad > n) { // baja parcial: se separa una línea de baja
          cur.cantidad -= n; cur.historial.push({ ...h, accion: `Baja parcial de ${n} ud.` });
          const b = structuredClone(cur); b.id = newId(); b.cantidad = n; b.ref = ""; b.estado = "De baja"; b.fechaBaja = fecha; b.motivoBaja = motivo;
          d.items.push(b);
        } else { Object.assign(cur, { estado: "De baja", fechaBaja: fecha, motivoBaja: motivo }); cur.historial.push(h); }
      }, `Baja: ${label(orig)} (${motivo}, por ${w})`);
      await learn([{ motivoBaja: motivo }]);
    }, "Baja registrada.");
    route();
  });
  $("#b-alta")?.addEventListener("click", async () => {
    if (!await limpio()) return;
    const w = await who(); if (!w) return;
    await guard(() => commit("inv", d => { const cur = d.items.find(x => x.id === orig.id); if (!cur) throw new Error("Este elemento ya no existe. Pulsa «Actualizar»."); Object.assign(cur, { estado: "Operativo", fechaBaja: "", motivoBaja: "" }); (cur.historial ||= []).push({ fecha: nowISO(), por: w, accion: "Reactivación" }); }, `Reactivación: ${label(orig)} (por ${w})`), "Elemento reactivado.");
    route();
  });
  $("#b-dup")?.addEventListener("click", () => { const d = structuredClone(orig); d.id = newId(); d.ref = ""; d.historial = []; d.fechaAlta = today(); if (d.coleccion) d.coleccion.ejemplares = []; vFicha(null, null, { obj: d, orig: null }); S.dirty = true; window.scrollTo(0, 0); });
  $("#b-del")?.addEventListener("click", async () => {
    const w = await who(); if (!w) return;
    if (!await confirmBox("Eliminar definitivamente", "Úsalo solo si el elemento se registró por error. Si el material existía y ya no está, usa «Dar de baja» para que quede constancia. (El historial de GitHub conserva una copia.)", "Eliminar", true)) return;
    const ok = await guard(() => commit("inv", d => { d.items = d.items.filter(x => x.id !== orig.id); }, `Eliminado por error de registro: ${label(orig)} (por ${w})`), "Elemento eliminado.");
    if (ok) go("#inventario");
  });
}
function collect(it) {
  const v = id => $("#" + id)?.value.trim() ?? "";
  const num = id => v(id) === "" ? null : +v(id);
  Object.assign(it, {
    tipo: v("i-tipo"), categoria: v("i-cat"), ref: v("i-ref"), denominacion: v("i-den"), especificacion: v("i-spec"), marca: v("i-marca"),
    cantidadIndeterminada: $("#i-indet").checked, cantidad: $("#i-indet").checked ? null : num("i-cant"),
    ubicacion: v("i-ubic"), armario: v("i-arm"), estado: v("i-estado") || it.estado, origen: $("input[name=i-origen]:checked")?.value || "",
    fechaAlta: v("i-alta"), proveedor: v("i-prov"), codigoProveedor: v("i-codprov"), factura: v("i-fact"), precio: num("i-precio"),
    observaciones: $("#i-obs").value.trim()
  });
  if ($("#i-fbaja")) { it.fechaBaja = v("i-fbaja"); it.motivoBaja = v("i-mbaja"); }
  if (it.reactivo && $("#r-cas")) Object.assign(it.reactivo, { formula: v("r-formula"), cas: v("r-cas"), fabricante: v("r-fab"), refFabricante: v("r-reffab"), lote: v("r-lote"), concentracion: v("r-conc"), estadoFisico: v("r-fis"), envase: v("r-env"), cantidadRestante: v("r-rest"), stockMinimo: num("r-min"), armarioSeguridad: v("r-armseg"), fechaApertura: v("r-fap"), fechaCaducidad: v("r-fcad"), fds: v("r-fds"), frasesHP: v("r-hp"), pictogramas: $$("input[name=r-ghs]:checked").map(x => x.value) });
  if (it.fungible && $("#u-unidad")) Object.assign(it.fungible, { unidadStock: v("u-unidad"), unidadesEnvase: num("u-porenv"), stockMinimo: num("u-min"), caducidad: v("u-cad") });
  if (it.coleccion && $("#c-tipo")) { it.coleccion.tipoColeccion = v("c-tipo"); it.coleccion.nEjemplares = it.coleccion.ejemplares.length || num("c-n"); }
  return it;
}
function diff(a, b) {
  const ch = Object.keys(NOMBRES).filter(k => String(a[k] ?? "") !== String(b[k] ?? "")).map(k => `${NOMBRES[k]}: «${a[k] ?? ""}» → «${b[k] ?? ""}»`);
  if (!!a.cantidadIndeterminada !== !!b.cantidadIndeterminada) ch.push(`cantidad indeterminada: ${b.cantidadIndeterminada ? "sí" : "no"}`);
  // se comparan sin distinguir null, "" o campo ausente, para no registrar cambios que no lo son
  const sub = o => JSON.stringify([o.reactivo, o.fungible, o.coleccion], (k, v) => v == null || v === "" || (Array.isArray(v) && !v.length) ? undefined : v);
  if (sub(a) !== sub(b)) ch.push("datos específicos del tipo");
  return ch.join("; ");
}

/* ---------- vista: avisos ---------- */
function vAvisos(c) {
  const g = avisos();
  c.innerHTML = `<h1>Avisos</h1>${g.length ? g.map(a => `<section class="sheet aviso ${a.sev}"><h2>${esc(a.t)}${a.list.length ? ` <span class="pill ${a.sev === "bad" ? "baja" : a.sev}">${a.list.length}</span>` : ""}</h2>
      ${a.help ? `<p class="muted small">${esc(a.help)}</p>` : ""}
      ${a.list.length ? `<ul class="avl">${a.list.slice(0, 300).map(([i, txt]) => `<li><a href="#ficha/${esc(i.id)}">${esc(label(i))}</a> <span class="sub">${esc(txt)}</span></li>`).join("")}</ul>` : ""}
      ${a.k === "stock" ? `<a class="btn ghost small" href="#listados/reposicion">Preparar el listado de reposición</a>` : ""}</section>`).join("") : `<p class="sheet">No hay nada pendiente.</p>`}
    <p class="muted small" style="margin-top:14px">Los avisos de reposición aparecen cuando la ficha de un fungible o de un reactivo tiene «Stock mínimo»; los de caducidad, cuando tiene fecha de caducidad. El número rojo de la pestaña cuenta solo lo urgente.</p>`;
}

boot();
