// Inventario del Departamento de Biología y Geología — núcleo compartido (v1.1)
// Utilidades, estado, cifrado, API de GitHub, diálogos y reglas del inventario.

export const VERSION = "1.1.0";
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
export const uniq = a => [...new Set(a.filter(v => v !== "" && v != null))].sort((x, y) => String(x).localeCompare(String(y), "es"));
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Fecha y hora LOCALES (antes se guardaban en UTC y el historial salía con una o dos horas de menos)
export const today = () => ymd(new Date());
export const nowISO = () => { const d = new Date(); return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
export const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
export const newId = () => "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const TIPOS = ["Equipo / mobiliario inventariable", "Material de laboratorio reutilizable", "Material fungible", "Reactivos", "Colecciones"];
export const ESTADOS = ["Operativo", "Deteriorado", "En reparación", "Pendiente de n.º de referencia", "De baja"];
export const GHS = { GHS01: "Explosivo", GHS02: "Inflamable", GHS03: "Comburente", GHS04: "Gas a presión", GHS05: "Corrosivo", GHS06: "Toxicidad aguda", GHS07: "Nocivo / irritante", GHS08: "Peligro para la salud", GHS09: "Peligro para el medio ambiente" };
export const FILES = { inv: "data/inventario.json", listas: "data/listas.json", cat: "data/catalogo-reactivos.json" };
export const NOMBRES = { ref: "referencia", tipo: "tipo", categoria: "categoría", denominacion: "denominación", especificacion: "especificación", marca: "marca", cantidad: "cantidad", ubicacion: "ubicación", armario: "armario", estado: "estado", origen: "origen", proveedor: "proveedor", codigoProveedor: "código del proveedor", factura: "factura", precio: "precio", fechaAlta: "fecha de alta", fechaBaja: "fecha de baja", motivoBaja: "motivo de baja", observaciones: "observaciones" };

export const S = { cfg: null, token: null, inv: null, listas: null, cat: [], sha: {}, cargado: 0, dirty: false, route: () => { },
  filtros: { q: "", tipo: "", cat: "", ubic: "", estado: "activos" }, orden: { k: "denominacion", dir: 1 }, sel: new Map(), marcados: new Set() };

/* ---------- base64 / cifrado ---------- */
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s.replace(/\s/g, "")), c => c.charCodeAt(0));
const utf8b64 = str => { const b = new TextEncoder().encode(str); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const b64utf8 = s => new TextDecoder().decode(unb64(s));

async function deriveKey(pass, salt, iter) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function encryptToken(token, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), iter = 600000;
  const key = await deriveKey(pass, salt, iter);
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token));
  return { kdf: "PBKDF2-SHA256", iter, salt: b64(salt), iv: b64(iv), data: b64(data) };
}
export async function decryptToken(c, pass) {
  const key = await deriveKey(pass, unb64(c.salt), c.iter);
  const out = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(c.iv) }, key, unb64(c.data));
  return new TextDecoder().decode(out);
}

/* ---------- almacenamiento local ---------- */
export const store = {
  get(k) { try { return sessionStorage.getItem(k) ?? localStorage.getItem(k); } catch { return null; } },
  set(k, v, persist) { try { sessionStorage.setItem(k, v); if (persist) localStorage.setItem(k, v); } catch { } },
  del(k) { try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch { } }
};

/* ---------- API de GitHub ---------- */
export function api(path, opts = {}) {
  const { owner, repo } = S.cfg;
  return fetch(`https://api.github.com/repos/${owner}/${repo}${path ? "/" + path : ""}`, {
    ...opts,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${S.token}`, "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) }
  });
}
export function ghError(st) {
  const e = new Error(st === 401 ? "GitHub rechaza el token (401). Puede haber caducado: genera uno nuevo en Ajustes → Configurar acceso."
    : st === 403 ? "GitHub deniega el permiso (403). Revisa que el token tenga «Contents: read and write» sobre inventario-datos (o espera unos minutos si se han hecho muchos cambios seguidos)."
      : st === 404 ? "No se encuentra el repositorio o el archivo (404). Revisa la organización y el nombre del repositorio."
        : `Error de GitHub (${st}). Inténtalo de nuevo en unos segundos.`);
  e.status = st; return e;
}
async function call(path, opts) {
  try { return await api(path, opts); }
  catch { const e = new Error("No hay conexión con GitHub. Comprueba la conexión a internet y vuelve a intentarlo."); e.status = 0; throw e; }
}
async function ghGet(file) {
  const r = await call(`contents/${file}?ref=${encodeURIComponent(S.cfg.branch)}&t=${Date.now()}`, { cache: "no-store" });
  if (r.status === 404) return { data: null, sha: null };
  if (!r.ok) throw ghError(r.status);
  const j = await r.json();
  let content = j.content;
  if (!content || j.encoding === "none") { // archivos de más de 1 MB
    const rb = await call(`git/blobs/${j.sha}`); if (!rb.ok) throw ghError(rb.status);
    content = (await rb.json()).content;
  }
  return { data: JSON.parse(b64utf8(content)), sha: j.sha };
}
async function ghPut(file, obj, sha, message) {
  const body = { message, content: utf8b64(JSON.stringify(obj, null, 1) + "\n"), branch: S.cfg.branch };
  if (sha) body.sha = sha;
  const r = await call(`contents/${file}`, { method: "PUT", body: JSON.stringify(body) });
  if (r.status === 409 || r.status === 422) return { conflict: true };
  if (!r.ok) throw ghError(r.status);
  return { sha: (await r.json()).content.sha };
}
const VACIO = { inv: () => ({ version: 1, items: [] }), listas: () => ({}), cat: () => [] };
// Guarda aplicando un cambio sobre la versión más reciente del archivo; si otra persona guardó a la vez, relee y reintenta.
export async function commit(key, mutate, message) {
  const file = FILES[key];
  for (let i = 0; i < 5; i++) {
    let base = S[key], sha = S.sha[key];
    if (i > 0) { await sleep(250 * i); const g = await ghGet(file); base = g.data ?? VACIO[key](); sha = g.sha; }
    const next = structuredClone(base);
    mutate(next);
    if (key === "inv") next.actualizado = nowISO();
    const r = await ghPut(file, next, sha, message);
    if (!r.conflict) { S[key] = next; S.sha[key] = r.sha; S.cargado = Date.now(); return next; }
  }
  throw new Error("No se ha podido guardar: alguien está modificando el inventario a la vez. Pulsa «Actualizar» y vuelve a intentarlo.");
}

/* ---------- estado de sincronización ---------- */
export function sync(msg, err) { const el = $("#sync"); el.textContent = msg || ""; el.classList.toggle("err", !!err); }
let busy = false, syncTimer = 0;
// Ejecuta un guardado. Mientras dura, bloquea los botones para que un doble clic no duplique altas.
export async function guard(fn, okMsg) {
  if (busy) return null;
  busy = true; document.body.classList.add("busy"); clearTimeout(syncTimer);
  try { sync("Guardando en GitHub…"); const r = await fn(); sync(okMsg || "Guardado."); syncTimer = setTimeout(() => sync(""), 5000); return r ?? true; }
  catch (e) { console.error(e); sync(e.message || String(e), true); return null; }
  finally { busy = false; document.body.classList.remove("busy"); }
}

export async function loadAll() {
  sync("Cargando el inventario desde GitHub…");
  try {
    const [inv, listas, cat] = await Promise.all([ghGet(FILES.inv), ghGet(FILES.listas), ghGet(FILES.cat)]);
    S.inv = inv.data || VACIO.inv(); S.sha.inv = inv.sha;
    S.listas = listas.data || {}; S.sha.listas = listas.sha;
    S.cat = Array.isArray(cat.data) ? cat.data : [];
    S.inv.items ||= [];
    for (const i of S.inv.items) { i.historial ||= []; if (i.reactivo) i.reactivo.pictogramas ||= []; if (i.coleccion) i.coleccion.ejemplares ||= []; }
    for (const r of S.cat) r.pictogramas ||= [];
    S.listas.personas ||= []; S.listas.centro ||= { nombre: "", departamento: "", jefeDepartamento: "" };
    S.cargado = Date.now();
    fillWho(); sync(""); return true;
  } catch (e) {
    console.error(e); sync(e.message, true);
    if (e.status === 401) { store.del("inv.token"); S.token = null; } // solo se olvida el token si GitHub lo rechaza, no por un corte de red
    return false;
  }
}

/* ---------- «Registrado por» ---------- */
export function fillWho() {
  const sel = $("#who-sel"), cur = store.get("inv.who") || "";
  sel.innerHTML = `<option value="">Registrado por…</option>` + S.listas.personas.map(p => `<option${p === cur ? " selected" : ""}>${esc(p)}</option>`).join("") + `<option value="__new">Añadir persona…</option>`;
}
export async function onWho() {
  const sel = $("#who-sel");
  if (sel.value === "__new") {
    const n = (await ask("Nombre de la persona", "Aparecerá en el historial de cada cambio que registre.", ""))?.trim();
    if (n) { await guard(() => commit("listas", l => { l.personas = uniq([...(l.personas || []), n]); }, `Añade persona: ${n}`)); store.set("inv.who", n, true); }
    fillWho(); return;
  }
  store.set("inv.who", sel.value, true);
}
export async function who() {
  const w = store.get("inv.who");
  if (w) return w;
  await info("Indica quién registra el cambio", "Elige tu nombre en el desplegable «Registrado por» de la parte superior (o añádelo) y repite la operación.");
  $("#who-sel").focus();
  return null;
}

/* ---------- diálogos ---------- */
export function dialog(html) {
  return new Promise(res => {
    const d = $("#dlg"); $("#dlg-body").innerHTML = html;
    d.returnValue = ""; // sin esto, cerrar con Esc devolvía la respuesta del diálogo anterior (p. ej. «ok»)
    d.onclose = () => res(d.returnValue);
    d.showModal();
  });
}
export async function info(t, txt) { await dialog(`<h2>${esc(t)}</h2><p>${esc(txt)}</p><div class="row"><button class="btn" value="ok">Entendido</button></div>`); }
export async function confirmBox(t, txt, ok = "Confirmar", danger) {
  return (await dialog(`<h2>${esc(t)}</h2><p>${esc(txt)}</p><div class="row"><button class="btn ${danger ? "danger" : ""}" value="ok">${esc(ok)}</button><button class="btn ghost" value="no">Cancelar</button></div>`)) === "ok";
}
export async function ask(t, txt, v) {
  const r = await dialog(`<h2>${esc(t)}</h2><p class="muted">${esc(txt)}</p><input id="ask-in" value="${esc(v)}"><div class="row" style="margin-top:12px"><button class="btn" value="ok">Aceptar</button><button class="btn ghost" value="no">Cancelar</button></div>`);
  return r === "ok" ? $("#ask-in").value : null;
}

/* ---------- listas para desplegables ---------- */
export const items = () => S.inv.items;
export function opts(key, field) { return uniq([...(S.listas[key] || []), ...(field ? items().map(i => i[field]) : [])]); }
export function specsFor(den) { const d = norm(den); return uniq(items().filter(i => norm(i.denominacion) === d).map(i => i.especificacion)); }
export function armariosFor(ub) { return uniq([...((S.listas.armarios || {})[ub] || []), ...items().filter(i => i.ubicacion === ub).map(i => i.armario)]); }
export function dl(id, values) { return `<datalist id="${id}">${values.map(v => `<option value="${esc(v)}">`).join("")}</datalist>`; }
// Si el valor actual no está en la lista se añade, para que guardar la ficha no lo cambie sin avisar.
export const sel = (id, values, cur, empty = "") => { const vs = cur && !values.includes(cur) ? [...values, cur] : values; return `<select id="${id}">${empty !== null ? `<option value="">${esc(empty)}</option>` : ""}${vs.map(v => `<option${v === cur ? " selected" : ""}>${esc(v)}</option>`).join("")}</select>`; };
export function ghsSvg(code) { return `<svg class="ghs" viewBox="0 0 40 40" role="img" aria-label="${esc(code)} ${esc(GHS[code] || "")}"><title>${esc(code)} · ${esc(GHS[code] || "")}</title><rect x="7" y="7" width="26" height="26" transform="rotate(45 20 20)" fill="var(--surface)" stroke="var(--ghs)" stroke-width="3"/><text x="20" y="25" text-anchor="middle" font-family="ui-monospace,monospace" font-size="13" font-weight="600" fill="var(--ink)">${esc(String(code).slice(3))}</text></svg>`; }
export function casValido(cas) { const m = /^(\d{2,7})-(\d{2})-(\d)$/.exec(cas || ""); if (!m) return false; const d = (m[1] + m[2]).split("").reverse(); return d.reduce((s, x, i) => s + (+x) * (i + 1), 0) % 10 === +m[3]; }
export const label = i => [i.denominacion, i.especificacion, i.marca].filter(Boolean).join(" · ");

// Añade a las listas los valores nuevos escritos en fichas o importaciones (desplegables ampliables). Un solo guardado.
export async function learn(list) {
  const add = {}, arms = {};
  const push = (k, v) => { if (v && !(S.listas[k] || []).includes(v) && !(add[k] || []).includes(v)) (add[k] ||= []).push(v); };
  for (const item of [].concat(list)) {
    push("categorias", item.categoria); push("ubicaciones", item.ubicacion); push("proveedores", item.proveedor); push("motivosBaja", item.motivoBaja);
    if (item.reactivo) { push("fabricantes", item.reactivo.fabricante); push("concentraciones", item.reactivo.concentracion); push("armariosSeguridad", item.reactivo.armarioSeguridad); }
    if (item.fungible) push("unidadesStock", item.fungible.unidadStock);
    if (item.coleccion) push("tiposColeccion", item.coleccion.tipoColeccion);
    if (item.armario && item.ubicacion && !((S.listas.armarios || {})[item.ubicacion] || []).includes(item.armario)) (arms[item.ubicacion] ||= new Set()).add(item.armario);
  }
  if (!Object.keys(add).length && !Object.keys(arms).length) return;
  await commit("listas", l => {
    for (const [k, v] of Object.entries(add)) l[k] = uniq([...(l[k] || []), ...v]);
    for (const [u, set] of Object.entries(arms)) { l.armarios ||= {}; l.armarios[u] = uniq([...(l.armarios[u] || []), ...set]); }
  }, "Añade valores nuevos a los desplegables");
}

/* ---------- fechas ---------- */
// Acepta aaaa-mm-dd, aaaa-mm, aaaa, d/m/aaaa y m/aaaa. Devuelve la fecha normalizada, "" si está vacía o null si no se entiende.
export function normFecha(s) {
  s = String(s ?? "").trim(); if (!s) return "";
  const ok = (y, mo, d) => { if (+y < 1900 || +y > 2100 || (mo && (+mo < 1 || +mo > 12)) || (d && (+d < 1 || +d > 31))) return null; return y + (mo ? "-" + pad(+mo) + (d ? "-" + pad(+d) : "") : ""); };
  let m;
  if ((m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(s))) return ok(m[1], m[2], m[3]);
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) return ok(m[3], m[2], m[1]);
  if ((m = /^(\d{1,2})[/.-](\d{4})$/.exec(s))) return ok(m[2], m[1]);
  return null;
}
export function cursoActual() { const d = new Date(), y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1; return [`${y}-09-01`, `${y + 1}-08-31`, `${y}-${String(y + 1).slice(2)}`]; }

/* ---------- filtros y orden ---------- */
export function filtrar(list, f) {
  const qs = norm(f.q).split(/\s+/).filter(Boolean);
  return list.filter(i => {
    if (f.tipo && i.tipo !== f.tipo) return false;
    if (f.cat && i.categoria !== f.cat) return false;
    if (f.ubic && i.ubicacion !== f.ubic) return false;
    if (f.estado === "activos" && i.estado === "De baja") return false;
    if (f.estado && f.estado !== "activos" && f.estado !== "todos" && i.estado !== f.estado) return false;
    if (qs.length) {
      const hay = norm([i.ref, i.denominacion, i.especificacion, i.marca, i.ubicacion, i.armario, i.categoria, i.proveedor, i.codigoProveedor, i.factura, i.observaciones, i.reactivo?.cas, i.reactivo?.formula, i.reactivo?.refFabricante].join(" "));
      if (!qs.every(q => hay.includes(q))) return false;
    }
    return true;
  });
}
const vacio = v => v === "" || v == null;
const cmp = (x, y) => typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""), "es", { numeric: true, sensitivity: "base" });
// Ordena por la columna elegida (los vacíos, al final) y desempata siempre igual, para que los listados salgan estables.
export function ordenar(list, o = S.orden) {
  const resto = ["denominacion", "especificacion", "marca", "ubicacion", "ref"];
  return [...list].sort((a, b) => {
    const x = a[o.k], y = b[o.k];
    let r = vacio(x) !== vacio(y) ? (vacio(x) ? 1 : -1) : cmp(x, y) * o.dir;
    for (const k of resto) { if (r) break; r = cmp(a[k], b[k]); }
    return r;
  });
}
export function cant(i) { return i.cantidadIndeterminada ? "varios" : (i.cantidad ?? ""); }
export function estadoPill(e) { return `<span class="pill ${e === "De baja" ? "baja" : e === "Operativo" ? "" : "warn"}">${esc(e)}</span>`; }

export function filterBar(f, prefix) {
  return `<div class="toolbar">
    <div><label for="${prefix}q">Buscar</label><input id="${prefix}q" type="search" value="${esc(f.q)}" placeholder="Nombre, referencia, marca, proveedor, CAS…"></div>
    <div><label for="${prefix}tipo">Tipo</label>${sel(prefix + "tipo", TIPOS, f.tipo, "Todos")}</div>
    <div><label for="${prefix}cat">Categoría</label>${sel(prefix + "cat", opts("categorias", "categoria"), f.cat, "Todas")}</div>
    <div><label for="${prefix}ubic">Ubicación</label>${sel(prefix + "ubic", opts("ubicaciones", "ubicacion"), f.ubic, "Todas")}</div>
    <div><label for="${prefix}estado">Estado</label><select id="${prefix}estado">${[["activos", "En uso (sin bajas)"], ["todos", "Todos"], ...ESTADOS.map(e => [e, e])].map(([v, t]) => `<option value="${esc(v)}"${v === f.estado ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
    ${prefix === "f-" ? `<div><a class="btn" href="#nuevo">+ Nuevo elemento</a></div>` : "<div></div>"}
  </div>`;
}
export function bindFilters(f, prefix, cb) {
  ["q", "tipo", "cat", "ubic", "estado"].forEach(k => $("#" + prefix + k).addEventListener(k === "q" ? "input" : "change", e => { f[k] = e.target.value; cb(); }));
}

/* ---------- fichas ---------- */
export function blank(tipo) {
  const i = { id: newId(), ref: "", tipo: TIPOS.includes(tipo) ? tipo : "Material de laboratorio reutilizable", categoria: "", denominacion: "", especificacion: "", marca: "", cantidad: 1, cantidadIndeterminada: false, ubicacion: "", armario: "", estado: "Operativo", origen: "Compra", proveedor: "", codigoProveedor: "", factura: "", precio: null, fechaAlta: today(), fechaBaja: "", motivoBaja: "", observaciones: "", historial: [] };
  return ensureSub(i);
}
export function ensureSub(i) {
  if (i.tipo === "Reactivos") { i.reactivo ||= { formula: "", cas: "", fabricante: "", refFabricante: "", lote: "", concentracion: "", estadoFisico: "", envase: "", cantidadRestante: "", pictogramas: [], frasesHP: "", armarioSeguridad: "", fechaApertura: "", fechaCaducidad: "", fds: "", stockMinimo: null }; i.reactivo.pictogramas ||= []; }
  if (i.tipo === "Material fungible") i.fungible ||= { unidadStock: "", unidadesEnvase: null, stockMinimo: null, caducidad: "" };
  if (i.tipo === "Colecciones") { i.coleccion ||= { tipoColeccion: "", nEjemplares: null, ejemplares: [] }; i.coleccion.ejemplares ||= []; }
  return i;
}
export const fld = (id, lab, val, extra = "", cls = "") => `<div class="${cls}"><label for="${id}">${lab}</label><input id="${id}" value="${esc(val ?? "")}" ${extra}></div>`;
// Mismo material en el mismo sitio (para proponer sumar en vez de duplicar líneas)
export const mismo = (a, b) => a.tipo === b.tipo && norm(a.denominacion) === norm(b.denominacion) && norm(a.especificacion) === norm(b.especificacion) && norm(a.marca) === norm(b.marca) && norm(a.ubicacion) === norm(b.ubicacion) && norm(a.armario) === norm(b.armario);

/* ---------- avisos ---------- */
export const minimo = i => i.fungible?.stockMinimo ?? i.reactivo?.stockMinimo ?? null;
export const bajoMinimo = i => i.estado !== "De baja" && !i.cantidadIndeterminada && minimo(i) != null && (i.cantidad ?? 0) < minimo(i);
export const caducidad = i => i.reactivo?.fechaCaducidad || i.fungible?.caducidad || "";
export function avisos() {
  const hoy = today(), lim = addDays(90), act = items().filter(i => i.estado !== "De baja"), g = [];
  const add = (k, t, sev, list, help) => { if (list.length) g.push({ k, t, sev, list, help }); };
  const cad = S.cfg?.caduca;
  if (cad && cad <= addDays(30)) g.push({ k: "token", t: cad < hoy ? "El token de GitHub ha caducado" : "El token de GitHub caduca pronto", sev: "bad", list: [], help: `Caduca el ${cad}. Genera uno nuevo en GitHub y repite «Ajustes → Configurar el acceso» antes de esa fecha; si no, nadie podrá entrar.` });
  add("stock", "Stock por debajo del mínimo", "bad", act.filter(bajoMinimo).map(i => [i, `quedan ${cant(i) || 0} · mínimo ${minimo(i)}`]), "Material fungible o reactivos que conviene reponer. En Listados tienes el formato «Reposición» para preparar el pedido.");
  add("caducado", "Caducados", "bad", act.filter(i => caducidad(i) && caducidad(i) < hoy).map(i => [i, `caducó el ${caducidad(i)}`]), "Valora retirarlos y darlos de baja con motivo «Caducado».");
  add("caduca", "Caducan en los próximos 90 días", "warn", act.filter(i => caducidad(i) >= hoy && caducidad(i) <= lim).map(i => [i, `caduca el ${caducidad(i)}`]));
  add("pendref", "Pendientes de n.º de referencia", "warn", act.filter(i => i.estado === "Pendiente de n.º de referencia").map(i => [i, i.ubicacion]), "Material inventariable al que Secretaría todavía no ha asignado número.");
  add("averia", "Deteriorados o en reparación", "warn", act.filter(i => i.estado === "Deteriorado" || i.estado === "En reparación").map(i => [i, i.estado]));
  const refs = new Map(); for (const i of act) if (i.ref) refs.set(i.ref, [...(refs.get(i.ref) || []), i]);
  const datos = [
    ...[...refs.values()].filter(l => l.length > 1).flat().map(i => [i, `referencia ${i.ref} repetida`]),
    ...act.filter(i => !i.ubicacion).map(i => [i, "sin ubicación"]),
    ...act.filter(i => i.cantidad == null && !i.cantidadIndeterminada).map(i => [i, "sin cantidad"]),
    ...act.filter(i => i.reactivo?.cas && !casValido(i.reactivo.cas)).map(i => [i, `CAS ${i.reactivo.cas} no válido`]),
    ...items().filter(i => i.estado === "De baja" && (!i.fechaBaja || !i.motivoBaja)).map(i => [i, "baja sin fecha o sin motivo"]),
    ...items().filter(i => normFecha(i.fechaAlta) === null || normFecha(i.fechaBaja) === null).map(i => [i, "fecha con formato no reconocido"])
  ];
  add("datos", "Datos por revisar", "", datos, "Registros incompletos o incoherentes. No impiden trabajar, pero afectan a los listados.");
  return g;
}
export const nUrgentes = () => avisos().filter(a => a.sev === "bad").reduce((s, a) => s + Math.max(1, a.list.length), 0);

/* ---------- varios ---------- */
export function download(name, content, type) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
export function parseCSV(t) {
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
