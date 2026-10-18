// La API de punta a punta: llaves, plantillas, generar, registro y límites.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.RS_DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-'));

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

  // Pantalla en modo local (sin NODE_ENV=production).
  const leer = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'ejemplos', f), 'utf8'));
  const diseno = leer('plantilla.json');
  const ejemplo = leer('datos.json');

  let r = await pedir('POST', '/api/admin/plantillas', { nombre: 'Mal Nombre' });
  assert.strictEqual(r.status, 400, 'nombre con mayúsculas y espacio');
  r = await pedir('POST', '/api/admin/plantillas', { nombre: 'resumen', plantilla: '{mal' });
  assert.strictEqual(r.status, 400, 'plantilla que no es JSON');
  r = await pedir('POST', '/api/admin/plantillas', { nombre: 'resumen', plantilla: { schemas: 'no' } });
  assert.strictEqual(r.status, 400, 'no es una plantilla');
  r = await pedir('POST', '/api/admin/plantillas', { nombre: 'resumen', plantilla: { basePdf: 'x', schemas: [[{ name: 'a' }]] } });
  assert.strictEqual(r.status, 400, 'pdfme no la acepta: ' + JSON.stringify(r.json));
  r = await pedir('POST', '/api/admin/plantillas', { nombre: 'resumen', plantilla: diseno, ejemplo: '{mal' });
  assert.strictEqual(r.status, 400, 'ejemplo que no es JSON');

  // En blanco, y no se pisa una que existe.
  r = await pedir('POST', '/api/admin/plantillas', { nombre: 'resumen', titulo: 'Resumen' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual(r.json.formatos, ['pdf']);
  assert.strictEqual((await pedir('POST', '/api/admin/plantillas', { nombre: 'resumen' })).status, 409);
  r = await pedir('GET', '/api/admin/plantillas/resumen/diseno');
  assert.deepStrictEqual(r.json.schemas, [[]], 'A4 en blanco');

  // Importar un diseño sustituye, y sin ejemplo conserva el que había.
  r = await pedir('PUT', '/api/admin/plantillas/resumen', { ejemplo });
  r = await pedir('POST', '/api/admin/plantillas', { nombre: 'resumen', plantilla: diseno });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.ejemplo.cliente.nombre, 'Multiforte SL');
  assert.strictEqual(r.json.titulo, 'Resumen');
  r = await pedir('PUT', '/api/admin/plantillas/resumen', { titulo: 'Resumen de servicios', ejemplo: { ...ejemplo, notas: 'cambiado' } });
  assert.strictEqual(r.json.titulo, 'Resumen de servicios');
  assert.strictEqual(r.json.ejemplo.notas, 'cambiado');
  r = await pedir('PUT', '/api/admin/plantillas/resumen', { plantilla: { ...diseno, schemas: [[...diseno.schemas[0]]] } });
  assert.strictEqual(r.status, 200, 'guardar desde el diseñador');
  assert.strictEqual(r.json.ejemplo.notas, 'cambiado', 'guardar el diseño no toca el ejemplo');
  r = await pedir('GET', '/api/admin/plantillas/resumen/fichero');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.nombre, 'resumen');
  assert.ok(r.json.plantilla.schemas[0].length > 5, 'la descarga lleva el diseño');

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
  assert.deepStrictEqual(r.json, [{ nombre: 'resumen', titulo: 'Resumen de servicios', grupo: '', formatos: ['pdf'], parametros: [] }]);

  // Una app instala sus plantillas de partida con su llave, sin pisar lo retocado.
  const propia = { nombre: 'soporte-parte', titulo: 'Parte', grupo: 'parte', plantilla: diseno, ejemplo };
  r = await pedir('POST', '/api/plantillas', propia);
  assert.strictEqual(r.status, 401, 'instalar sin llave');
  r = await pedir('POST', '/api/plantillas', { ...propia, nombre: 'resumen', sustituir: true }, conLlave);
  assert.strictEqual(r.status, 403, 'solo las que empiezan por su nombre');
  r = await pedir('POST', '/api/plantillas', { ...propia, nombre: 'soportes-x' }, conLlave);
  assert.strictEqual(r.status, 403, 'el nombre de la app entero, con guion');
  r = await pedir('POST', '/api/plantillas', { ...propia, plantilla: { schemas: 'no' } }, conLlave);
  assert.strictEqual(r.status, 400, 'plantilla no válida');
  r = await pedir('POST', '/api/plantillas', { ...propia, origen: { conexion: 'x', consultas: [{ nombre: 'a', sql: 'select 1' }] } }, conLlave);
  assert.deepStrictEqual(r.json, { nombre: 'soporte-parte', estado: 'instalada' }, JSON.stringify(r.json));
  r = await pedir('GET', '/api/admin/plantillas/soporte-parte/fichero');
  assert.strictEqual(r.json.grupo, 'parte');
  assert.strictEqual(r.json.origen.conexion, '', 'la app no pone consultas');
  await pedir('PUT', '/api/admin/plantillas/soporte-parte', { titulo: 'Parte retocado' });
  r = await pedir('POST', '/api/plantillas', propia, conLlave);
  assert.deepStrictEqual(r.json, { nombre: 'soporte-parte', estado: 'ya estaba' });
  assert.strictEqual((await pedir('GET', '/api/admin/plantillas/soporte-parte/fichero')).json.titulo, 'Parte retocado');
  r = await pedir('POST', '/api/plantillas', { ...propia, sustituir: true }, conLlave);
  assert.deepStrictEqual(r.json, { nombre: 'soporte-parte', estado: 'sustituida' });
  assert.strictEqual((await pedir('GET', '/api/admin/plantillas/soporte-parte/fichero')).json.titulo, 'Parte');
  await pedir('DELETE', '/api/admin/plantillas/soporte-parte');

  assert.strictEqual((await pedir('POST', '/api/generar', { plantilla: 'no-existe' }, conLlave)).status, 404);
  assert.strictEqual((await pedir('POST', '/api/generar', { plantilla: 'resumen', formato: 'docx' }, conLlave)).status, 400);
  assert.strictEqual((await pedir('POST', '/api/generar', { plantilla: 'resumen', datos: 'texto' }, conLlave)).status, 400);

  // Lo que entra en cada campo: marcas resueltas, en español, y lo que manda la app tal cual.
  const motor = require('../src/motor');
  await motor.cargar();
  const datos = { ...ejemplo, cliente: { ...ejemplo.cliente, nombre: 'Café <b>& Cía</b> {1+1}' } };
  const { valores } = motor.preparar(diseno, datos);
  assert.strictEqual(valores['linea-documento'], 'Documento: RS-2026-0014   ·   Fecha: 12/10/2026');
  assert.ok(valores['bloque-cliente'].startsWith('Cliente: Café <b>& Cía</b> {1+1} (B00000000)'), valores['bloque-cliente']);
  assert.deepStrictEqual(JSON.parse(valores.lineas)[0], ['21/08/2026', 'Revisión de facturas duplicadas', '1,50', '60,00\u00a0€']);
  assert.strictEqual(JSON.parse(valores.lineas).length, 3);
  assert.strictEqual(valores['linea-total'], 'Total: 6,75 h   ·   270,00\u00a0€');
  assert.strictEqual(motor.preparar(diseno, { ...ejemplo, notas: '' }).valores['linea-notas'], '');
  assert.strictEqual(motor.preparar(diseno, {}).valores.lineas, '[]', 'sin lista, tabla vacía');
  assert.ok(motor.preparar(diseno, {}).valores['linea-documento'].includes('{documento}'), 'lo que falta se ve');
  const editable = { basePdf: diseno.basePdf, schemas: [[{ ...diseno.schemas[0][3], name: 'campo1', readOnly: false, content: 'Hola {cliente.nombre}' }]] };
  assert.strictEqual(motor.preparar(editable, ejemplo).valores.campo1, 'Hola Multiforte SL', 'editable sin dato: lo escrito');
  assert.strictEqual(motor.preparar(editable, { ...ejemplo, campo1: 'Otro {x}' }).valores.campo1, 'Otro {x}', 'editable con dato: el dato');
  const { AYUDAS } = require('../src/ayudas');
  assert.strictEqual(AYUDAS.enEuros(1234.5), '1.234,50\u00a0€');
  assert.strictEqual(AYUDAS.conDecimales(6.75, 1), '6,8');
  assert.strictEqual(AYUDAS.comoFecha('2026-10-12', 'larga'), '12 de octubre de 2026');
  assert.strictEqual(AYUDAS.comoFecha('2026-10-12T16:30:00Z', 'hora'), '12/10/2026, 18:30');
  assert.strictEqual(AYUDAS.siVacio('', 'Sin notas'), 'Sin notas');

  // Generar el PDF.
  r = await pedir('POST', '/api/generar', { plantilla: 'resumen', datos, nombre: 'Resumen: octubre' }, conLlave);
  assert.strictEqual(r.status, 200, r.buf.toString().slice(0, 200));
  assert.strictEqual(r.tipo, 'application/pdf');
  assert.strictEqual(r.buf.subarray(0, 5).toString(), '%PDF-');
  assert.strictEqual(r.disposicion, "attachment; filename*=UTF-8''" + encodeURIComponent('Resumen  octubre.pdf'));
  // Una lista larga sigue en otra página.
  const largas = { ...ejemplo, lineas: Array.from({ length: 80 }, (_, i) => ({ ...ejemplo.lineas[0], concepto: 'Línea ' + i })) };
  r = await pedir('POST', '/api/generar', { plantilla: 'resumen', datos: largas }, conLlave);
  assert.strictEqual(r.status, 200);
  const { PDFDocument } = await import('@pdfme/pdf-lib');
  assert.ok((await PDFDocument.load(r.buf)).getPageCount() >= 2, 'más de una página');

  // La vista previa de la pantalla usa el diseño sin guardar.
  r = await pedir('POST', '/api/admin/probar', { plantilla: 'resumen', datos: ejemplo, diseno: { basePdf: diseno.basePdf, schemas: [[]] } });
  assert.strictEqual(r.status, 200);
  assert.ok(r.buf.length < 5000, 'sin campos, un PDF casi vacío');
  r = await pedir('POST', '/api/admin/probar', { plantilla: 'resumen', datos: ejemplo, diseno: { schemas: 'roto' } });
  assert.strictEqual(r.status, 422);
  r = await pedir('GET', '/api/admin/registro?app=pantalla');
  assert.strictEqual(r.json[0].estado, 'fallido');
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

  // Las de la versión anterior (Word) se ven pero no salen; la de ejemplo se cambia sola.
  const { bd, ahora } = require('../src/bd');
  for (const n of ['ejemplo', 'vieja']) {
    fs.writeFileSync(path.join(process.env.RS_DATOS, 'plantillas', n + '.docx'), 'PK');
    bd.prepare("INSERT INTO plantilla (nombre, titulo, extension, bytes, ejemplo, creada, actualizada) VALUES (?, ?, 'docx', 2, '{}', ?, ?)").run(n, n, ahora(), ahora());
  }
  r = await pedir('POST', '/api/admin/probar', { plantilla: 'vieja' });
  assert.strictEqual(r.status, 422);
  assert.match(r.json.error, /versión anterior/);
  await app.sembrarEjemplo();
  const nuevas = (await pedir('GET', '/api/admin/plantillas')).json;
  assert.strictEqual(nuevas.find(p => p.nombre === 'ejemplo').extension, 'pdfme');
  assert.strictEqual(nuevas.find(p => p.nombre === 'vieja').extension, 'docx');
  assert.ok(!fs.existsSync(path.join(process.env.RS_DATOS, 'plantillas', 'ejemplo.docx')), 'el docx de antes se borra');
  r = await pedir('POST', '/api/admin/probar', { plantilla: 'ejemplo', datos: ejemplo });
  assert.strictEqual(r.status, 200);

  // Solo JSON en la API.
  r = await fetch(url + '/api/generar', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' });
  assert.strictEqual(r.status, 415);

  srv.close();
  console.log('api: bien');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
