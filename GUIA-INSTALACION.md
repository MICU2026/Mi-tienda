# Guía de instalación en tu celular

Esta PWA puede instalarse en cualquier celular Android o iPhone y abrirse como cualquier otra app desde la pantalla de inicio. Como es una **aplicación web**, primero hay que publicar los archivos en una dirección que el celular pueda abrir.

## Opción A — La más rápida y gratis: GitHub Pages (15 minutos)

Esta opción te da una URL pública (algo como `https://tu-usuario.github.io/mi-tienda/`) y publicación automática. No requiere tarjeta de crédito.

1. Crea una cuenta en https://github.com (gratis).
2. Crea un nuevo repositorio público llamado `mi-tienda`.
3. Sube los 6 archivos de esta carpeta al repositorio (botón **Add file → Upload files**).
4. Ve a **Settings → Pages**, en *Source* elige **Deploy from a branch**, rama `main`, carpeta `/ (root)`, y guarda.
5. Espera 1-2 minutos. GitHub te dará una URL: `https://TU-USUARIO.github.io/mi-tienda/`.
6. Abre esa URL en el navegador de tu celular (Chrome en Android o Safari en iPhone).

## Opción B — Sin internet ni servidor: solo en tu computadora

Útil para probar antes de publicar. Solo funciona en la PC donde están los archivos.

1. Abre `index.html` directamente en Chrome o Edge — verás la app, pero el Service Worker (modo offline) requiere servidor.
2. Para servidor local rápido, abre PowerShell en esta carpeta y ejecuta:
   ```
   python -m http.server 8080
   ```
3. En tu PC, abre `http://localhost:8080`.
4. Si tu celular está en la misma red WiFi, busca la IP de tu PC (`ipconfig`) y entra desde el celular a `http://192.168.X.X:8080`.

## Opción C — Hosting corporativo de ILC

Si quieres alojarlo en infraestructura de Ingenio La Cabaña: cualquier servidor web estático sirve (IIS, Nginx, Apache, o un sitio SharePoint con scripts permitidos). Solo se requiere **HTTPS** para que la PWA sea instalable y el Service Worker funcione.

## Instalación en el celular (una vez publicada)

### Android (Chrome)
1. Abre la URL en Chrome.
2. Toca el menú **⋮** arriba a la derecha.
3. Toca **Instalar aplicación** o **Agregar a pantalla de inicio**.
4. Confirma. El ícono aparecerá en tu pantalla principal.
5. Ábrela: se ve como una app nativa, sin barra del navegador.

### iPhone (Safari)
1. Abre la URL en Safari (no funciona en Chrome iOS).
2. Toca el botón de **Compartir** (cuadrado con flecha hacia arriba).
3. Desplázate y toca **Añadir a pantalla de inicio**.
4. Confirma. El ícono aparecerá en tu pantalla principal.

## Verificar que funciona offline

Después de instalar y abrir la app al menos una vez con internet, **activa el modo avión** y vuelve a abrirla. Debe funcionar sin problemas. Si no carga, espera unos segundos a que el Service Worker termine de cachear.

## Cómo respaldar a Google Drive (paso a paso)

Es **manual pero confiable**. Recomendación: una vez por semana, mínimo.

1. En la app, toca el menú **⋮** arriba a la derecha → **Respaldo / Drive**.
2. Toca **Exportar respaldo**. Se descarga un archivo `mitienda_backup_AAAA-MM-DD.json` a tu carpeta de descargas del celular.
3. Abre la app de **Google Drive**.
4. Toca el botón **+** (flotante, abajo a la derecha) → **Subir**.
5. Navega hasta **Descargas** y selecciona el archivo `.json` recién creado.
6. Listo. El archivo queda guardado en tu Drive y respaldado en la nube.

**Tip:** Crea una carpeta en Drive llamada *Respaldos Mi Tienda* y sube siempre ahí. Mantén los últimos 4-8 respaldos para tener histórico.

### Cómo restaurar desde Drive

Si cambias de celular, pierdes datos, o necesitas regresar a una versión anterior:

1. Abre Google Drive en el celular nuevo.
2. Localiza el archivo `mitienda_backup_*.json` que quieres usar.
3. Toca los **⋮** del archivo → **Descargar**.
4. Abre la app Mi Tienda → Menú → **Respaldo / Drive** → **Importar respaldo**.
5. Selecciona el archivo descargado.
6. Confirma. Todos los datos serán reemplazados con los del respaldo.

## Compartir la app con tus vendedores

Cada vendedor debe:

1. Abrir la URL en su celular e instalar la PWA.
2. Iniciar sesión con el usuario y contraseña que tú le creaste desde **Configuración → Usuarios**.
3. Importar el respaldo inicial (si los vas a sincronizar manualmente) o empezar con catálogo vacío.

**Importante:** Cada celular es independiente. Si quieres consolidar ventas de varios vendedores, deberás exportar de cada uno y combinar, **o** migrar a una versión con servidor central (Firebase, Supabase, o SQL Server de ILC).

## Problemas frecuentes

**"No puedo instalar la app en iPhone".** Debe ser Safari, no Chrome iOS. iOS solo permite instalar PWAs desde Safari.

**"No se ve la opción Instalar en Android".** Asegúrate de que la URL sea **HTTPS** (no HTTP). GitHub Pages ya es HTTPS automáticamente.

**"La cámara no se abre al tomar foto del producto".** El navegador necesita permisos de cámara. Acepta el permiso cuando lo pida. En iPhone, ve a **Ajustes → Safari → Cámara → Permitir**.

**"Perdí mis datos al limpiar el navegador".** Los datos viven en el navegador. Si limpias datos del sitio, se borra todo. **Por eso es indispensable respaldar a Drive con frecuencia.**

**"Quiero usar varios celulares con los mismos datos en tiempo real".** Esta versión no sincroniza automáticamente. Migración futura a backend (Firebase/SQL Server) lo permite.
