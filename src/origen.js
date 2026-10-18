// De dónde saca sus datos un informe: una conexión, los parámetros que recibe
// (id del pedido…) y las consultas que lanza con ellos. Cada consulta deja sus
// filas en los datos con su nombre: «pedido» (una fila) -> {pedido.cliente};
// «lineas» (varias) -> la tabla «lineas» del diseño.
//
//   { "conexion": "erp",
//     "parametros": [{ "nombre": "id", "prueba": "1" }],
//     "consultas": [{ "nombre": "pedido", "una": true, "sql": "SELECT … WHERE id = :id" },
//                   { "nombre": "lineas", "sql": "SELECT … WHERE pedido_id = :id" }] }

const conexiones = require('./conexiones');
const { error } = require('./llaves');

const NOMBRE = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const MAX_CONSULTAS = 10;

const vacio = () => ({ conexion: '', parametros: [], consultas: [] });

function validar(origen) {
  if (origen === undefined || origen === null || origen === '') return vacio();
  let o = origen;
  if (typeof o === 'string') {
    try { o = JSON.parse(o); } catch (e) { throw error('Los datos del informe no son JSON válido.'); }
  }
  if (typeof o !== 'object' || Array.isArray(o)) throw error('Los datos del informe no se entienden.');

  const conexion = String(o.conexion || '').trim();
  if (conexion && !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(conexion)) throw error('Conexión no válida.');

  const parametros = (Array.isArray(o.parametros) ? o.parametros : []).map(p => ({
    nombre: String((p && p.nombre) || '').trim(),
    prueba: String((p && p.prueba) ?? '').slice(0, 200)
  })).filter(p => p.nombre);
  for (const p of parametros) if (!NOMBRE.test(p.nombre)) throw error('Parámetro «' + p.nombre.slice(0, 40) + '»: letras, números y guion bajo.');
  if (new Set(parametros.map(p => p.nombre)).size !== parametros.length) throw error('Hay parámetros repetidos.');

  const consultas = (Array.isArray(o.consultas) ? o.consultas : []).map(c => ({
    nombre: String((c && c.nombre) || '').trim(),
    una: !!(c && c.una),
    sql: String((c && c.sql) || '').trim()
  })).filter(c => c.nombre || c.sql);
  if (consultas.length > MAX_CONSULTAS) throw error('Como mucho ' + MAX_CONSULTAS + ' consultas por informe.');
  for (const c of consultas) {
    if (!NOMBRE.test(c.nombre)) throw error('Cada consulta necesita un nombre (pedido, lineas…): letras, números y guion bajo.');
    if (!c.sql) throw error('La consulta «' + c.nombre + '» está vacía.');
    if (c.sql.length > 20000) throw error('La consulta «' + c.nombre + '» es demasiado larga.');
    if (c.nombre === 'parametros') throw error('«parametros» ya lo usa el informe: pon otro nombre a la consulta.');
  }
  if (new Set(consultas.map(c => c.nombre)).size !== consultas.length) throw error('Hay consultas con el mismo nombre.');
  if (consultas.length && !conexion) throw error('Elige la conexión de la que leen las consultas.');
  return { conexion, parametros, consultas };
}

const conDatos = (o) => !!(o && o.conexion && o.consultas && o.consultas.length);

// Solo pasan los parámetros declarados, como texto (o número si lo es).
function parametrosDe(o, recibidos) {
  const r = recibidos && typeof recibidos === 'object' ? recibidos : {};
  const salida = {};
  for (const p of o.parametros) {
    const v = r[p.nombre];
    if (v === undefined || v === null || v === '') throw error('Falta el parámetro «' + p.nombre + '».');
    if (typeof v === 'object') throw error('El parámetro «' + p.nombre + '» tiene que ser un texto o un número.');
    salida[p.nombre] = v;
  }
  return salida;
}

const parametrosPrueba = (o) => Object.fromEntries(o.parametros.map(p => [p.nombre, p.prueba]));

async function leer(o, recibidos) {
  const parametros = parametrosDe(o, recibidos);
  const datos = { parametros };
  for (const c of o.consultas) {
    let filas;
    try {
      filas = await conexiones.consultar(o.conexion, c.sql, parametros);
    } catch (e) {
      e.message = 'Consulta «' + c.nombre + '»: ' + e.message;
      throw e;
    }
    datos[c.nombre] = c.una ? (filas[0] || {}) : filas;
  }
  return datos;
}

module.exports = { validar, conDatos, leer, parametrosPrueba, vacio };
