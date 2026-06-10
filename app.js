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

const STORES = ['usuarios', 'categorias', 'productos', 'compras', 'ventas', 'movimientos', 'config', 'clientes'];

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

// --------------------- DATA LAYER (Firestore via window.FB) ----
// Las funciones getAll/getOne/put/del delegan a Firebase con caché offline.
// El módulo firebase-api.js (cargado como type="module") inicializa window.FB.

function esperarFB() {
  return new Promise(resolve => {
    if (window.FB && window.FB.db) return resolve();
    window.addEventListener('fb-ready', resolve, { once: true });
    // fallback: poll por si llegamos tarde al evento
    const t = setInterval(() => { if (window.FB && window.FB.db) { clearInterval(t); resolve(); } }, 100);
  });
}

async function getAll(store) { return window.FB.getAll(store); }
async function getOne(store, key) { return window.FB.get(store, key); }
async function put(store, obj) { return window.FB.put(store, obj); }
async function del(store, key) { return window.FB.del(store, key); }

// --------------------- ESTADO -----------------------------
const state = {
  user: null,
  productos: [],
  categorias: [],
  ventas: [],
  compras: [],
  clientes: [],
  carrito: [],
  carritoCompra: [],
  catFilter: null,
  ventaClienteId: null,
  charts: {},
};

// --------------------- BOOTSTRAP --------------------------
async function init() {
  initEventos();
  initSyncBadge();
  await esperarFB();

  // Escuchar cambios de sesión (Firebase Auth persiste solo)
  window.FB.onAuth(async (user) => {
    if (user) {
      state.user = user;
      try {
        await cargarTodo();
        entrarApp();
      } catch (e) {
        console.error('Error cargando datos:', e);
        toast('Error de conexión. Revisa tu internet.');
        mostrarLogin();
      }
    } else {
      state.user = null;
      mostrarLogin();
    }
  });
}

function initSyncBadge() {
  const badge = $('#syncBadge');
  const dot = $('#syncDot');
  const text = $('#syncText');
  if (!badge) return;
  badge.classList.remove('hidden');
  badge.classList.add('inline-flex');

  function actualizar() {
    const online = navigator.onLine;
    const pend = (window.FB && window.FB.pendingWrites) || 0;
    if (!online) {
      dot.className = 'w-2 h-2 rounded-full bg-amber-500';
      text.textContent = 'Sin conexión';
      badge.className = 'inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-700 mr-1';
    } else if (pend > 0) {
      dot.className = 'w-2 h-2 rounded-full bg-blue-500 animate-pulse';
      text.textContent = 'Sincronizando ' + pend;
      badge.className = 'inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700 mr-1';
    } else {
      dot.className = 'w-2 h-2 rounded-full bg-emerald-500';
      text.textContent = 'Sincronizado';
      badge.className = 'inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 mr-1';
    }
  }
  window.addEventListener('online', actualizar);
  window.addEventListener('offline', actualizar);
  window.addEventListener('fb-pending', actualizar);
  window.addEventListener('fb-connection', actualizar);
  setInterval(actualizar, 5000);
  actualizar();
}

async function cargarTodo() {
  state.productos = await getAll('productos');
  state.categorias = await getAll('categorias');
  state.ventas = await getAll('ventas');
  state.clientes = await getAll('clientes').catch(() => []);
  // Compras solo para admin (los vendedores no las pueden leer por seguridad)
  if (state.user && state.user.rol === 'admin') {
    try { state.compras = await getAll('compras'); }
    catch { state.compras = []; }
  } else {
    state.compras = [];
  }
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
  const esAdmin = state.user.rol === 'admin';

  // Botón "+ Nuevo producto" en catálogo: solo admin
  const btnNuevoProd = document.getElementById('btnNuevoProducto');
  if (btnNuevoProd) btnNuevoProd.style.display = esAdmin ? '' : 'none';

  // Tabs de navegación inferior: vendedor solo ve Inicio, Catálogo y Ventas
  const tabsOcultarVendedor = ['inventario', 'reportes'];
  document.querySelectorAll('.tab-btn').forEach(tab => {
    const t = tab.dataset.tab;
    tab.style.display = (!esAdmin && tabsOcultarVendedor.includes(t)) ? 'none' : '';
  });

  // Items del menú dropdown
  const menuItems = document.querySelectorAll('#menuDrop .menu-item');
  menuItems.forEach(item => {
    const txt = item.textContent.trim();
    if (!esAdmin && (txt.includes('Compras') || txt.includes('Configuración') || txt.includes('Respaldo'))) {
      item.style.display = 'none';
    } else {
      item.style.display = '';
    }
  });

  // Botón "Nueva compra" del dashboard
  const btnNuevaCompra = document.querySelector('[onclick*="abrirNuevaCompra"]');
  if (btnNuevaCompra) btnNuevaCompra.style.display = esAdmin ? '' : 'none';

  showView('dashboard');
  // Verificar recordatorio semanal de créditos pendientes
  setTimeout(verificarRecordatorioSemanal, 1500);
}

async function login(e) {
  e.preventDefault();
  const email = $('#loginUser').value.trim();
  const pass = $('#loginPass').value;
  const err = $('#loginError');
  err.classList.add('hidden');

  const btn = e.target.querySelector('button[type="submit"]');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Ingresando...';

  try {
    await window.FB.signIn(email, pass);
    // onAuth se encarga del resto
    $('#loginPass').value = '';
  } catch (e2) {
    err.textContent = e2.message;
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}

async function cerrarSesion() {
  if (!confirm('¿Cerrar sesión?')) return;
  await window.FB.signOut();
  cerrarMenu();
  // onAuth -> mostrarLogin()
}

// --------------------- NAVEGACIÓN -------------------------
function showView(name) {
  $$('.view').forEach(v => v.classList.add('hidden'));
  const el = document.querySelector(`[data-view="${name}"]`);
  if (el) el.classList.remove('hidden');

  $$('.tab-btn').forEach(b => b.classList.remove('tab-active'));
  const tab = document.querySelector(`.tab-btn[data-tab="${name}"]`);
  if (tab) tab.classList.add('tab-active');

  const titulos = { dashboard: 'Dashboard', catalogo: 'Catálogo', inventario: 'Inventario', compras: 'Compras', ventas: 'Ventas', reportes: 'Reportes', clientes: 'Clientes' };
  $('#topTitle').textContent = titulos[name] || 'MICU Store';

  if (name === 'dashboard') renderDashboard();
  if (name === 'catalogo') renderCatalogo();
  if (name === 'inventario') renderInventario();
  if (name === 'compras') renderCompras();
  if (name === 'ventas') renderVentas();
  if (name === 'reportes') initReportes();
  if (name === 'clientes') renderClientes();

  window.scrollTo({ top: 0, behavior: 'instant' });
}

function toggleMenu() { $('#menuDrop').classList.toggle('hidden'); }
function cerrarMenu() { $('#menuDrop').classList.add('hidden'); }

// --------------------- DASHBOARD --------------------------
function renderDashboard() {
  const esAdmin = state.user && state.user.rol === 'admin';
  // Ocultar KPIs sensibles para vendedor (ganancia y valor del inventario)
  const cards = document.querySelectorAll('[data-view="dashboard"] .grid.grid-cols-2 > div');
  if (cards.length >= 4) {
    cards[1].style.display = esAdmin ? '' : 'none'; // Ganancia hoy
    cards[3].style.display = esAdmin ? '' : 'none'; // Inventario (valor)
  }
  const kpiInvCard = $('#kpiInventarioValor')?.closest('.bg-white');
  if (kpiInvCard) kpiInvCard.style.display = esAdmin ? '' : 'none';

  const hoy = startOfDay();
  const mes = startOfMonth();

  const ventasHoy = state.ventas.filter(v => v.fecha >= hoy);
  const ventasMes = state.ventas.filter(v => v.fecha >= mes);

  // Solo cuenta como ganancia las ventas ya cobradas; usa fechaPago como referencia.
  const ventasCobradasHoy = state.ventas.filter(v => v.estado !== 'pendiente' && (v.fechaPago || v.fecha) >= hoy);
  const totalHoy = ventasHoy.reduce((s, v) => s + (v.total || 0), 0);
  const gananciaHoy = ventasCobradasHoy.reduce((s, v) => s + (v.gananciaTotal || 0), 0);
  const totalMes = ventasMes.reduce((s, v) => s + (v.total || 0), 0);

  $('#kpiVentasHoy').textContent = fmtMoney(totalHoy);
  $('#kpiVentasHoyCount').textContent = `${ventasHoy.length} venta${ventasHoy.length === 1 ? '' : 's'}`;
  $('#kpiGananciaHoy').textContent = fmtMoney(gananciaHoy);
  $('#kpiVentasMes').textContent = fmtMoney(totalMes);
  $('#kpiVentasMesCount').textContent = `${ventasMes.length} venta${ventasMes.length === 1 ? '' : 's'}`;

  const invValor = state.productos.reduce((s, p) => s + (p.precioCompra || 0) * (p.stock || 0), 0);
  $('#kpiInventarioValor').textContent = fmtMoney(invValor);
  $('#kpiInventarioCount').textContent = `${state.productos.length} producto${state.productos.length === 1 ? '' : 's'}`;

  // ====== Banner de créditos pendientes (solo admin) ======
  if (esAdmin) renderBannerCreditos();

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
    data: { labels, datasets: [{ data, backgroundColor: '#0a0a0a', borderRadius: 6 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } }, maintainAspectRatio: false }
  });

  // Stock bajo
  const bajos = state.productos.filter(p => (p.stock || 0) <= (p.stockMinimo || 0) && productoEsVisible(p));
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
        <span class="text-sm font-semibold text-amber-500">${q} ud</span>
      </div>`;
    }).join('');
  }
}

// --------------------- CATÁLOGO ---------------------------
function getCategoriasPermitidas() {
  // Admin ve todas; vendedor solo las asignadas (o todas si no tiene restricción)
  if (!state.user || state.user.rol === 'admin') return null;
  const arr = state.user.categoriasPermitidas;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr;
}

function productoEsVisible(p) {
  if (p.activo === false) return false;
  const permitidas = getCategoriasPermitidas();
  if (permitidas === null) return true;
  return permitidas.includes(p.categoriaId);
}

function categoriaEsVisible(c) {
  const permitidas = getCategoriasPermitidas();
  if (permitidas === null) return true;
  return permitidas.includes(c.id);
}

function renderCatalogo() {
  const cont = $('#filtroCategorias');
  const categoriasVisibles = state.categorias.filter(categoriaEsVisible);
  const chips = [
    `<button class="chip ${state.catFilter === null ? 'chip-active' : ''}" onclick="filtrarCategoria(null)">Todas</button>`,
    ...categoriasVisibles.map(c => `<button class="chip ${state.catFilter === c.id ? 'chip-active' : ''}" onclick="filtrarCategoria('${c.id}')">${c.nombre}</button>`)
  ];
  cont.innerHTML = chips.join('');

  const q = ($('#busquedaCatalogo').value || '').toLowerCase();
  let lista = state.productos.filter(productoEsVisible);
  if (state.catFilter) lista = lista.filter(p => p.categoriaId === state.catFilter);
  if (q) lista = lista.filter(p => (p.nombre + ' ' + (p.sku || '')).toLowerCase().includes(q));

  const grid = $('#listaProductos');
  $('#vacioCatalogo').classList.toggle('hidden', lista.length > 0);

  grid.innerHTML = lista.map(p => `
    <div class="bg-white rounded-2xl overflow-hidden border border-slate-100 shadow-sm" onclick="verProductoCatalogo('${p.id}')">
      <div class="aspect-square product-photo flex items-center justify-center overflow-hidden">
        ${p.foto
          ? `<img src="${p.foto}" alt="${p.nombre}" class="w-full h-full object-cover" />`
          : `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="opacity-40"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/></svg>`
        }
      </div>
      <div class="p-2.5">
        <div class="font-semibold text-sm truncate">${p.nombre}</div>
        <div class="flex items-center justify-between mt-1">
          <span class="text-amber-500 font-bold">${fmtMoney(p.precioVenta)}</span>
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

function verProductoCatalogo(id) {
  // Admin abre el editor; vendedor abre vista simple de solo lectura
  const esAdmin = state.user && state.user.rol === 'admin';
  if (esAdmin) { abrirEditorProducto(id); return; }
  const p = state.productos.find(x => x.id === id);
  if (!p) return;
  const cat = state.categorias.find(c => c.id === p.categoriaId);
  const stockBadge = (p.stock || 0) === 0
    ? '<span class="badge bg-red-100 text-red-700">Agotado</span>'
    : (p.stock <= (p.stockMinimo || 0)
        ? '<span class="badge bg-amber-100 text-amber-700">Últimas ' + p.stock + ' unidades</span>'
        : '<span class="badge bg-emerald-100 text-emerald-700">' + p.stock + ' disponibles</span>');
  const html = `
  <div class="fixed inset-0 z-40 bg-black/40 modal-backdrop flex items-end sm:items-center justify-center" onclick="cerrarModal(event)">
    <div class="modal-sheet bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-3xl max-h-[92vh] overflow-y-auto" onclick="event.stopPropagation()">
      <div class="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
        <h3 class="font-semibold">Detalle del producto</h3>
        <button onclick="cerrarModal()" class="p-1.5 hover:bg-slate-100 rounded-lg">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="p-4 space-y-3">
        <div class="aspect-square rounded-2xl product-photo overflow-hidden">
          ${p.foto ? `<img src="${p.foto}" class="w-full h-full object-cover" />` : ''}
        </div>
        <div>
          <div class="text-xs text-slate-500 uppercase tracking-wide">${cat ? esc(cat.nombre) : ''}</div>
          <h2 class="text-xl font-bold text-slate-900">${esc(p.nombre)}</h2>
          ${p.sku ? `<div class="text-xs text-slate-500">Código: ${esc(p.sku)}</div>` : ''}
        </div>
        ${p.descripcion ? `<p class="text-sm text-slate-700">${esc(p.descripcion)}</p>` : ''}
        <div class="flex items-center justify-between border-t border-b py-3">
          <span class="text-3xl font-bold text-slate-900">${fmtMoney(p.precioVenta)}</span>
          ${stockBadge}
        </div>
        <button onclick="cerrarModal(); abrirNuevaVenta(); setTimeout(function(){ agregarAlCarrito('${p.id}'); }, 200);" ${p.stock <= 0 ? 'disabled' : ''} class="w-full bg-black disabled:bg-slate-300 hover:bg-slate-800 text-white font-bold py-3 rounded-xl">
          ${p.stock <= 0 ? 'Sin stock' : 'Agregar a venta'}
        </button>
      </div>
    </div>
  </div>`;
  abrirModal(html);
}

function abrirEditorProducto(id = null) {
  const p = id ? state.productos.find(x => x.id === id) : null;
  const esNuevo = !p;
  const esAdmin = state.user && state.user.rol === 'admin';
  if (!esAdmin) { toast('No tienes permiso para editar productos.'); return; }
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
          <input id="prodNombre" required ${esAdmin ? '' : 'readonly'} class="w-full px-3 py-2 rounded-lg border border-slate-300 ${esAdmin ? '' : 'bg-slate-50'}" value="${p ? esc(p.nombre) : ''}" />
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="text-xs text-slate-500">SKU</label>
            <input id="prodSku" ${esAdmin ? '' : 'readonly'} class="w-full px-3 py-2 rounded-lg border border-slate-300 ${esAdmin ? '' : 'bg-slate-50'}" value="${p ? esc(p.sku || '') : ''}" />
          </div>
          <div>
            <label class="text-xs text-slate-500">Categoría</label>
            <select id="prodCategoria" ${esAdmin ? '' : 'disabled'} class="w-full px-3 py-2 rounded-lg border border-slate-300 ${esAdmin ? '' : 'bg-slate-50'}">${cats}</select>
          </div>
        </div>

        <div>
          <label class="text-xs text-slate-500">Descripción</label>
          <textarea id="prodDesc" rows="2" ${esAdmin ? '' : 'readonly'} class="w-full px-3 py-2 rounded-lg border border-slate-300 ${esAdmin ? '' : 'bg-slate-50'}">${p ? esc(p.descripcion || '') : ''}</textarea>
        </div>

        <div class="grid ${esAdmin ? 'grid-cols-2' : 'grid-cols-1'} gap-2">
          ${esAdmin ? `<div>
            <label class="text-xs text-slate-500">Precio compra</label>
            <input id="prodPCompra" type="number" step="0.01" min="0" class="w-full px-3 py-2 rounded-lg border border-slate-300" value="${p ? (p.precioCompra || 0) : 0}" />
          </div>` : `<input type="hidden" id="prodPCompra" value="${p ? (p.precioCompra || 0) : 0}" />`}
          <div>
            <label class="text-xs text-slate-500">Precio venta *</label>
            <input id="prodPVenta" type="number" step="0.01" min="0" required ${esAdmin ? '' : 'readonly'} class="w-full px-3 py-2 rounded-lg border border-slate-300 ${esAdmin ? '' : 'bg-slate-50'}" value="${p ? (p.precioVenta || 0) : 0}" />
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
          ${esAdmin && !esNuevo ? `<button type="button" onclick="eliminarProducto('${id}')" class="px-3 py-2.5 rounded-lg border border-red-300 text-red-600 hover:bg-red-50">Eliminar</button>` : ''}
          <button type="submit" class="flex-1 bg-black hover:bg-slate-800 text-white font-semibold py-2.5 rounded-lg">${esNuevo ? 'Crear' : (esAdmin ? 'Guardar cambios' : 'Guardar stock')}</button>
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
        <button onclick="ajustarStock('${p.id}')" class="text-xs text-amber-500 underline">Ajustar</button>
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
          <button onclick="agregarItemCompra()" class="bg-black text-white px-3 rounded-lg">+ Agregar</button>
        </div>

        <div class="bg-slate-50 rounded-lg p-2 max-h-64 overflow-y-auto">
          <div class="flex text-xs text-slate-500 font-medium pb-1 border-b">
            <span class="flex-1">Producto</span><span class="w-16 text-center">Cant.</span><span class="w-20 text-center">Costo</span><span class="w-6"></span>
          </div>
          ${itemsHtml || '<div class="text-center text-slate-400 py-3 text-sm">Agrega productos</div>'}
        </div>

        <div class="flex justify-between items-center pt-2 text-lg font-bold">
          <span>Total</span><span class="text-amber-500">${fmtMoney(total)}</span>
        </div>

        <textarea id="compraNotas" rows="2" placeholder="Notas (opcional)" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"></textarea>

        <button onclick="guardarCompra()" ${state.carritoCompra.length === 0 ? 'disabled' : ''} class="w-full bg-black disabled:bg-slate-300 hover:bg-slate-800 text-white font-semibold py-3 rounded-xl">Registrar compra</button>
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
  const totalEl = document.querySelector('.modal-sheet .text-amber-500');
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
          <span>Total</span><span class="text-amber-500">${fmtMoney(c.total)}</span>
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
  const esAdmin = state.user && state.user.rol === 'admin';
  cont.innerHTML = lista.map(v => {
    const pendiente = v.estado === 'pendiente';
    return `
    <div class="bg-white rounded-xl p-3 border ${pendiente ? 'border-amber-300' : 'border-slate-100'}" onclick="verVenta('${v.id}')">
      <div class="flex justify-between items-start">
        <div>
          <div class="font-medium text-sm flex items-center gap-1">
            ${esc(v.cliente || 'Venta de mostrador')}
            ${pendiente ? '<span class="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold">CRÉDITO</span>' : ''}
          </div>
          <div class="text-xs text-slate-500">${fmtDateTime(v.fecha)} · ${(v.items || []).length} ítem(s)</div>
        </div>
        <div class="text-right">
          <div class="font-bold text-slate-800">${fmtMoney(v.total)}</div>
          ${pendiente
            ? '<div class="text-xs text-amber-600">Por cobrar</div>'
            : (esAdmin ? `<div class="text-xs text-emerald-600">+${fmtMoney(v.gananciaTotal)}</div>` : '')}
        </div>
      </div>
    </div>`;
  }).join('');
}

function abrirNuevaVenta() {
  state.carrito = [];
  state.ventaClienteId = null;
  renderModalVenta();
}

function renderModalVenta() {
  const productos = state.productos.filter(p => productoEsVisible(p) && (p.stock || 0) > 0);
  const productosHtml = productos.map(p => `
    <button onclick="agregarAlCarrito('${p.id}')" class="text-left bg-white border border-slate-200 rounded-xl p-2 active:bg-slate-50">
      <div class="aspect-square mb-1 rounded-lg product-photo overflow-hidden">
        ${p.foto ? `<img src="${p.foto}" class="w-full h-full object-cover" />` : ''}
      </div>
      <div class="text-xs font-medium truncate">${p.nombre}</div>
      <div class="flex justify-between text-xs">
        <span class="text-amber-500 font-semibold">${fmtMoney(p.precioVenta)}</span>
        <span class="text-slate-500">${p.stock} ud</span>
      </div>
    </button>
  `).join('');

  const itemsHtml = state.carrito.map((it, idx) => {
    const p = state.productos.find(x => x.id === it.productoId);
    const desc = it.descuentoPct || 0;
    const precioFinal = it.precioUnitario * (1 - desc / 100);
    const subtotalItem = it.cantidad * precioFinal;
    const badgeDesc = desc > 0
      ? `<span class="text-emerald-600 font-medium">−${desc}%</span>`
      : '';
    const colorBtnDesc = desc > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600';
    return `
      <div class="py-2 border-b border-slate-100">
        <div class="flex items-center gap-2">
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">${p ? p.nombre : '?'}</div>
            <div class="text-xs text-slate-500">
              ${fmtMoney(it.precioUnitario)} c/u
              ${badgeDesc}
            </div>
          </div>
          <div class="flex items-center gap-1">
            <button onclick="cambiarCantidadVenta(${idx}, -1)" class="w-7 h-7 bg-slate-100 rounded">−</button>
            <span class="w-8 text-center text-sm">${it.cantidad}</span>
            <button onclick="cambiarCantidadVenta(${idx}, 1)" class="w-7 h-7 bg-slate-100 rounded">+</button>
          </div>
          <div class="w-16 text-right text-sm font-semibold">${fmtMoney(subtotalItem)}</div>
        </div>
        <div class="flex items-center justify-end gap-1 mt-1">
          <span class="text-xs text-slate-500 mr-1">Desc:</span>
          <button onclick="setDescuento(${idx}, 0)" class="text-xs px-2 py-0.5 rounded-full ${desc===0?'bg-slate-700 text-white':'bg-slate-100 text-slate-600'}">0%</button>
          <button onclick="setDescuento(${idx}, 5)" class="text-xs px-2 py-0.5 rounded-full ${desc===5?'bg-emerald-600 text-white':'bg-slate-100 text-slate-600'}">5%</button>
          <button onclick="setDescuento(${idx}, 10)" class="text-xs px-2 py-0.5 rounded-full ${desc===10?'bg-emerald-600 text-white':'bg-slate-100 text-slate-600'}">10%</button>
        </div>
      </div>
    `;
  }).join('');

  const subtotal = state.carrito.reduce((s, it) => {
    const desc = it.descuentoPct || 0;
    return s + it.cantidad * it.precioUnitario * (1 - desc / 100);
  }, 0);
  const descTotal = state.carrito.reduce((s, it) => {
    const desc = it.descuentoPct || 0;
    return s + it.cantidad * it.precioUnitario * (desc / 100);
  }, 0);

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
          <span class="text-lg font-bold text-amber-500">${fmtMoney(subtotal)}</span>
        </summary>
        ${descTotal > 0 ? `<div class="px-4 py-2 bg-emerald-50 text-xs text-emerald-700 flex justify-between"><span>Descuento aplicado</span><span class="font-semibold">−${fmtMoney(descTotal)}</span></div>` : ''}
        <div class="px-4">${itemsHtml}</div>
        <div class="px-4 py-3 space-y-2">
          <div class="flex gap-2">
            <select id="ventaClienteSel" onchange="seleccionarClienteVenta(this.value)" class="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm">
              <option value="">— Seleccionar cliente —</option>
              ${state.clientes.filter(c => c.activo !== false).sort((a,b) => a.nombre.localeCompare(b.nombre)).map(c => `<option value="${c.id}" ${state.ventaClienteId===c.id?'selected':''}>${esc(c.nombre)}${c.telefono?' · '+esc(c.telefono):''}</option>`).join('')}
            </select>
            <button onclick="abrirEditorClienteRapido()" class="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 rounded-lg text-sm font-medium">+ Nuevo</button>
          </div>
          <input id="ventaCliente" placeholder="Nombre del cliente (opcional)" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" value="${state.ventaClienteId ? (state.clientes.find(c=>c.id===state.ventaClienteId)?.nombre||'') : ''}" />
          <input id="ventaTelefono" type="tel" placeholder="WhatsApp del cliente (opcional) ej: +50370000000" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" value="${state.ventaClienteId ? (state.clientes.find(c=>c.id===state.ventaClienteId)?.telefono||'') : ''}" />
          <input id="ventaEmail" type="email" placeholder="Correo del cliente (opcional)" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" value="${state.ventaClienteId ? (state.clientes.find(c=>c.id===state.ventaClienteId)?.email||'') : ''}" />
          <select id="ventaMetodo" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
            <option value="efectivo">Efectivo</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="transferencia">Transferencia</option>
            <option value="credito">Crédito</option>
          </select>
          <button onclick="guardarVenta()" class="w-full bg-black hover:bg-slate-800 text-white font-bold py-3 rounded-xl text-lg">Cobrar ${fmtMoney(subtotal)}${descTotal > 0 ? ` (ahorro ${fmtMoney(descTotal)})` : ''}</button>
        </div>
      </details>
    </div>` : ''}
  </div>`;
  abrirModal(html);
}

function filtrarProductosVenta(q) {
  const term = (q || '').toLowerCase();
  const productos = state.productos.filter(p => productoEsVisible(p) && (p.stock || 0) > 0 &&
    (p.nombre + ' ' + (p.sku || '')).toLowerCase().includes(term));
  $('#gridProductosVenta').innerHTML = productos.map(p => `
    <button onclick="agregarAlCarrito('${p.id}')" class="text-left bg-white border border-slate-200 rounded-xl p-2 active:bg-slate-50">
      <div class="aspect-square mb-1 rounded-lg product-photo overflow-hidden">
        ${p.foto ? `<img src="${p.foto}" class="w-full h-full object-cover" />` : ''}
      </div>
      <div class="text-xs font-medium truncate">${p.nombre}</div>
      <div class="flex justify-between text-xs">
        <span class="text-amber-500 font-semibold">${fmtMoney(p.precioVenta)}</span>
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

function setDescuento(idx, porcentaje) {
  if (porcentaje < 0 || porcentaje > 10) { toast('Descuento máximo permitido: 10%'); return; }
  if (!state.carrito[idx]) return;
  state.carrito[idx].descuentoPct = porcentaje;
  renderModalVenta();
}

async function guardarVenta() {
  if (state.carrito.length === 0) return;
  const items = state.carrito.map(it => {
    const desc = Math.min(10, Math.max(0, it.descuentoPct || 0));
    const precioFinal = it.precioUnitario * (1 - desc / 100);
    return {
      productoId: it.productoId,
      cantidad: it.cantidad,
      precioUnitario: it.precioUnitario,
      descuentoPct: desc,
      precioFinal: Number(precioFinal.toFixed(2)),
      costoUnitario: it.costoUnitario,
      subtotal: Number((it.cantidad * precioFinal).toFixed(2)),
      ganancia: Number((it.cantidad * (precioFinal - it.costoUnitario)).toFixed(2)),
    };
  });
  const total = items.reduce((s, it) => s + it.subtotal, 0);
  const gananciaTotal = items.reduce((s, it) => s + it.ganancia, 0);

  const metodoPagoSel = $('#ventaMetodo')?.value || 'efectivo';
  const ahora = Date.now();
  const venta = {
    id: uid(),
    fecha: ahora,
    clienteId: state.ventaClienteId || null,
    cliente: $('#ventaCliente')?.value.trim() || '',
    telefonoCliente: $('#ventaTelefono')?.value.trim() || '',
    emailCliente: $('#ventaEmail')?.value.trim() || '',
    metodoPago: metodoPagoSel,
    estado: metodoPagoSel === 'credito' ? 'pendiente' : 'pagada',
    fechaPago: metodoPagoSel === 'credito' ? null : ahora,
    fechaVencimiento: metodoPagoSel === 'credito' ? ahora + 7 * 24 * 60 * 60 * 1000 : null,
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
  const subtotalSinDesc = v.items.reduce((s, it) => s + (it.cantidad * it.precioUnitario), 0);
  const totalDesc = subtotalSinDesc - v.total;
  const items = v.items.map(it => {
    const p = state.productos.find(x => x.id === it.productoId);
    const desc = it.descuentoPct || 0;
    return `<div class="py-1 text-sm">
      <div class="flex justify-between">
        <span>${p ? esc(p.nombre) : '?'} ×${it.cantidad}</span>
        <span>${fmtMoney(it.subtotal)}</span>
      </div>
      ${desc > 0 ? `<div class="text-xs text-emerald-600">Descuento ${desc}% aplicado</div>` : ''}
    </div>`;
  }).join('');

  const tienePhone = !!(v.telefonoCliente && v.telefonoCliente.length >= 8);
  const tieneEmail = !!(v.emailCliente && v.emailCliente.includes('@'));

  const html = `
  <div class="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center" onclick="cerrarModal(event)">
    <div class="modal-sheet bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-3xl max-h-[92vh] overflow-y-auto" onclick="event.stopPropagation()">
      <div class="p-5 text-center">
        ${v.estado === 'pendiente'
          ? `<div class="w-14 h-14 bg-amber-100 rounded-full mx-auto flex items-center justify-center mb-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="3"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
            <h3 class="font-bold text-lg text-amber-700">Venta a crédito</h3>
            <div class="text-xs text-amber-600 mt-0.5">Pendiente de cobro</div>`
          : `<div class="w-14 h-14 bg-emerald-100 rounded-full mx-auto flex items-center justify-center mb-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>
            </div>
            <h3 class="font-bold text-lg">Venta registrada</h3>`}
        <div class="text-3xl font-bold text-amber-500 my-2">${fmtMoney(v.total)}</div>
        <div class="text-xs text-slate-500">${fmtDateTime(v.fecha)}</div>
        ${v.cliente ? `<div class="text-sm mt-1">Cliente: <b>${esc(v.cliente)}</b></div>` : ''}
        ${v.estado === 'pendiente' && v.fechaVencimiento ? `<div class="text-xs text-amber-700 mt-1">Cobro esperado: ${fmtDate(v.fechaVencimiento)}</div>` : ''}
        ${v.estado === 'pagada' && v.fechaPago && v.fechaPago !== v.fecha ? `<div class="text-xs text-emerald-700 mt-1">✓ Pagado el ${fmtDate(v.fechaPago)}</div>` : ''}
      </div>
      <div class="px-5 pb-3 border-t pt-3">${items}</div>
      ${totalDesc > 0 ? `<div class="px-5 text-sm flex justify-between text-emerald-700"><span>Descuento total</span><span>−${fmtMoney(totalDesc)}</span></div>` : ''}
      <div class="px-5 py-2 border-t flex justify-between font-bold"><span>Total</span><span>${fmtMoney(v.total)}</span></div>
      <div class="px-5 pb-5 pt-3 space-y-2">
        ${state.user && state.user.rol === 'admin' ? `
          <button onclick="cerrarModal(); setTimeout(function(){editarVenta('${v.id}');}, 100)" class="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 py-2.5 rounded-lg font-semibold flex items-center justify-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Editar venta
          </button>` : ''}
        ${v.estado === 'pendiente' && state.user ? `
          <button onclick="cerrarModal(); setTimeout(function(){marcarVentaPagada('${v.id}');}, 100)" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-lg font-bold">✓ Marcar como cobrada</button>
        ` : ''}
        ${tienePhone ? `<button onclick="enviarPorWhatsApp('${v.id}')" class="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-2.5 rounded-lg font-semibold flex items-center justify-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.945C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.715 5.59l-.999 3.648 3.773-.937zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.149-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z"/></svg>
          Enviar por WhatsApp
        </button>` : ''}
        ${tieneEmail ? `<button onclick="enviarPorEmail('${v.id}')" class="w-full bg-blue-500 hover:bg-blue-600 text-white py-2.5 rounded-lg font-semibold flex items-center justify-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-10 5L2 7"/></svg>
          Enviar por correo
        </button>` : ''}
        <button onclick="descargarTicketPDF('${v.id}')" class="w-full bg-slate-100 hover:bg-slate-200 py-2.5 rounded-lg font-medium flex items-center justify-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
          Descargar / compartir PDF
        </button>
        <button onclick="cerrarModal()" class="w-full bg-black hover:bg-slate-800 text-white py-2.5 rounded-lg font-semibold">Cerrar</button>
      </div>
    </div>
  </div>`;
  abrirModal(html);
}

async function obtenerLineasTexto(v, negocio) {
  const lineas = v.items.map(it => {
    const p = state.productos.find(x => x.id === it.productoId);
    const desc = it.descuentoPct || 0;
    return `• ${p ? p.nombre : '?'} x${it.cantidad}  ${fmtMoney(it.subtotal)}${desc > 0 ? ' (' + desc + '% desc)' : ''}`;
  });
  const subtotalSinDesc = v.items.reduce((s, it) => s + (it.cantidad * it.precioUnitario), 0);
  const totalDesc = subtotalSinDesc - v.total;
  return `*${negocio.nombre || 'MICU Store'}*\n` +
    `Ticket: ${fmtDateTime(v.fecha)}\n` +
    `${v.cliente ? 'Cliente: ' + v.cliente + '\n' : ''}\n` +
    lineas.join('\n') + '\n\n' +
    (totalDesc > 0 ? `Descuento: -${fmtMoney(totalDesc)}\n` : '') +
    `*TOTAL: ${fmtMoney(v.total)}*\n` +
    `Pago: ${v.metodoPago}\n\n` +
    `¡Gracias por tu compra!` +
    (negocio.telefono ? `\nContacto: ${negocio.telefono}` : '') +
    (negocio.instagram ? `\nIG: ${negocio.instagram}` : '');
}

async function enviarPorWhatsApp(vid) {
  const v = state.ventas.find(x => x.id === vid);
  if (!v || !v.telefonoCliente) { toast('Sin teléfono del cliente'); return; }
  const negocio = await obtenerDatosNegocio();
  const texto = await obtenerLineasTexto(v, negocio);
  const tel = v.telefonoCliente.replace(/[^\d]/g, '');
  const url = `https://wa.me/${tel}?text=${encodeURIComponent(texto)}`;
  window.open(url, '_blank');
}

async function enviarPorEmail(vid) {
  const v = state.ventas.find(x => x.id === vid);
  if (!v || !v.emailCliente) { toast('Sin correo del cliente'); return; }
  const negocio = await obtenerDatosNegocio();
  const texto = (await obtenerLineasTexto(v, negocio)).replace(/\*/g, '');
  const asunto = `Tu compra en ${negocio.nombre || 'MICU Store'} - ${fmtDate(v.fecha)}`;
  const url = `mailto:${v.emailCliente}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(texto)}`;
  window.open(url, '_blank');
}

async function descargarTicketPDF(vid) {
  const v = state.ventas.find(x => x.id === vid);
  if (!v) return;
  const negocio = await obtenerDatosNegocio();
  const { jsPDF } = window.jspdf;

  const W = 80;
  const numItems = v.items.length;
  const H = 130 + numItems * 12;
  const doc = new jsPDF({ unit: 'mm', format: [W, H], orientation: 'portrait' });
  const BLACK = [10, 10, 10];
  const GOLD = [251, 191, 36];
  const GRAY = [115, 115, 115];

  // --- Header negro con logo ---
  doc.setFillColor(...BLACK);
  doc.rect(0, 0, W, 35, 'F');

  // Logo: cuadrado negro con M dorada y línea
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(W/2 - 8, 5, 16, 16, 2, 2, 'F');
  doc.setTextColor(...BLACK);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text('M', W/2, 16, { align: 'center' });

  // Nombre del negocio
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13); doc.setFont('helvetica', 'bold');
  doc.text(negocio.nombre || 'MICU Store', W/2, 28, { align: 'center' });

  // Línea dorada
  doc.setDrawColor(...GOLD); doc.setLineWidth(0.5);
  doc.line(W/2 - 15, 31, W/2 + 15, 31);

  // --- Info contacto del negocio ---
  let y = 41;
  doc.setTextColor(...GRAY);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
  if (negocio.telefono) { doc.text(negocio.telefono, W/2, y, { align: 'center' }); y += 3.5; }
  if (negocio.direccion) {
    const lns = doc.splitTextToSize(negocio.direccion, W - 10);
    doc.text(lns, W/2, y, { align: 'center' }); y += lns.length * 3.5;
  }
  if (negocio.instagram) { doc.text(negocio.instagram, W/2, y, { align: 'center' }); y += 3.5; }

  y += 2;
  doc.setDrawColor(200); doc.setLineWidth(0.2);
  doc.line(4, y, W - 4, y);
  y += 4;

  // --- Datos de la venta ---
  doc.setTextColor(...BLACK);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
  doc.text('TICKET DE VENTA', W/2, y, { align: 'center' }); y += 4;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
  doc.text(fmtDateTime(v.fecha), W/2, y, { align: 'center' }); y += 3.5;
  if (v.cliente) { doc.text('Cliente: ' + v.cliente, 4, y); y += 3.5; }
  y += 1;
  doc.setDrawColor(200);
  doc.line(4, y, W - 4, y);
  y += 4;

  // --- Items ---
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
  doc.text('Producto', 4, y);
  doc.text('Cant', W - 32, y, { align: 'left' });
  doc.text('Subt.', W - 4, y, { align: 'right' });
  y += 3;
  doc.setDrawColor(220);
  doc.line(4, y, W - 4, y);
  y += 3;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
  for (const it of v.items) {
    const p = state.productos.find(x => x.id === it.productoId);
    const nombre = p ? p.nombre : '(eliminado)';
    const nombreLines = doc.splitTextToSize(nombre, W - 38);
    doc.text(nombreLines, 4, y);
    doc.text(String(it.cantidad), W - 32, y);
    doc.text(fmtMoney(it.subtotal), W - 4, y, { align: 'right' });
    y += nombreLines.length * 3;
    if ((it.descuentoPct || 0) > 0) {
      doc.setTextColor(5, 150, 105);
      doc.setFontSize(6);
      doc.text(`  Desc. ${it.descuentoPct}% (-${fmtMoney(it.cantidad * it.precioUnitario * it.descuentoPct / 100)})`, 4, y);
      doc.setTextColor(...BLACK); doc.setFontSize(7);
      y += 3;
    }
    y += 1;
  }

  y += 1;
  doc.setDrawColor(200);
  doc.line(4, y, W - 4, y);
  y += 4;

  // --- Subtotal/Descuento/Total ---
  const subtSinDesc = v.items.reduce((s, it) => s + it.cantidad * it.precioUnitario, 0);
  const totDesc = subtSinDesc - v.total;
  if (totDesc > 0.001) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    doc.text('Subtotal', 4, y);
    doc.text(fmtMoney(subtSinDesc), W - 4, y, { align: 'right' });
    y += 3.5;
    doc.setTextColor(5, 150, 105);
    doc.text('Descuento', 4, y);
    doc.text('-' + fmtMoney(totDesc), W - 4, y, { align: 'right' });
    doc.setTextColor(...BLACK);
    y += 3.5;
  }
  doc.setFillColor(...BLACK);
  doc.rect(2, y - 1, W - 4, 8, 'F');
  doc.setTextColor(...GOLD);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('TOTAL', 4, y + 4);
  doc.text(fmtMoney(v.total), W - 4, y + 4, { align: 'right' });
  y += 11;

  doc.setTextColor(...GRAY);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
  doc.text('Forma de pago: ' + (v.metodoPago || 'efectivo'), W/2, y, { align: 'center' });
  y += 6;

  // --- Footer ---
  doc.setDrawColor(...GOLD); doc.setLineWidth(0.4);
  doc.line(W/2 - 12, y, W/2 + 12, y);
  y += 4;
  doc.setTextColor(...BLACK); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
  doc.text('¡Gracias por tu compra!', W/2, y, { align: 'center' });
  y += 4;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6);
  doc.setTextColor(...GRAY);
  doc.text('Conserva este ticket', W/2, y, { align: 'center' });

  // Compartir si es posible (móvil), si no descargar
  const fechaArch = new Date(v.fecha).toISOString().slice(0, 10);
  const fileName = `ticket_${fechaArch}_${vid.slice(-6)}.pdf`;

  try {
    const blob = doc.output('blob');
    const file = new File([blob], fileName, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Ticket de venta', text: `Ticket de ${negocio.nombre || 'MICU Store'}` });
      return;
    }
  } catch (e) { /* fallback to download */ }
  doc.save(fileName);
  toast('Ticket descargado');
}

async function compartirTicket(vid) {
  return descargarTicketPDF(vid);
}

// ----------- CREDITOS PENDIENTES -----------
function renderBannerCreditos() {
  const pendientes = getVentasPendientes();
  if (pendientes.length === 0) {
    const ex = document.getElementById('bannerCreditos');
    if (ex) ex.remove();
    return;
  }
  const vencidas = pendientes.filter(v => v.fechaVencimiento && Date.now() > v.fechaVencimiento);
  const total = pendientes.reduce((s, v) => s + v.total, 0);
  const cls = vencidas.length > 0 ? 'bg-red-50 border-red-300 text-red-800' : 'bg-amber-50 border-amber-300 text-amber-800';
  const icon = vencidas.length > 0 ? '⚠️' : '⏰';
  const titulo = vencidas.length > 0
    ? `${vencidas.length} crédito${vencidas.length===1?'':'s'} VENCIDO${vencidas.length===1?'':'S'}`
    : `${pendientes.length} crédito${pendientes.length===1?'':'s'} por cobrar`;
  const view = document.querySelector('[data-view="dashboard"]');
  if (!view) return;
  let banner = document.getElementById('bannerCreditos');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'bannerCreditos';
    view.insertBefore(banner, view.firstChild);
  }
  banner.className = `rounded-2xl border-2 p-3 ${cls} cursor-pointer`;
  banner.onclick = abrirCreditos;
  banner.innerHTML = `
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="text-2xl">${icon}</div>
        <div>
          <div class="font-bold text-sm">${titulo}</div>
          <div class="text-xs opacity-80">Total: ${fmtMoney(total)} · Toca para revisar</div>
        </div>
      </div>
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
    </div>`;
}

function getVentasPendientes() {
  return state.ventas
    .filter(v => v.estado === 'pendiente')
    .sort((a, b) => a.fecha - b.fecha);
}

function diasTranscurridos(fecha) {
  return Math.floor((Date.now() - fecha) / (24 * 60 * 60 * 1000));
}

async function marcarVentaPagada(vid) {
  const v = state.ventas.find(x => x.id === vid);
  if (!v) return;
  if (!confirm(`¿Marcar como pagada la venta de ${esc(v.cliente || 'cliente')} por ${fmtMoney(v.total)}?`)) return;
  v.estado = 'pagada';
  v.fechaPago = Date.now();
  await put('ventas', v);
  await cargarTodo();
  toast('Venta marcada como pagada');
  abrirCreditos();
}

async function abrirCreditos() {
  const pendientes = getVentasPendientes();
  const totalPendiente = pendientes.reduce((s, v) => s + v.total, 0);
  const html = `
  <div class="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center" onclick="cerrarModal(event)">
    <div class="modal-sheet bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-3xl max-h-[92vh] overflow-y-auto" onclick="event.stopPropagation()">
      <div class="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
        <h3 class="font-semibold">Créditos pendientes</h3>
        <button onclick="cerrarModal()" class="p-1.5 hover:bg-slate-100 rounded-lg">&times;</button>
      </div>
      <div class="p-4">
        ${pendientes.length === 0 ? `
          <div class="text-center py-12">
            <div class="text-5xl mb-2">✓</div>
            <div class="text-emerald-700 font-semibold">No hay créditos pendientes</div>
            <div class="text-xs text-slate-500 mt-1">Todas tus ventas están cobradas.</div>
          </div>
        ` : `
          <div class="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
            <div class="text-xs text-amber-700 uppercase">Total por cobrar</div>
            <div class="text-2xl font-bold text-amber-900">${fmtMoney(totalPendiente)}</div>
            <div class="text-xs text-amber-700">${pendientes.length} venta${pendientes.length === 1 ? '' : 's'} pendiente${pendientes.length === 1 ? '' : 's'}</div>
          </div>
          ${pendientes.some(v => v.telefonoCliente) ? `
          <button onclick="recordarTodosPorWhatsApp()" class="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.945C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.715 5.59l-.999 3.648 3.773-.937zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.149-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z"/></svg>
            Recordar a todos por WhatsApp
          </button>` : ''}
          ${pendientes.map(v => {
            const dias = diasTranscurridos(v.fecha);
            const vencida = v.fechaVencimiento && Date.now() > v.fechaVencimiento;
            const cls = vencida ? 'bg-red-50 border-red-200' : (dias >= 5 ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200');
            const claseDias = vencida ? 'text-red-700 font-semibold' : (dias >= 5 ? 'text-amber-700' : 'text-slate-600');
            return `
              <div class="rounded-xl p-3 border ${cls} mb-2">
                <div class="flex justify-between items-start">
                  <div class="min-w-0 flex-1">
                    <div class="font-medium text-sm">${esc(v.cliente || 'Sin nombre')}</div>
                    <div class="text-xs text-slate-500">${fmtDate(v.fecha)}</div>
                    ${v.telefonoCliente ? `<div class="text-xs text-slate-500">📱 ${esc(v.telefonoCliente)}</div>` : ''}
                  </div>
                  <div class="text-right">
                    <div class="font-bold">${fmtMoney(v.total)}</div>
                    <div class="text-xs ${claseDias}">${dias} día${dias === 1 ? '' : 's'}${vencida ? ' (VENCIDO)' : ''}</div>
                  </div>
                </div>
                <div class="grid grid-cols-${v.telefonoCliente ? '4' : '3'} gap-1 mt-2">
                  <button onclick="verVenta('${v.id}')" class="text-xs bg-slate-100 hover:bg-slate-200 py-1.5 rounded font-medium">Ver</button>
                  <button onclick="editarVenta('${v.id}')" class="text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 py-1.5 rounded font-medium">✏ Editar</button>
                  ${v.telefonoCliente ? `<button onclick="recordarPorWhatsApp('${v.id}')" class="text-xs bg-emerald-100 hover:bg-emerald-200 text-emerald-700 py-1.5 rounded font-medium">WA</button>` : ''}
                  <button onclick="marcarVentaPagada('${v.id}', true)" class="text-xs bg-emerald-600 hover:bg-emerald-700 text-white py-1.5 rounded font-semibold">✓ Cobrar</button>
                </div>
              </div>
            `;
          }).join('')}
        `}
      </div>
    </div>
  </div>`;
  abrirModal(html);
}

async function recordarPorWhatsApp(vid) {
  const v = state.ventas.find(x => x.id === vid);
  if (!v || !v.telefonoCliente) return;
  const negocio = await obtenerDatosNegocio();
  const dias = diasTranscurridos(v.fecha);
  const texto = `Hola ${v.cliente || ''} 👋\n\nQuería recordarte amablemente tu pago pendiente con *${negocio.nombre || 'MICU Store'}*:\n\nMonto: *${fmtMoney(v.total)}*\nFecha: ${fmtDate(v.fecha)}\nDías transcurridos: ${dias}\n\n¿Cuándo te queda mejor que pase a cobrar?\n\n¡Gracias!`;
  const tel = v.telefonoCliente.replace(/[^\d]/g, '');
  window.open(`https://wa.me/${tel}?text=${encodeURIComponent(texto)}`, '_blank');
}

function verVenta(id) {
  const v = state.ventas.find(x => x.id === id);
  if (v) mostrarTicket(v);
}

// --------------------- CLIENTES ---------------------------

function renderClientes() {
  const q = ($('#busquedaClientes').value || '').toLowerCase();
  let lista = state.clientes.filter(c => c.activo !== false);
  if (q) lista = lista.filter(c => (c.nombre + ' ' + (c.telefono || '') + ' ' + (c.email || '')).toLowerCase().includes(q));
  lista = lista.sort((a, b) => a.nombre.localeCompare(b.nombre));

  // Stats
  const pendientes = getVentasPendientes();
  const clientesConCredito = new Set(pendientes.filter(v => v.clienteId).map(v => v.clienteId));
  const totalCredito = pendientes.reduce((s, v) => s + v.total, 0);
  $('#cliTotal').textContent = state.clientes.filter(c => c.activo !== false).length;
  $('#cliConCredito').textContent = clientesConCredito.size;
  $('#cliTotalCredito').textContent = fmtMoney(totalCredito);

  const cont = $('#listaClientes');
  $('#vacioClientes').classList.toggle('hidden', lista.length > 0);

  cont.innerHTML = lista.map(c => {
    const ventasCli = state.ventas.filter(v => v.clienteId === c.id);
    const creditoCli = ventasCli.filter(v => v.estado === 'pendiente');
    const totalPendCli = creditoCli.reduce((s, v) => s + v.total, 0);
    const ultimaVenta = ventasCli.sort((a, b) => b.fecha - a.fecha)[0];
    return `
    <div class="bg-white rounded-xl border ${creditoCli.length ? 'border-amber-300' : 'border-slate-100'} p-3" onclick="verCliente('${c.id}')">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-sm flex-shrink-0">
          ${esc(c.nombre.trim()[0].toUpperCase())}
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-sm truncate">${esc(c.nombre)}</div>
          <div class="text-xs text-slate-500">${c.telefono ? esc(c.telefono) : 'Sin teléfono'}${ultimaVenta ? ' · Última compra: ' + fmtDate(ultimaVenta.fecha) : ''}</div>
        </div>
        <div class="text-right">
          ${creditoCli.length ? `<div class="font-bold text-amber-600 text-sm">${fmtMoney(totalPendCli)}</div><div class="text-xs text-amber-500">Por cobrar</div>` : `<div class="text-xs text-slate-400">${ventasCli.length} compra${ventasCli.length===1?'':'s'}</div>`}
        </div>
      </div>
    </div>`;
  }).join('');
}

function seleccionarClienteVenta(clienteId) {
  state.ventaClienteId = clienteId || null;
  renderModalVenta();
}

function abrirEditorClienteRapido() {
  // Versión simplificada para abrir desde venta en curso
  const html = `
  <div class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onclick="cerrarModal(event)">
    <div class="bg-white rounded-2xl w-full max-w-sm p-5" onclick="event.stopPropagation()">
      <h3 class="font-semibold mb-3">Nuevo cliente</h3>
      <form onsubmit="guardarClienteRapido(event)" class="space-y-2">
        <input id="cliRNombre" required placeholder="Nombre *" class="w-full px-3 py-2 border rounded-lg" />
        <input id="cliRTel" type="tel" placeholder="Teléfono / WhatsApp" class="w-full px-3 py-2 border rounded-lg" />
        <input id="cliREmail" type="email" placeholder="Correo (opcional)" class="w-full px-3 py-2 border rounded-lg" />
        <div class="flex gap-2 pt-2">
          <button type="button" onclick="cerrarModal()" class="flex-1 bg-slate-100 py-2 rounded-lg text-sm">Cancelar</button>
          <button type="submit" class="flex-1 bg-black text-white py-2 rounded-lg text-sm">Crear y seleccionar</button>
        </div>
      </form>
    </div>
  </div>`;
  abrirModal(html);
}

async function guardarClienteRapido(e) {
  e.preventDefault();
  const nombre = $('#cliRNombre').value.trim();
  if (!nombre) return;
  const nuevo = { id: uid(), nombre, telefono: $('#cliRTel').value.trim(), email: $('#cliREmail').value.trim(), notas: '', activo: true, creado: Date.now() };
  await put('clientes', nuevo);
  await cargarTodo();
  state.ventaClienteId = nuevo.id;
  cerrarModal();
  // Pequeño delay para dejar que cerrarModal limpie, luego reabrir venta
  setTimeout(renderModalVenta, 100);
  toast('Cliente creado');
}

function abrirEditorCliente(id = null) {
  const c = id ? state.clientes.find(x => x.id === id) : null;
  const html = `
  <div class="fixed inset-0 z-40 bg-black/40 modal-backdrop flex items-end sm:items-center justify-center" onclick="cerrarModal(event)">
    <div class="modal-sheet bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-3xl max-h-[92vh] overflow-y-auto" onclick="event.stopPropagation()">
      <div class="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
        <h3 class="font-semibold">${c ? 'Editar cliente' : 'Nuevo cliente'}</h3>
        <button onclick="cerrarModal()" class="p-1.5 hover:bg-slate-100 rounded-lg">&times;</button>
      </div>
      <form id="formCliente" class="p-4 space-y-3" onsubmit="guardarCliente(event, '${id || ''}')">
        <div>
          <label class="text-xs text-slate-500">Nombre *</label>
          <input id="cliNombre" required class="w-full px-3 py-2 rounded-lg border border-slate-300" value="${c ? esc(c.nombre) : ''}" />
        </div>
        <div>
          <label class="text-xs text-slate-500">Teléfono / WhatsApp</label>
          <input id="cliTel" type="tel" class="w-full px-3 py-2 rounded-lg border border-slate-300" value="${c ? esc(c.telefono || '') : ''}" placeholder="+503 7000-0000" />
        </div>
        <div>
          <label class="text-xs text-slate-500">Correo electrónico</label>
          <input id="cliEmail" type="email" class="w-full px-3 py-2 rounded-lg border border-slate-300" value="${c ? esc(c.email || '') : ''}" />
        </div>
        <div>
          <label class="text-xs text-slate-500">Dirección</label>
          <input id="cliDir" class="w-full px-3 py-2 rounded-lg border border-slate-300" value="${c ? esc(c.direccion || '') : ''}" />
        </div>
        <div>
          <label class="text-xs text-slate-500">Notas</label>
          <textarea id="cliNotas" rows="2" class="w-full px-3 py-2 rounded-lg border border-slate-300">${c ? esc(c.notas || '') : ''}</textarea>
        </div>
        <div class="flex gap-2 pt-2">
          ${c ? `<button type="button" onclick="eliminarCliente('${id}')" class="px-3 py-2.5 rounded-lg border border-red-300 text-red-600 hover:bg-red-50">Eliminar</button>` : ''}
          <button type="submit" class="flex-1 bg-black hover:bg-slate-800 text-white font-semibold py-2.5 rounded-lg">${c ? 'Guardar cambios' : 'Crear cliente'}</button>
        </div>
      </form>
    </div>
  </div>`;
  abrirModal(html);
}

async function guardarCliente(e, id) {
  e.preventDefault();
  const existente = id ? state.clientes.find(x => x.id === id) : null;
  const obj = {
    id: id || uid(),
    nombre: $('#cliNombre').value.trim(),
    telefono: $('#cliTel').value.trim(),
    email: $('#cliEmail').value.trim(),
    direccion: $('#cliDir').value.trim(),
    notas: $('#cliNotas').value.trim(),
    activo: true,
    creado: existente ? existente.creado : Date.now(),
    actualizado: Date.now(),
  };
  if (!obj.nombre) { toast('Falta el nombre'); return; }
  await put('clientes', obj);
  await cargarTodo();
  cerrarModal();
  renderClientes();
  toast(id ? 'Cliente actualizado' : 'Cliente creado');
}

async function eliminarCliente(id) {
  if (!confirm('¿Eliminar este cliente? El historial de ventas se conserva.')) return;
  const c = state.clientes.find(x => x.id === id);
  if (c) { c.activo = false; await put('clientes', c); }
  await cargarTodo();
  cerrarModal();
  renderClientes();
  toast('Cliente eliminado');
}

function verCliente(id) {
  const c = state.clientes.find(x => x.id === id);
  if (!c) return;
  const ventasCli = state.ventas.filter(v => v.clienteId === id).sort((a, b) => b.fecha - a.fecha);
  const creditosCli = ventasCli.filter(v => v.estado === 'pendiente');
  const totalCredito = creditosCli.reduce((s, v) => s + v.total, 0);
  const totalCompras = ventasCli.reduce((s, v) => s + v.total, 0);

  const ventasHtml = ventasCli.slice(0, 20).map(v => `
    <div class="flex items-center justify-between py-2 border-b border-slate-100 last:border-0" onclick="verVenta('${v.id}')">
      <div>
        <div class="text-sm">${fmtDate(v.fecha)}</div>
        <div class="text-xs text-slate-500">${(v.items||[]).length} ítem(s) · ${v.metodoPago}</div>
      </div>
      <div class="text-right">
        <div class="font-semibold text-sm">${fmtMoney(v.total)}</div>
        ${v.estado === 'pendiente' ? '<div class="text-xs text-amber-600 font-semibold">CRÉDITO</div>' : '<div class="text-xs text-emerald-600">Pagado</div>'}
      </div>
    </div>`).join('') || '<div class="text-sm text-slate-500 py-3 text-center">Sin compras registradas.</div>';

  const html = `
  <div class="fixed inset-0 z-40 bg-black/40 modal-backdrop flex items-end sm:items-center justify-center" onclick="cerrarModal(event)">
    <div class="modal-sheet bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-3xl max-h-[92vh] overflow-y-auto" onclick="event.stopPropagation()">
      <div class="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
        <h3 class="font-semibold">Cliente</h3>
        <div class="flex gap-2">
          <button onclick="abrirEditorCliente('${id}')" class="text-xs bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg">Editar</button>
          <button onclick="cerrarModal()" class="p-1.5 hover:bg-slate-100 rounded-lg">&times;</button>
        </div>
      </div>
      <div class="p-4 space-y-4">
        <div class="flex items-center gap-3">
          <div class="w-14 h-14 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-xl">
            ${esc(c.nombre.trim()[0].toUpperCase())}
          </div>
          <div>
            <div class="font-bold text-lg">${esc(c.nombre)}</div>
            ${c.telefono ? `<div class="text-sm text-slate-600">📱 ${esc(c.telefono)}</div>` : ''}
            ${c.email ? `<div class="text-sm text-slate-600">✉ ${esc(c.email)}</div>` : ''}
            ${c.direccion ? `<div class="text-sm text-slate-600">📍 ${esc(c.direccion)}</div>` : ''}
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="bg-slate-50 rounded-xl p-3">
            <div class="text-xs text-slate-500">Total compras</div>
            <div class="font-bold text-slate-800">${fmtMoney(totalCompras)}</div>
            <div class="text-xs text-slate-400">${ventasCli.length} venta${ventasCli.length===1?'':'s'}</div>
          </div>
          <div class="bg-${creditosCli.length ? 'amber' : 'emerald'}-50 rounded-xl p-3">
            <div class="text-xs text-${creditosCli.length ? 'amber' : 'emerald'}-600">Por cobrar</div>
            <div class="font-bold text-${creditosCli.length ? 'amber' : 'emerald'}-700">${fmtMoney(totalCredito)}</div>
            <div class="text-xs text-${creditosCli.length ? 'amber' : 'emerald'}-500">${creditosCli.length} crédito${creditosCli.length===1?'':'s'}</div>
          </div>
        </div>

        ${c.notas ? `<div class="bg-slate-50 rounded-lg p-3 text-sm text-slate-700"><b>Notas:</b> ${esc(c.notas)}</div>` : ''}

        ${creditosCli.length ? `
        <div class="space-y-2">
          <div class="font-semibold text-sm text-amber-700">Créditos pendientes</div>
          ${creditosCli.map(v => `
            <div class="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center justify-between">
              <div>
                <div class="text-sm font-medium">${fmtDate(v.fecha)} · ${(v.items||[]).map(it=>{const p=state.productos.find(x=>x.id===it.productoId);return (p?p.nombre:'?')+' ×'+it.cantidad;}).join(', ')}</div>
                <div class="text-xs text-amber-700">${diasTranscurridos(v.fecha)} días pendiente</div>
              </div>
              <div class="text-right">
                <div class="font-bold text-amber-700">${fmtMoney(v.total)}</div>
                <button onclick="marcarVentaPagada('${v.id}')" class="text-xs bg-emerald-600 text-white px-2 py-1 rounded mt-1">✓ Cobrar</button>
              </div>
            </div>`).join('')}
          ${c.telefono ? `<button onclick="recordarClienteCreditos('${id}')" class="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-2 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 mt-1">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.945C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24z"/></svg>
            Enviar recordatorio por WhatsApp
          </button>` : ''}
        </div>` : ''}

        <div>
          <div class="font-semibold text-sm mb-2">Historial de compras</div>
          ${ventasHtml}
        </div>

        <button onclick="cerrarModal(); abrirNuevaVenta(); state.ventaClienteId='${id}'; setTimeout(renderModalVenta,100);" class="w-full bg-black hover:bg-slate-800 text-white py-3 rounded-xl font-semibold flex items-center justify-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
          Nueva venta a este cliente
        </button>
      </div>
    </div>
  </div>`;
  abrirModal(html);
}

async function recordarClienteCreditos(clienteId) {
  const c = state.clientes.find(x => x.id === clienteId);
  if (!c || !c.telefono) { toast('Cliente sin teléfono'); return; }
  const negocio = await obtenerDatosNegocio();
  const creditosCli = state.ventas.filter(v => v.clienteId === clienteId && v.estado === 'pendiente');
  if (creditosCli.length === 0) { toast('Sin créditos pendientes'); return; }

  const detalles = creditosCli.map(v => {
    const items = (v.items || []).map(it => {
      const p = state.productos.find(x => x.id === it.productoId);
      return `  • ${p ? p.nombre : '?'} ×${it.cantidad} = ${fmtMoney(it.subtotal)}`;
    }).join('\n');
    return `📅 ${fmtDate(v.fecha)}\n${items}\n   *Total: ${fmtMoney(v.total)}*`;
  }).join('\n\n');

  const totalDeuda = creditosCli.reduce((s, v) => s + v.total, 0);
  const texto = `Hola ${c.nombre} 👋\n\nTe recordamos tu${creditosCli.length > 1 ? 's' : ''} deuda${creditosCli.length > 1 ? 's' : ''} pendiente${creditosCli.length > 1 ? 's' : ''} con *${negocio.nombre || 'MICU Store'}*:\n\n${detalles}\n\n💰 *Total a pagar: ${fmtMoney(totalDeuda)}*\n\n¿Cuándo te queda bien que pasemos a cobrar? ¡Gracias!`;
  const tel = c.telefono.replace(/[^\d]/g, '');
  window.open(`https://wa.me/${tel}?text=${encodeURIComponent(texto)}`, '_blank');
  localStorage.setItem('miTienda.ultimoRecordatorio', Date.now().toString());
}

async function recordarTodosPorWhatsApp() {
  const negocio = await obtenerDatosNegocio();
  const pendientes = getVentasPendientes().filter(v => v.telefonoCliente || (v.clienteId && state.clientes.find(c => c.id === v.clienteId && c.telefono)));
  if (pendientes.length === 0) { toast('No hay clientes con teléfono para recordar'); return; }

  // Agrupar por cliente (clienteId o teléfono)
  const porCliente = {};
  pendientes.forEach(v => {
    const tel = v.telefonoCliente || (v.clienteId && state.clientes.find(c => c.id === v.clienteId)?.telefono) || '';
    if (!tel) return;
    const key = v.clienteId || tel;
    (porCliente[key] = porCliente[key] || { nombre: v.cliente, tel, ventas: [] }).ventas.push(v);
  });

  const grupos = Object.values(porCliente);
  if (grupos.length === 0) { toast('Sin teléfonos para enviar recordatorio'); return; }

  // Construir HTML para mostrar la lista de recordatorios a enviar
  const listaHtml = grupos.map((g, idx) => {
    const total = g.ventas.reduce((s, v) => s + v.total, 0);
    return `
    <div class="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
      <div>
        <div class="text-sm font-medium">${esc(g.nombre || 'Sin nombre')}</div>
        <div class="text-xs text-slate-500">${g.tel}</div>
      </div>
      <div class="text-right">
        <div class="font-semibold text-amber-700 text-sm">${fmtMoney(total)}</div>
        <button onclick="enviarRecordatorioGrupo(${idx})" class="text-xs bg-emerald-500 text-white px-2 py-1 rounded mt-0.5">Enviar WA</button>
      </div>
    </div>`;
  }).join('');

  // Guardar los grupos temporalmente para acceso desde los botones
  window._gruposRecordatorio = grupos;
  window._negocioRecordatorio = negocio;

  const html = `
  <div class="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onclick="cerrarModal(event)">
    <div class="modal-sheet bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-3xl max-h-[92vh] overflow-y-auto" onclick="event.stopPropagation()">
      <div class="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
        <h3 class="font-semibold">Recordatorios semanales</h3>
        <button onclick="cerrarModal()" class="p-1.5 hover:bg-slate-100 rounded-lg">&times;</button>
      </div>
      <div class="p-4 space-y-3">
        <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-800">
          Toca <b>Enviar WA</b> en cada cliente para abrir WhatsApp con el resumen de su deuda y los artículos pendientes.
        </div>
        ${listaHtml}
        <button onclick="registrarEnvioRecordatorios()" class="w-full bg-slate-100 hover:bg-slate-200 py-2.5 rounded-xl text-sm text-slate-700 font-medium">✓ Marcar recordatorios como enviados hoy</button>
      </div>
    </div>
  </div>`;
  abrirModal(html);
}

async function enviarRecordatorioGrupo(idx) {
  const g = window._gruposRecordatorio[idx];
  const negocio = window._negocioRecordatorio || await obtenerDatosNegocio();
  if (!g) return;
  const detalles = g.ventas.map(v => {
    const items = (v.items || []).map(it => {
      const p = state.productos.find(x => x.id === it.productoId);
      return `  • ${p ? p.nombre : '?'} ×${it.cantidad} = ${fmtMoney(it.subtotal)}`;
    }).join('\n');
    return `📅 ${fmtDate(v.fecha)}\n${items}\n   *Subtotal: ${fmtMoney(v.total)}*`;
  }).join('\n\n');
  const totalDeuda = g.ventas.reduce((s, v) => s + v.total, 0);
  const texto = `Hola ${g.nombre || ''} 👋\n\nTe recordamos tu${g.ventas.length > 1 ? 's' : ''} deuda${g.ventas.length > 1 ? 's' : ''} pendiente${g.ventas.length > 1 ? 's' : ''} con *${negocio.nombre || 'MICU Store'}*:\n\n${detalles}\n\n💰 *Total a pagar: ${fmtMoney(totalDeuda)}*\n\nCuando puedas, avísanos. ¡Gracias!`;
  const tel = g.tel.replace(/[^\d]/g, '');
  window.open(`https://wa.me/${tel}?text=${encodeURIComponent(texto)}`, '_blank');
}

function registrarEnvioRecordatorios() {
  localStorage.setItem('miTienda.ultimoRecordatorio', Date.now().toString());
  cerrarModal();
  toast('Recordatorios marcados como enviados');
}

function verificarRecordatorioSemanal() {
  const pendientes = getVentasPendientes();
  if (pendientes.length === 0) return;
  const conTelefono = pendientes.filter(v => v.telefonoCliente || (v.clienteId && state.clientes.find(c => c.id === v.clienteId && c.telefono)));
  if (conTelefono.length === 0) return;
  const ultimo = parseInt(localStorage.getItem('miTienda.ultimoRecordatorio') || '0');
  const diasDesde = Math.floor((Date.now() - ultimo) / (24 * 60 * 60 * 1000));
  if (diasDesde >= 7 || ultimo === 0) {
    // Mostrar banner de recordatorio semanal en el dashboard
    mostrarBannerRecordatorio(conTelefono.length, diasDesde);
  }
}

function mostrarBannerRecordatorio(count, diasDesde) {
  const view = document.querySelector('[data-view="dashboard"]');
  if (!view) return;
  let banner = document.getElementById('bannerRecordatorio');
  if (banner) return; // ya existe
  banner = document.createElement('div');
  banner.id = 'bannerRecordatorio';
  banner.className = 'rounded-2xl border-2 border-blue-300 bg-blue-50 p-3 cursor-pointer';
  banner.onclick = () => { abrirCreditos(); banner.remove(); };
  banner.innerHTML = `
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="text-2xl">🔔</div>
        <div>
          <div class="font-bold text-sm text-blue-800">Recordatorio semanal pendiente</div>
          <div class="text-xs text-blue-600">${count} cliente${count===1?'':'s'} con crédito · ${diasDesde >= 7 ? diasDesde + ' días sin recordar' : 'Primera vez'}. Toca para enviar.</div>
        </div>
      </div>
      <button onclick="event.stopPropagation(); this.closest('#bannerRecordatorio').remove();" class="text-blue-400 p-1">✕</button>
    </div>`;
  // Insertar después del bannerCreditos si existe
  const bancred = document.getElementById('bannerCreditos');
  if (bancred) bancred.insertAdjacentElement('afterend', banner);
  else view.insertBefore(banner, view.firstChild);
}

// --------------------- EDICIÓN DE VENTAS (ADMIN) ----------

function editarVenta(id) {
  if (!state.user || state.user.rol !== 'admin') { toast('Solo el administrador puede editar ventas'); return; }
  const v = state.ventas.find(x => x.id === id);
  if (!v) return;

  const itemsHtml = (v.items || []).map((it, idx) => {
    const p = state.productos.find(x => x.id === it.productoId);
    return `
    <div class="bg-slate-50 rounded-lg p-3 mb-2">
      <div class="text-sm font-medium text-slate-700 mb-2">${p ? esc(p.nombre) : '(producto eliminado)'}</div>
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="text-xs text-slate-500">Cantidad</label>
          <input type="number" min="0" id="editCant_${idx}" value="${it.cantidad}" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
        </div>
        <div>
          <label class="text-xs text-slate-500">Precio unitario</label>
          <input type="number" step="0.01" min="0" id="editPrecio_${idx}" value="${it.precioFinal || it.precioUnitario}" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
        </div>
      </div>
    </div>`;
  }).join('');

  const fecVenc = v.fechaVencimiento ? new Date(v.fechaVencimiento).toISOString().slice(0, 10) : '';

  const html = `
  <div class="fixed inset-0 z-40 bg-black/40 modal-backdrop flex items-end sm:items-center justify-center" onclick="cerrarModal(event)">
    <div class="modal-sheet bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-3xl max-h-[92vh] overflow-y-auto" onclick="event.stopPropagation()">
      <div class="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
        <h3 class="font-semibold">Editar venta</h3>
        <button onclick="cerrarModal()" class="p-1.5 hover:bg-slate-100 rounded-lg">&times;</button>
      </div>
      <div class="p-4 space-y-4">

        <details open>
          <summary class="font-semibold text-sm py-1 cursor-pointer">Datos del cliente</summary>
          <div class="mt-3 space-y-2">
            <div>
              <label class="text-xs text-slate-500">Nombre del cliente</label>
              <input id="editCliNombre" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" value="${esc(v.cliente || '')}" placeholder="Nombre del cliente" />
            </div>
            <div>
              <label class="text-xs text-slate-500">Teléfono / WhatsApp</label>
              <input id="editCliTel" type="tel" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" value="${esc(v.telefonoCliente || '')}" placeholder="+503 7000-0000" />
            </div>
            <div>
              <label class="text-xs text-slate-500">Correo electrónico</label>
              <input id="editCliEmail" type="email" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" value="${esc(v.emailCliente || '')}" placeholder="correo@ejemplo.com" />
            </div>
            ${v.estado === 'pendiente' ? `
            <div>
              <label class="text-xs text-slate-500">Fecha límite de pago</label>
              <input id="editFecVenc" type="date" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" value="${fecVenc}" />
            </div>` : ''}
          </div>
        </details>

        <details>
          <summary class="font-semibold text-sm py-1 cursor-pointer">Artículos y precios</summary>
          <div class="mt-3">
            <div class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3">
              Al cambiar cantidades el stock se ajusta automáticamente. Para quitar un artículo pon cantidad 0.
            </div>
            ${itemsHtml}
          </div>
        </details>

        <button onclick="guardarEdicionVenta('${id}')" class="w-full bg-black hover:bg-slate-800 text-white font-semibold py-3 rounded-xl">Guardar cambios</button>
      </div>
    </div>
  </div>`;
  abrirModal(html);
}

async function guardarEdicionVenta(id) {
  const esAdmin = state.user && state.user.rol === 'admin';
  if (!esAdmin) { toast('Sin permiso'); return; }

  const v = state.ventas.find(x => x.id === id);
  if (!v) return;

  // --- Datos del cliente ---
  v.cliente = document.getElementById('editCliNombre')?.value.trim() || v.cliente;
  v.telefonoCliente = document.getElementById('editCliTel')?.value.trim() || '';
  v.emailCliente = document.getElementById('editCliEmail')?.value.trim() || '';
  const fecVencInput = document.getElementById('editFecVenc');
  if (fecVencInput && fecVencInput.value) {
    v.fechaVencimiento = new Date(fecVencInput.value).getTime() + 12 * 60 * 60 * 1000; // mediodía
  }

  // --- Artículos ---
  const nuevosItems = [];
  for (let idx = 0; idx < v.items.length; idx++) {
    const it = v.items[idx];
    const cantInput = document.getElementById(`editCant_${idx}`);
    const precioInput = document.getElementById(`editPrecio_${idx}`);
    if (!cantInput) continue;

    const nuevaCant = parseInt(cantInput.value) || 0;
    const nuevoPrecio = parseFloat(precioInput?.value) || it.precioFinal || it.precioUnitario;
    const cantAnterior = it.cantidad;
    const deltaCant = nuevaCant - cantAnterior;

    // Ajustar stock del producto
    if (deltaCant !== 0) {
      const p = state.productos.find(x => x.id === it.productoId);
      if (p) {
        p.stock = Math.max(0, (p.stock || 0) - deltaCant); // si aumentó la venta, baja el stock
        await put('productos', p);
        await put('movimientos', {
          id: uid(), fecha: Date.now(), productoId: p.id, tipo: 'ajuste-venta',
          cantidad: -deltaCant, usuarioId: state.user.id, notas: 'Edición de venta ' + id
        });
      }
    }

    if (nuevaCant > 0) {
      const subtotalNuevo = Number((nuevaCant * nuevoPrecio).toFixed(2));
      const gananciaNueva = Number((nuevaCant * (nuevoPrecio - (it.costoUnitario || 0))).toFixed(2));
      nuevosItems.push({
        ...it,
        cantidad: nuevaCant,
        precioFinal: Number(nuevoPrecio.toFixed(2)),
        subtotal: subtotalNuevo,
        ganancia: gananciaNueva,
      });
    }
  }

  if (nuevosItems.length === 0) { toast('La venta debe tener al menos un artículo'); return; }

  v.items = nuevosItems;
  v.total = Number(nuevosItems.reduce((s, it) => s + it.subtotal, 0).toFixed(2));
  v.gananciaTotal = Number(nuevosItems.reduce((s, it) => s + it.ganancia, 0).toFixed(2));

  await put('ventas', v);
  await cargarTodo();
  cerrarModal();
  toast('Venta actualizada');

  // Si venía de créditos, volver a abrirlos
  setTimeout(abrirCreditos, 150);
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
  const esAdmin = state.user && state.user.rol === 'admin';
  const desde = new Date($('#repDesde').value).getTime();
  const hasta = new Date($('#repHasta').value).getTime() + 24 * 60 * 60 * 1000;
  const ventas = state.ventas.filter(v => v.fecha >= desde && v.fecha < hasta);
  const compras = (state.compras || []).filter(c => c.fecha >= desde && c.fecha < hasta);

  const totalVentas = ventas.reduce((s, v) => s + v.total, 0);
  // Ganancia: solo de ventas cobradas dentro del rango usando fechaPago como referencia
  const ventasCobradas = state.ventas.filter(v => v.estado !== 'pendiente' && (v.fechaPago || v.fecha) >= desde && (v.fechaPago || v.fecha) < hasta);
  const totalGanancia = ventasCobradas.reduce((s, v) => s + (v.gananciaTotal || 0), 0);
  const totalCompras = compras.reduce((s, c) => s + c.total, 0);

  $('#repTotalVentas').textContent = fmtMoney(totalVentas);
  $('#repGanancia').textContent = esAdmin ? fmtMoney(totalGanancia) : '—';
  $('#repCompras').textContent = esAdmin ? fmtMoney(totalCompras) : '—';
  $('#repNumVentas').textContent = ventas.length;
  // Ocultar tarjetas de ganancia y compras para vendedor
  const cardsRep = document.querySelectorAll('[data-view="reportes"] .grid.grid-cols-2 > div');
  if (cardsRep.length >= 4) {
    cardsRep[1].style.display = esAdmin ? '' : 'none'; // Ganancia
    cardsRep[2].style.display = esAdmin ? '' : 'none'; // Compras
  }

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
          <div class="font-semibold text-amber-500 text-sm">${fmtMoney(x.monto)}</div>
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
      <div class="min-w-0 flex-1">
        <div class="font-medium text-sm truncate">${esc(u.nombre)}</div>
        <div class="text-xs text-slate-500 truncate">${esc(u.email || '')} · ${u.rol}${u.activo ? '' : ' · inactivo'}</div>
      </div>
      <div class="flex gap-1 flex-shrink-0">
        <button onclick="editarUsuario('${u.id}')" class="text-amber-500 text-sm px-2">Editar</button>
        ${u.id !== state.user.id ? `<button onclick="eliminarUsuario('${u.id}')" class="text-red-500 text-sm px-2">×</button>` : ''}
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
            <button onclick="event.preventDefault(); editarUsuario(null)" class="bg-black text-white text-xs px-3 py-1 rounded-lg">+ Nuevo</button>
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
              <button onclick="agregarCategoria()" class="bg-black text-white px-3 rounded-lg text-sm">Agregar</button>
            </div>
            ${catsHtml}
          </div>
        </details>

        <details>
          <summary class="font-semibold text-sm py-2">Cambiar mi contraseña</summary>
          <div class="mt-2 space-y-2">
            <input type="password" id="passActual" placeholder="Actual" class="w-full px-3 py-2 border rounded-lg text-sm" />
            <input type="password" id="passNueva" placeholder="Nueva (mín 6)" class="w-full px-3 py-2 border rounded-lg text-sm" />
            <button onclick="cambiarMiPass()" class="w-full bg-black text-white py-2 rounded-lg text-sm">Cambiar</button>
          </div>
        </details>

      </div>
    </div>
  </div>`;
  abrirModal(html);
}

async function editarUsuario(id) {
  if (state.user.rol !== 'admin') { toast('Solo el administrador puede gestionar usuarios'); return; }
  const u = id ? await getOne('usuarios', id) : null;
  const esNuevo = !u;
  const catsPermitidas = (u && Array.isArray(u.categoriasPermitidas)) ? u.categoriasPermitidas : [];
  const catsHtml = state.categorias.map(c =>
    `<label class="flex items-center gap-2 text-xs py-1">
      <input type="checkbox" class="catPermitida" value="${c.id}" ${catsPermitidas.includes(c.id) ? 'checked' : ''} />
      <span>${esc(c.nombre)}</span>
    </label>`
  ).join('');
  const html = `
  <div class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onclick="cerrarModal(event)">
    <div class="bg-white rounded-2xl w-full max-w-sm p-5 max-h-[92vh] overflow-y-auto" onclick="event.stopPropagation()">
      <h3 class="font-semibold mb-3">${u ? 'Editar usuario' : 'Nuevo usuario'}</h3>
      ${esNuevo ? '<p class="text-xs text-slate-500 mb-2">El nuevo usuario podrá ingresar con su correo y contraseña desde cualquier dispositivo.</p>' : ''}
      <form onsubmit="guardarUsuario(event, '${id || ''}')" class="space-y-2">
        <input id="uNombre" required placeholder="Nombre completo" value="${u ? esc(u.nombre) : ''}" class="w-full px-3 py-2 border rounded-lg" />
        <input type="email" id="uEmail" required placeholder="correo@ejemplo.com" value="${u ? esc(u.email || '') : ''}" ${esNuevo ? '' : 'readonly'} class="w-full px-3 py-2 border rounded-lg ${esNuevo ? '' : 'bg-slate-50'}" />
        <select id="uRol" onchange="document.getElementById('catsPermBox').style.display = this.value==='vendedor'?'':'none'" class="w-full px-3 py-2 border rounded-lg">
          <option value="admin" ${u && u.rol === 'admin' ? 'selected' : ''}>Admin</option>
          <option value="vendedor" ${u && u.rol === 'vendedor' ? 'selected' : ''}>Vendedor</option>
        </select>
        ${esNuevo ? '<input type="password" id="uPass" required placeholder="Contraseña inicial (mín 6)" class="w-full px-3 py-2 border rounded-lg" />' : '<p class="text-xs text-slate-500 italic">Para cambiar contraseña, el usuario debe hacerlo desde su sesión.</p>'}
        <div id="catsPermBox" class="border rounded-lg p-2 bg-slate-50" style="display:${(u && u.rol==='vendedor') || (esNuevo) ? '' : 'none'}">
          <div class="text-xs font-semibold mb-1">Categorías que puede vender</div>
          <div class="text-xs text-slate-500 mb-2 italic">Si no marcas ninguna, ve TODAS las categorías. Marca solo las que este vendedor debe poder ver y vender.</div>
          <div class="grid grid-cols-2 gap-1 max-h-48 overflow-y-auto">
            ${catsHtml || '<div class="text-xs text-slate-500 col-span-2">Sin categorías</div>'}
          </div>
        </div>
        <label class="flex items-center gap-2 text-sm py-1">
          <input type="checkbox" id="uActivo" ${!u || u.activo ? 'checked' : ''} /> Activo
        </label>
        <div class="flex gap-2 pt-2">
          <button type="button" onclick="abrirConfig()" class="flex-1 bg-slate-100 py-2 rounded-lg">Cancelar</button>
          <button type="submit" class="flex-1 bg-black text-white py-2 rounded-lg">Guardar</button>
        </div>
      </form>
    </div>
  </div>`;
  abrirModal(html);
}

async function guardarUsuario(e, id) {
  e.preventDefault();
  if (state.user.rol !== 'admin') { toast('Permiso denegado'); return; }

  const nombre = $('#uNombre').value.trim();
  const email = $('#uEmail').value.trim().toLowerCase();
  const rol = $('#uRol').value;
  const activo = $('#uActivo').checked;
  const categoriasPermitidas = Array.from(document.querySelectorAll('.catPermitida:checked')).map(c => c.value);

  try {
    if (id) {
      const u = await getOne('usuarios', id);
      if (!u) { toast('Usuario no encontrado'); return; }
      u.nombre = nombre; u.rol = rol; u.activo = activo;
      u.categoriasPermitidas = (rol === 'vendedor') ? categoriasPermitidas : [];
      await put('usuarios', u);
      toast('Usuario actualizado');
    } else {
      const pass = $('#uPass').value;
      if (pass.length < 6) { toast('Contraseña mínima 6 caracteres'); return; }
      const newUid = await window.FB.createUserAndProfile({ email, password: pass, nombre, rol });
      // Si es vendedor con categorías, actualizar el doc con categoriasPermitidas
      if (rol === 'vendedor' && categoriasPermitidas.length > 0 && newUid) {
        const nuevoDoc = await getOne('usuarios', newUid);
        if (nuevoDoc) {
          nuevoDoc.categoriasPermitidas = categoriasPermitidas;
          await put('usuarios', nuevoDoc);
        }
      }
      toast('Vendedor creado correctamente. Comunícale su correo y contraseña.');
    }
  } catch (err) {
    toast('Error: ' + err.message);
    return;
  }
  abrirConfig();
}

async function eliminarUsuario(id) {
  if (state.user.rol !== 'admin') { toast('Permiso denegado'); return; }
  if (!confirm('¿Eliminar este usuario? (Nota: solo se desactiva su perfil; el acceso a Firebase Auth debe revocarse desde la consola.)')) return;
  const u = await getOne('usuarios', id);
  if (u) { u.activo = false; await put('usuarios', u); }
  toast('Usuario desactivado');
  abrirConfig();
}

async function cambiarMiPass() {
  const actual = $('#passActual').value;
  const nueva = $('#passNueva').value;
  if (nueva.length < 6) { toast('Mínimo 6 caracteres'); return; }
  try {
    await window.FB.changeMyPassword(actual, nueva);
    toast('Contraseña cambiada');
    $('#passActual').value = ''; $('#passNueva').value = '';
  } catch (err) {
    toast(err.message);
  }
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

        <button onclick="exportarRespaldo()" class="w-full bg-black hover:bg-slate-800 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
          Exportar respaldo (.json)
        </button>

        <label class="w-full bg-white border-2 border-black text-amber-500 font-semibold py-3 rounded-xl flex items-center justify-center gap-2 cursor-pointer">
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
  data._meta = { app: 'MICU Store', version: APP.dbVersion, fecha: Date.now(), usuario: state.user.email || state.user.nombre };
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
  if (state.user.rol !== 'admin') { toast('Solo admin puede importar'); return; }
  if (!confirm('Importar agregará/reemplazará datos en Firebase. Los usuarios viejos NO se importan (se gestionan en Firebase Auth). ¿Continuar?')) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      // Colecciones que SÍ importamos. 'usuarios' se excluye (Firebase Auth los maneja).
      const STORES_IMPORT = ['categorias', 'productos', 'compras', 'ventas', 'movimientos', 'config'];
      const adminUid = state.user.uid;
      let totalSubidos = 0;
      let totalErr = 0;
      toast('Importando, no cierres la ventana...');

      for (const s of STORES_IMPORT) {
        const nuevos = data[s] || [];
        for (const item of nuevos) {
          try {
            // Reasignar usuarioId al admin actual para ventas/movimientos (cumple reglas)
            if ((s === 'ventas' || s === 'movimientos') && item.usuarioId) {
              item.usuarioId = adminUid;
            }
            await put(s, item);
            totalSubidos++;
          } catch (err) {
            console.error('No se pudo importar', s, item.id || item.clave, err);
            totalErr++;
          }
        }
      }
      await cargarTodo();
      cerrarModal();
      toast(`Importación lista: ${totalSubidos} registros subidos${totalErr ? ', ' + totalErr + ' fallaron' : ''}`);
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

// --------------------- CATÁLOGO PARA CLIENTES -------------
async function obtenerDatosNegocio() {
  const cfg = await getOne('config', 'negocio');
  return cfg ? cfg.valor : {
    nombre: 'MICU_Store',
    telefono: '',
    direccion: '',
    mensaje: 'Gracias por preferirnos. Realiza tu pedido por WhatsApp.',
    instagram: '',
    facebook: '',
  };
}

async function guardarDatosNegocio(datos) {
  await put('config', { clave: 'negocio', valor: datos });
}

async function abrirCatalogoCliente() {
  const negocio = await obtenerDatosNegocio();
  const esAdmin = state.user && state.user.rol === 'admin';
  const catsHtml = state.categorias.map(c => `
    <label class="flex items-center gap-2 py-1 text-sm">
      <input type="checkbox" class="cat-filter-pdf" value="${c.id}" checked />
      <span>${esc(c.nombre)}</span>
    </label>
  `).join('');

  const html = `
  <div class="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center" onclick="cerrarModal(event)">
    <div class="modal-sheet bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-3xl max-h-[92vh] overflow-y-auto" onclick="event.stopPropagation()">
      <div class="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
        <h3 class="font-semibold">Catálogo para clientes</h3>
        <button onclick="cerrarModal()" class="p-1.5 hover:bg-slate-100 rounded-lg">&times;</button>
      </div>
      <div class="p-4 space-y-4">

        <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
          Se genera un PDF con tus productos para enviar por WhatsApp o correo. Los datos del negocio se guardan para próximas veces.
        </div>

        <details ${esAdmin ? 'open' : ''}>
          <summary class="font-semibold text-sm py-2">Datos del negocio ${esAdmin ? '' : '(solo admin puede editar)'}</summary>
          <div class="space-y-2 mt-2">
            <div>
              <label class="text-xs text-slate-500">Nombre comercial *</label>
              <input id="negNombre" required value="${esc(negocio.nombre)}" ${esAdmin ? '' : 'readonly'} class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm ${esAdmin ? '' : 'bg-slate-50'}" />
            </div>
            <div>
              <label class="text-xs text-slate-500">Teléfono / WhatsApp</label>
              <input id="negTel" value="${esc(negocio.telefono)}" ${esAdmin ? '' : 'readonly'} placeholder="+503 7000-0000" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm ${esAdmin ? '' : 'bg-slate-50'}" />
            </div>
            <div>
              <label class="text-xs text-slate-500">Dirección (opcional)</label>
              <input id="negDir" value="${esc(negocio.direccion)}" ${esAdmin ? '' : 'readonly'} class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm ${esAdmin ? '' : 'bg-slate-50'}" />
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="text-xs text-slate-500">Instagram</label>
                <input id="negIG" value="${esc(negocio.instagram || '')}" ${esAdmin ? '' : 'readonly'} placeholder="@micu_store" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm ${esAdmin ? '' : 'bg-slate-50'}" />
              </div>
              <div>
                <label class="text-xs text-slate-500">Facebook</label>
                <input id="negFB" value="${esc(negocio.facebook || '')}" ${esAdmin ? '' : 'readonly'} placeholder="MICU Store" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm ${esAdmin ? '' : 'bg-slate-50'}" />
              </div>
            </div>
            <div>
              <label class="text-xs text-slate-500">Mensaje de bienvenida</label>
              <textarea id="negMsg" rows="2" ${esAdmin ? '' : 'readonly'} class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm ${esAdmin ? '' : 'bg-slate-50'}">${esc(negocio.mensaje)}</textarea>
            </div>
          </div>
        </details>

        <details>
          <summary class="font-semibold text-sm py-2">Categorías a incluir</summary>
          <div class="mt-2">${catsHtml || '<div class="text-xs text-slate-500">Sin categorías</div>'}</div>
        </details>

        <details>
          <summary class="font-semibold text-sm py-2">Opciones</summary>
          <div class="mt-2 space-y-1.5 text-sm">
            <label class="flex items-center gap-2"><input type="checkbox" id="optPrecio" checked /> Mostrar precios</label>
            <label class="flex items-center gap-2"><input type="checkbox" id="optDesc" checked /> Mostrar descripción</label>
            <label class="flex items-center gap-2"><input type="checkbox" id="optSku" checked /> Mostrar código (SKU)</label>
            <label class="flex items-center gap-2"><input type="checkbox" id="optAgotado" checked /> Marcar productos agotados</label>
            <label class="flex items-center gap-2"><input type="checkbox" id="optSoloStock" /> Excluir productos sin stock</label>
          </div>
        </details>

        <button onclick="generarCatalogoPDF()" id="btnGenPDF" class="w-full bg-black hover:bg-slate-800 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Generar PDF
        </button>
      </div>
    </div>
  </div>`;
  abrirModal(html);
}

async function generarCatalogoPDF() {
  const btn = $('#btnGenPDF');
  btn.disabled = true;
  btn.innerHTML = 'Generando PDF...';

  try {
    const negocio = {
      nombre: $('#negNombre').value.trim() || 'MICU Store',
      telefono: $('#negTel').value.trim(),
      direccion: $('#negDir').value.trim(),
      instagram: $('#negIG').value.trim(),
      facebook: $('#negFB').value.trim(),
      mensaje: $('#negMsg').value.trim(),
    };
    if (state.user && state.user.rol === 'admin') {
      try { await guardarDatosNegocio(negocio); } catch (_) {}
    }
    const catsSel = Array.from(document.querySelectorAll('.cat-filter-pdf:checked')).map(c => c.value);
    const opts = {
      precio: $('#optPrecio').checked,
      desc: $('#optDesc').checked,
      sku: $('#optSku').checked,
      agotado: $('#optAgotado').checked,
      soloStock: $('#optSoloStock').checked,
    };
    let productos = state.productos.filter(p => p.activo !== false);
    if (catsSel.length > 0) productos = productos.filter(p => catsSel.includes(p.categoriaId));
    if (opts.soloStock) productos = productos.filter(p => (p.stock || 0) > 0);
    if (productos.length === 0) {
      toast('No hay productos para incluir');
      btn.disabled = false; btn.innerHTML = 'Generar PDF';
      return;
    }
    const porCat = {};
    productos.forEach(p => {
      const cid = p.categoriaId || 'sincat';
      (porCat[cid] = porCat[cid] || []).push(p);
    });
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const W = 210, H = 297;
    const COLOR_PRIMARY = [10, 10, 10];
    const COLOR_ACCENT = [251, 191, 36];
    const COLOR_DARK = [10, 10, 10];
    const COLOR_GRAY = [115, 115, 115];
    const COLOR_LIGHT = [245, 245, 245];
    const COLOR_RED = [220, 38, 38];
    doc.setFillColor(...COLOR_PRIMARY);
    doc.rect(0, 0, W, H, 'F');
    doc.setFillColor(255, 255, 255);
    doc.circle(W / 2, 90, 22, 'F');
    doc.setTextColor(...COLOR_PRIMARY);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(28);
    const iniciales = (negocio.nombre || 'MICU').split(/[\s_-]+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    doc.text(iniciales, W / 2, 98, { align: 'center' });
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(36); doc.setFont('helvetica', 'bold');
    doc.text(negocio.nombre || 'MICU Store', W / 2, 140, { align: 'center' });
    doc.setTextColor(...COLOR_ACCENT);
    doc.setFontSize(14); doc.setFont('helvetica', 'normal');
    doc.text('CATÁLOGO DE PRODUCTOS', W / 2, 152, { align: 'center' });
    doc.setDrawColor(...COLOR_ACCENT); doc.setLineWidth(0.8);
    doc.line(W / 2 - 25, 158, W / 2 + 25, 158);
    doc.setTextColor(255, 255, 255);
    if (negocio.mensaje) {
      doc.setFontSize(11);
      const lineas = doc.splitTextToSize(negocio.mensaje, 130);
      doc.text(lineas, W / 2, 175, { align: 'center' });
    }
    let y = 230;
    doc.setFontSize(10);
    if (negocio.telefono) { doc.text('Tel/WhatsApp: ' + negocio.telefono, W / 2, y, { align: 'center' }); y += 6; }
    if (negocio.direccion) { doc.text(negocio.direccion, W / 2, y, { align: 'center' }); y += 6; }
    if (negocio.instagram) { doc.text('Instagram: ' + negocio.instagram, W / 2, y, { align: 'center' }); y += 6; }
    if (negocio.facebook) { doc.text('Facebook: ' + negocio.facebook, W / 2, y, { align: 'center' }); y += 6; }

    const CARD_H = 125, CARD_W = 170;
    const CARD_X = (W - CARD_W) / 2;
    const TOP_MARGIN = 20;
    let primero = true, idxEnPag = 0, pagina = 1;
    for (const catId of Object.keys(porCat)) {
      const cat = state.categorias.find(c => c.id === catId);
      const catNombre = cat ? cat.nombre : 'Sin categoría';
      for (const p of porCat[catId]) {
        if (primero || idxEnPag >= 2) {
          doc.addPage(); pagina++; idxEnPag = 0;
          doc.setFillColor(...COLOR_PRIMARY);
          doc.rect(0, 0, W, 12, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
          doc.text(negocio.nombre || 'MICU Store', 10, 8);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
          doc.text('Catálogo', 200, 8, { align: 'right' });
          doc.setTextColor(...COLOR_GRAY);
          doc.text('Página ' + pagina, 200, 290, { align: 'right' });
          primero = false;
        }
        const cardY = TOP_MARGIN + idxEnPag * (CARD_H + 8);
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.3);
        doc.roundedRect(CARD_X, cardY, CARD_W, CARD_H, 4, 4, 'FD');
        doc.setFillColor(...COLOR_LIGHT);
        doc.roundedRect(CARD_X + 6, cardY + 6, 50, 6, 2, 2, 'F');
        doc.setTextColor(...COLOR_PRIMARY);
        doc.setFontSize(7); doc.setFont('helvetica', 'bold');
        doc.text(catNombre.toUpperCase().slice(0, 22), CARD_X + 31, cardY + 10, { align: 'center' });
        const IMG_SIZE = 80;
        const imgX = CARD_X + 8, imgY = cardY + 18;
        if (p.foto) {
          try { doc.addImage(p.foto, 'JPEG', imgX, imgY, IMG_SIZE, IMG_SIZE, undefined, 'FAST'); }
          catch (e) {
            doc.setFillColor(...COLOR_LIGHT);
            doc.roundedRect(imgX, imgY, IMG_SIZE, IMG_SIZE, 2, 2, 'F');
          }
        } else {
          doc.setFillColor(...COLOR_LIGHT);
          doc.roundedRect(imgX, imgY, IMG_SIZE, IMG_SIZE, 2, 2, 'F');
        }
        const textX = imgX + IMG_SIZE + 8;
        const textW = CARD_W - IMG_SIZE - 24;
        let textY = cardY + 26;
        doc.setTextColor(...COLOR_DARK);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
        const nombreLines = doc.splitTextToSize(p.nombre, textW);
        doc.text(nombreLines.slice(0, 2), textX, textY);
        textY += nombreLines.slice(0, 2).length * 6 + 1;
        if (opts.sku && p.sku) {
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
          doc.setTextColor(...COLOR_GRAY);
          doc.text('Código: ' + p.sku, textX, textY);
          textY += 5;
        }
        if (opts.desc && p.descripcion) {
          doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
          doc.setTextColor(...COLOR_GRAY);
          const descLines = doc.splitTextToSize(p.descripcion, textW);
          doc.text(descLines.slice(0, 4), textX, textY);
          textY += descLines.slice(0, 4).length * 4 + 2;
        }
        if (opts.precio) {
          doc.setFillColor(...COLOR_PRIMARY);
          doc.roundedRect(CARD_X + CARD_W - 60, cardY + CARD_H - 22, 52, 16, 3, 3, 'F');
          doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
          doc.setTextColor(...COLOR_ACCENT);
          doc.text(fmtMoney(p.precioVenta), CARD_X + CARD_W - 34, cardY + CARD_H - 10, { align: 'center' });
        }
        if (opts.agotado && (p.stock || 0) === 0) {
          doc.setFillColor(...COLOR_RED);
          doc.roundedRect(CARD_X + CARD_W - 38, cardY + 6, 32, 8, 2, 2, 'F');
          doc.setTextColor(255, 255, 255); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
          doc.text('AGOTADO', CARD_X + CARD_W - 22, cardY + 11.5, { align: 'center' });
        }
        idxEnPag++;
      }
    }
    const fechaArch = new Date().toISOString().slice(0, 10);
    const nombreArch = 'catalogo_' + (negocio.nombre || 'micu').replace(/[^a-z0-9]/gi, '_') + '_' + fechaArch + '.pdf';
    doc.save(nombreArch);
    cerrarModal();
    toast('Catálogo PDF generado');
  } catch (err) {
    console.error(err);
    alert('Error generando el PDF: ' + err.message);
    btn.disabled = false;
    btn.innerHTML = 'Generar PDF';
  }
}

function abrirModal(html) { document.getElementById('modalContainer').innerHTML = html; }
function cerrarModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('modalContainer').innerHTML = '';
}
function descargarBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, function(c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

function initEventos() {
  document.getElementById('loginForm').addEventListener('submit', login);
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { showView(btn.dataset.tab); });
  });
  document.getElementById('btnMenu').addEventListener('click', toggleMenu);
  document.addEventListener('click', function(e) {
    if (!e.target.closest('#btnMenu') && !e.target.closest('#menuDrop')) cerrarMenu();
  });
  document.getElementById('busquedaCatalogo').addEventListener('input', renderCatalogo);
  document.getElementById('busquedaInventario').addEventListener('input', renderInventario);
  document.getElementById('filtroEstadoInv').addEventListener('change', renderInventario);
  document.getElementById('busquedaClientes').addEventListener('input', renderClientes);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('sw.js').catch(function(){});
  });
}

window.addEventListener('DOMContentLoaded', init);
