// Generar un documento: plantilla + datos -> PDF (o el formato que se pida).
// Carbone rellena la plantilla y, para cambiar de formato, usa LibreOffice
// (que tiene que estar en la imagen; ver Dockerfile). Cada documento queda
// anotado en el registro, sin su contenido.

const os = require('os');
const carbone = require('carbone');
const { bd, ahora } = require('./bd');
const plantillas = require('./plantillas');
const { error } = require('./llaves');

carbone.set({
  // Las rutas de las plantillas van completas; aquí Carbone solo deja su carpeta «lang».
  templatePath: os.tmpdir(),
  tempPath: os.tmpdir(),
  lang: 'es-es',
  timezone: 'Europe/Madrid',
  currencySource: 'EUR',
  currencyTarget: 'EUR',
  // Un solo LibreOffice: los documentos esperan su turno en vez de gastar memoria.
  factories: 1,
  startFactory: false
});

function render(ruta, datos, opciones) {
  return new Promise((ok, mal) => carbone.render(ruta, datos, opciones, (e, r) => (e ? mal(e) : ok(r))));
}

// "Resumen de octubre.pdf" -> "Resumen de octubre.pdf"; quita lo que no va en un nombre de fichero.
function nombreFichero(nombre, porDefecto, formato) {
  const limpio = String(nombre || '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 120) || porDefecto;
  return limpio.toLowerCase().endsWith('.' + formato) ? limpio : limpio + '.' + formato;
}

function anotar(app, plantilla, formato, estado, motivo, bytes, ms) {
  bd.prepare('INSERT INTO generado (app, plantilla, formato, estado, motivo, bytes, ms, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(app, plantilla, formato, estado, motivo, bytes, ms, ahora());
}

// { plantilla, datos, formato?, nombre? } -> { contenido, tipo, fichero }
async function generar(app, peticion) {
  const p = plantillas.una(peticion.plantilla);
  if (!p) throw error('No existe la plantilla «' + String(peticion.plantilla || '').slice(0, 40) + '».', 404);
  const formato = String(peticion.formato || p.formatos[0]).toLowerCase();
  if (!p.formatos.includes(formato)) throw error('Esta plantilla sale en ' + p.formatos.join(', ') + '.');
  const datos = peticion.datos === undefined ? {} : peticion.datos;
  if (!datos || typeof datos !== 'object') throw error('datos tiene que ser un objeto o una lista.');

  const inicio = Date.now();
  try {
    const contenido = await render(plantillas.fichero(p), datos, formato === p.extension ? {} : { convertTo: formato });
    anotar(app, p.nombre, formato, 'generado', '', contenido.length, Date.now() - inicio);
    return { contenido, tipo: plantillas.TIPOS[formato], fichero: nombreFichero(peticion.nombre, p.nombre, formato) };
  } catch (e) {
    const motivo = String(e.message || e).slice(0, 300);
    console.error('No se ha podido generar ' + p.nombre + ' (' + formato + '): ' + motivo);
    anotar(app, p.nombre, formato, 'fallido', motivo, 0, Date.now() - inicio);
    throw error('No se ha podido generar el documento: ' + motivo, 422);
  }
}

function registro(filtro) {
  const app = String((filtro && filtro.app) || '').trim();
  return bd.prepare("SELECT * FROM generado WHERE (? = '' OR app = ?) ORDER BY id DESC LIMIT 200").all(app, app);
}

module.exports = { generar, registro, nombreFichero };
