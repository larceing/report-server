// Generar un documento: plantilla + datos -> PDF, con pdfme (ver motor.js).
// Cada documento queda anotado en el registro, sin su contenido.

const { bd, ahora } = require('./bd');
const plantillas = require('./plantillas');
const motor = require('./motor');
const origenes = require('./origen');
const { error } = require('./llaves');

// "Resumen de octubre" -> "Resumen de octubre.pdf"; quita lo que no va en un nombre de fichero.
function nombreFichero(nombre, porDefecto, formato) {
  const limpio = String(nombre || '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 120) || porDefecto;
  return limpio.toLowerCase().endsWith('.' + formato) ? limpio : limpio + '.' + formato;
}

function anotar(app, plantilla, formato, estado, motivo, bytes, ms) {
  bd.prepare('INSERT INTO generado (app, plantilla, formato, estado, motivo, bytes, ms, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(app, plantilla, formato, estado, motivo, bytes, ms, ahora());
}

// { plantilla, parametros?, datos?, formato?, nombre? } -> { contenido, tipo, fichero }
// Si la plantilla tiene consultas, los datos salen de la base de datos con los
// parámetros (y lo que mande la app en «datos» se añade). La pantalla puede
// mandar además «diseno» y «origen» para ver lo que se está editando sin guardarlo.
async function generar(app, peticion, conDiseno) {
  const p = plantillas.una(peticion.plantilla);
  if (!p) throw error('No existe la plantilla «' + String(peticion.plantilla || '').slice(0, 40) + '».', 404);
  if (!p.formatos.length) throw error('La plantilla «' + p.nombre + '» es de la versión anterior (Word): hay que rehacerla en el diseñador.', 422);
  const formato = String(peticion.formato || 'pdf').toLowerCase();
  if (!p.formatos.includes(formato)) throw error('Las plantillas salen en PDF.');
  const datos = peticion.datos === undefined ? {} : peticion.datos;
  if (!datos || typeof datos !== 'object') throw error('datos tiene que ser un objeto o una lista.');
  const deLaPantalla = !!(conDiseno && peticion.diseno);
  const diseno = deLaPantalla ? peticion.diseno : plantillas.diseno(p);
  const origen = conDiseno && peticion.origen !== undefined ? origenes.validar(peticion.origen) : p.origen;

  const inicio = Date.now();
  try {
    if (deLaPantalla) await motor.comprobar(diseno);
    // En la pantalla, sin parámetros, los de prueba de la plantilla.
    const parametros = peticion.parametros === undefined && conDiseno ? origenes.parametrosPrueba(origen) : peticion.parametros;
    const todo = origenes.conDatos(origen) ? { ...datos, ...(await origenes.leer(origen, parametros)) } : datos;
    const contenido = await motor.pdf(diseno, todo);
    anotar(app, p.nombre, formato, 'generado', '', contenido.length, Date.now() - inicio);
    return { contenido, tipo: plantillas.TIPOS.pdf, fichero: nombreFichero(peticion.nombre, p.nombre, formato) };
  } catch (e) {
    const motivo = String(e.message || e).split('\n')[0].slice(0, 300);
    console.error('No se ha podido generar ' + p.nombre + ': ' + motivo);
    anotar(app, p.nombre, formato, 'fallido', motivo, 0, Date.now() - inicio);
    // Un parámetro que falta es culpa de quien llama (400); lo demás, de la plantilla o la base de datos.
    throw error('No se ha podido generar el documento: ' + motivo, e.status === 400 ? 400 : e.status === 502 ? 502 : 422);
  }
}

function registro(filtro) {
  const app = String((filtro && filtro.app) || '').trim();
  return bd.prepare("SELECT * FROM generado WHERE (? = '' OR app = ?) ORDER BY id DESC LIMIT 200").all(app, app);
}

module.exports = { generar, registro, nombreFichero };
