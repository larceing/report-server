// El motor: una plantilla de pdfme (MIT) + los datos de la app -> PDF.
//
// Una plantilla es el JSON que guarda el diseñador de la pantalla: el tamaño
// de la página y los campos (textos, tablas, imágenes, líneas…) con su sitio.
// Los datos entran así:
//   - Texto fijo (no editable): su contenido puede llevar marcas, como
//     «Cliente: {cliente.nombre}» o «{euros(total)}».
//   - Tabla: su primera fila de ejemplo lleva las marcas de cada columna
//     ({concepto}, {euros(importe)}…) y se repite por cada elemento de la lista
//     de los datos que se llama como la tabla.
//   - Campo editable (texto, imagen, código QR…): toma el dato que se llama
//     como el campo; si no viene, lo que tenga en el diseñador.
// Las marcas se resuelven aquí, antes de pasar nada a pdfme, así que lo que
// mande la app nunca se interpreta como una marca.

const { AYUDAS } = require('./ayudas');

let pdfme = null;
async function cargar() {
  if (!pdfme) {
    const [generador, esquemas, comun] = await Promise.all([
      import('@pdfme/generator'), import('@pdfme/schemas'), import('@pdfme/common')
    ]);
    const { builtInPlugins, ...resto } = esquemas;
    const plugins = { ...builtInPlugins };
    for (const nombre of ['table', 'image', 'svg', 'line', 'rectangle', 'ellipse', 'multiVariableText', 'list']) {
      if (resto[nombre]) plugins[nombre] = resto[nombre];
    }
    for (const [nombre, plugin] of Object.entries(resto.barcodes || {})) plugins[nombre] = plugin;
    pdfme = { generate: generador.generate, checkTemplate: comun.checkTemplate, replacePlaceholders: comun.replacePlaceholders, plugins };
  }
  return pdfme;
}

const texto = (v) => v === undefined || v === null ? '' : typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);

function resolver(contenido, variables) {
  return pdfme.replacePlaceholders({ content: String(contenido || ''), variables, schemas: [] });
}

function filaModelo(campo) {
  try {
    const filas = JSON.parse(campo.content || '[]');
    return Array.isArray(filas) && Array.isArray(filas[0]) ? filas[0] : null;
  } catch (e) {
    return null;
  }
}

// La plantilla con las marcas ya resueltas y los valores de cada campo.
function preparar(plantilla, datos) {
  const t = structuredClone(plantilla);
  const base = Array.isArray(datos) ? { lista: datos } : datos;
  const variables = { ...base, ...AYUDAS };
  const valores = {};

  for (const campo of t.schemas.flat()) {
    const dato = base[campo.name];
    if (campo.type === 'table') {
      const modelo = filaModelo(campo);
      if (Array.isArray(dato)) {
        valores[campo.name] = JSON.stringify(dato.map(fila => Array.isArray(fila) ? fila.map(texto)
          : (modelo || []).map(celda => resolver(celda, { ...variables, ...(fila && typeof fila === 'object' ? fila : { valor: fila }) }))));
      } else {
        // Sin lista en los datos, la tabla sale vacía (no con la fila de marcas).
        valores[campo.name] = '[]';
      }
      campo.readOnly = false;
    } else if (campo.type === 'text' || campo.type === 'multiVariableText') {
      // Un texto editable toma el dato con su nombre; si no viene, lo escrito en el
      // diseñador con sus marcas, como un texto fijo.
      const escrito = campo.type === 'multiVariableText' ? campo.text : campo.content;
      valores[campo.name] = !campo.readOnly && dato !== undefined ? texto(dato) : resolver(escrito, variables);
      campo.type = 'text';
      campo.readOnly = false;
    } else if (!campo.readOnly) {
      valores[campo.name] = dato === undefined ? texto(campo.content) : texto(dato);
    }
  }
  return { plantilla: t, valores };
}

// pdfme explica qué falla en varias líneas («ERROR POSITION: … ERROR MESSAGE: …»): en una.
function explicar(e) {
  const texto = String((e && e.message) || e);
  const partes = [...texto.matchAll(/ERROR POSITION: (.*)\nERROR MESSAGE: (.*)/g)].map(m => m[1] + ': ' + m[2]);
  return partes.length ? partes.slice(0, 3).join(' · ') : texto.split('\n')[0];
}

// Para comprobar al guardar que el JSON es una plantilla de pdfme.
async function comprobar(plantilla) {
  const { checkTemplate } = await cargar();
  try {
    checkTemplate(plantilla);
  } catch (e) {
    throw new Error(explicar(e));
  }
}

async function pdf(plantilla, datos) {
  const { generate, plugins } = await cargar();
  const { plantilla: t, valores } = preparar(plantilla, datos);
  return Buffer.from(await generate({ template: t, inputs: [valores], plugins }));
}

module.exports = { pdf, comprobar, preparar, cargar };
