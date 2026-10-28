# Herramientas GEE: comparador swipe y series de tiempo espectrales

Dos apps web estáticas que usan **Google Earth Engine** directamente desde el navegador. No necesitan servidor y se publican tal cual en GitHub Pages.

| Página | Para qué sirve |
|---|---|
| `index.html` · **Comparador swipe** | Compara dos imágenes (sensor y fechas distintas a cada lado) con un deslizador. |
| `series.html` · **Series de tiempo espectrales** | Carga puntos o polígonos y grafica la evolución de índices espectrales en el tiempo. |

```
├── index.html        Comparador swipe
├── series.html       Series de tiempo de índices
├── config.js         Client ID OAuth y proyecto por defecto (compartido)
├── js/lectores.js    Lectura de Shapefile, KML/KMZ, GeoJSON, GeoPackage, GPX y CSV
└── README.md
```

---

## Series de tiempo espectrales (`series.html`)

### 1. Elementos de entrada
Arrastra uno o varios archivos al panel o al mapa. También puedes dibujar puntos y polígonos con las herramientas del mapa.

| Formato | Cómo subirlo |
|---|---|
| Shapefile | Un `.zip` con el shapefile, o los archivos `.shp`, `.dbf`, `.prj` (y `.cpg`) seleccionados juntos |
| KML / KMZ | Directo |
| GeoJSON | `.geojson` o `.json` |
| GeoPackage | `.gpkg`; se leen todas sus capas vectoriales |
| GPX | Waypoints, rutas y tracks |
| CSV | Columnas `lat`/`lon` (o `latitud`/`longitud`), o `x`/`y`/`este`/`norte` junto con el EPSG |

- **Reproyección automática:** Shapefile (con `.prj`), GeoPackage y GeoJSON con `crs` se pasan solos a WGS84.
- **Archivos sin sistema de referencia** (un CSV en UTM, un shapefile sin `.prj`): elige el EPSG en «Sistema de referencia si el archivo no lo trae». Vienen incluidos WGS84 / UTM 18S-19S, SIRGAS-Chile, PSAD56, SAD69 y Web Mercator.
- **Límites:** hasta 300 elementos por cálculo, y hasta 8 visibles a la vez en los gráficos para mantener los colores distinguibles. Se marcan en la lista o haciendo clic en el mapa.

### 2. Parámetros
- **Sensor:**
  - Landsat 5, 7, 8 o 9 (30 m).
  - Sentinel-2 L2A (10 m).
  - **Landsat 5–9 combinado**, para series largas desde 1984.
- **Período y nubosidad:** se filtra por la nubosidad máxima de la escena y luego se aplica una máscara de nubes por píxel (QA_PIXEL en Landsat, SCL en Sentinel-2).
- **Polígonos:** se usa la media o la mediana de los píxeles despejados dentro del polígono.
- **Índices disponibles (hasta 8 por cálculo):**

| Índice | Fórmula | Uso |
|---|---|---|
| NDVI | (NIR − R) / (NIR + R) | Vigor de vegetación |
| EVI | 2.5 (NIR − R) / (NIR + 6R − 7.5A + 1) | Vegetación densa |
| SAVI | 1.5 (NIR − R) / (NIR + R + 0.5) | Vegetación con suelo expuesto |
| GNDVI | (NIR − V) / (NIR + V) | Clorofila |
| NDWI | (V − NIR) / (V + NIR) | Agua (McFeeters) |
| MNDWI | (V − SWIR1) / (V + SWIR1) | Agua (Xu) |
| NDMI | (NIR − SWIR1) / (NIR + SWIR1) | Humedad de la vegetación |
| NBR | (NIR − SWIR2) / (NIR + SWIR2) | Áreas quemadas |
| NDBI | (SWIR1 − NIR) / (SWIR1 + NIR) | Superficie construida |
| BSI | ((SWIR1 + R) − (NIR + A)) / ((SWIR1 + R) + (NIR + A)) | Suelo desnudo |

### 3. Resultados
- **Por índice:** un gráfico por índice, con una línea por elemento.
- **Por elemento:** todos los índices de un elemento en un mismo gráfico.
- **Tabla:** número de observaciones, media, desviación estándar, mínimo, máximo, primera fecha y último valor.
- **Agregación temporal:** cada observación, promedio mensual, promedio anual o perfil estacional (promedio por mes del año).
- **Descargas:** CSV en formato largo (`fid, elemento, tipo, fecha, sensor, índices…`) y cada gráfico como PNG.

Si dos escenas caen el mismo día sobre un elemento (pasadas solapadas), se promedian. El cálculo se divide en bloques por año y por grupos de elementos para respetar el límite de Earth Engine de 5000 elementos por consulta.

---

## Comparador swipe (`index.html`)

- **Área de interés:** dibuja un polígono o rectángulo, o carga un GeoJSON.
- **Configuración por lado:** cada lado tiene su sensor, rango de fechas, método (mediana con máscara de nubes o escena menos nubosa) y visualización (color real, falso color, infrarrojo, NDWI o NDVI).
- **Comparación:** arrastra la manija central.

---

## Configuración de Google Cloud (una sola vez)

Cada visitante inicia sesión con **su propia cuenta Google** y usa **un proyecto de Google Cloud registrado en Earth Engine**. La app no guarda credenciales.

1. **Proyecto con Earth Engine**
   - Crea o elige un proyecto en <https://console.cloud.google.com>.
   - Regístralo en <https://code.earthengine.google.com/register>.
   - En *APIs y servicios → Biblioteca*, habilita la **Google Earth Engine API**.
2. **Pantalla de consentimiento OAuth**
   - Tipo **Externo**, estado **En prueba**.
   - Agrega como **usuarios de prueba** los correos de quienes usarán la app.
   - Mientras esté "En prueba" admite hasta 100 usuarios. Para abrirla a cualquiera, Google exige verificarla.
3. **Client ID OAuth**
   - Ve a *Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web*.
   - En **Orígenes de JavaScript autorizados** agrega `https://TU_USUARIO.github.io` y `http://localhost:8000`.
4. **Pega el Client ID en `config.js`:**
   ```js
   window.GEE_CONFIG = {
     CLIENT_ID: 'xxxxxxxx.apps.googleusercontent.com',
     PROJECT: 'tu-proyecto-gee'
   };
   ```
   El Client ID no es secreto y puede ir en un repositorio público. Las dos páginas lo comparten.

## Publicar en GitHub Pages
1. Sube todos los archivos manteniendo la carpeta `js/`.
2. En *Settings → Pages*, usa *Deploy from a branch*, rama `main`, carpeta `/ (root)`.
3. La app quedará en `https://TU_USUARIO.github.io/NOMBRE_REPO/`. La página de series estará en `…/series.html`.

## Probar en local
```bash
python -m http.server 8000
```
Abre <http://localhost:8000>. No funciona abriendo el archivo con doble clic (`file://`), porque OAuth exige un origen http(s).

## Notas
- Landsat 7 tiene franjas sin datos (SLC-off) desde junio de 2003: algunas fechas no tendrán valor en ciertos puntos.
- En la serie combinada Landsat 5–9 hay pequeñas diferencias radiométricas entre sensores (TM/ETM+ frente a OLI). Para análisis finos de tendencia conviene armonizarlas.
- Los polígonos muy detallados se simplifican (~5–20 m) solo para el envío a Earth Engine.
- Librerías: Leaflet, Leaflet.draw, Chart.js, Earth Engine JS API, shpjs, @tmcw/togeojson, JSZip, sql.js y proj4.

---

Autor: Daniel González Baez — Ingeniero de Ejecución en Geomensura | Candidato a Magíster en Teledetección
