/* ============================================================
   Mi Tienda – PWA de ventas, inventario, compras y reportes
   Autor: ILC – Fran Alvarenga
   Almacenamiento: IndexedDB (offline-first) + respaldo a JSON
   ============================================================ */

// --------------------- CONFIG GLOBAL --------------------------
const APP = {
  dbName: 'miTiendaDB',
  dbVersion: 1,
  moneda: '$',
  decimales: 2,
  ivaIncluido: true,
};

const STORES = ['usuarios', 'categorias', 'productos', 'compras', 'ventas', 'movimientos', 'config'];

// --------------------- UTILIDADES -----------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const fmtMoney = (n) => `${APP.moneda}${Number(n || 0).toFixed(APP.decimales)}`;
const fmtDate = (iso) => {
  const d = new Date(iso); if (isNaN(d)) return '';
  return d.toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });
};
const fmtDateTime = (iso) => {
  const d = new Date(iso); if (isNaN(d)) return '';
  return d.toLocaleString('es-SV', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const startOfMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1).getTime();

const toast = (msg, ms = 2200) => {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), ms);
};

// Hash simple SHA-256 para contraseñas (no es militar pero protege de mirones)
async function hashPass(pass) {
  const enc = new TextEncoder().encode(pass);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// --------------------- INDEXEDDB ------------------------------
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(APP.dbName, APP.dbVersion);
    req.onupgradeneeded = (e) => {
      const _db = e.target.result;
      STORES.forEach(name => {
        if (!_db.objectStoreNames.contains(name)) {
          const opts = name === 'config' ? { keyPath: 'clave' } : { keyPath: 'id' };
          const store = _db.createObjectStore(name, opts);
          if (name === 'productos') {
            store.createIndex('sku', 'sku', { unique: false });
            store.createIndex('categoriaId', 'categoriaId', { unique: false });
          }
          if (name === 'ventas' || name === 'compras' || name === 'movimientos') {
            store.createIndex('fecha', 'fecha', { unique: false });
          }
        }
      });
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function tx(store, mode = 'readonly') {
  return db.transaction(store, mode).objectStore(store);
}

function getAll(store) {
  return new Promise((res, rej) => {
    const r = tx(store).getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}

function getOne(store, key) {
  return new Promise((res, rej) => {
    const r = tx(store).get(key);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  });
}

function put(store, obj) {
  return new Promise((res, rej) => {
    const r = tx(store, 'readwrite').put(obj);
    r.onsuccess = () => res(obj);
    r.onerror = () => rej(r.error);
  });
}

function del(store, key) {
  return new Promise((res, rej) => {
    const r = tx(store, 'readwrite').delete(key);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

// --------------------- ESTADO -----------------------------
const state = {
  user: null,
  productos: [],
  categorias: [],
  ventas: [],
  compras: [],
  carrito: [],
  carritoCompra: [],
  catFilter: null,
  charts: {},
};

// --------------------- BOOTSTRAP --------------------------
async function init() {
  await openDB();
  await seedInicial();
  await cargarTodo();
  initEventos();

  // Sesión persistida en localStorage
  const sesion = localStorage.getItem('miTienda.session');
  if (sesion) {
    try { state.user = JSON.parse(sesion); entrarApp(); }
    catch { mostrarLogin(); }
  } else {
    mostrarLogin();
  }
}

async function seedInicial() {
  // Crear admin por defecto si no hay usuarios
  const usuarios = await getAll('usuarios');
  if (usuarios.length === 0) {
    const passHash = await hashPass('admin123');
    await put('usuarios', {
      id: uid(),
      nombre: 'Administrador',
      usuario: 'admin',
      passHash,
      rol: 'admin',
      activo: true,
      creado: Date.now(),
    });
  }
  // Categorías base
  const cats = await getAll('categorias');
  if (cats.length === 0) {
    const base = ['General', 'Bebidas', 'Alimentos', 'Limpieza', 'Otros'];
    for (const n of base) await put('categorias', { id: uid(), nombre: n });
  }
}

async function cargarTodo() {
  state.productos = await getAll('productos');
  state.categorias = await getAll('categorias');
  state.ventas = await getAll('ventas');
  state.compras = await getAll('compras');
}

// --------------------- LOGIN ------------------------------
function mostrarLogin() {
  $('#loginScreen').classList.remove('hidden');
  $('#app').classList.add('hidden');
}

function entrarApp() {
  $('#loginScreen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#topUser').textContent = `${state.user.nombre} · ${state.user.rol}`;
  showView('dashboard');
}

async function login(e) {
  e.preventDefault();
  const u = $('#loginUser').value.trim().toLowerCase();
  const p = $('#loginPass').value;
  const err = $('#loginError');
  err.classList.add('hidden');

  const usuarios = await getAll('usuarios');
  const user = usuarios.find(x => x.usuario.toLowerCase() === u && x.activo);
  if (!user) { err.textContent = 'Usuario no encontrado o inactivo.'; err.classList.remove('hidden'); return; }

  const hash = await hashPass(p);
  if (hash !== user.passHash) { err.textContent = 'Contraseña incorrecta.'; err.classList.remove('hidden'); return; }

  state.user = { id: user.id, nombre: user.nombre, usuario: user.usuario, rol: user.rol };
  localStorage.setItem('miTienda.session', JSON.stringify(state.user));
  $('#loginPass').value = '';
  entrarApp();
}

function cerrarSesion() {
  if (!confirm('¿Cerrar sesión?')) return;
  localStorage.removeItem('miTienda.session');
  state.user = null;
  cerrarMenu();
  mostrarLogin();
}

// --------------------- NAVEGACIÓN -------------------------
function showView(name) {
  $$('.view').forEach(v => v.classList.add('hidden'));
  const el = document.querySelector(`[data-view="${name}"]`);
  if (el) el.classList.remove('hidden');

  $$('.tab-btn').forEach(b => b.classList.remove('tab-active'));
  const tab = document.querySelector(`.tab-btn[data-tab="${name}"]`);
  if (tab) tab.classList.add('tab-active');

  const titulos = { dashboard: 'Dashboard', catalogo: 'Catálogo', inventario: 'Inventario', compras: 'Compras', ventas: 'Ventas', reportes: 'Reportes' };
  $('#topTitle').textContent = titulos[name] || 'Mi Tienda';

  if (name === 'dashboard') renderDashboard();
  if (name === 'catalogo') renderCatalogo();
  if (name === 'inventario') renderInventario();
  if (name === 'compras') renderCompras();
  if (name === 'ventas') renderVentas();
  if (name === 'reportes') initReportes();

  window.scrollTo({ top: 0, behavior: 'instant' });
}

function toggleMenu() { $('#menuDrop').classList.toggle('hidden'); }
function cerrarMenu() { $('#menuDrop').classList.add('hidden'); }

// --------------------- DASHBOARD --------------------------
function renderDashboard() {
  const hoy = startOfDay();
  const mes = startOfMonth();

  const ventasHoy = state.ventas.filter(v => v.fecha >= hoy);
  const ventasMes = state.ventas.filter(v => v.fecha >= mes);

  const totalHoy = ventasHoy.reduce((s, v) => s + (v.total || 0), 0);
  const gananciaHoy = ventasHoy.reduce((s, v) => s + (v.gananciaTotal || 0), 0);
  const totalMes = ventasMes.reduce((s, v) => s + (v.total || 0), 0);

  $('#kpiVentasHoy').textContent = fmtMoney(totalHoy);
  $('#kpiVentasHoyCount').textContent = `${ventasHoy.length} venta${ventasHoy.length === 1 ? '' : 's'}`;
  $('#kpiGananciaHoy').textContent = fmtMoney(gananciaHoy);
  $('#kpiVentasMes').textContent = fmtMoney(totalMes);
  $('#kpiVentasMesCount').textContent = `${ventasMes.length} venta${ventasMes.length === 1 ? '' : 's'}`;

  const invValor = state.productos.reduce((s, p) => s + (p.precioCompra || 0) * (p.stock || 0), 0);
  $('#kpiInventarioValor').textContent = fmtMoney(invValor);
  $('#kpiInventarioCount').textContent = `${state.productos.length} producto${state.productos.length === 1 ? '' : 's'}`;

  // Chart últimos 7 días
  const labels = [];
  const data = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ini = startOfDay(d);
    const fin = ini + 24 * 60 * 60 * 1000;
    const t = state.ventas.filter(v => v.fecha >= ini && v.fecha < fin).reduce((s, v) => s + (v.total || 0), 0);
    labels.push(d.toLocaleDateString('es-SV', { weekday: 'short' }));
    data.push(Number(t.toFixed(2)));
  }
  if (state.charts.v7) state.charts.v7.destroy();
  state.charts.v7 = new Chart($('#chartVentas7d'), {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: '#0f766e', borderRadius: 6 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } }, maintainAspectRatio: false }
  });

  // Stock bajo
  const bajos = state.productos.filter(p => (p.stock || 0) <= (p.stockMinimo || 0) && p.activo !== false);
  $('#badgeStockBajo').textContent = bajos.length;
  const cont = $('#listaStockBajo');
  if (bajos.length === 0) {
    cont.innerHTML = `<div class="text-sm text-slate-500 py-2">✓ Todo en orden</div>`;
  } else {
    cont.innerHTML = bajos.slice(0, 5).map(p => `
      <div class="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
        <div class="text-sm">${p.nombre}</div>
        <span class="badge bg-red-100 text-red-700">${p.stock || 0} ud</span>
      </div>`).join('');
  }

  // Top productos del mes
  const conteo = {};
  ventasMes.forEach(v => (v.items || []).forEach(it => {
    conteo[it.productoId] = (conteo[it.productoId] || 0) + it.cantidad;
  }));
  const top = Object.entries(conteo).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const contTop = $('#listaTopProductos');
  if (top.length === 0) {
    contTop.innerHTML = `<div class="text-sm text-slate-500 py-2">Sin ventas este mes aún.</div>`;
  } else {
    contTop.innerHTML = top.map(([pid, q]) => {
      const p = state.productos.find(x => x.id === pid);
      return `<div class="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
        <div class="text-sm">${p ? p.nombre : '(eliminado)'}</div>
        <span class="text-sm font-semibold text-teal-700">${q} ud</span>
      </div>`;
    }).join('');
  }
}

// --------------------- CATÁLOGO ---------------------------
function renderCatalogo() {
  const cont = $('#filtroCategorias');
  const chips = [
    `<button class="chip ${state.catFilter === null ? 'chip-active' : ''}" onclick="filtrarCategoria(null)">Todas</button>`,
    ...state.categorias.map(c => `<button class="chip ${state.catFilter === c.id ? 'chip-active' : ''}" onclick="filtrarCategoria('${c.id}')">${c.nombre}</button>`)
  ];
  cont.innerHTML = chips.join('');

  const q = ($('#busquedaCatalogo').value || '').toLowerCase();
  let lista = state.productos.filter(p => p.activo !== false);
  if (state.catFilter) lista = lista.filter(p => p.categoriaId === state.catFilter);
  if (q) lista = lista.filter(p => (p.nombre + ' ' + (p.sku || '')).toLowerCase().includes(q));

  const grid = $('#listaProductos');
  $('#vacioCatalogo').classList.toggle('hidden', lista.length > 0);

  grid.innerHTML = lista.map(p => `
    <div class="bg-white rounded-2xl overflow-hidden border border-slate-100 shadow-sm" onclick="abrirEditorProducto('${p.id}')">
      <div class="aspect-square product-photo flex items-center justify-center overflow-hidden">
        ${p.foto
          ? `<img src="${p.foto}" alt="${p.nombre}" class="w-full h-full object-cover" />`
          : `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#0f766e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="opacity-40"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/></svg>`
        }
      </div>
      <div class="p-2.5">
        <div class="font-semibold text-sm truncate">${p.nombre}</div>
        <div class="flex items-center justify-between mt-1">
          <span class="text-teal-700 font-bold">${fmtMoney(p.precioVenta)}</span>
          <span class="badge ${p.stock <= (p.stockMinimo||0) ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}">${p.stock||0}</span>
        </div>
      </div>
    </div>
  `).join('');
}

function filtrarCategoria(id) {
  state.catFilter = id;
  renderCatalogo();
}

function abrirEditorProducto(id = null) {
  const p = id ? state.productos.find(x => x.id === id) : null;
  const esNuevo = !p;
  const cats = state.categorias.map(c => `<option value="${c.id}" ${p && p.categoriaId === c.id ? 'selected' : ''}>${c.nombre}</option>`).join('');

  const html = `
  <div class="fixed inset-0 z-40 bg-black/40 modal-backdrop flex items-end sm:items-center justify-center" onclick="cerrarModal(event)">
    <div class="modal-sheet bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-3xl max-h-[92vh] overflow-y-auto" onclick="event.stopPropagation()">
      <div class="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
        <h3 class="font-semibold">${esNuevo ? 'Nuevo producto' : 'Editar producto'}</h3>
        <button onclick="cerrarModal()" class="p-1.5 hover:bg-slate-100 rounded-lg" aria-label="Cerrar">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <form id="formProducto" class="p-4 space-y-3" onsubmit="guardarProducto(event, '${id || ''}')">
        <div class="flex justify-center">
          <label class="cursor-pointer">
            <div id="prodFotoPreview" class="w-28 h-28 rounded-2xl product-photo flex items-center justify-center overflow-hidden border-2 border-dashed border-slate-300">
              ${p && p.foto ? `<img src="${p.foto}" class="w-full h-full object-cover" />` : '<span class="text-slate-400 text-xs">Toca para foto</span>'}
            </div>
            <input type="file" accept="image/*" capture="environment" class="hidden" id="inputFoto" />
          </label>
        </div>

        <div>
          <label class="text-xs text-slate-500">Nombre *</label>
          <input id="prodNombre" required class="w-full px-3 py-2 rounded-lg border border-slate-300" value="${p ? esc(p.nombre) : ''}" />
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="text-xs text-slate-500">SKU</label>
            <input id="prodSku" class="w-full px-3 py-2 rounded-lg border border-slate-300" value="${p ? esc(p.sku || '') : ''}" />
          </div>
          <div>
            <label class="text-xs text-slate-500">Categoría</label>
            <select id="prodCategoria" class="w-full px-3 py-2 rounded-lg border border-slate-300">${cats}</select>
          </div>
        </div>

        <div>
          <label class="text-xs text-slate-500">Descripción</label>
          <textarea id="prodDesc" rows="2" class="w-full px-3 py-2 rounded-lg border border-slate-300">${p ? esc(p.descripcion || '') : ''}</textarea>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="text-xs text-slate-500">Precio compra</label>
            <input id="prodPCompra" type="number" step="0.01" min="0" class="w-full px-3 py-2 rounded-lg border border-slate-300" value="${p ? (p.precioCompra || 0) : 0}" />
          </div>
          <div>
            <label class="text-xs text-slate-500">Precio venta *</label>
            <input id="prodPVenta" type="number" step="0.01" min="0" required class="w-full px-3 py-2 rounded-lg border border-slate-300" value="${p ? (p.precioVenta || 0) : 0}" />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="text-xs text-slate-500">Stock actual</label>
            <input id="prodStock" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-slate-300" value="${p ? (p.stock || 0) : 0}" />
          </div>
          <div>
            <label class="text-xs text-slate-500">Stock mínimo</label>
            <input id="prodStockMin" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-slate-300" value="${p ? (p.stockMinimo || 0) : 0}" />
          </div>
        </div>

        <div class="flex gap-2 pt-2">
          ${!esNuevo ? `<button type="button" onclick="eliminarProducto('${id}')" class="px-3 py-2.5 rounded-lg border border-red-300 text-red-600 hover:bg-red-50">Eliminar</button>` : ''}
          <button type="submit" class="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-semibold py-2.5 rounded-lg">${esNuevo ? 'Crear' : 'Guardar cambios'}</button>
        </div>
      </form>
    </div>
  </div>`;
  abrirModal(html);

  $('#inputFoto').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const dataUrl = await comprimirImagen(file);
    $('#prodFotoPreview').innerHTML = `<img src="${dataUrl}" class="w-full h-full object-cover" />`;
    $('#prodFotoPreview').dataset.foto = dataUrl;
  });
}

async function comprimirImagen(file, maxDim = 800, quality = 0.78) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const scale = Math.min(1, maxDim / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const c = document.createElement('canvas');
      c.width = width; c.height = height;
      c.getContext('2d').drawImage(img, 0, 0, width, height);
      res(c.toDataURL('image/jpeg', quality));
    };
    img.src = URL.createObjectURL(file);
  });
}

async function guardarProducto(e, id) {
  e.preventDefault();
  const existente = id ? state.productos.find(x => x.id === id) : null;
  const fotoNueva = $('#prodFotoPreview').dataset.foto;
  const obj = {
    id: id || uid(),
    nombre: $('#prodNombre').value.trim(),
    sku: $('#prodSku').value.trim(),
    categoriaId: $('#prodCategoria').value,
    descripcion: $('#prodDesc').value.trim(),
    precioCompra: parseFloat($('#prodPCompra').value) || 0,
    precioVenta: parseFloat($('#prodPVenta').value) || 0,
    stock: parseInt($('#prodStock').value) || 0,
    stockMinimo: parseInt($('#prodStockMin').value) || 0,
    foto: fotoNueva || (existente ? existente.foto : null),
    activo: true,
    creado: existente ? existente.creado : Date.now(),
    actualizado: Date.now(),
  };
  if (!obj.nombre) { toast('Falta el nombre'); return; }
  await put('productos', obj);
  await cargarTodo();
  cerrarModal();
  renderCatalogo();
  toast(id ? 'Producto actualizado' : 'Producto creado');
}

async function eliminarProducto(id) {
  if (!confirm('¿Eliminar este producto? El historial de ventas y compras se conserva.')) return;
  // Soft delete: marcar inactivo para no romper referencias históricas
  const p = state.productos.find(x => x.id === id);
  if (p) { p.activo = false; await put('productos', p); }
  await cargarTodo();
  cerrarModal();
  renderCatalogo();
  toast('Producto eliminado');
}

// --------------------- INVENTARIO -------------------------
function renderInventario() {
  const q = ($('#busquedaInventario').value || '').toLowerCase();
  const estado = $('#filtroEstadoInv').value;
  let lista = state.productos.filter(p => p.activo !== false);
  if (q) lista = lista.filter(p => (p.nombre + ' ' + (p.sku || '')).toLowerCase().includes(q));
  if (estado === 'bajo') lista = lista.filter(p => (p.stock || 0) > 0 && (p.stock || 0) <= (p.stockMinimo || 0));
  if (estado === 'agotado') lista = lista.filter(p => (p.stock || 0) === 0);
  if (estado === 'ok') lista = lista.filter(p => (p.stock || 0) > (p.stockMinimo || 0));

  $('#invTotalProductos').textContent = state.productos.filter(p => p.activo !== false).length;
  $('#invTotalUnidades').textContent = state.productos.reduce((s, p) => s + (p.activo === false ? 0 : (p.stock || 0)), 0);
  $('#invValorTotal').textContent = fmtMoney(state.productos.reduce((s, p) => s + (p.activo === false ? 0 : (p.precioCompra || 0) * (p.stock || 0)), 0));

  const cont = $('#listaInventario');
  if (lista.length === 0) {
    cont.innerHTML = `<div class="text-center text-slate-500 py-10 text-sm">Sin resultados.</div>`;
    return;
  }
  cont.innerHTML = lista.map(p => `
    <div class="bg-white rounded-xl border border-slate-100 p-3 flex items-center gap-3">
      <div class="w-12 h-12 rounded-lg product-photo overflow-hidden flex-shrink-0">
        ${p.foto ? `<img src="${p.foto}" class="w-full h-full object-cover" />` : ''}
      </div>
      <div class="flex-1 min-w-0">
        <div class="font-medium truncate">${p.nombre}</div>
        <div class="text-xs text-slate-500">${p.sku || 'sin SKU'} · ${fmtMoney(p.precioVenta)}</div>
      </div>
      <div class="text-right">
        <div class="font-bold ${p.stock <= (p.stockMinimo||0) ? 'text-red-600' : 'text-slate-800'}">${p.stock || 0}</div>
        <button onclick="ajustarStock('${p.id}')" class="text-xs text-teal-700 underline">Ajustar</button>
      </div>
    </div>
  `).join('');
}

async function ajustarStock(id) {
  const p = state.productos.find(x => x.id === id);
  if (!p) return;
  const val = prompt(`Stock actual de "${p.nombre}": ${p.stock || 0}\nNuevo stock:`, p.stock || 0);
  if (val === null) return;
  const nuevo = parseInt(val);
  if (isNaN(nuevo) || nuevo < 0) { toast('Valor inválido'); return; }
  const delta = nuevo - (p.stock || 0);
  p.stock = nuevo;
  await put('productos', p);
  await put('movimientos', {
    id: uid(), fecha: Date.now(), productoId: id, tipo: 'ajuste',
    cantidad: delta, usuarioId: state.user.id, notas: 'Ajuste manual'
  });
  await cargarTodo();
  renderInventario();
  toast('Stock actualizado');
}

// --------------------- COMPRAS ----------------------------
function renderCompras() {
  const cont = $('#listaCompras');
  const lista = [...state.compras].sort((a, b) => b.fecha - a.fecha).slice(0, 50);
  if (lista.length === 0) {
    cont.innerHTML = `<div class="text-center text-slate-500 py-10 text-sm">Sin compras registradas.</div>`;
    return;
  }
  cont.innerHTML = lista.map(c => `
    <div class="bg-white rounded-xl p-3 border border-slate-100" onclick="verCompra('${c.id}')">
      <div class="flex justify-between items-start">
        <div>
          <div class="font-medium text-sm">${esc(c.proveedor || 'Sin proveedor')}</div>
          <div class="text-xs text-slate-500">${fmtDateTime(c.fecha)} · ${(c.items || []).length} ítem(s)</div>
        </div>
        <div class="font-bold text-slate-800">${fmtMoney(c.total)}</div>
      </div>
    </div>
  `).join('');
}

function abrirNuevaCompra() {
  state.carritoCompra = [];
  showView('compras');
  renderModalCompra();
}

function renderModalCompra() {
  const productosOpts = state.productos.filter(p => p.activo !== false).map(p =>
    `<option value="${p.id}">${esc(p.nombre)} (${fmtMoney(p.precioCompra)})</option>`
  ).join('');

  const itemsHtml = state.carritoCompra.map((it, idx) => {
    const p = state.productos.find(x => x.id === it.productoId);
    return `
      <div class="flex items-center gap-2 py-2 border-b border-slate-100">
        <div class="flex-1 text-sm">${p ? p.nombre : '?'}</div>
        <input type="number" min="1" value="${it.cantidad}" oninput="actualizarItemCompra(${idx},'cantidad',this.value)" class="w-16 px-2 py-1 border rounded text-sm" />
        <input type="number" step="0.01" min="0" value="${it.costoUnitario}" oninput="actualizarItemCompra(${idx},'costoUnitario',this.value)" class="w-20 px-2 py-1 border rounded text-sm" />
        <button onclick="quitarItemCompra(${idx})" class="text-red-500 p-1">&times;</button>
      </div>
    `;
  }).join('');

  const total = state.carritoCompra.reduce((s, it) => s + it.cantidad * it.costoUnitario, 0);

  const html = `
  <div class="fixed inset-0 z-40 bg-black/40 modal-backdrop flex items-end sm:items-center justify-center" onclick="cerrarModal(event)">
    <div class="modal-sheet bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-3xl max-h-[92vh] overflow-y-auto" onclick="event.stopPropagation()">
      <div class="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
        <h3 class="font-semibold">Nueva compra</h3>
        <button onclick="cerrarModal()" class="p-1.5 hover:bg-slate-100 rounded-lg">&times;</button>
      </div>
      <div class="p-4 space-y-3">
        <input id="compraProv" placeholder="Proveedor (opcional)" class="w-full px-3 py-2 rounded-lg border border-slate-300" />

        <div class="flex gap-2">
          <select id="compraSelProd" class="flex-1 px-2 py-2 rounded-lg border border-slate-300 text-sm">${productosOpts}</select>
          <button onclick="agregarItemCompra()" class="bg-teal-600 text-white px-3 rounded-lg">+ Agregar</button>
        </div>

        <div class="bg-slate-50 rounded-lg p-2 max-h-64 overflow-y-auto">
          <div class="flex text-xs text-slate-500 font-medium pb-1 border-b">
            <span class="flex-1">Producto</span><span class="w-16 text-center">Cant.</span><span class="w-20 text-center">Costo</span><span class="w-6"></span>
          </div>
          ${itemsHtml || '<div class="text-center text-slate-400 py-3 text-sm">Agrega productos</div>'}
        </div>

        <div class="flex justify-between items-center pt-2 text-lg font-bold">
          <span>Total</span><span class="text-teal-700">${fmtMoney(total)}</span>
        </div>

        <textarea id="compraNotas" rows="2" placeholder="Notas (opcional)" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"></textarea>

        <button onclick="guardarCompra()" ${state.carritoCompra.length === 0 ? 'disabled' : ''} class="w-full bg-teal-600 disabled:bg-slate-300 hover:bg-teal-700 text-white font-semibold py-3 rounded-xl">Registrar compra</button>
      </div>
    </div>
  </div>`;
  abrirModal(html);
}

function agregarItemCompra() {
  const pid = $('#compraSelProd').value;
  if (!pid) { toast('Selecciona un producto'); return; }
  const p = state.productos.find(x => x.id === pid);
  const existente = state.carritoCompra.find(it => it.productoId === pid);
  if (existente) { existente.cantidad++; }
  else { state.carritoCompra.push({ productoId: pid, cantidad: 1, costoUnitario: p.precioCompra || 0 }); }
  renderModalCompra();
}

function actualizarItemCompra(idx, campo, valor) {
  const v = parseFloat(valor);
  if (isNaN(v) || v < 0) return;
  state.carritoCompra[idx][campo] = v;
  // re-render dejaría focus extraño en mobile; sólo actualizamos total
  const total = state.carritoCompra.reduce((s, it) => s + it.cantidad * it.costoUnitario, 0);
  const totalEl = document.querySelector('.modal-sheet .text-teal-700');
  if (totalEl) totalEl.textContent = fmtMoney(total);
}

function quitarItemCompra(idx) {
  state.carritoCompra.splice(idx, 1);
  renderModalCompra();
}

async function guardarCompra() {
  if (state.carritoCompra.length === 0) return;
  const items = state.carritoCompra.map(it => ({
    productoId: it.productoId,
    cantidad: Number(it.cantidad),
    costoUnitario: Number(it.costoUnitario),
    subtotal: Number(it.cantidad) * Number(it.costoUnitario),
  }));
  const total = items.reduce((s, it) => s + it.subtotal, 0);
  const compra = {
    id: uid(),
    fecha: Date.now(),
    proveedor: $('#compraProv').value.trim(),
    items, total,
    notas: $('#compraNotas').value.trim(),
    usuarioId: state.user.id,
  };
  await put('compras', compra);

  // Actualizar stock y costo promedio
  for (const it of items) {
    const p = state.productos.find(x => x.id === it.productoId);
    if (!p) continue;
    const stockAnterior = p.stock || 0;
    const costoAnterior = p.precioCompra || 0;
    const nuevoStock = stockAnterior + it.cantidad;
    // Costo promedio ponderado
    const nuevoCosto = nuevoStock > 0
      ? ((stockAnterior * costoAnterior) + (it.cantidad * it.costoUnitario)) / nuevoStock
      : it.costoUnitario;
    p.stock = nuevoStock;
    p.precioCompra = Number(nuevoCosto.toFixed(4));
    await put('productos', p);
    await put('movimientos', {
      id: uid(), fecha: Date.now(), productoId: p.id, tipo: 'compra',
      cantidad: it.cantidad, costo: it.costoUnitario, referenciaId: compra.id, usuarioId: state.user.id
    });
  }

  state.carritoCompra = [];
  await cargarTodo();
  cerrarModal();
  renderCompras();
  toast('Compra registrada');
}

function verCompra(id) {
  const c = state.compras.find(x => x.id === id);
  if (!c) return;
  const items = (c.items || []).map(it => {
    const p = state.productos.find(x => x.id === it.productoId);
    return `<div class="flex justify-between text-sm py-1 border-b border-slate-100">
      <span>${p ? p.nombre : '(eliminado)'} ×${it.cantidad}</span>
      <span>${fmtMoney(it.subtotal)}</span>
    </div>`;
  }).join('');
  const html = `
  <div class="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center" onclick="cerrarModal(event)">
    <div class="modal-sheet bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-3xl max-h-[92vh] overflow-y-auto" onclick="event.stopPropagation()">
      <div class="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
        <h3 class="font-semibold">Compra</h3>
        <button onclick="cerrarModal()" class="p-1.5 hover:bg-slate-100 rounded-lg">&times;</button>
      </div>
      <div class="p-4 space-y-2 text-sm">
        <div><b>Fecha:</b> ${fmtDateTime(c.fecha)}</div>
        <div><b>Proveedor:</b> ${esc(c.proveedor || '—')}</div>
        ${c.notas ? `<div><b>Notas:</b> ${esc(c.notas)}</div>` : ''}
        <div class="pt-2 border-t mt-2">${items}</div>
        <div class="flex justify-between text-lg font-bold pt-2 border-t mt-2">
          <span>Total</span><span class="text-teal-700">${fmtMoney(c.total)}</span>
        </div>
      </div>
    </div>
  </div>`;
  abrirModal(html);
}

// --------------------- VENTAS -----------------------------
function renderVentas() {
  const cont = $('#listaVentas');
  const lista = [...state.ventas].sort((a, b) => b.fecha - a.fecha).slice(0, 50);
  if (lista.length === 0) {
    cont.innerHTML = `<div class="text-center text-slate-500 py-10 text-sm">Sin ventas registradas.</div>`;
    return;
  }
  cont.innerHTML = lista.map(v => `
    <div class="bg-white rounded-xl p-3 border border-slate-100" onclick="verVenta('${v.id}')">
      <div class="flex justify-between items-start">
        <div>
          <div class="font-medium text-sm">${esc(v.cliente || 'Venta de mostrador')}</div>
          <div class="text-xs text-slate-500">${fmtDateTime(v.fecha)} · ${(v.items || []).length} ítem(s)</div>
        </div>
        <div class="text-right">
          <div class="font-bold text-slate-800">${fmtMoney(v.total)}</div>
          <div class="text-xs text-emerald-600">+${fmtMoney(v.gananciaTotal)}</div>
        </div>
      </div>
    </div>
  `).join('');
}

function abrirNuevaVenta() {
  state.carrito = [];
  renderModalVenta();
}

function renderModalVenta() {
  const productos = state.productos.filter(p => p.activo !== false && (p.stock || 0) > 0);
  const productosHtml = productos.map(p => `
    <button onclick="agregarAlCarrito('${p.id}')" class="text-left bg-white border border-slate-200 rounded-xl p-2 active:bg-slate-50">
      <div class="aspect-square mb-1 rounded-lg product-photo overflow-hidden">
        ${p.foto ? `<img src="${p.foto}" class="w-full h-full object-cover" />` : ''}
      </div>
      <div class="text-xs font-medium truncate">${p.nombre}</div>
      <div class="flex justify-between text-xs">
        <span class="text-teal-700 font-semibold">${fmtMoney(p.precioVenta)}</span>
        <span class="text-slate-500">${p.stock} ud</span>
      </div>
    </button>
  `).join('');

  const itemsHtml = state.carrito.map((it, idx) => {
    const p = state.productos.find(x => x.id === it.productoId);
    return `
      <div class="flex items-center gap-2 py-2 border-b border-slate-100">
        <div class="flex-1">
          <div class="text-sm font-medium">${p ? p.nombre : '?'}</div>
          <div class="text-xs text-slate-500">${fmtMoney(it.precioUnitario)} c/u</div>
        </div>
        <div class="flex items-center gap-1">
          <button onclick="cambiarCantidadVenta(${idx}, -1)" class="w-7 h-7 bg-slate-100 rounded">−</button>
          <span class="w-8 text-center text-sm">${it.cantidad}</span>
          <button onclick="cambiarCantidadVenta(${idx}, 1)" class="w-7 h-7 bg-slate-100 rounded">+</button>
        </div>
        <div class="w-16 text-right text-sm font-semibold">${fmtMoney(it.cantidad * it.precioUnitario)}</div>
      </div>
    `;
  }).join('');

  const subtotal = state.carrito.reduce((s, it) => s + it.cantidad * it.precioUnitario, 0);

  const html = `
  <div class="fixed inset-0 z-40 bg-slate-100 flex flex-col" onclick="event.target===this && cerrarModal()">
    <div class="bg-white border-b safe-top px-4 py-3 flex items-center justify-between">
      <button onclick="cerrarModal()" class="p-1.5 hover:bg-slate-100 rounded-lg">
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <h3 class="font-semibold">Nueva venta</h3>
      <div class="w-9"></div>
    </div>

    <div class="flex-1 overflow-y-auto p-3">
      <input id="busqVenta" placeholder="Buscar producto..." oninput="filtrarProductosVenta(this.value)" class="w-full px-3 py-2 rounded-lg border border-slate-300 mb-3 bg-white" />
      <div id="gridProductosVenta" class="grid grid-cols-3 gap-2">${productosHtml || '<div class="col-span-3 text-center text-slate-500 py-6 text-sm">No hay productos con stock.</div>'}</div>
    </div>

    ${state.carrito.length > 0 ? `
    <div class="bg-white border-t shadow-lg max-h-[55vh] overflow-y-auto">
      <details open>
        <summary class="px-4 py-3 flex justify-between items-center border-b">
          <span class="font-semibold">Carrito (${state.carrito.length})</span>
          <span class="text-lg font-bold text-teal-700">${fmtMoney(subtotal)}</span>
        </summary>
        <div class="px-4">${itemsHtml}</div>
        <div class="px-4 py-3 space-y-2">
          <input id="ventaCliente" placeholder="Cliente (opcional)" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
          <select id="ventaMetodo" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
            <option value="efectivo">Efectivo</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="transferencia">Transferencia</option>
            <option value="credito">Crédito</option>
          </select>
          <button onclick="guardarVenta()" class="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-3 rounded-xl text-lg">Cobrar ${fmtMoney(subtotal)}</button>
        </div>
      </details>
    </div>` : ''}
  </div>`;
  abrirModal(html);
}

function filtrarProductosVenta(q) {
  const term = (q || '').toLowerCase();
  const productos = state.productos.filter(p => p.activo !== false && (p.stock || 0) > 0 &&
    (p.nombre + ' ' + (p.sku || '')).toLowerCase().includes(term));
  $('#gridProductosVenta').innerHTML = productos.map(p => `
    <button onclick="agregarAlCarrito('${p.id}')" class="text-left bg-white border border-slate-200 rounded-xl p-2 active:bg-slate-50">
      <div class="aspect-square mb-1 rounded-lg product-photo overflow-hidden">
        ${p.foto ? `<img src="${p.foto}" class="w-full h-full object-cover" />` : ''}
      </div>
      <div class="text-xs font-medium truncate">${p.nombre}</div>
      <div class="flex justify-between text-xs">
        <span class="text-teal-700 font-semibold">${fmtMoney(p.precioVenta)}</span>
        <span class="text-slate-500">${p.stock} ud</span>
      </div>
    </button>
  `).join('') || '<div class="col-span-3 text-center text-slate-500 py-6 text-sm">Sin resultados.</div>';
}

function agregarAlCarrito(pid) {
  const p = state.productos.find(x => x.id === pid);
  if (!p) return;
  const existente = state.carrito.find(it => it.productoId === pid);
  if (existente) {
    if (existente.cantidad + 1 > p.stock) { toast('Sin stock suficiente'); return; }
    existente.cantidad++;
  } else {
    state.carrito.push({ productoId: pid, cantidad: 1, precioUnitario: p.precioVenta, costoUnitario: p.precioCompra || 0 });
  }
  renderModalVenta();
}

function cambiarCantidadVenta(idx, delta) {
  const it = state.carrito[idx];
  const p = state.productos.find(x => x.id === it.productoId);
  const nueva = it.cantidad + delta;
  if (nueva < 1) { state.carrito.splice(idx, 1); }
  else if (nueva > (p?.stock || 0)) { toast('Sin stock suficiente'); return; }
  else { it.cantidad = nueva; }
  renderModalVenta();
}

async function guardarVenta() {
  if (state.carrito.length === 0) return;
  const items = state.carrito.map(it => ({
    productoId: it.productoId,
    cantidad: it.cantidad,
    precioUnitario: it.precioUnitario,
    costoUnitario: it.costoUnitario,
    subtotal: it.cantidad * it.precioUnitario,
    ganancia: it.cantidad * (it.precioUnitario - it.costoUnitario),
  }));
  const total = items.reduce((s, it) => s + it.subtotal, 0);
  const gananciaTotal = items.reduce((s, it) => s + it.ganancia, 0);

  const venta = {
    id: uid(),
    fecha: Date.now(),
    cliente: $('#ventaCliente')?.value.trim() || '',
    metodoPago: $('#ventaMetodo')?.value || 'efectivo',
    items, total, gananciaTotal,
    usuarioId: state.user.id,
  };
  await put('ventas', venta);

  for (const it of items) {
    const p = state.productos.find(x => x.id === it.productoId);
    if (!p) continue;
    p.stock = Math.max(0, (p.stock || 0) - it.cantidad);
    await put('productos', p);
    await put('movimientos', {
      id: uid(), fecha: Date.now(), productoId: p.id, tipo: 'venta',
      cantidad: -it.cantidad, precio: it.precioUnitario, referenciaId: venta.id, usuarioId: state.user.id
    });
  }

  state.carrito = [];
  await cargarTodo();
  cerrarModal();
  renderVentas();
  toast('Venta registrada · ' + fmtMoney(total));
  mostrarTicket(venta);
}

function mostrarTicket(v) {
  const items = v.items.map(it => {
    const p = state.productos.find(x => x.id === it.productoId);
    return `<div class="flex justify-between text-sm py-1"><span>${p ? p.nombre : '?'} ×${it.cantidad}</span><span>${fmtMoney(it.subtotal)}</span></div>`;
  }).join('');
  const html = `
  <div class="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center" onclick="cerrarModal(event)">
    <div class="modal-sheet bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-3xl" onclick="event.stopPropagation()">
      <div class="p-5 text-center">
        <div class="w-14 h-14 bg-emerald-100 rounded-full mx-auto flex items-center justify-center mb-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>
        </div>
        <h3 class="font-bold text-lg">Venta registrada</h3>
        <div class="text-3xl font-bold text-teal-700 my-2">${fmtMoney(v.total)}</div>
        <div class="text-xs text-slate-500">${fmtDateTime(v.fecha)}</div>
      </div>
      <div class="px-5 pb-3 border-t pt-3">${items}</div>
      <div class="px-5 pb-5 space-y-2">
        <button onclick="compartirTicket('${v.id}')" class="w-full bg-slate-100 hover:bg-slate-200 py-2.5 rounded-lg font-medium">Compartir ticket</button>
        <button onclick="cerrarModal()" class="w-full bg-teal-600 hover:bg-teal-700 text-white py-2.5 rounded-lg font-semibold">Cerrar</button>
      </div>
    </div>
  </div>`;
  abrirModal(html);
}

async function compartirTicket(vid) {
  const v = state.ventas.find(x => x.id === vid);
  if (!v) return;
  const lineas = v.items.map(it => {
    const p = state.productos.find(x => x.id === it.productoId);
    return `${p ? p.nombre : '?'} x${it.cantidad}  ${fmtMoney(it.subtotal)}`;
  });
  const texto = `*Ticket de venta*\n${fmtDateTime(v.fecha)}\n${v.cliente ? `Cliente: ${v.cliente}\n` : ''}\n${lineas.join('\n')}\n\n*TOTAL: ${fmtMoney(v.total)}*\nPago: ${v.metodoPago}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Ticket', text: texto }); }
    catch { /* user cancelled */ }
  } else {
    await navigator.clipboard.writeText(texto);
    toast('Ticket copiado al portapapeles');
  }
}

function verVenta(id) {
  const v = state.ventas.find(x => x.id === id);
  if (v) mostrarTicket(v);
}

// --------------------- REPORTES ---------------------------
function initReportes() {
  if (!$('#repDesde').value) {
    const d = new Date(); d.setDate(d.getDate() - 30);
    $('#repDesde').value = d.toISOString().slice(0, 10);
    $('#repHasta').value = todayISO();
  }
  generarReporte();
}

function generarReporte() {
  const desde = new Date($('#repDesde').value).getTime();
  const hasta = new Date($('#repHasta').value).getTime() + 24 * 60 * 60 * 1000;
  const ventas = state.ventas.filter(v => v.fecha >= desde && v.fecha < hasta);
  const compras = state.compras.filter(c => c.fecha >= desde && c.fecha < hasta);

  const totalVentas = ventas.reduce((s, v) => s + v.total, 0);
  const totalGanancia = ventas.reduce((s, v) => s + (v.gananciaTotal || 0), 0);
  const totalCompras = compras.reduce((s, c) => s + c.total, 0);

  $('#repTotalVentas').textContent = fmtMoney(totalVentas);
  $('#repGanancia').textContent = fmtMoney(totalGanancia);
  $('#repCompras').textContent = fmtMoney(totalCompras);
  $('#repNumVentas').textContent = ventas.length;

  const conteo = {};
  ventas.forEach(v => (v.items || []).forEach(it => {
    if (!conteo[it.productoId]) conteo[it.productoId] = { cant: 0, monto: 0 };
    conteo[it.productoId].cant += it.cantidad;
    conteo[it.productoId].monto += it.subtotal;
  }));
  const top = Object.entries(conteo).sort((a, b) => b[1].monto - a[1].monto).slice(0, 10);
  $('#repTopProductos').innerHTML = top.length === 0
    ? '<div class="text-sm text-slate-500 py-2">Sin datos.</div>'
    : top.map(([pid, x]) => {
        const p = state.productos.find(z => z.id === pid);
        return `<div class="flex justify-between items-center py-1.5 border-b border-slate-100 last:border-0">
          <div class="text-sm">${p ? p.nombre : '(eliminado)'}<div class="text-xs text-slate-500">${x.cant} ud</div></div>
          <div class="font-semibold text-teal-700 text-sm">${fmtMoney(x.monto)}</div>
        </div>`;
      }).join('');
}

function exportarReporteCSV() {
  const desde = new Date($('#repDesde').value).getTime();
  const hasta = new Date($('#repHasta').value).getTime() + 24 * 60 * 60 * 1000;
  const ventas = state.ventas.filter(v => v.fecha >= desde && v.fecha < hasta);

  const filas = [['Fecha', 'Cliente', 'Método', 'Producto', 'Cantidad', 'Precio Unit.', 'Subtotal', 'Costo Unit.', 'Ganancia']];
  ventas.forEach(v => (v.items || []).forEach(it => {
    const p = state.productos.find(x => x.id === it.productoId);
    filas.push([
      new Date(v.fecha).toISOString(),
      v.cliente || '',
      v.metodoPago || '',
      p ? p.nombre : '(eliminado)',
      it.cantidad,
      it.precioUnitario.toFixed(2),
      it.subtotal.toFixed(2),
      it.costoUnitario.toFixed(2),
      it.ganancia.toFixed(2),
    ]);
  }));
  const csv = '﻿' + filas.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  descargarBlob(blob, `ventas_${$('#repDesde').value}_${$('#repHasta').value}.csv`);
}

// --------------------- CONFIGURACIÓN ----------------------
async function abrirConfig() {
  const usuarios = await getAll('usuarios');
  const cats = state.categorias;

  const usuariosHtml = usuarios.map(u => `
    <div class="flex items-center justify-between py-2 border-b border-slate-100">
      <div>
        <div class="font-medium text-sm">${esc(u.nombre)} <span class="text-xs text-slate-500">@${u.usuario}</span></div>
        <div class="text-xs text-slate-500">${u.rol} ${u.activo ? '' : '· inactivo'}</div>
      </div>
      <div class="flex gap-1">
        <button onclick="editarUsuario('${u.id}')" class="text-teal-600 text-sm px-2">Editar</button>
        ${u.usuario !== 'admin' ? `<button onclick="eliminarUsuario('${u.id}')" class="text-red-500 text-sm px-2">×</button>` : ''}
      </div>
    </div>
  `).join('');

  const catsHtml = cats.map(c => `
    <div class="flex items-center justify-between py-1.5 border-b border-slate-100">
      <span class="text-sm">${esc(c.nombre)}</span>
      <button onclick="eliminarCategoria('${c.id}')" class="text-red-500 text-sm px-2">×</button>
    </div>
  `).join('');

  const html = `
  <div class="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center" onclick="cerrarModal(event)">
    <div class="modal-sheet bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-3xl max-h-[92vh] overflow-y-auto" onclick="event.stopPropagation()">
      <div class="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
        <h3 class="font-semibold">Configuración</h3>
        <button onclick="cerrarModal()" class="p-1.5 hover:bg-slate-100 rounded-lg">&times;</button>
      </div>
      <div class="p-4 space-y-5">

        <details open>
          <summary class="font-semibold text-sm py-2 flex justify-between items-center">
            <span>Usuarios (${usuarios.length})</span>
            <button onclick="event.preventDefault(); editarUsuario(null)" class="bg-teal-600 text-white text-xs px-3 py-1 rounded-lg">+ Nuevo</button>
          </summary>
          <div class="mt-2">${usuariosHtml}</div>
        </details>

        <details>
          <summary class="font-semibold text-sm py-2 flex justify-between items-center">
            <span>Categorías (${cats.length})</span>
          </summary>
          <div class="mt-2">
            <div class="flex gap-2 mb-2">
              <input id="nuevaCatNombre" placeholder="Nombre" class="flex-1 px-3 py-2 border rounded-lg text-sm" />
              <button onclick="agregarCategoria()" class="bg-teal-600 text-white px-3 rounded-lg text-sm">Agregar</button>
            </div>
            ${catsHtml}
          </div>
        </details>

        <details>
          <summary class="font-semibold text-sm py-2">Cambiar mi contraseña</summary>
          <div class="mt-2 space-y-2">
            <input type="password" id="passActual" placeholder="Actual" class="w-full px-3 py-2 border rounded-lg text-sm" />
            <input type="password" id="passNueva" placeholder="Nueva (mín 6)" class="w-full px-3 py-2 border rounded-lg text-sm" />
            <button onclick="cambiarMiPass()" class="w-full bg-teal-600 text-white py-2 rounded-lg text-sm">Cambiar</button>
          </div>
        </details>

      </div>
    </div>
  </div>`;
  abrirModal(html);
}

async function editarUsuario(id) {
  const u = id ? (await getAll('usuarios')).find(x => x.id === id) : null;
  const html = `
  <div class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onclick="cerrarModal(event)">
    <div class="bg-white rounded-2xl w-full max-w-sm p-5" onclick="event.stopPropagation()">
      <h3 class="font-semibold mb-3">${u ? 'Editar usuario' : 'Nuevo usuario'}</h3>
      <form onsubmit="guardarUsuario(event, '${id || ''}')" class="space-y-2">
        <input id="uNombre" required placeholder="Nombre completo" value="${u ? esc(u.nombre) : ''}" class="w-full px-3 py-2 border rounded-lg" />
        <input id="uUsuario" required placeholder="usuario (login)" value="${u ? esc(u.usuario) : ''}" ${u && u.usuario === 'admin' ? 'readonly' : ''} class="w-full px-3 py-2 border rounded-lg" />
        <select id="uRol" class="w-full px-3 py-2 border rounded-lg">
          <option value="admin" ${u && u.rol === 'admin' ? 'selected' : ''}>Admin</option>
          <option value="vendedor" ${u && u.rol === 'vendedor' ? 'selected' : ''}>Vendedor</option>
        </select>
        <input type="password" id="uPass" placeholder="${u ? 'Nueva contraseña (dejar vacío para conservar)' : 'Contraseña'}" ${u ? '' : 'required'} class="w-full px-3 py-2 border rounded-lg" />
        <label class="flex items-center gap-2 text-sm py-1">
          <input type="checkbox" id="uActivo" ${!u || u.activo ? 'checked' : ''} /> Activo
        </label>
        <div class="flex gap-2 pt-2">
          <button type="button" onclick="abrirConfig()" class="flex-1 bg-slate-100 py-2 rounded-lg">Cancelar</button>
          <button type="submit" class="flex-1 bg-teal-600 text-white py-2 rounded-lg">Guardar</button>
        </div>
      </form>
    </div>
  </div>`;
  abrirModal(html);
}

async function guardarUsuario(e, id) {
  e.preventDefault();
  const usuarios = await getAll('usuarios');
  const existente = id ? usuarios.find(x => x.id === id) : null;
  const usuario = $('#uUsuario').value.trim().toLowerCase();
  if (!existente && usuarios.find(x => x.usuario.toLowerCase() === usuario)) {
    toast('Usuario ya existe'); return;
  }
  const pass = $('#uPass').value;
  const obj = {
    id: id || uid(),
    nombre: $('#uNombre').value.trim(),
    usuario,
    rol: $('#uRol').value,
    activo: $('#uActivo').checked,
    passHash: existente ? existente.passHash : '',
    creado: existente ? existente.creado : Date.now(),
  };
  if (pass) {
    if (pass.length < 6) { toast('Contraseña mínima 6 caracteres'); return; }
    obj.passHash = await hashPass(pass);
  }
  await put('usuarios', obj);
  toast('Usuario guardado');
  abrirConfig();
}

async function eliminarUsuario(id) {
  if (!confirm('¿Eliminar este usuario?')) return;
  await del('usuarios', id);
  toast('Usuario eliminado');
  abrirConfig();
}

async function cambiarMiPass() {
  const actual = $('#passActual').value;
  const nueva = $('#passNueva').value;
  if (nueva.length < 6) { toast('Mínimo 6 caracteres'); return; }
  const u = (await getAll('usuarios')).find(x => x.id === state.user.id);
  if (!u) return;
  const hashAct = await hashPass(actual);
  if (hashAct !== u.passHash) { toast('Contraseña actual incorrecta'); return; }
  u.passHash = await hashPass(nueva);
  await put('usuarios', u);
  toast('Contraseña cambiada');
  $('#passActual').value = ''; $('#passNueva').value = '';
}

async function agregarCategoria() {
  const n = $('#nuevaCatNombre').value.trim();
  if (!n) return;
  await put('categorias', { id: uid(), nombre: n });
  await cargarTodo();
  abrirConfig();
}

async function eliminarCategoria(id) {
  if (!confirm('¿Eliminar categoría? Los productos quedarán sin categoría.')) return;
  await del('categorias', id);
  await cargarTodo();
  abrirConfig();
}

// --------------------- RESPALDO / DRIVE -------------------
async function abrirRespaldo() {
  const html = `
  <div class="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center" onclick="cerrarModal(event)">
    <div class="modal-sheet bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-3xl max-h-[92vh] overflow-y-auto" onclick="event.stopPropagation()">
      <div class="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
        <h3 class="font-semibold">Respaldo y restauración</h3>
        <button onclick="cerrarModal()" class="p-1.5 hover:bg-slate-100 rounded-lg">&times;</button>
      </div>
      <div class="p-4 space-y-4 text-sm">
        <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-900 text-xs">
          <b>Cómo funciona el respaldo a Google Drive:</b>
          <ol class="list-decimal pl-4 mt-1 space-y-0.5">
            <li>Toca <b>Exportar respaldo</b> — se descargará un archivo .json a tu celular.</li>
            <li>Abre Google Drive, toca <b>+</b> → <b>Subir</b> y selecciona ese archivo.</li>
            <li>Para restaurar, descarga el archivo desde Drive y toca <b>Importar respaldo</b>.</li>
          </ol>
        </div>

        <button onclick="exportarRespaldo()" class="w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
          Exportar respaldo (.json)
        </button>

        <label class="w-full bg-white border-2 border-teal-600 text-teal-700 font-semibold py-3 rounded-xl flex items-center justify-center gap-2 cursor-pointer">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
          Importar respaldo (.json)
          <input type="file" accept="application/json,.json" class="hidden" onchange="importarRespaldo(event)" />
        </label>

        <div class="border-t pt-3 text-xs text-slate-500">
          <p>Último respaldo exportado: <span id="ultimoRespaldo">—</span></p>
          <p class="mt-1">Recomendación: respalda al menos <b>una vez por semana</b>.</p>
        </div>

        <button onclick="borrarTodo()" class="w-full bg-red-50 hover:bg-red-100 text-red-700 font-semibold py-2 rounded-xl text-sm">⚠ Borrar todos los datos (peligroso)</button>
      </div>
    </div>
  </div>`;
  abrirModal(html);
  const ult = localStorage.getItem('miTienda.ultimoBackup');
  if (ult) $('#ultimoRespaldo').textContent = fmtDateTime(parseInt(ult));
}

async function exportarRespaldo() {
  const data = {};
  for (const s of STORES) data[s] = await getAll(s);
  data._meta = { app: 'Mi Tienda', version: APP.dbVersion, fecha: Date.now(), usuario: state.user.usuario };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const fecha = new Date().toISOString().slice(0, 10);
  descargarBlob(blob, `mitienda_backup_${fecha}.json`);
  localStorage.setItem('miTienda.ultimoBackup', Date.now().toString());
  toast('Respaldo descargado. Súbelo a Drive desde la app de Drive.');
}

function importarRespaldo(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm('Importar reemplazará TODOS los datos actuales. ¿Continuar?')) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      // Limpiar y reemplazar
      for (const s of STORES) {
        const items = await getAll(s);
        for (const i of items) await del(s, s === 'config' ? i.clave : i.id);
        const nuevos = data[s] || [];
        for (const i of nuevos) await put(s, i);
      }
      await cargarTodo();
      cerrarModal();
      toast('Datos restaurados correctamente');
      showView('dashboard');
    } catch (err) {
      alert('Error al importar: archivo inválido.\n' + err.message);
    }
  };
  reader.readAsText(file);
}

async function borrarTodo() {
  const conf = prompt('Escribe BORRAR para confirmar la eliminación total de datos:');
  if (conf !== 'BORRAR') return;
  for (const s of STORES) {
    const items = await getAll(s);
    for (const i of items) await del(s, s === 'config' ? i.clave : i.id);
  }
  localStorage.clear();
  toast('Datos eliminados. Reiniciando...');
  setTimeout(() => location.reload(), 1500);
}

// --------------------- HELPERS ----------------------------
function abrirModal(html) {
  $('#modalContainer').innerHTML = html;
}
function cerrarModal(e) {
  if (e && e.target !== e.currentTarget) return;
  $('#modalContainer').innerHTML = '';
}

function descargarBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// --------------------- EVENTOS ----------------------------
function initEventos() {
  $('#loginForm').addEventListener('submit', login);
  $$('.tab-btn').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.tab)));
  $('#btnMenu').addEventListener('click', toggleMenu);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#btnMenu') && !e.target.closest('#menuDrop')) cerrarMenu();
  });
  $('#busquedaCatalogo').addEventListener('input', renderCatalogo);
  $('#busquedaInventario').addEventListener('input', renderInventario);
  $('#filtroEstadoInv').addEventListener('change', renderInventario);
}

// --------------------- SERVICE WORKER ---------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// --------------------- START ------------------------------
window.addEventListener('DOMContentLoaded', init);
