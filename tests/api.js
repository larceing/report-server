// La API de punta a punta: llaves, plantillas, generar, registro y límites.
// Sale en el formato de la plantilla (docx) sin LibreOffice; el PDF solo se
// prueba si LibreOffice está a mano (en la imagen lo comprueba GitHub).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yauzl = require('yauzl');

process.env.RS_DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-'));
const conLibreOffice = process.env.PATH.split(':').some(d => fs.existsSync(path.join(d, 'soffice.bin')));

// El texto de word/document.xml de un docx.
function textoDocx(buf) {
  return new Promise((ok, mal) => yauzl.fromBuffer(buf, { lazyEntries: true }, (e, zip) => {
    if (e) return mal(e);
    zip.on('entry', entrada => {
      if (entrada.fileName !== 'word/document.xml') return zip.readEntry();
      zip.openReadStream(entrada, (e2, s) => {
        if (e2) return mal(e2);
        let xml = '';
        s.on('data', d => { xml += d; });
        s.on('end', () => ok(xml.replace(/<[^>]+>/g, '')));
      });
    });
    zip.on('end', () => mal(new Error('sin word/document.xml')));
    zip.readEntry();
  }));
}

(async () => {
  const app = require('../server');
  const srv = app.listen(0);
  await new Promise(r => srv.on('listening', r));
  const url = 'http://127.0.0.1:' + srv.address().port;

  const pedir = async (metodo, ruta, cuerpo, cab) => {
    const r = await fetch(url + ruta, {
      method: metodo,
      headers: { ...(cuerpo ? { 'Content-Type': 'application/json' } : {}), ...(cab || {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined
    });
    const buf = Buffer.from(await r.arrayBuffer());
    let json = null;
    try { json = JSON.parse(buf.toString()); } catch (e) { /* binario */ }
    return { status: r.status, tipo: r.headers.get('content-type'), disposicion: r.headers.get('content-disposition'), buf, json };
  };

  // Pantalla en modo local (sin NODE_ENV=production): subir la plantilla de ejemplo.
  const docx = fs.readFileSync(path.join(__dirname, '..', 'ejemplos', 'ejemplo.docx')).toString('base64');
  const ejemplo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'ejemplos', 'ejemplo.json'), 'utf8'));

  let r = await pedir('POST', '/api/admin/plantillas', { nombre: 'Mal Nombre', fichero: 'a.docx', contenido: docx });
  assert.strictEqual(r.status, 400, 'nombre con mayúsculas y espacio');
  r = await pedir('POST', '/api/admin/plantillas', { nombre: 'resumen', fichero: 'a.pdf', contenido: docx });
  assert.strictEqual(r.status, 400, 'un pdf no es plantilla');
  r = await pedir('POST', '/api/admin/plantillas', { nombre: 'resumen', fichero: 'a.docx', contenido: Buffer.from('hola').toString('base64') });
  assert.strictEqual(r.status, 400, 'no es un zip de Office');
  r = await pedir('POST', '/api/admin/plantillas', { nombre: 'resumen', fichero: 'a.docx', contenido: docx, ejemplo: '{mal' });
  assert.strictEqual(r.status, 400, 'ejemplo que no es JSON');

  r = await pedir('POST', '/api/admin/plantillas', { nombre: 'resumen', titulo: 'Resumen', fichero: 'Resumen.DOCX', contenido: docx, ejemplo });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual(r.json.formatos, ['pdf', 'docx', 'odt']);
  assert.strictEqual(r.json.ejemplo.cliente.nombre, 'Multiforte SL');

  // Sustituir el fichero conserva el ejemplo; editar cambia título y ejemplo.
  r = await pedir('POST', '/api/admin/plantillas', { nombre: 'resumen', fichero: 'otra.docx', contenido: docx });
  assert.strictEqual(r.json.ejemplo.cliente.nombre, 'Multiforte SL');
  assert.strictEqual(r.json.titulo, 'Resumen');
  r = await pedir('PUT', '/api/admin/plantillas/resumen', { titulo: 'Resumen de servicios', ejemplo: { ...ejemplo, notas: 'cambiado' } });
  assert.strictEqual(r.json.titulo, 'Resumen de servicios');
  assert.strictEqual(r.json.ejemplo.notas, 'cambiado');
  r = await pedir('GET', '/api/admin/plantillas/resumen/fichero');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.buf.subarray(0, 2).toString(), 'PK');

  // Llaves.
  r = await pedir('POST', '/api/admin/llaves', { app: 'Soporte!' });
  assert.strictEqual(r.status, 400);
  r = await pedir('POST', '/api/admin/llaves', { app: 'soporte' });
  const llave = r.json.llave;
  assert.match(llave, /^rs_[A-Za-z0-9_-]{32}$/);
  const conLlave = { Authorization: 'Bearer ' + llave };

  assert.strictEqual((await pedir('POST', '/api/generar', { plantilla: 'resumen' })).status, 401, 'sin llave');
  assert.strictEqual((await pedir('POST', '/api/generar', { plantilla: 'resumen' }, { Authorization: 'Bearer rs_' + 'x'.repeat(32) })).status, 401, 'llave inventada');

  r = await pedir('GET', '/api/plantillas', null, conLlave);
  assert.deepStrictEqual(r.json, [{ nombre: 'resumen', titulo: 'Resumen de servicios', formatos: ['pdf', 'docx', 'odt'] }]);

  assert.strictEqual((await pedir('POST', '/api/generar', { plantilla: 'no-existe' }, conLlave)).status, 404);
  assert.strictEqual((await pedir('POST', '/api/generar', { plantilla: 'resumen', formato: 'xlsx' }, conLlave)).status, 400);
  assert.strictEqual((await pedir('POST', '/api/generar', { plantilla: 'resumen', datos: 'texto' }, conLlave)).status, 400);

  // Generar en docx: los datos, escapados, dentro del documento.
  const datos = { ...ejemplo, cliente: { ...ejemplo.cliente, nombre: 'Café <b>& Cía</b>' } };
  r = await pedir('POST', '/api/generar', { plantilla: 'resumen', formato: 'docx', datos, nombre: 'Resumen: octubre' }, conLlave);
  assert.strictEqual(r.status, 200, r.buf.toString().slice(0, 200));
  assert.match(r.tipo, /wordprocessingml/);
  assert.strictEqual(r.disposicion, "attachment; filename*=UTF-8''" + encodeURIComponent('Resumen  octubre.docx'));
  const texto = await textoDocx(r.buf);
  assert.ok(texto.includes('Café &lt;b&gt;&amp; Cía&lt;/b&gt;'), 'el nombre, escapado: ' + texto.slice(0, 300));
  assert.ok(texto.includes('Informe mensual de ventas') && texto.includes('Soporte a usuarios'), 'todas las líneas');
  assert.ok(texto.includes('12/10/2026') && texto.includes('270,00 €'), 'fecha y moneda en español');
  assert.ok(!texto.includes('{d.'), 'no quedan marcas sin rellenar');

  if (conLibreOffice) {
    r = await pedir('POST', '/api/generar', { plantilla: 'resumen', datos }, conLlave);
    assert.strictEqual(r.status, 200, r.buf.toString().slice(0, 200));
    assert.strictEqual(r.tipo, 'application/pdf');
    assert.strictEqual(r.buf.subarray(0, 5).toString(), '%PDF-');
    console.log('api: PDF con LibreOffice, bien');
  }

  // Registro y probar desde la pantalla.
  r = await pedir('POST', '/api/admin/probar', { plantilla: 'resumen', formato: 'odt', datos: ejemplo });
  assert.strictEqual(conLibreOffice ? 200 : 422, r.status, 'odt necesita LibreOffice');
  r = await pedir('GET', '/api/admin/registro?app=soporte');
  assert.ok(r.json.length >= 1 && r.json.every(g => g.app === 'soporte'));
  assert.strictEqual(r.json[r.json.length - 1].estado, 'generado');
  r = await pedir('GET', '/api/admin/llaves');
  assert.ok(r.json[0].usada, 'la llave anota su último uso');

  // Revocar y borrar.
  await pedir('DELETE', '/api/admin/llaves/' + r.json[0].id);
  assert.strictEqual((await pedir('GET', '/api/plantillas', null, conLlave)).status, 401, 'llave revocada');
  await pedir('DELETE', '/api/admin/plantillas/resumen');
  assert.deepStrictEqual((await pedir('GET', '/api/admin/plantillas')).json, []);
  assert.deepStrictEqual(fs.readdirSync(path.join(process.env.RS_DATOS, 'plantillas')), [], 'el fichero también se borra');

  // Solo JSON en la API.
  r = await fetch(url + '/api/generar', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' });
  assert.strictEqual(r.status, 415);

  srv.close();
  console.log('api: bien');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
