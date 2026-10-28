/* =====================================================================
   Lectores de archivos geoespaciales → GeoJSON WGS84 (EPSG:4326)
   Formatos: Shapefile (.zip o .shp+.dbf+.prj+.cpg), KML, KMZ, GeoJSON,
             GeoPackage (.gpkg), GPX y CSV con columnas de coordenadas.
   Dependencias globales: shp (shpjs), toGeoJSON (@tmcw/togeojson),
             JSZip, proj4 y, solo para GeoPackage, initSqlJs (sql.js).
   ===================================================================== */
(function (global) {
  'use strict';

  /* ---------- Sistemas de referencia frecuentes en Chile ---------- */
  const DEFS = {
    'EPSG:32718': '+proj=utm +zone=18 +south +datum=WGS84 +units=m +no_defs',
    'EPSG:32719': '+proj=utm +zone=19 +south +datum=WGS84 +units=m +no_defs',
    'EPSG:5362':  '+proj=utm +zone=18 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
    'EPSG:5361':  '+proj=utm +zone=19 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
    'EPSG:24878': '+proj=utm +zone=18 +south +ellps=intl +towgs84=-288,175,-376,0,0,0,0 +units=m +no_defs',
    'EPSG:24879': '+proj=utm +zone=19 +south +ellps=intl +towgs84=-288,175,-376,0,0,0,0 +units=m +no_defs',
    'EPSG:29188': '+proj=utm +zone=18 +south +ellps=aust_SA +towgs84=-57,1,-41,0,0,0,0 +units=m +no_defs',
    'EPSG:29189': '+proj=utm +zone=19 +south +ellps=aust_SA +towgs84=-57,1,-41,0,0,0,0 +units=m +no_defs'
  };
  const EPSG_OPCIONES = [
    ['', 'Automático / WGS84 geográficas'],
    ['EPSG:32719', 'WGS84 / UTM 19S (32719)'],
    ['EPSG:32718', 'WGS84 / UTM 18S (32718)'],
    ['EPSG:5361', 'SIRGAS-Chile / UTM 19S (5361)'],
    ['EPSG:5362', 'SIRGAS-Chile / UTM 18S (5362)'],
    ['EPSG:24879', 'PSAD56 / UTM 19S (24879)'],
    ['EPSG:24878', 'PSAD56 / UTM 18S (24878)'],
    ['EPSG:29189', 'SAD69 / UTM 19S (29189)'],
    ['EPSG:29188', 'SAD69 / UTM 18S (29188)'],
    ['EPSG:3857', 'Web Mercator (3857)']
  ];
  function registrarDefs() {
    if (!global.proj4) return;
    Object.entries(DEFS).forEach(([k, v]) => { if (!global.proj4.defs(k)) global.proj4.defs(k, v); });
  }
  registrarDefs();

  /* ---------- Utilidades de geometría ---------- */
  function mapCoords(geom, fn) {
    if (!geom) return null;
    const rec = (c, prof) => (prof === 0 ? fn(c) : c.map((x) => rec(x, prof - 1)));
    const prof = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 };
    if (geom.type === 'GeometryCollection') {
      return { type: 'GeometryCollection', geometries: geom.geometries.map((g) => mapCoords(g, fn)).filter(Boolean) };
    }
    if (!(geom.type in prof) || !geom.coordinates) return null;
    return { type: geom.type, coordinates: rec(geom.coordinates, prof[geom.type]) };
  }

  function recorrerCoords(geom, fn) {
    mapCoords(geom, (c) => { fn(c); return c; });
  }

  function fueraDeRango(fc) {
    let malo = false;
    fc.features.forEach((f) => recorrerCoords(f.geometry, (c) => {
      if (Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) malo = true;
    }));
    return malo;
  }

  function reproyectar(fc, desde) {
    if (!desde) return fc;
    const tr = global.proj4(desde, 'EPSG:4326');
    fc.features.forEach((f) => {
      f.geometry = mapCoords(f.geometry, (c) => tr.forward([c[0], c[1]]));
    });
    return fc;
  }

  /** Aplana geometrías: separa GeometryCollection, quita Z/M y elementos sin geometría. */
  function normalizar(fc, origen) {
    const salida = [];
    const agregar = (geom, props) => {
      if (!geom) return;
      if (geom.type === 'GeometryCollection') { geom.geometries.forEach((g) => agregar(g, props)); return; }
      const g = mapCoords(geom, (c) => [Number(c[0]), Number(c[1])]);
      if (g) salida.push({ type: 'Feature', geometry: g, properties: Object.assign({}, props) });
    };
    (fc.features || []).forEach((f) => agregar(f.geometry, f.properties || {}));
    const res = { type: 'FeatureCollection', features: salida };
    if (origen) reproyectar(res, origen);
    if (fueraDeRango(res)) {
      const e = new Error('Las coordenadas no son geográficas (lon/lat). Indica el sistema de referencia (EPSG) del archivo y vuelve a cargarlo.');
      e.codigo = 'PROYECTADO';
      throw e;
    }
    return res;
  }

  /* ---------- Lectores por formato ---------- */
  async function leerShapefileZip(buffer, nombre) {
    const r = await global.shp(buffer);
    const capas = Array.isArray(r) ? r : [r];
    const features = [];
    capas.forEach((c) => (c.features || []).forEach((f) => {
      if (capas.length > 1) f.properties = Object.assign({ _capa: c.fileName }, f.properties);
      features.push(f);
    }));
    if (!features.length) throw new Error(`${nombre}: el ZIP no contiene elementos de shapefile.`);
    return { type: 'FeatureCollection', features };
  }

  async function leerShapefileSuelto(partes, nombre) {
    if (!partes.dbf) throw new Error(`${nombre}: falta el archivo .dbf (atributos).`);
    const obj = { shp: partes.shp, dbf: partes.dbf };
    if (partes.prj) obj.prj = partes.prj;
    if (partes.cpg) obj.cpg = partes.cpg;
    const fc = await global.shp(obj);
    return { fc, sinPrj: !partes.prj };
  }

  function parsearXML(texto) {
    const doc = new global.DOMParser().parseFromString(texto, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('XML inválido.');
    return doc;
  }

  function leerKML(texto) { return global.toGeoJSON.kml(parsearXML(texto)); }
  function leerGPX(texto) { return global.toGeoJSON.gpx(parsearXML(texto)); }

  async function leerKMZ(buffer, nombre) {
    const zip = await global.JSZip.loadAsync(buffer);
    const kmls = Object.keys(zip.files).filter((k) => /\.kml$/i.test(k));
    if (!kmls.length) throw new Error(`${nombre}: el KMZ no contiene un archivo .kml.`);
    const features = [];
    for (const k of kmls) {
      const fc = leerKML(await zip.file(k).async('string'));
      features.push(...fc.features);
    }
    return { type: 'FeatureCollection', features };
  }

  function crsDeGeoJSON(obj) {
    const n = obj && obj.crs && obj.crs.properties && obj.crs.properties.name;
    if (!n) return null;
    const m = String(n).match(/EPSG:{1,2}(\d+)/i);
    if (!m || m[1] === '4326' || /CRS84/i.test(n)) return null;
    return 'EPSG:' + m[1];
  }

  function leerGeoJSON(texto) {
    const obj = JSON.parse(texto);
    let fc;
    if (obj.type === 'FeatureCollection') fc = obj;
    else if (obj.type === 'Feature') fc = { type: 'FeatureCollection', features: [obj] };
    else if (obj.type && obj.coordinates || obj.type === 'GeometryCollection') {
      fc = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: obj, properties: {} }] };
    } else throw new Error('No es un GeoJSON válido.');
    return { fc, crs: crsDeGeoJSON(obj) };
  }

  /* CSV con columnas de coordenadas (lat/lon o este/norte) */
  function parsearCSV(texto) {
    const linea1 = texto.split(/\r?\n/, 1)[0];
    const cuenta = (ch) => linea1.split(ch).length;
    const sep = [';', '\t', ','].sort((a, b) => cuenta(b) - cuenta(a))[0];
    const filas = [];
    let fila = [], campo = '', comillas = false;
    for (let i = 0; i < texto.length; i++) {
      const ch = texto[i];
      if (comillas) {
        if (ch === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
        else if (ch === '"') comillas = false;
        else campo += ch;
      } else if (ch === '"') comillas = true;
      else if (ch === sep) { fila.push(campo); campo = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && texto[i + 1] === '\n') i++;
        fila.push(campo); campo = '';
        if (fila.some((v) => v.trim() !== '')) filas.push(fila);
        fila = [];
      } else campo += ch;
    }
    fila.push(campo);
    if (fila.some((v) => v.trim() !== '')) filas.push(fila);
    return filas;
  }

  function leerCSV(texto, nombre) {
    const filas = parsearCSV(texto.replace(/^﻿/, ''));
    if (filas.length < 2) throw new Error(`${nombre}: el CSV no tiene datos.`);
    const cab = filas[0].map((c) => c.trim());
    const buscar = (re) => cab.findIndex((c) => re.test(c));
    let ix = buscar(/^(lon|lng|long|longitud|longitude)$/i);
    let iy = buscar(/^(lat|latitud|latitude)$/i);
    let proyectado = false;
    if (ix < 0 || iy < 0) {
      ix = buscar(/^(x|este|east|easting|utm_?e|coord_?x)$/i);
      iy = buscar(/^(y|norte|north|northing|utm_?n|coord_?y)$/i);
      proyectado = true;
    }
    if (ix < 0 || iy < 0) {
      throw new Error(`${nombre}: no encontré columnas de coordenadas. Usa lat/lon, latitud/longitud, x/y o este/norte.`);
    }
    const num = (v) => parseFloat(String(v).trim().replace(',', '.'));
    const features = [];
    filas.slice(1).forEach((f) => {
      const x = num(f[ix]), y = num(f[iy]);
      if (!isFinite(x) || !isFinite(y)) return;
      const props = {};
      cab.forEach((c, i) => { if (i !== ix && i !== iy) props[c] = f[i]; });
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [x, y] }, properties: props });
    });
    if (!features.length) throw new Error(`${nombre}: ninguna fila tiene coordenadas válidas.`);
    return { fc: { type: 'FeatureCollection', features }, proyectado };
  }

  /* ---------- GeoPackage (sql.js + parser WKB) ---------- */
  function leerWKB(dv, inicio) {
    let off = inicio;
    const le = dv.getUint8(off) === 1; off += 1;
    let t = dv.getUint32(off, le); off += 4;
    let z = false, m = false;
    if (t & 0x80000000) z = true;
    if (t & 0x40000000) m = true;
    if (t & 0x20000000) off += 4; // EWKB con SRID
    t &= 0x0fffffff;
    if (t >= 3000) { z = m = true; t -= 3000; } else if (t >= 2000) { m = true; t -= 2000; } else if (t >= 1000) { z = true; t -= 1000; }
    const dim = 2 + (z ? 1 : 0) + (m ? 1 : 0);
    const pt = () => { const c = [dv.getFloat64(off, le), dv.getFloat64(off + 8, le)]; off += 8 * dim; return c; };
    const n = () => { const v = dv.getUint32(off, le); off += 4; return v; };
    const pts = () => { const k = n(), a = []; for (let i = 0; i < k; i++) a.push(pt()); return a; };
    const anillos = () => { const k = n(), a = []; for (let i = 0; i < k; i++) a.push(pts()); return a; };
    const partes = () => { const k = n(), a = []; for (let i = 0; i < k; i++) { const r = leerWKB(dv, off); off = r.off; a.push(r.geom); } return a; };
    let geom;
    switch (t) {
      case 1: { const c = pt(); geom = isNaN(c[0]) ? null : { type: 'Point', coordinates: c }; break; }
      case 2: geom = { type: 'LineString', coordinates: pts() }; break;
      case 3: geom = { type: 'Polygon', coordinates: anillos() }; break;
      case 4: geom = { type: 'MultiPoint', coordinates: partes().filter(Boolean).map((g) => g.coordinates) }; break;
      case 5: geom = { type: 'MultiLineString', coordinates: partes().filter(Boolean).map((g) => g.coordinates) }; break;
      case 6: geom = { type: 'MultiPolygon', coordinates: partes().filter(Boolean).map((g) => g.coordinates) }; break;
      case 7: geom = { type: 'GeometryCollection', geometries: partes().filter(Boolean) }; break;
      default: throw new Error('Tipo de geometría WKB no soportado: ' + t);
    }
    return { geom, off };
  }

  function leerGeomGPKG(blob) {
    if (!blob || blob.length < 8) return null;
    const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    if (blob[0] !== 0x47 || blob[1] !== 0x50) return leerWKB(dv, 0).geom; // WKB sin cabecera
    const flags = blob[3];
    if (flags & 0x10) return null; // geometría vacía
    const env = [0, 32, 48, 48, 64][(flags >> 1) & 7] || 0;
    return leerWKB(dv, 8 + env).geom;
  }

  let sqlPromesa = null;
  function cargarSql(urlBase) {
    if (!sqlPromesa) sqlPromesa = global.initSqlJs({ locateFile: (f) => urlBase + f });
    return sqlPromesa;
  }

  function resolverSRS(srsId, org, codigo, wkt) {
    if (srsId === 4326 || (String(org).toUpperCase() === 'EPSG' && Number(codigo) === 4326)) return null;
    if (srsId === 0 || srsId === -1) return null; // sin definir: se asumen geográficas
    const clave = 'EPSG:' + (String(org).toUpperCase() === 'EPSG' ? codigo : srsId);
    if (global.proj4.defs(clave)) return clave;
    if (wkt && wkt !== 'undefined') {
      try { global.proj4.defs(clave, wkt); if (global.proj4.defs(clave)) return clave; } catch (e) { /* sigue */ }
    }
    throw new Error(`Sistema de referencia ${clave} no reconocido en el GeoPackage. Reproyéctalo a WGS84 (EPSG:4326) y vuelve a cargarlo.`);
  }

  async function leerGPKG(buffer, nombre, urlSql) {
    const SQL = await cargarSql(urlSql);
    const db = new SQL.Database(new Uint8Array(buffer));
    try {
      const capas = db.exec(`SELECT g.table_name, g.column_name, g.srs_id, s.organization,
          s.organization_coordsys_id, s.definition
        FROM gpkg_geometry_columns g LEFT JOIN gpkg_spatial_ref_sys s ON g.srs_id = s.srs_id`);
      if (!capas.length || !capas[0].values.length) throw new Error(`${nombre}: el GeoPackage no tiene capas vectoriales.`);
      const features = [];
      const varias = capas[0].values.length > 1;
      for (const [tabla, col, srsId, org, codigo, wkt] of capas[0].values) {
        const origen = resolverSRS(srsId, org, codigo, wkt);
        const res = db.exec(`SELECT * FROM "${String(tabla).replace(/"/g, '""')}"`);
        if (!res.length) continue;
        const cols = res[0].columns;
        const ig = cols.indexOf(col);
        const capa = [];
        res[0].values.forEach((fila) => {
          const props = varias ? { _capa: tabla } : {};
          cols.forEach((c, i) => { if (i !== ig && !(fila[i] instanceof Uint8Array)) props[c] = fila[i]; });
          capa.push({ type: 'Feature', geometry: leerGeomGPKG(fila[ig]), properties: props });
        });
        const fc = { type: 'FeatureCollection', features: capa };
        if (origen) reproyectar(fc, origen);
        features.push(...fc.features);
      }
      return { type: 'FeatureCollection', features };
    } finally {
      db.close();
    }
  }

  /* ---------- Punto de entrada ---------- */
  const ext = (n) => (n.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
  const base = (n) => n.replace(/\.[^.]+$/, '');
  const comoTexto = (f) => (f.text ? f.text() : new Response(f).text());
  const comoBuffer = (f) => (f.arrayBuffer ? f.arrayBuffer() : new Response(f).arrayBuffer());

  /**
   * Lee una lista de archivos (FileList o array de File/Blob con .name).
   * opciones: { epsg: 'EPSG:xxxx' | '', urlSql: 'https://…/sql.js@x/dist/' }
   * Devuelve [{ nombre, fc }] con cada FeatureCollection en WGS84.
   */
  async function leerArchivos(archivos, opciones) {
    const op = Object.assign({ epsg: '', urlSql: '' }, opciones);
    const lista = Array.from(archivos);
    const resultados = [];

    // Agrupar shapefiles sueltos por nombre base
    const grupos = {};
    const otros = [];
    lista.forEach((f) => {
      const e = ext(f.name);
      if (['shp', 'dbf', 'prj', 'cpg', 'shx', 'sbn', 'sbx', 'qmd', 'xml'].includes(e) && !/\.(kml|gpx)$/i.test(f.name)) {
        if (e === 'xml' && !/\.shp\.xml$/i.test(f.name)) { otros.push(f); return; }
        const b = base(f.name.replace(/\.shp\.xml$/i, '.shp')).toLowerCase();
        (grupos[b] = grupos[b] || {})[e] = f;
      } else otros.push(f);
    });

    for (const [b, partes] of Object.entries(grupos)) {
      if (!partes.shp) {
        if (partes.dbf) throw new Error(`Para "${b}" falta el archivo .shp (sube .shp, .dbf, .shx y .prj juntos, o un .zip).`);
        continue;
      }
      const leido = {};
      for (const k of ['shp', 'dbf', 'cpg']) if (partes[k]) leido[k] = await comoBuffer(partes[k]);
      if (partes.prj) leido.prj = await comoTexto(partes.prj);
      const { fc, sinPrj } = await leerShapefileSuelto(leido, partes.shp.name);
      resultados.push({ nombre: partes.shp.name, fc: normalizar(fc, sinPrj ? op.epsg : null) });
    }

    for (const f of otros) {
      const e = ext(f.name);
      let fc, origen = null;
      if (e === 'zip') fc = await leerShapefileZip(await comoBuffer(f), f.name);
      else if (e === 'kml') fc = leerKML(await comoTexto(f));
      else if (e === 'kmz') fc = await leerKMZ(await comoBuffer(f), f.name);
      else if (e === 'gpx') fc = leerGPX(await comoTexto(f));
      else if (e === 'geojson' || e === 'json') {
        const r = leerGeoJSON(await comoTexto(f));
        fc = r.fc; origen = r.crs || op.epsg || null;
        if (r.crs && !global.proj4.defs(r.crs)) throw new Error(`${f.name}: CRS ${r.crs} no reconocido; reproyecta a WGS84.`);
      } else if (e === 'gpkg') fc = await leerGPKG(await comoBuffer(f), f.name, op.urlSql);
      else if (e === 'csv' || e === 'txt') {
        const r = leerCSV(await comoTexto(f), f.name);
        fc = r.fc; origen = op.epsg || null;
      } else throw new Error(`${f.name}: formato .${e} no soportado.`);
      resultados.push({ nombre: f.name, fc: normalizar(fc, origen) });
    }
    return resultados;
  }

  /* ---------- Simplificación (Douglas-Peucker) para geometrías pesadas ---------- */
  function dp(pts, tol) {
    if (pts.length <= 4) return pts;
    const t2 = tol * tol;
    const marca = new Uint8Array(pts.length);
    marca[0] = marca[pts.length - 1] = 1;
    const pila = [[0, pts.length - 1]];
    while (pila.length) {
      const [a, b] = pila.pop();
      const [ax, ay] = pts[a], [bx, by] = pts[b];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      let maxD = 0, idx = -1;
      for (let i = a + 1; i < b; i++) {
        const [px, py] = pts[i];
        let d;
        if (l2 === 0) d = (px - ax) ** 2 + (py - ay) ** 2;
        else {
          const u = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
          d = (px - ax - u * dx) ** 2 + (py - ay - u * dy) ** 2;
        }
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > t2 && idx > 0) { marca[idx] = 1; pila.push([a, idx], [idx, b]); }
    }
    const r = pts.filter((_, i) => marca[i]);
    return r.length >= 4 ? r : pts;
  }

  function contarVertices(geom) { let n = 0; recorrerCoords(geom, () => n++); return n; }

  function simplificar(geom, tol) {
    const anillo = (r) => dp(r, tol);
    switch (geom.type) {
      case 'Polygon': return { type: 'Polygon', coordinates: geom.coordinates.map(anillo) };
      case 'MultiPolygon': return { type: 'MultiPolygon', coordinates: geom.coordinates.map((p) => p.map(anillo)) };
      case 'LineString': return { type: 'LineString', coordinates: dp(geom.coordinates, tol) };
      case 'MultiLineString': return { type: 'MultiLineString', coordinates: geom.coordinates.map((l) => dp(l, tol)) };
      default: return geom;
    }
  }

  global.Lectores = {
    leerArchivos, normalizar, simplificar, contarVertices, mapCoords,
    EPSG_OPCIONES, registrarDefs,
    _interno: { leerWKB, leerGeomGPKG, parsearCSV }
  };
})(typeof window !== 'undefined' ? window : globalThis);
