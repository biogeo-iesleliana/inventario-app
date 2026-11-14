// Inventario del Departamento de Biología y Geología — versión 1
// App estática (GitHub Pages). Los datos viven en un repositorio privado y se leen/escriben
// con la API de contenidos de GitHub usando un token cifrado con la contraseña del departamento.

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const uniq = a => [...new Set(a.filter(v => v !== "" && v != null))].sort((x, y) => String(x).localeCompare(String(y), "es"));
const today = () => new Date().toISOString().slice(0, 10);
const nowISO = () => new Date().toISOString().slice(0, 19);
const newId = () => "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const TIPOS = ["Equipo / mobiliario inventariable", "Material de laboratorio reutilizable", "Material fungible", "Reactivos", "Colecciones"];
const ESTADOS = ["Operativo", "Deteriorado", "En reparación", "Pendiente de n.º de referencia", "De baja"];
const GHS = { GHS01: "Explosivo", GHS02: "Inflamable", GHS03: "Comburente", GHS04: "Gas a presión", GHS05: "Corrosivo", GHS06: "Toxicidad aguda", GHS07: "Nocivo / irritante", GHS08: "Peligro para la salud", GHS09: "Peligro para el medio ambiente" };
const FILES = { inv: "data/inventario.json", listas: "data/listas.json", cat: "data/catalogo-reactivos.json" };

const S = { cfg: null, token: null, inv: null, listas: null, cat: [], sha: {}, filtros: { q: "", tipo: "", cat: "", ubic: "", estado: "activos" }, orden: { k: "denominacion", dir: 1 }, sel: new Map() };

/* ---------- utilidades base64 / cifrado ---------- */
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s.replace(/\s/g, "")), c => c.charCodeAt(0));
const utf8b64 = str => { const b = new TextEncoder().encode(str); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const b64utf8 = s => new TextDecoder().decode(unb64(s));

async function deriveKey(pass, salt, iter) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function encryptToken(token, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), iter = 600000;
  const key = await deriveKey(pass, salt, iter);
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token));
  return { kdf: "PBKDF2-SHA256", iter, salt: b64(salt), iv: b64(iv), data: b64(data) };
}
async function decryptToken(c, pass) {
  const key = await deriveKey(pass, unb64(c.salt), c.iter);
  const out = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(c.iv) }, key, unb64(c.data));
  return new TextDecoder().decode(out);
}

/* ---------- almacenamiento local seguro ---------- */
const store = {
  get(k) { try { return sessionStorage.getItem(k) ?? localStorage.getItem(k); } catch { return null; } },
  set(k, v, persist) { try { sessionStorage.setItem(k, v); if (persist) localStorage.setItem(k, v); } catch { } },
  del(k) { try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch { } }
};

/* ---------- API de GitHub ---------- */
function api(path, opts = {}) {
  const { owner, repo } = S.cfg;
  return fetch(`https://api.github.com/repos/${owner}/${repo}${path ? "/" + path : ""}`, {
    ...opts,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${S.token}`, "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) }
  });
}
async function ghGet(file) {
  const r = await api(`contents/${file}?ref=${encodeURIComponent(S.cfg.branch)}&t=${Date.now()}`, { cache: "no-store" });
  if (r.status === 404) return { data: null, sha: null };
  if (!r.ok) throw new Error(ghError(r.status));
  const j = await r.json();
  let content = j.content;
  if (!content || j.encoding === "none") { // archivos de más de 1 MB
    const rb = await api(`git/blobs/${j.sha}`); if (!rb.ok) throw new Error(ghError(rb.status));
    content = (await rb.json()).content;
  }
  return { data: JSON.parse(b64utf8(content)), sha: j.sha };
}
async function ghPut(file, obj, sha, message) {
  const body = { message, content: utf8b64(JSON.stringify(obj, null, 1) + "\n"), branch: S.cfg.branch };
  if (sha) body.sha = sha;
  const r = await api(`contents/${file}`, { method: "PUT", body: JSON.stringify(body) });
  if (r.status === 409 || r.status === 422) return { conflict: true };
  if (!r.ok) throw new Error(ghError(r.status));
  const j = await r.json();
  return { sha: j.content.sha };
}
function ghError(st) {
  return st === 401 ? "GitHub rechaza el token (401). Puede haber caducado: genera uno nuevo en Ajustes → Configurar acceso."
    : st === 403 ? "GitHub deniega el permiso (403). Revisa que el token tenga «Contents: read and write» sobre inventario-datos."
    : st === 404 ? "No se encuentra el repositorio o el archivo (404). Revisa la organización y el nombre del repositorio."
    : `Error de GitHub (${st}). Inténtalo de nuevo en unos segundos.`;
}
// Guarda aplicando un cambio sobre la versión más reciente del archivo; si otra persona guardó a la vez, reintenta.
async function commit(key, mutate, message) {
  const file = FILES[key];
  for (let i = 0; i < 4; i++) {
    let base = S[key], sha = S.sha[key];
    if (i > 0) { const g = await ghGet(file); base = g.data; sha = g.sha; }
    const next = structuredClone(base);
    mutate(next);
    if (key === "inv") next.actualizado = nowISO();
    const r = await ghPut(file, next, sha, message);
    if (!r.conflict) { S[key] = next; S.sha[key] = r.sha; return next; }
  }
  throw new Error("No se ha podido guardar: alguien está modificando el inventario a la vez. Recarga y vuelve a intentarlo.");
}

/* ---------- estado de sincronización ---------- */
function sync(msg, err) { const el = $("#sync"); el.textContent = msg || ""; el.classList.toggle("err", !!err); }
async function guard(fn, okMsg) {
  try { sync("Guardando en GitHub…"); const r = await fn(); sync(okMsg || "Guardado."); setTimeout(() => sync(""), 4000); return r; }
  catch (e) { console.error(e); sync(e.message || String(e), true); return null; }
}

/* ---------- arranque y acceso ---------- */
async function boot() {
  try { const r = await fetch("config.json?t=" + Date.now(), { cache: "no-store" }); S.cfg = r.ok ? await r.json() : null; } catch { S.cfg = null; }
  window.addEventListener("hashchange", route);
  $("#f-login").addEventListener("submit", onLogin);
  $("#f-setup").addEventListener("submit", onSetup);
  $("#btn-logout").addEventListener("click", () => { store.del("inv.token"); S.token = null; location.hash = ""; location.reload(); });
  $("#who-sel").addEventListener("change", onWho);
  const t = store.get("inv.token");
  if (t && S.cfg?.cifrado) { S.token = t; if (await loadAll()) return route(); }
  route();
}
function show(id) { $$(".view").forEach(v => v.hidden = v.id !== id); }

async function onLogin(e) {
  e.preventDefault();
  const msg = $("#login-msg"); msg.className = "msg"; msg.textContent = "Comprobando…";
  if (!S.cfg?.cifrado) { msg.className = "msg err"; msg.textContent = "Todavía no hay acceso configurado. Usa «Configurar el acceso»."; return; }
  try { S.token = await decryptToken(S.cfg.cifrado, $("#login-pass").value); }
  catch { msg.className = "msg err"; msg.textContent = "Contraseña incorrecta."; return; }
  store.set("inv.token", S.token, $("#login-remember").checked);
  $("#login-pass").value = "";
  if (await loadAll()) { msg.textContent = ""; location.hash = "#inventario"; route(); }
  else { msg.className = "msg err"; msg.textContent = $("#sync").textContent; }
}

async function onSetup(e) {
  e.preventDefault();
  const m = $("#setup-msg"); m.className = "msg";
  const p1 = $("#s-pass").value, p2 = $("#s-pass2").value;
  if (p1 !== p2) { m.className = "msg err"; m.textContent = "Las contraseñas no coinciden."; return; }
  const cfg = { owner: $("#s-owner").value.trim(), repo: $("#s-repo").value.trim(), branch: $("#s-branch").value.trim() || "main" };
  const token = $("#s-token").value.trim();
  m.textContent = "Comprobando el token con GitHub…";
  const prev = { cfg: S.cfg, token: S.token };
  S.cfg = cfg; S.token = token;
  try {
    const r = await api("");
    if (!r.ok) throw new Error(ghError(r.status));
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
  finally { S.cfg = prev.cfg?.cifrado ? prev.cfg : S.cfg; S.token = prev.token; }
}

async function loadAll() {
  sync("Cargando el inventario desde GitHub…");
  try {
    const [inv, listas, cat] = await Promise.all([ghGet(FILES.inv), ghGet(FILES.listas), ghGet(FILES.cat)]);
    S.inv = inv.data || { version: 1, items: [] }; S.sha.inv = inv.sha;
    S.listas = listas.data || {}; S.sha.listas = listas.sha;
    S.cat = cat.data || [];
    S.listas.personas ||= []; S.listas.centro ||= { nombre: "", departamento: "", jefeDepartamento: "" };
    fillWho(); sync(""); return true;
  } catch (e) { console.error(e); sync(e.message, true); store.del("inv.token"); S.token = null; return false; }
}

function fillWho() {
  const sel = $("#who-sel"), cur = store.get("inv.who") || "";
  sel.innerHTML = `<option value="">Registrado por…</option>` + S.listas.personas.map(p => `<option${p === cur ? " selected" : ""}>${esc(p)}</option>`).join("") + `<option value="__new">Añadir persona…</option>`;
}
async function onWho() {
  const sel = $("#who-sel");
  if (sel.value === "__new") {
    const n = (await ask("Nombre de la persona", "Aparecerá en el historial de cada cambio que registre.", ""))?.trim();
    if (n) { await guard(() => commit("listas", l => { l.personas = uniq([...(l.personas || []), n]); }, `Añade persona: ${n}`)); store.set("inv.who", n, true); }
    fillWho(); return;
  }
  store.set("inv.who", sel.value, true);
}
async function who() {
  let w = store.get("inv.who");
  if (!w) {
    $("#who-sel").focus();
    await info("Indica quién registra el cambio", "Elige tu nombre en el desplegable «Registrado por» de la parte superior (o añádelo) y vuelve a guardar.");
    return null;
  }
  return w;
}

/* ---------- diálogos ---------- */
function dialog(html) {
  return new Promise(res => {
    const d = $("#dlg"); $("#dlg-body").innerHTML = html; d.showModal();
    d.onclose = () => res(d.returnValue);
  });
}
async function info(t, txt) { await dialog(`<h2>${esc(t)}</h2><p>${esc(txt)}</p><div class="row"><button class="btn" value="ok">Entendido</button></div>`); }
async function confirmBox(t, txt, ok = "Confirmar", danger) {
  return (await dialog(`<h2>${esc(t)}</h2><p>${esc(txt)}</p><div class="row"><button class="btn ${danger ? "danger" : ""}" value="ok">${esc(ok)}</button><button class="btn ghost" value="no">Cancelar</button></div>`)) === "ok";
}
async function ask(t, txt, v) {
  const r = await dialog(`<h2>${esc(t)}</h2><p class="muted">${esc(txt)}</p><input id="ask-in" value="${esc(v)}"><div class="row" style="margin-top:12px"><button class="btn" value="ok">Aceptar</button><button class="btn ghost" value="no">Cancelar</button></div>`);
  return r === "ok" ? $("#ask-in").value : null;
}

/* ---------- enrutado ---------- */
function route() {
  if (location.hash === "#configurar") return show("v-setup");
  if (!S.token || !S.inv) return show("v-login");
  show("v-main");
  const [view, arg] = location.hash.slice(1).split("/");
  $$(".tabs a").forEach(a => a.classList.toggle("on", a.dataset.tab === (view === "ficha" || view === "nuevo" ? "inventario" : view || "inventario")));
  const c = $("#content");
  ({ inventario: vInventario, ficha: () => vFicha(arg), nuevo: () => vFicha(null, arg), reactivos: vCatalogo, importar: vImportar, listados: vListados, ajustes: vAjustes }[view] || vInventario)(c);
  window.scrollTo(0, 0);
}

/* ---------- listas para desplegables ---------- */
const items = () => S.inv.items;
function opts(key, field) { return uniq([...(S.listas[key] || []), ...(field ? items().map(i => i[field]) : [])]); }
function specsFor(den) { const d = norm(den); return uniq(items().filter(i => norm(i.denominacion) === d).map(i => i.especificacion)); }
function armariosFor(ub) { return uniq([...((S.listas.armarios || {})[ub] || []), ...items().filter(i => i.ubicacion === ub).map(i => i.armario)]); }
function dl(id, values) { return `<datalist id="${id}">${values.map(v => `<option value="${esc(v)}">`).join("")}</datalist>`; }
const sel = (id, values, cur, empty = "") => `<select id="${id}">${empty !== null ? `<option value="">${esc(empty)}</option>` : ""}${values.map(v => `<option${v === cur ? " selected" : ""}>${esc(v)}</option>`).join("")}</select>`;
function ghsSvg(code) { return `<svg class="ghs" viewBox="0 0 40 40" role="img" aria-label="${code} ${GHS[code]}"><title>${code} · ${GHS[code]}</title><rect x="7" y="7" width="26" height="26" transform="rotate(45 20 20)" fill="var(--surface)" stroke="var(--ghs)" stroke-width="3"/><text x="20" y="25" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="13" font-weight="600" fill="var(--ink)">${code.slice(3)}</text></svg>`; }
function casValido(cas) { const m = /^(\d{2,7})-(\d{2})-(\d)$/.exec(cas || ""); if (!m) return false; const d = (m[1] + m[2]).split("").reverse(); return d.reduce((s, x, i) => s + (+x) * (i + 1), 0) % 10 === +m[3]; }
const label = i => [i.denominacion, i.especificacion, i.marca].filter(Boolean).join(" · ");

// Añade a las listas los valores nuevos escritos en una ficha (desplegables ampliables)
async function learn(item) {
  const add = {};
  const push = (k, v) => { if (v && !(S.listas[k] || []).includes(v)) (add[k] ||= []).push(v); };
  push("categorias", item.categoria); push("ubicaciones", item.ubicacion); push("proveedores", item.proveedor); push("motivosBaja", item.motivoBaja);
  if (item.reactivo) { push("fabricantes", item.reactivo.fabricante); push("concentraciones", item.reactivo.concentracion); push("armariosSeguridad", item.reactivo.armarioSeguridad); }
  if (item.fungible) push("unidadesStock", item.fungible.unidadStock);
  if (item.coleccion) push("tiposColeccion", item.coleccion.tipoColeccion);
  const arm = item.armario && item.ubicacion && !((S.listas.armarios || {})[item.ubicacion] || []).includes(item.armario);
  if (!Object.keys(add).length && !arm) return;
  await commit("listas", l => {
    for (const [k, v] of Object.entries(add)) l[k] = uniq([...(l[k] || []), ...v]);
    if (arm) { l.armarios ||= {}; l.armarios[item.ubicacion] = uniq([...(l.armarios[item.ubicacion] || []), item.armario]); }
  }, "Añade valores nuevos a los desplegables");
}

/* ---------- vista: inventario ---------- */
function filtrar(list, f) {
  const qs = norm(f.q).split(/\s+/).filter(Boolean);
  return list.filter(i => {
    if (f.tipo && i.tipo !== f.tipo) return false;
    if (f.cat && i.categoria !== f.cat) return false;
    if (f.ubic && i.ubicacion !== f.ubic) return false;
    if (f.estado === "activos" && i.estado === "De baja") return false;
    if (f.estado && f.estado !== "activos" && f.estado !== "todos" && i.estado !== f.estado) return false;
    if (qs.length) {
      const hay = norm([i.ref, i.denominacion, i.especificacion, i.marca, i.ubicacion, i.armario, i.categoria, i.observaciones, i.reactivo?.cas, i.reactivo?.formula, i.reactivo?.refFabricante].join(" "));
      if (!qs.every(q => hay.includes(q))) return false;
    }
    return true;
  });
}
function ordenar(list) {
  const { k, dir } = S.orden;
  return [...list].sort((a, b) => {
    const x = a[k] ?? "", y = b[k] ?? "";
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "es", { numeric: true })) * dir;
  });
}
function cant(i) { return i.cantidadIndeterminada ? "varios" : (i.cantidad ?? ""); }
function estadoPill(e) { return `<span class="pill ${e === "De baja" ? "baja" : e === "Operativo" ? "" : "warn"}">${esc(e)}</span>`; }

function filterBar(f, prefix) {
  return `<div class="toolbar">
    <div><label for="${prefix}q">Buscar</label><input id="${prefix}q" type="search" value="${esc(f.q)}" placeholder="Nombre, referencia, marca, CAS…"></div>
    <div><label for="${prefix}tipo">Tipo</label>${sel(prefix + "tipo", TIPOS, f.tipo, "Todos")}</div>
    <div><label for="${prefix}cat">Categoría</label>${sel(prefix + "cat", opts("categorias", "categoria"), f.cat, "Todas")}</div>
    <div><label for="${prefix}ubic">Ubicación</label>${sel(prefix + "ubic", opts("ubicaciones", "ubicacion"), f.ubic, "Todas")}</div>
    <div><label for="${prefix}estado">Estado</label><select id="${prefix}estado">${[["activos", "En uso (sin bajas)"], ["todos", "Todos"], ...ESTADOS.map(e => [e, e])].map(([v, t]) => `<option value="${esc(v)}"${v === f.estado ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
    ${prefix === "f-" ? `<div><a class="btn" href="#nuevo">+ Nuevo elemento</a></div>` : "<div></div>"}
  </div>`;
}
function bindFilters(f, prefix, cb) {
  ["q", "tipo", "cat", "ubic", "estado"].forEach(k => $("#" + prefix + k).addEventListener(k === "q" ? "input" : "change", e => { f[k] = e.target.value; cb(); }));
}

function vInventario(c) {
  const f = S.filtros;
  c.innerHTML = `<h1>Inventario</h1>${filterBar(f, "f-")}<div class="summary" id="inv-sum"></div><div class="tablewrap"><table><thead><tr>
    ${[["ref", "N.º ref."], ["denominacion", "Denominación"], ["cantidad", "Cant."], ["ubicacion", "Ubicación"], ["categoria", "Categoría"], ["estado", "Estado"]].map(([k, t]) => `<th data-k="${k}" aria-sort="${S.orden.k === k ? (S.orden.dir > 0 ? "ascending" : "descending") : "none"}">${t}</th>`).join("")}
    </tr></thead><tbody id="inv-body"></tbody></table></div>`;
  const draw = () => {
    const list = ordenar(filtrar(items(), f));
    const tot = items().filter(i => i.estado !== "De baja").length;
    $("#inv-sum").innerHTML = `<span><strong>${list.length}</strong> elementos mostrados</span><span>${tot} en uso en total</span><span>${items().length - tot} de baja</span><span>Actualizado: ${esc((S.inv.actualizado || "").replace("T", " "))}</span>`;
    $("#inv-body").innerHTML = list.map(i => `<tr data-id="${esc(i.id)}">
      <td data-l="Ref." class="mono">${esc(i.ref)}</td>
      <td data-l="Denominación"><strong>${esc(i.denominacion)}</strong>${i.especificacion || i.marca ? `<div class="sub">${esc([i.especificacion, i.marca].filter(Boolean).join(" · "))}</div>` : ""}${i.reactivo?.pictogramas?.length ? `<div>${i.reactivo.pictogramas.map(ghsSvg).join("")}</div>` : ""}</td>
      <td data-l="Cantidad" class="num">${esc(cant(i))}</td>
      <td data-l="Ubicación">${esc(i.ubicacion)}${i.armario ? `<div class="sub">${esc(i.armario)}</div>` : ""}</td>
      <td data-l="Categoría">${esc(i.categoria)}<div class="sub">${esc(i.tipo)}</div></td>
      <td data-l="Estado">${estadoPill(i.estado)}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">No hay elementos con estos filtros.</td></tr>`;
  };
  bindFilters(f, "f-", draw);
  $$("th[data-k]", c).forEach(th => th.addEventListener("click", () => { const k = th.dataset.k; S.orden = { k, dir: S.orden.k === k ? -S.orden.dir : 1 }; vInventario(c); }));
  $("#inv-body").addEventListener("click", e => { const tr = e.target.closest("tr[data-id]"); if (tr) location.hash = "#ficha/" + tr.dataset.id; });
  draw();
}

/* ---------- vista: ficha ---------- */
function blank(tipo) {
  const i = { id: newId(), ref: "", tipo: tipo || "Material de laboratorio reutilizable", categoria: "", denominacion: "", especificacion: "", marca: "", cantidad: 1, cantidadIndeterminada: false, ubicacion: "", armario: "", estado: "Operativo", origen: "Compra", proveedor: "", codigoProveedor: "", factura: "", precio: null, fechaAlta: today(), fechaBaja: "", motivoBaja: "", observaciones: "", historial: [] };
  return ensureSub(i);
}
function ensureSub(i) {
  if (i.tipo === "Reactivos") i.reactivo ||= { formula: "", cas: "", fabricante: "", refFabricante: "", lote: "", concentracion: "", estadoFisico: "", envase: "", cantidadRestante: "", pictogramas: [], frasesHP: "", armarioSeguridad: "", fechaApertura: "", fechaCaducidad: "", fds: "" };
  if (i.tipo === "Material fungible") i.fungible ||= { unidadStock: "", unidadesEnvase: null, stockMinimo: null, caducidad: "" };
  if (i.tipo === "Colecciones") i.coleccion ||= { tipoColeccion: "", nEjemplares: null, ejemplares: [] };
  return i;
}
const fld = (id, lab, val, extra = "", cls = "") => `<div class="${cls}"><label for="${id}">${lab}</label><input id="${id}" value="${esc(val ?? "")}" ${extra}></div>`;

function vFicha(id, tipoNuevo, preset) {
  const c = $("#content");
  const orig = preset ? preset.orig : id ? items().find(i => i.id === id) : null;
  if (id && !orig && !preset) { c.innerHTML = `<p>No se encuentra este elemento.</p><a href="#inventario">Volver al inventario</a>`; return; }
  const it = ensureSub(preset ? preset.obj : structuredClone(orig || blank(decodeURIComponent(tipoNuevo || ""))));
  const r = it.reactivo, fu = it.fungible, co = it.coleccion;
  c.innerHTML = `<p><a href="#inventario">← Inventario</a></p>
  <form class="sheet" id="f-item" autocomplete="off">
    <h1>${orig ? esc(label(orig)) : "Nuevo elemento"} ${orig ? estadoPill(orig.estado) : ""}</h1>
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
      ${fld("i-alta", "Fecha de alta", it.fechaAlta, 'placeholder="aaaa-mm-dd"')}
      ${fld("i-prov", "Proveedor", it.proveedor, 'list="dl-prov"')}
      ${fld("i-codprov", "Código de artículo del proveedor", it.codigoProveedor)}
      ${fld("i-fact", "N.º de factura", it.factura)}
      ${fld("i-precio", "Precio unitario (€)", it.precio ?? "", 'type="number" min="0" step="0.01"')}
      <div class="span2"><label for="i-obs">Observaciones</label><textarea id="i-obs" rows="2">${esc(it.observaciones)}</textarea></div>
    </div>
    ${it.estado === "De baja" ? `<fieldset><legend>Baja</legend><div class="grid">${fld("i-fbaja", "Fecha de baja", it.fechaBaja)}${fld("i-mbaja", "Motivo de baja", it.motivoBaja, 'list="dl-motivo"')}</div></fieldset>` : ""}
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
    ${orig?.historial?.length ? `<fieldset><legend>Historial</legend><ul class="hist">${orig.historial.slice().reverse().map(h => `<li>${esc(h.fecha.replace("T", " "))} · <strong>${esc(h.por)}</strong> · ${esc(h.accion)}${h.detalle ? ` · ${esc(h.detalle)}` : ""}</li>`).join("")}</ul></fieldset>` : ""}
    <div class="actions">
      <button class="btn" type="submit">Guardar</button>
      ${orig && orig.estado !== "De baja" ? `<button class="btn ghost" type="button" id="b-baja">Dar de baja</button>` : ""}
      ${orig?.estado === "De baja" ? `<button class="btn ghost" type="button" id="b-alta">Reactivar</button>` : ""}
      ${orig ? `<button class="btn ghost" type="button" id="b-dup">Duplicar</button>` : ""}
      ${orig ? `<button class="btn ghost" type="button" id="b-del" style="margin-left:auto;color:var(--bad);border-color:var(--bad)">Eliminar (error de registro)</button>` : ""}
    </div>
    ${dl("dl-cat", opts("categorias", "categoria"))}${dl("dl-den", uniq(items().map(i => i.denominacion)))}${dl("dl-spec", specsFor(it.denominacion))}${dl("dl-marca", uniq(items().map(i => i.marca)))}
    ${dl("dl-ubic", opts("ubicaciones", "ubicacion"))}${dl("dl-arm", armariosFor(it.ubicacion))}${dl("dl-prov", opts("proveedores", "proveedor"))}${dl("dl-motivo", S.listas.motivosBaja || [])}
    ${dl("dl-fab", opts("fabricantes"))}${dl("dl-conc", opts("concentraciones"))}${dl("dl-armseg", opts("armariosSeguridad"))}${dl("dl-unid", opts("unidadesStock"))}${dl("dl-tcol", opts("tiposColeccion"))}
  </form>`;

  // dependencias de los desplegables
  $("#i-den").addEventListener("change", e => { $("#dl-spec").outerHTML = dl("dl-spec", specsFor(e.target.value)); });
  $("#i-ubic").addEventListener("change", e => { $("#dl-arm").outerHTML = dl("dl-arm", armariosFor(e.target.value)); });
  $("#i-indet").addEventListener("change", e => { $("#i-cant").disabled = e.target.checked; });
  $("#i-tipo").addEventListener("change", () => { collect(it); ensureSub(it); if (it.tipo === "Reactivos" && !it.categoria) it.categoria = "Reactivos"; vFicha(null, null, { obj: it, orig }); });
  if (r) {
    const casMsg = () => { const v = $("#r-cas").value.trim(); $("#r-cas-msg").textContent = !v ? "" : casValido(v) ? "✓ CAS válido" : "El dígito de control no cuadra: revisa el número."; $("#r-links").innerHTML = v && casValido(v) ? `Información de seguridad: <a href="https://pubchem.ncbi.nlm.nih.gov/compound/${encodeURIComponent(v)}" target="_blank" rel="noopener">PubChem</a>` : ""; };
    $("#r-cas").addEventListener("input", casMsg); casMsg();
  }
  if (co) {
    const body = $("#ej-body");
    const drawEj = () => {
      body.innerHTML = co.ejemplares.map((e, k) => `<tr data-k="${k}">${["n", "nombre", "clasificacion", "localidad", "edad", "estado"].map(f => `<td><input data-f="${f}" value="${esc(e[f])}" aria-label="${f}"></td>`).join("")}<td><button type="button" class="btn ghost small" data-del="${k}" aria-label="Quitar ejemplar">✕</button></td></tr>`).join("") || `<tr><td colspan="7" class="muted">Sin ejemplares registrados.</td></tr>`;
      $("#c-n").disabled = co.ejemplares.length > 0; if (co.ejemplares.length) $("#c-n").value = co.ejemplares.length;
    };
    body.addEventListener("input", e => { const tr = e.target.closest("tr[data-k]"); if (tr) co.ejemplares[+tr.dataset.k][e.target.dataset.f] = e.target.value; });
    body.addEventListener("click", e => { const k = e.target.dataset.del; if (k !== undefined) { co.ejemplares.splice(+k, 1); drawEj(); } });
    $("#ej-add").addEventListener("click", () => { co.ejemplares.push({ n: String(co.ejemplares.length + 1), nombre: "", clasificacion: "", localidad: "", edad: "", estado: "Completo", observaciones: "" }); drawEj(); });
    drawEj();
  }

  $("#f-item").addEventListener("submit", async e => {
    e.preventDefault();
    collect(it);
    const w = await who(); if (!w) return;
    if (it.ref && items().some(x => x.ref === it.ref && x.id !== it.id)) { if (!await confirmBox("Referencia repetida", `Ya hay otro elemento con el n.º de referencia ${it.ref}. ¿Guardar igualmente?`, "Guardar")) return; }
    const accion = orig ? "Modificación" : "Alta";
    const cambios = orig ? diff(orig, it) : "";
    it.historial = [...(orig?.historial || []), { fecha: nowISO(), por: w, accion, detalle: cambios }];
    const ok = await guard(async () => {
      await commit("inv", d => { const k = d.items.findIndex(x => x.id === it.id); if (k >= 0) d.items[k] = it; else d.items.push(it); }, `${accion}: ${label(it)} (por ${w})`);
      await learn(it);
      return true;
    }, `${accion} guardada.`);
    if (ok) location.hash = "#ficha/" + it.id;
  });
  $("#b-baja")?.addEventListener("click", async () => {
    const r2 = await dialog(`<h2>Dar de baja</h2><p>${esc(label(orig))}</p>
      <label for="bj-f">Fecha de baja</label><input id="bj-f" type="date" value="${today()}">
      <label for="bj-m">Motivo</label><input id="bj-m" list="dl-motivo2" required>${dl("dl-motivo2", S.listas.motivosBaja || [])}
      ${orig.cantidad > 1 && !orig.cantidadIndeterminada ? `<label for="bj-n">Unidades que se dan de baja (de ${orig.cantidad})</label><input id="bj-n" type="number" min="1" max="${orig.cantidad}" value="${orig.cantidad}">` : ""}
      <label for="bj-o">Observaciones</label><input id="bj-o">
      <div class="row" style="margin-top:12px"><button class="btn danger" value="ok">Dar de baja</button><button class="btn ghost" value="no" formnovalidate>Cancelar</button></div>`);
    if (r2 !== "ok") return;
    const w = await who(); if (!w) return;
    const fecha = $("#bj-f").value || today(), motivo = $("#bj-m").value.trim() || "Otro", n = +($("#bj-n")?.value || orig.cantidad || 0), obs = $("#bj-o").value.trim();
    await guard(async () => {
      await commit("inv", d => {
        const k = d.items.findIndex(x => x.id === orig.id); const cur = d.items[k];
        const h = { fecha: nowISO(), por: w, accion: "Baja", detalle: `${motivo}${obs ? " · " + obs : ""}` };
        if (n && cur.cantidad > n) { // baja parcial: se separa una línea de baja
          cur.cantidad -= n; cur.historial.push({ ...h, accion: `Baja parcial de ${n} ud.` });
          const b = structuredClone(cur); b.id = newId(); b.cantidad = n; b.ref = ""; b.estado = "De baja"; b.fechaBaja = fecha; b.motivoBaja = motivo; b.historial = [...cur.historial];
          d.items.push(b);
        } else { Object.assign(cur, { estado: "De baja", fechaBaja: fecha, motivoBaja: motivo }); cur.historial.push(h); }
      }, `Baja: ${label(orig)} (${motivo}, por ${w})`);
      await learn({ motivoBaja: motivo });
    }, "Baja registrada.");
    route();
  });
  $("#b-alta")?.addEventListener("click", async () => {
    const w = await who(); if (!w) return;
    await guard(() => commit("inv", d => { const cur = d.items.find(x => x.id === orig.id); Object.assign(cur, { estado: "Operativo", fechaBaja: "", motivoBaja: "" }); cur.historial.push({ fecha: nowISO(), por: w, accion: "Reactivación" }); }, `Reactivación: ${label(orig)} (por ${w})`), "Elemento reactivado.");
    route();
  });
  $("#b-dup")?.addEventListener("click", () => { const d = structuredClone(orig); d.id = newId(); d.ref = ""; d.historial = []; d.fechaAlta = today(); if (d.coleccion) d.coleccion.ejemplares = []; vFicha(null, null, { obj: d, orig: null }); window.scrollTo(0, 0); });
  $("#b-del")?.addEventListener("click", async () => {
    if (!await confirmBox("Eliminar definitivamente", "Úsalo solo si el elemento se registró por error. Si el material existía y ya no está, usa «Dar de baja» para que quede constancia. (El historial de GitHub conserva una copia.)", "Eliminar", true)) return;
    const w = await who(); if (!w) return;
    const ok = await guard(() => commit("inv", d => { d.items = d.items.filter(x => x.id !== orig.id); }, `Eliminado por error de registro: ${label(orig)} (por ${w})`), "Elemento eliminado.");
    if (ok) location.hash = "#inventario";
  });
}
function collect(it) {
  const v = id => $("#" + id)?.value.trim() ?? "";
  Object.assign(it, {
    tipo: v("i-tipo"), categoria: v("i-cat"), ref: v("i-ref"), denominacion: v("i-den"), especificacion: v("i-spec"), marca: v("i-marca"),
    cantidadIndeterminada: $("#i-indet").checked, cantidad: $("#i-indet").checked ? null : (v("i-cant") === "" ? null : +v("i-cant")),
    ubicacion: v("i-ubic"), armario: v("i-arm"), estado: v("i-estado") || it.estado, origen: $("input[name=i-origen]:checked")?.value || "",
    fechaAlta: v("i-alta"), proveedor: v("i-prov"), codigoProveedor: v("i-codprov"), factura: v("i-fact"), precio: v("i-precio") === "" ? null : +v("i-precio"),
    observaciones: $("#i-obs").value.trim()
  });
  if ($("#i-fbaja")) { it.fechaBaja = v("i-fbaja"); it.motivoBaja = v("i-mbaja"); }
  if (it.reactivo && $("#r-cas")) Object.assign(it.reactivo, { formula: v("r-formula"), cas: v("r-cas"), fabricante: v("r-fab"), refFabricante: v("r-reffab"), lote: v("r-lote"), concentracion: v("r-conc"), estadoFisico: v("r-fis"), envase: v("r-env"), cantidadRestante: v("r-rest"), armarioSeguridad: v("r-armseg"), fechaApertura: v("r-fap"), fechaCaducidad: v("r-fcad"), fds: v("r-fds"), frasesHP: v("r-hp"), pictogramas: $$("input[name=r-ghs]:checked").map(x => x.value) });
  if (it.fungible && $("#u-unidad")) Object.assign(it.fungible, { unidadStock: v("u-unidad"), unidadesEnvase: v("u-porenv") === "" ? null : +v("u-porenv"), stockMinimo: v("u-min") === "" ? null : +v("u-min"), caducidad: v("u-cad") });
  if (it.coleccion && $("#c-tipo")) { it.coleccion.tipoColeccion = v("c-tipo"); it.coleccion.nEjemplares = it.coleccion.ejemplares.length || (v("c-n") === "" ? null : +v("c-n")); }
  if (it.tipo !== "Reactivos") delete it.reactivo;
  if (it.tipo !== "Material fungible") delete it.fungible;
  if (it.tipo !== "Colecciones") delete it.coleccion;
  return it;
}
function diff(a, b) {
  const nombres = { ref: "referencia", tipo: "tipo", categoria: "categoría", denominacion: "denominación", especificacion: "especificación", marca: "marca", cantidad: "cantidad", ubicacion: "ubicación", armario: "armario", estado: "estado", origen: "origen", proveedor: "proveedor", fechaAlta: "fecha de alta", observaciones: "observaciones" };
  const ch = Object.keys(nombres).filter(k => String(a[k] ?? "") !== String(b[k] ?? "")).map(k => `${nombres[k]}: «${a[k] ?? ""}» → «${b[k] ?? ""}»`);
  if (JSON.stringify(a.reactivo || a.fungible || a.coleccion) !== JSON.stringify(b.reactivo || b.fungible || b.coleccion)) ch.push("datos específicos del tipo");
  return ch.join("; ");
}

/* ---------- vista: catálogo de reactivos ---------- */
function vCatalogo(c) {
  const grupos = uniq(S.cat.map(r => r.grupo)); let g = "", q = "";
  const enInv = r => items().some(i => i.tipo === "Reactivos" && i.estado !== "De baja" && ((r.cas && i.reactivo?.cas === r.cas) || norm(i.denominacion) === norm(r.nombre)));
  c.innerHTML = `<h1>Catálogo de reactivos</h1><p class="muted">Marca los reactivos que tenéis, completa envase, número de envases y ubicación, y añádelos al inventario de una vez. Los que ya están en el inventario aparecen atenuados.</p>
    <div class="cat-layout"><div><input id="c-q" type="search" placeholder="Buscar por nombre, sinónimo, fórmula o CAS"><div class="chips" id="c-chips"></div><div id="c-list"></div></div>
    <aside class="tray"><h2>Seleccionados (<span id="c-n">0</span>)</h2><div id="c-tray"></div>
    <div class="row" style="margin-top:10px"><button class="btn" id="c-add" disabled>Añadir al inventario</button></div><p class="msg" id="c-msg"></p></aside></div>
    ${dl("dl-ubic", opts("ubicaciones", "ubicacion"))}${dl("dl-armseg", opts("armariosSeguridad"))}`;
  $("#c-chips").innerHTML = [["", "Todos"], ...grupos.map(x => [x, x])].map(([v, t]) => `<button class="chip" aria-pressed="${v === g}" data-g="${esc(v)}">${esc(t)}</button>`).join("");
  $("#c-chips").onclick = e => { const b = e.target.closest(".chip"); if (!b) return; g = b.dataset.g; $$(".chip", c).forEach(x => x.setAttribute("aria-pressed", x === b)); draw(); };
  $("#c-q").oninput = e => { q = norm(e.target.value); draw(); };
  const draw = () => {
    const qs = q.split(/\s+/).filter(Boolean);
    const list = S.cat.map((r, k) => ({ ...r, k })).filter(r => (!g || r.grupo === g) && qs.every(t => norm([r.nombre, r.sinonimos, r.formula, r.cas].join(" ")).includes(t)));
    $("#c-list").innerHTML = list.map(r => `<div class="crow${S.sel.has(r.k) ? " sel" : ""}${enInv(r) ? " have" : ""}" data-k="${r.k}"><input type="checkbox" ${S.sel.has(r.k) ? "checked" : ""} aria-label="Seleccionar ${esc(r.nombre)}">
      <div><strong>${esc(r.nombre)}</strong>${enInv(r) ? ` <span class="pill">ya en inventario</span>` : ""}${r.sinonimos ? `<div class="sub">${esc(r.sinonimos)}</div>` : ""}<div class="sub"><span class="mono">${esc(r.formula)}</span> ${r.cas ? `· <span class="mono">CAS ${esc(r.cas)}</span>` : ""} ${r.notas ? `· <span class="pill warn">${esc(r.notas)}</span>` : ""}</div></div>
      <div>${r.pictogramas.map(ghsSvg).join("")}</div></div>`).join("") || `<p class="muted">Ningún reactivo coincide. Puedes darlo de alta a mano desde «Nuevo elemento» con tipo Reactivos.</p>`;
  };
  $("#c-list").onclick = e => {
    const row = e.target.closest(".crow"); if (!row) return; const k = +row.dataset.k;
    if (S.sel.has(k)) S.sel.delete(k); else S.sel.set(k, { envase: "", n: 1, ubic: store.get("inv.lastUbic") || "Laboratorio", armseg: "" });
    draw(); tray();
  };
  const tray = () => {
    $("#c-n").textContent = S.sel.size; $("#c-add").disabled = !S.sel.size;
    $("#c-tray").innerHTML = [...S.sel].map(([k, v]) => `<div class="it" data-k="${k}"><div class="row" style="justify-content:space-between"><strong>${esc(S.cat[k].nombre)}</strong><button class="btn ghost small" data-x="${k}" aria-label="Quitar">✕</button></div>
      <div class="f3"><input data-f="envase" value="${esc(v.envase)}" placeholder="Envase (500 g)" aria-label="Envase"><input data-f="ubic" value="${esc(v.ubic)}" list="dl-ubic" aria-label="Ubicación"><input data-f="n" type="number" min="1" value="${v.n}" aria-label="N.º de envases"></div>
      <input data-f="armseg" value="${esc(v.armseg)}" list="dl-armseg" placeholder="Armario de seguridad (opcional)" style="margin-top:6px;padding:4px 6px;font-size:.85rem" aria-label="Armario de seguridad"></div>`).join("") || `<p class="muted small">Marca reactivos en la lista.</p>`;
  };
  $("#c-tray").oninput = e => { const it = e.target.closest(".it"); if (it) S.sel.get(+it.dataset.k)[e.target.dataset.f] = e.target.value; };
  $("#c-tray").onclick = e => { const x = e.target.dataset.x; if (x !== undefined) { S.sel.delete(+x); draw(); tray(); } };
  $("#c-add").onclick = async () => {
    const w = await who(); if (!w) return;
    const nuevos = [...S.sel].map(([k, v]) => { const r = S.cat[k]; const i = ensureSub(blank("Reactivos")); Object.assign(i, { categoria: "Reactivos", denominacion: r.nombre, cantidad: +v.n || 1, ubicacion: v.ubic || "Laboratorio", origen: "Dotación", observaciones: r.notas || "" }); Object.assign(i.reactivo, { formula: r.formula, cas: r.cas, envase: v.envase, pictogramas: [...r.pictogramas], armarioSeguridad: v.armseg }); i.historial = [{ fecha: nowISO(), por: w, accion: "Alta desde el catálogo" }]; return i; });
    const ok = await guard(async () => { await commit("inv", d => d.items.push(...nuevos), `Alta de ${nuevos.length} reactivos desde el catálogo (por ${w})`); for (const n of nuevos) await learn(n); return true; }, `${nuevos.length} reactivos añadidos.`);
    if (ok) { store.set("inv.lastUbic", nuevos[0].ubicacion, true); S.sel.clear(); $("#c-msg").textContent = `${nuevos.length} reactivos añadidos al inventario. Origen marcado como «Dotación»: cámbialo en la ficha si alguno es una compra.`; draw(); tray(); }
  };
  draw(); tray();
}

/* ---------- vista: importar ---------- */
function vImportar(c) {
  c.innerHTML = `<h1>Importar</h1>
  <div class="sheet"><h2>Pegar una lista</h2><p class="muted">Un elemento por línea. Si empieza por un número, se toma como cantidad («3 Vaso de precipitados 250 mL»). Los reactivos se buscan en el catálogo para completar fórmula, CAS y pictogramas.</p>
   <div class="grid"><div><label for="p-tipo">Tipo</label>${sel("p-tipo", TIPOS, "Reactivos", null)}</div>${fld("p-ubic", "Ubicación", store.get("inv.lastUbic") || "Laboratorio", 'list="dl-ubic"')}${fld("p-cat", "Categoría", "Reactivos", 'list="dl-cat"')}</div>
   <label for="p-text">Lista</label><textarea id="p-text" rows="8" placeholder="Sulfato de cobre pentahidratado&#10;2 Hidróxido de sodio&#10;Azul de metileno"></textarea>
   <div class="row" style="margin-top:10px"><button class="btn" id="p-prev" type="button">Revisar antes de importar</button></div><div id="p-out"></div></div>
  <div class="sheet" style="margin-top:16px"><h2>Importar un archivo CSV</h2><p class="muted">Admite separador «;» o «,». Después indicas qué columna corresponde a cada campo.</p>
   <input id="csv-file" type="file" accept=".csv,text/csv"><div id="csv-out"></div></div>
   ${dl("dl-ubic", opts("ubicaciones", "ubicacion"))}${dl("dl-cat", opts("categorias", "categoria"))}`;

  const matchCat = name => { const n = norm(name); if (!n) return null; return S.cat.find(r => norm(r.nombre) === n) || S.cat.find(r => norm(r.sinonimos).split(/,\s*/).includes(n)) || S.cat.find(r => norm(r.nombre).startsWith(n) || n.startsWith(norm(r.nombre))) || null; };
  $("#p-prev").onclick = () => {
    const tipo = $("#p-tipo").value, ubic = $("#p-ubic").value.trim(), cat = $("#p-cat").value.trim();
    const rows = $("#p-text").value.split(/\n/).map(l => l.trim()).filter(Boolean).map(l => { const m = /^(\d+)\s+(.+)$/.exec(l); const name = m ? m[2] : l; return { n: m ? +m[1] : 1, name, m: tipo === "Reactivos" ? matchCat(name) : null }; });
    if (!rows.length) return;
    $("#p-out").innerHTML = `<div class="tablewrap" style="margin-top:12px"><table><thead><tr><th>Cant.</th><th>Escrito</th><th>Se registrará como</th></tr></thead><tbody>${rows.map(r => `<tr><td class="num">${r.n}</td><td>${esc(r.name)}</td><td>${r.m ? `<strong>${esc(r.m.nombre)}</strong> <span class="sub mono">${esc(r.m.cas)}</span>` : tipo === "Reactivos" ? `${esc(r.name)} <span class="pill warn">no está en el catálogo</span>` : esc(r.name)}</td></tr>`).join("")}</tbody></table></div>
      <div class="row" style="margin-top:10px"><button class="btn" id="p-go" type="button">Importar ${rows.length} elementos</button></div>`;
    $("#p-go").onclick = async () => {
      const w = await who(); if (!w) return;
      const nuevos = rows.map(r => { const i = ensureSub(blank(tipo)); Object.assign(i, { denominacion: r.m?.nombre || r.name, cantidad: r.n, ubicacion: ubic, categoria: cat, origen: "Dotación" }); if (i.reactivo && r.m) Object.assign(i.reactivo, { formula: r.m.formula, cas: r.m.cas, pictogramas: [...r.m.pictogramas] }); i.historial = [{ fecha: nowISO(), por: w, accion: "Alta por lista pegada" }]; return i; });
      const ok = await guard(async () => { await commit("inv", d => d.items.push(...nuevos), `Alta de ${nuevos.length} elementos por lista (por ${w})`); await learn(nuevos[0]); return true; }, `${nuevos.length} elementos importados.`);
      if (ok) { $("#p-out").innerHTML = `<p class="msg">${nuevos.length} elementos importados.</p>`; $("#p-text").value = ""; }
    };
  };

  $("#csv-file").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const txt = (await f.text()).replace(/^﻿/, "");
    const rows = parseCSV(txt); if (rows.length < 2) { $("#csv-out").innerHTML = `<p class="msg err">El archivo no tiene filas de datos.</p>`; return; }
    const head = rows[0], data = rows.slice(1).filter(r => r.some(x => x.trim()));
    const campos = [["ref", "N.º referencia"], ["tipo", "Tipo de registro"], ["categoria", "Categoría"], ["denominacion", "Denominación *"], ["especificacion", "Especificación"], ["marca", "Marca / modelo"], ["cantidad", "Cantidad"], ["ubicacion", "Ubicación"], ["armario", "Armario"], ["estado", "Estado"], ["origen", "Origen"], ["fechaAlta", "Fecha de alta"], ["fechaBaja", "Fecha de baja"], ["motivoBaja", "Motivo de baja"], ["observaciones", "Observaciones"], ["r.cas", "CAS (reactivos)"], ["r.formula", "Fórmula (reactivos)"]];
    const guess = t => { const n = norm(t); return head.findIndex(h => { const x = norm(h); return x === n || x.startsWith(n.split(" ")[0]); }); };
    $("#csv-out").innerHTML = `<p>${data.length} filas, ${head.length} columnas.</p><div class="grid">${campos.map(([k, t]) => `<div><label for="m-${k}">${t}</label><select id="m-${k}" data-k="${k}"><option value="-1">— no importar —</option>${head.map((h, j) => `<option value="${j}"${guess(t.replace(" *", "").replace(/ \(.*\)/, "")) === j ? " selected" : ""}>${esc(h)}</option>`).join("")}</select></div>`).join("")}</div>
      <div class="grid"><div><label for="m-deftipo">Tipo por defecto</label>${sel("m-deftipo", TIPOS, "Material de laboratorio reutilizable", null)}</div>${fld("m-defubic", "Ubicación por defecto", "Laboratorio", 'list="dl-ubic"')}</div>
      <div class="row" style="margin-top:10px"><button class="btn" id="csv-go" type="button">Importar ${data.length} filas</button></div><p class="msg" id="csv-msg"></p>`;
    $("#csv-go").onclick = async () => {
      const map = Object.fromEntries($$("select[data-k]", c).map(s => [s.dataset.k, +s.value]));
      if (map.denominacion < 0) { $("#csv-msg").className = "msg err"; $("#csv-msg").textContent = "Indica qué columna es la denominación."; return; }
      const w = await who(); if (!w) return;
      const get = (r, k) => map[k] >= 0 ? (r[map[k]] ?? "").trim() : "";
      const nuevos = data.map(r => {
        const tipo = TIPOS.includes(get(r, "tipo")) ? get(r, "tipo") : $("#m-deftipo").value;
        const i = ensureSub(blank(tipo)); const cn = get(r, "cantidad");
        Object.assign(i, { ref: get(r, "ref"), categoria: get(r, "categoria"), denominacion: get(r, "denominacion"), especificacion: get(r, "especificacion"), marca: get(r, "marca"), cantidad: /^\d+$/.test(cn) ? +cn : null, cantidadIndeterminada: cn !== "" && !/^\d+$/.test(cn), ubicacion: get(r, "ubicacion") || $("#m-defubic").value, armario: get(r, "armario"), estado: ESTADOS.includes(get(r, "estado")) ? get(r, "estado") : (get(r, "fechaBaja") ? "De baja" : "Operativo"), origen: get(r, "origen") || "", fechaAlta: get(r, "fechaAlta"), fechaBaja: get(r, "fechaBaja"), motivoBaja: get(r, "motivoBaja"), observaciones: get(r, "observaciones") });
        if (i.reactivo) Object.assign(i.reactivo, { cas: get(r, "r.cas"), formula: get(r, "r.formula") });
        i.historial = [{ fecha: nowISO(), por: w, accion: `Alta por importación de ${f.name}` }]; return i;
      }).filter(i => i.denominacion);
      const ok = await guard(async () => { await commit("inv", d => d.items.push(...nuevos), `Importación CSV ${f.name}: ${nuevos.length} elementos (por ${w})`); return true; }, `${nuevos.length} elementos importados.`);
      if (ok) $("#csv-msg").textContent = `${nuevos.length} elementos importados.`;
    };
  };
}
function parseCSV(t) {
  const first = t.split(/\r?\n/)[0]; const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ";" : ",";
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true; else if (ch === sep) { row.push(f); f = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && t[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

/* ---------- vista: listados y exportación ---------- */
function cursoActual() { const d = new Date(), y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1; return [`${y}-09-01`, `${y + 1}-08-31`, `${y}-${String(y + 1).slice(2)}`]; }
const FORMATOS = {
  completo: { t: "Listado completo", cols: [["N.º ref.", i => i.ref], ["Tipo", i => i.tipo], ["Categoría", i => i.categoria], ["Denominación", i => i.denominacion], ["Especificación", i => i.especificacion], ["Marca / modelo", i => i.marca], ["Cantidad", cant], ["Ubicación", i => i.ubicacion], ["Armario", i => i.armario], ["Estado", i => i.estado], ["Origen", i => i.origen], ["Fecha alta", i => i.fechaAlta], ["Fecha baja", i => i.fechaBaja], ["Motivo baja", i => i.motivoBaja], ["Observaciones", i => i.observaciones]] },
  secretaria: { t: "Formato Secretaría", cols: [["N.º Referencia", i => i.ref], ["Denominación", label], ["Cantidad", cant], ["Ubicación", i => i.ubicacion], ["Dotación / Compra", i => i.origen], ["Fecha Alta", i => i.fechaAlta], ["Fecha Baja", i => i.fechaBaja]] },
  reactivos: { t: "Reactivos", cols: [["Reactivo", i => i.denominacion], ["Fórmula", i => i.reactivo?.formula], ["CAS", i => i.reactivo?.cas], ["Envase", i => i.reactivo?.envase], ["N.º envases", cant], ["Ubicación", i => [i.ubicacion, i.armario].filter(Boolean).join(" · ")], ["Armario de seguridad", i => i.reactivo?.armarioSeguridad], ["Pictogramas", i => (i.reactivo?.pictogramas || []).join(" ")], ["Caducidad", i => i.reactivo?.fechaCaducidad], ["Observaciones", i => i.observaciones]] },
  colecciones: { t: "Colecciones con ejemplares", cols: [["Colección / ejemplar", i => i._ej ? "   " + [i._ej.n, i._ej.nombre].filter(Boolean).join(" · ") : label(i)], ["Tipo / clasificación", i => i._ej ? i._ej.clasificacion : i.coleccion?.tipoColeccion], ["N.º ejemplares / localidad", i => i._ej ? i._ej.localidad : (i.coleccion?.ejemplares?.length || i.coleccion?.nEjemplares || "")], ["Edad", i => i._ej?.edad], ["Estado", i => i._ej ? i._ej.estado : i.estado], ["Ubicación", i => i._ej ? "" : [i.ubicacion, i.armario].filter(Boolean).join(" · ")]] }
};
function vListados(c) {
  const f = { q: "", tipo: "", cat: "", ubic: "", estado: "activos" }; let fmt = "completo", desde = "", hasta = "", campoFecha = "fechaAlta";
  const [ci, cf, cl] = cursoActual();
  c.innerHTML = `<h1>Listados</h1>${filterBar(f, "l-")}
   <div class="grid" style="margin-bottom:10px"><div><label for="l-fmt">Formato</label><select id="l-fmt">${Object.entries(FORMATOS).map(([k, v]) => `<option value="${k}">${v.t}</option>`).join("")}</select></div>
    <div><label for="l-campo">Filtrar por fecha de</label><select id="l-campo"><option value="fechaAlta">alta</option><option value="fechaBaja">baja</option></select></div>
    ${fld("l-desde", "Desde", "", 'type="date"')}${fld("l-hasta", "Hasta", "", 'type="date"')}
    <div><label>&nbsp;</label><button class="btn ghost" id="l-curso" type="button">Bajas del curso ${cl}</button></div></div>
   <div class="row"><button class="btn" id="l-pdf" type="button">PDF / imprimir</button><button class="btn ghost" id="l-xlsx" type="button">Excel</button><button class="btn ghost" id="l-csv" type="button">CSV</button><span class="muted small" id="l-n"></span></div>
   <p class="muted small">Para el PDF, elige «Guardar como PDF» en la ventana de impresión. Sale en horizontal.</p>
   <div class="tablewrap" style="margin-top:10px"><table id="l-prev"></table></div>`;
  const rows = () => {
    let l = ordenar(filtrar(items(), f));
    if (desde) l = l.filter(i => (i[campoFecha] || "") >= desde); if (hasta) l = l.filter(i => i[campoFecha] && i[campoFecha] <= hasta);
    if (fmt === "reactivos") l = l.filter(i => i.tipo === "Reactivos");
    if (fmt === "colecciones") l = l.filter(i => i.tipo === "Colecciones").flatMap(i => [i, ...(i.coleccion?.ejemplares || []).map(e => ({ ...i, _ej: e }))]);
    return l;
  };
  const table = l => { const cols = FORMATOS[fmt].cols; return `<thead><tr>${cols.map(([t]) => `<th>${esc(t)}</th>`).join("")}</tr></thead><tbody>${l.map(i => `<tr>${cols.map(([, g]) => `<td>${esc(g(i) ?? "")}</td>`).join("")}</tr>`).join("")}</tbody>`; };
  const draw = () => { const l = rows(); $("#l-n").textContent = `${l.length} líneas`; $("#l-prev").innerHTML = table(l.slice(0, 60)) + (l.length > 60 ? `<tfoot><tr><td colspan="9" class="muted">Vista previa de las primeras 60 líneas.</td></tr></tfoot>` : ""); };
  bindFilters(f, "l-", draw);
  $("#l-fmt").onchange = e => { fmt = e.target.value; draw(); };
  $("#l-campo").onchange = e => { campoFecha = e.target.value; draw(); };
  $("#l-desde").onchange = e => { desde = e.target.value; draw(); };
  $("#l-hasta").onchange = e => { hasta = e.target.value; draw(); };
  $("#l-curso").onclick = () => { campoFecha = "fechaBaja"; desde = ci; hasta = cf; f.estado = "De baja"; $("#l-campo").value = "fechaBaja"; $("#l-desde").value = ci; $("#l-hasta").value = cf; $("#l-estado").value = "De baja"; draw(); };
  const matrix = () => { const cols = FORMATOS[fmt].cols; return [cols.map(([t]) => t), ...rows().map(i => cols.map(([, g]) => { const v = g(i); return v == null ? "" : v; }))]; };
  const fname = ext => `inventario-${fmt}-${today()}.${ext}`;
  $("#l-csv").onclick = () => download(fname("csv"), "﻿" + matrix().map(r => r.map(v => /[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(";")).join("\r\n"), "text/csv;charset=utf-8");
  $("#l-xlsx").onclick = () => {
    if (!window.XLSX) { sync("No se ha podido cargar la librería de Excel. Comprueba la conexión y recarga la página.", true); return; }
    const ws = XLSX.utils.aoa_to_sheet(matrix()); ws["!cols"] = matrix()[0].map((_, j) => ({ wch: Math.min(60, Math.max(8, ...matrix().slice(0, 200).map(r => String(r[j] ?? "").length))) }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, FORMATOS[fmt].t.slice(0, 31)); XLSX.writeFile(wb, fname("xlsx"));
  };
  $("#l-pdf").onclick = () => {
    const ce = S.listas.centro || {}; const l = rows();
    const filtrosTxt = [f.tipo, f.cat, f.ubic, f.estado === "activos" ? "en uso" : f.estado === "todos" ? "" : f.estado, desde && `desde ${desde}`, hasta && `hasta ${hasta}`].filter(Boolean).join(" · ");
    $("#print-area").innerHTML = fmt === "secretaria"
      ? `<div class="p-head"><div><strong>INVENTARIO ${esc((ce.nombre || "").toUpperCase())}</strong><br>Departamento: <strong>${esc(ce.departamento)}</strong><br>${esc(new Date().toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }))}</div><div>Jefe/a de Departamento: <strong>${esc(ce.jefeDepartamento)}</strong><br><br>Firma:</div></div><table>${table(l)}</table>`
      : `<h2>${esc(FORMATOS[fmt].t)} · ${esc(ce.nombre)} · ${esc(ce.departamento)}</h2><p>${esc(new Date().toLocaleDateString("es-ES"))} · ${l.length} líneas${filtrosTxt ? " · " + esc(filtrosTxt) : ""}</p><table>${table(l)}</table>`;
    window.print();
  };
  draw();
}
function download(name, content, type) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ---------- vista: ajustes ---------- */
function vAjustes(c) {
  const L = S.listas, ce = L.centro || {};
  const listas = [["personas", "Personas del departamento («Registrado por»)"], ["ubicaciones", "Ubicaciones"], ["categorias", "Categorías"], ["motivosBaja", "Motivos de baja"], ["proveedores", "Proveedores"], ["fabricantes", "Fabricantes de reactivos"], ["armariosSeguridad", "Armarios de seguridad"], ["unidadesStock", "Unidades de stock (fungible)"], ["concentraciones", "Concentraciones"], ["tiposColeccion", "Tipos de colección"]];
  c.innerHTML = `<h1>Ajustes</h1>
  <form class="sheet" id="f-aj"><h2>Centro (cabecera de los listados)</h2><div class="grid">${fld("a-nombre", "Centro", ce.nombre)}${fld("a-dep", "Departamento", ce.departamento)}${fld("a-jefe", "Jefe/a de departamento", ce.jefeDepartamento)}</div>
  <h2 style="margin-top:18px">Valores de los desplegables</h2><p class="muted small">Uno por línea. Los valores nuevos que se escriben en las fichas se añaden aquí solos.</p>
  <div class="grid">${listas.map(([k, t]) => `<div><label for="a-${k}">${t}</label><textarea id="a-${k}" rows="6">${esc((L[k] || []).join("\n"))}</textarea></div>`).join("")}</div>
  <div class="actions"><button class="btn" type="submit">Guardar ajustes</button></div></form>
  <div class="sheet" style="margin-top:16px"><h2>Acceso</h2><p>Para cambiar la contraseña del departamento o renovar el token de GitHub, genera un nuevo <code>config.json</code> y súbelo al repositorio <code>inventario-app</code>.</p><a class="btn ghost" href="#configurar">Configurar el acceso</a>
  <p class="muted small">Datos en <code>${esc(S.cfg.owner)}/${esc(S.cfg.repo)}</code> (rama ${esc(S.cfg.branch)}). Cada cambio queda en el historial de GitHub.</p></div>`;
  $("#f-aj").onsubmit = async e => {
    e.preventDefault();
    const w = await who(); if (!w) return;
    await guard(() => commit("listas", l => { l.centro = { nombre: $("#a-nombre").value.trim(), departamento: $("#a-dep").value.trim(), jefeDepartamento: $("#a-jefe").value.trim() }; for (const [k] of listas) l[k] = uniq($("#a-" + k).value.split("\n").map(s => s.trim())); }, `Ajustes actualizados (por ${w})`), "Ajustes guardados.");
    fillWho();
  };
}

boot();
