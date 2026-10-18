// Plantillas: documentos de Word, LibreOffice o Excel con marcas de Carbone
// ({d.cliente}, {d.lineas[i].concepto}…). El fichero va en /datos/plantillas
// con el nombre de la plantilla; la ficha (título, datos de ejemplo) en SQLite.

const fs = require('fs');
const path = require('path');
const { bd, ahora, PLANTILLAS } = require('./bd');
const { error } = require('./llaves');

const MAX_BYTES = 10 * 1024 * 1024;
const NOMBRE = /^[a-z0-9][a-z0-9-]{0,39}$/;

// Lo que se puede sacar de cada tipo de plantilla. El primero es el de siempre.
const FORMATOS = {
  docx: ['pdf', 'docx', 'odt'],
  odt: ['pdf', 'odt', 'docx'],
  xlsx: ['pdf', 'xlsx', 'ods', 'csv'],
  ods: ['pdf', 'ods', 'xlsx', 'csv']
};

const TIPOS = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  csv: 'text/csv; charset=utf-8'
};

const fichero = (p) => path.join(PLANTILLAS, p.nombre + '.' + p.extension);

function ficha(fila) {
  return fila && { ...fila, formatos: FORMATOS[fila.extension], ejemplo: JSON.parse(fila.ejemplo || '{}') };
}

const lista = () => bd.prepare('SELECT * FROM plantilla ORDER BY nombre').all().map(ficha);
const una = (nombre) => ficha(bd.prepare('SELECT * FROM plantilla WHERE nombre = ?').get(String(nombre || '')));

function ejemploValido(ejemplo) {
  let datos = ejemplo === undefined || ejemplo === '' ? {} : ejemplo;
  if (typeof datos === 'string') {
    try { datos = JSON.parse(datos); } catch (e) { throw error('Los datos de ejemplo no son JSON válido: ' + e.message); }
  }
  if (!datos || typeof datos !== 'object') throw error('Los datos de ejemplo tienen que ser un objeto o una lista JSON.');
  return JSON.stringify(datos);
}

// Docx, xlsx, odt y ods son ficheros zip: empiezan por «PK».
function guardar({ nombre, titulo, fichero: nombreFichero, contenido, ejemplo }) {
  nombre = String(nombre || '').trim();
  if (!NOMBRE.test(nombre)) throw error('Nombre: minúsculas, números y guiones (resumen, parte-de-horas…).');
  const extension = String(nombreFichero || '').toLowerCase().split('.').pop();
  if (!FORMATOS[extension]) throw error('La plantilla tiene que ser .docx, .odt, .xlsx u .ods.');
  const buf = Buffer.from(String(contenido || ''), 'base64');
  if (!buf.length) throw error('El fichero está vacío.');
  if (buf.length > MAX_BYTES) throw error('Como mucho 10 MB.');
  if (buf.subarray(0, 2).toString('latin1') !== 'PK') throw error('El fichero no es un documento de Office o LibreOffice.');

  const anterior = una(nombre);
  const datosEjemplo = ejemplo === undefined && anterior ? JSON.stringify(anterior.ejemplo) : ejemploValido(ejemplo);
  const t = String(titulo || '').trim().slice(0, 80) || (anterior ? anterior.titulo : nombre);

  if (anterior && anterior.extension !== extension) fs.rmSync(fichero(anterior), { force: true });
  fs.writeFileSync(fichero({ nombre, extension }), buf);
  bd.prepare(`INSERT INTO plantilla (nombre, titulo, extension, bytes, ejemplo, creada, actualizada) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (nombre) DO UPDATE SET titulo = excluded.titulo, extension = excluded.extension, bytes = excluded.bytes,
      ejemplo = excluded.ejemplo, actualizada = excluded.actualizada`)
    .run(nombre, t, extension, buf.length, datosEjemplo, ahora(), ahora());
  return una(nombre);
}

function editar(nombre, { titulo, ejemplo }) {
  const p = una(nombre);
  if (!p) throw error('No existe esa plantilla.', 404);
  bd.prepare('UPDATE plantilla SET titulo = ?, ejemplo = ?, actualizada = ? WHERE nombre = ?')
    .run(String(titulo || '').trim().slice(0, 80) || p.titulo, ejemplo === undefined ? JSON.stringify(p.ejemplo) : ejemploValido(ejemplo), ahora(), p.nombre);
  return una(p.nombre);
}

function borrar(nombre) {
  const p = una(nombre);
  if (!p) return;
  fs.rmSync(fichero(p), { force: true });
  bd.prepare('DELETE FROM plantilla WHERE nombre = ?').run(p.nombre);
}

module.exports = { FORMATOS, TIPOS, lista, una, guardar, editar, borrar, fichero };
