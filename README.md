# Mi Tienda — App móvil de Ventas e Inventario

Aplicación web progresiva (PWA) instalable en el celular, lista para vender, controlar inventario, registrar compras y revisar ganancias. Funciona **sin internet** una vez instalada, y respalda datos a **Google Drive** mediante archivo JSON.

## Contenido del paquete

| Archivo | Descripción |
|---|---|
| `index.html` | Interfaz principal de la app |
| `app.js` | Lógica de negocio (productos, ventas, compras, reportes) |
| `manifest.webmanifest` | Configuración PWA (nombre, íconos, modo standalone) |
| `sw.js` | Service Worker para funcionamiento offline |
| `icon-192.svg`, `icon-512.svg` | Íconos de la app |
| `GUIA-INSTALACION.md` | Guía paso a paso para publicar e instalar en tu celular |

## Características principales

**Catálogo de productos.** Foto tomada desde la cámara, nombre, SKU, descripción, categoría, precio de compra, precio de venta, stock actual y stock mínimo. Las fotos se comprimen automáticamente para ahorrar espacio.

**Inventario.** Vista consolidada con búsqueda, filtros (todos, stock bajo, agotados, en stock), ajustes manuales con bitácora de movimientos, y resumen total de unidades y valor invertido.

**Compras.** Registro de entrada de mercadería con proveedor, múltiples ítems, costo unitario y total. Al guardar, **actualiza automáticamente el stock y recalcula el costo promedio ponderado** del producto.

**Ventas.** Pantalla tipo punto de venta (POS) optimizada para celular: grid de productos con foto, búsqueda rápida, carrito con +/− por ítem, selección de método de pago (efectivo, tarjeta, transferencia, crédito), ticket generado automáticamente y opción para **compartir por WhatsApp/SMS**.

**Cálculo de ganancia.** En cada venta se registra el costo unitario al momento de la transacción para calcular la **utilidad bruta** (precio venta − costo). Los reportes muestran ganancia por período.

**Dashboard.** KPIs del día y del mes, gráfico de ventas de los últimos 7 días, alertas de stock bajo, top de productos más vendidos.

**Reportes.** Rango de fechas configurable, totales de ventas, ganancia y compras, top productos, y exportación a CSV para Excel.

**Multi-usuario.** Login con roles **admin** (todo) y **vendedor** (operativo). Contraseñas hasheadas con SHA-256. Soporta de 2 a 5 usuarios o más.

**Respaldo a Google Drive.** Exporta todos los datos (productos, ventas, compras, usuarios) a un archivo `.json` que tú subes a Drive desde la app móvil de Drive. Para restaurar, descargas el archivo de Drive y lo importas.

## Inicio rápido

Usuario por defecto: **admin** / **admin123** — Cámbialo inmediatamente al primer ingreso desde **Configuración → Cambiar mi contraseña**.

Flujo recomendado:

1. Inicia sesión y cambia la contraseña.
2. Crea categorías propias (ej. *Bebidas*, *Snacks*, *Aseo*) desde **Menú → Configuración**.
3. Crea los usuarios vendedores adicionales.
4. Carga el catálogo inicial: **Catálogo → +** por cada producto.
5. Registra el inventario inicial: para cada producto, ingresa el **Stock actual** al crearlo (o desde **Inventario → Ajustar**). Alternativa: registra una **compra inicial** que sume todo el stock con su costo real.
6. Empieza a vender: **Inicio → Nueva venta**.
7. Respalda cada semana: **Menú → Respaldo/Drive → Exportar respaldo**.

## Limitaciones conocidas

Los datos viven en el navegador del celular (IndexedDB). Si desinstalas la app o limpias los datos del navegador **sin tener un respaldo**, perderás la información. **Respalda con frecuencia**.

La sincronización entre múltiples celulares **no es automática**. Cada dispositivo tiene su propia base. Para trabajar con varios vendedores en tiempo real se requiere un backend (próxima fase: migración a SQL Server de ILC o Firebase).

No emite Documentos Tributarios Electrónicos (DTE) del Ministerio de Hacienda. Los tickets son comprobantes internos. Cuando lo necesites, se puede integrar firma y transmisión al MH.

## Próximos pasos sugeridos

Cuando el negocio crezca o necesites consolidar datos de varios celulares, las opciones son: integrar **SQL Server de ILC** vía API REST, usar **Firebase/Supabase** para sincronización en tiempo real con costo bajo, o agregar **emisión de DTE** según legislación salvadoreña vigente (Ley de Simplificación Tributaria, NRC, certificado de firma electrónica).
