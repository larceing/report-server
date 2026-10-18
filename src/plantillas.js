// Plantillas: el diseño de cada documento, hecho con el diseñador de la
// pantalla (pdfme). El JSON va en /datos/plantillas/<nombre>.json; la ficha
// (título, grupo, de dónde saca los datos y datos de ejemplo) en SQLite.

const fs = require('fs');
const path = require('path');
const { bd, ahora, PLANTILLAS } = require('./bd');
const { error } = require('./llaves');
const motor = require('./motor');
const origenes = require('./origen');

const MAX_BYTES = 10 * 1024 * 1024;
const NOMBRE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TIPO = 'pdfme';
const FORMATOS = ['pdf'];
const TIPOS = { pdf: 'application/pdf', json: 'application/json' };

// Una página A4 en blanco con márgenes de 15 mm.
const EN_BLANCO = () => ({ basePdf: { width: 210, height: 297, padding: [15, 15, 15, 15] }, schemas: [[]] });

const fichero = (p) => path.join(PLANTILLAS, p.nombre + '.' + (p.extension === TIPO ? 'json' : p.extension));

// Las de antes de pdfme (Word) siguen en la lista para que se vean, pero ya no salen.
function ficha(fila) {
  return fila && {
    ...fila, formatos: fila.extension === TIPO ? FORMATOS : [],
    ejemplo: JSON.parse(fila.ejemplo || '{}'), origen: { ...origenes.vacio(), ...JSON.parse(fila.origen || '{}') }
  };
}

const lista = () => bd.prepare("SELECT * FROM plantilla ORDER BY grupo = '', grupo, nombre").all().map(ficha);
const una = (nombre) => ficha(bd.prepare('SELECT * FROM plantilla WHERE nombre = ?').get(String(nombre || '')));

function diseno(p) {
  return JSON.parse(fs.readFileSync(fichero(p), 'utf8'));
}

function ejemploValido(ejemplo) {
  let datos = ejemplo === undefined || ejemplo === '' ? {} : ejemplo;
  if (typeof datos === 'string') {
    try { datos = JSON.parse(datos); } catch (e) { throw error('Los datos de ejemplo no son JSON válido: ' + e.message); }
  }
  if (!datos || typeof datos !== 'object') throw error('Los datos de ejemplo tienen que ser un objeto o una lista JSON.');
  return JSON.stringify(datos);
}

async function disenoValido(plantilla) {
  let t = plantilla;
  if (typeof t === 'string') {
    try { t = JSON.parse(t); } catch (e) { throw error('La plantilla no es JSON válido.'); }
  }
  if (!t || typeof t !== 'object' || !Array.isArray(t.schemas)) throw error('Eso no es una plantilla de Report Server.');
  try {
    await motor.comprobar(t);
  } catch (e) {
    throw error('La plantilla no es válida: ' + String(e.message || e).slice(0, 300));
  }
  const json = JSON.stringify(t);
  if (Buffer.byteLength(json) > MAX_BYTES) throw error('Como mucho 10 MB (las imágenes ocupan mucho).');
  return json;
}

const grupoValido = (g) => {
  const t = String(g || '').trim().toLowerCase();
  if (t && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(t)) throw error('Grupo: minúsculas, números y guiones (pedido, factura…).');
  return t;
};

// Crear (en blanco, o con un diseño importado) o sustituir el diseño de una que
// existe. Lo que no venga se conserva de la anterior.
async function guardar({ nombre, titulo, plantilla, ejemplo, grupo, origen }) {
  nombre = String(nombre || '').trim();
  if (!NOMBRE.test(nombre)) throw error('Nombre: minúsculas, números y guiones (resumen, parte-de-horas…).');
  const anterior = una(nombre);
  if (plantilla === undefined && anterior && anterior.extension === TIPO) plantilla = diseno(anterior);
  const json = await disenoValido(plantilla === undefined ? EN_BLANCO() : plantilla);
  const datosEjemplo = ejemplo === undefined && anterior ? JSON.stringify(anterior.ejemplo) : ejemploValido(ejemplo);
  const t = String(titulo || '').trim().slice(0, 80) || (anterior ? anterior.titulo : nombre);
  const g = grupo === undefined ? (anterior ? anterior.grupo : '') : grupoValido(grupo);
  const o = JSON.stringify(origen === undefined ? (anterior ? anterior.origen : origenes.vacio()) : origenes.validar(origen));

  if (anterior && anterior.extension !== TIPO) fs.rmSync(fichero(anterior), { force: true });
  fs.writeFileSync(fichero({ nombre, extension: TIPO }), json);
  bd.prepare(`INSERT INTO plantilla (nombre, titulo, extension, bytes, ejemplo, grupo, origen, creada, actualizada) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (nombre) DO UPDATE SET titulo = excluded.titulo, extension = excluded.extension, bytes = excluded.bytes,
      ejemplo = excluded.ejemplo, grupo = excluded.grupo, origen = excluded.origen, actualizada = excluded.actualizada`)
    .run(nombre, t, TIPO, Buffer.byteLength(json), datosEjemplo, g, o, ahora(), ahora());
  return una(nombre);
}

async function editar(nombre, cambios) {
  const p = una(nombre);
  if (!p) throw error('No existe esa plantilla.', 404);
  if (p.extension !== TIPO) throw error('Es de la versión anterior (Word): hay que rehacerla en el diseñador.', 422);
  return guardar({ ...cambios, nombre: p.nombre });
}

// Lo que da «Descargar»: la plantilla entera, sin contraseñas (la conexión va por su nombre).
const exportar = (p) => ({ nombre: p.nombre, titulo: p.titulo, grupo: p.grupo, origen: p.origen, ejemplo: p.ejemplo, plantilla: diseno(p) });

function borrar(nombre) {
  const p = una(nombre);
  if (!p) return;
  fs.rmSync(fichero(p), { force: true });
  bd.prepare('DELETE FROM plantilla WHERE nombre = ?').run(p.nombre);
}

module.exports = { TIPO, FORMATOS, TIPOS, lista, una, diseno, guardar, editar, borrar, fichero, exportar };
