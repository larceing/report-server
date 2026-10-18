// Conexiones, consultas con parámetros e informes con datos de una MariaDB.
// Las partes sin base de datos van siempre; las otras, con RS_PRUEBA_BD=host:puerto:usuario:clave:base
// (en CI, un servicio MariaDB). El usuario necesita poder crear tablas en esa base.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.RS_DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-bd-'));

(async () => {
  const conexiones = require('../src/conexiones');
  const origenes = require('../src/origen');

  // ── sin base de datos ───────────────────────────────────────────────────
  let t = conexiones.traducir("SELECT * FROM p WHERE id = :id AND n = ':no' -- y :tampoco\nAND f > :desde /* :ni */;");
  assert.deepStrictEqual(t.nombres, ['id', 'desde']);
  assert.strictEqual(t.sql, "SELECT * FROM p WHERE id = ? AND n = ':no'  \nAND f > ?");
  assert.deepStrictEqual(conexiones.traducir('SELECT CAST(x AS TIME), a::b').nombres, []);

  const cifrada = conexiones.cifrar('secreto');
  assert.ok(!cifrada.includes('secreto'));
  assert.strictEqual(conexiones.descifrar(cifrada), 'secreto');
  assert.ok(fs.existsSync(path.join(process.env.RS_DATOS, '.clave-conexiones')), 'la clave se crea en /datos');

  assert.deepStrictEqual(origenes.validar(undefined), origenes.vacio());
  assert.throws(() => origenes.validar({ consultas: [{ nombre: 'pedido', sql: 'SELECT 1' }] }), /conexión/);
  assert.throws(() => origenes.validar({ conexion: 'erp', consultas: [{ nombre: 'parametros', sql: 'SELECT 1' }] }), /parametros/);
  assert.throws(() => origenes.validar({ conexion: 'erp', consultas: [{ nombre: 'a', sql: 'x' }, { nombre: 'a', sql: 'y' }] }), /mismo nombre/);
  assert.throws(() => origenes.validar({ conexion: 'erp', parametros: [{ nombre: 'id' }, { nombre: 'id' }] }), /repetidos/);
  assert.throws(() => origenes.validar({ conexion: 'Mal Nombre' }), /Conexión/);
  const o = origenes.validar(JSON.stringify({ conexion: 'erp', parametros: [{ nombre: 'id', prueba: 1 }],
    consultas: [{ nombre: 'pedido', una: 1, sql: ' SELECT 1 ' }, { nombre: '', sql: '' }] }));
  assert.deepStrictEqual(o, { conexion: 'erp', parametros: [{ nombre: 'id', prueba: '1' }], consultas: [{ nombre: 'pedido', una: true, sql: 'SELECT 1' }] });
  assert.deepStrictEqual(origenes.parametrosPrueba(o), { id: '1' });

  assert.throws(() => conexiones.guardar({ nombre: 'erp', host: 'a b', usuario: 'u', base: 'b' }), /Servidor/);
  assert.throws(() => conexiones.guardar({ nombre: 'erp', host: 'bd', puerto: 70000, usuario: 'u', base: 'b' }), /Puerto/);
  assert.throws(() => conexiones.guardar({ nombre: 'erp', host: 'bd', usuario: '', base: 'b' }), /usuario/);

  if (!process.env.RS_PRUEBA_BD) {
    console.log('bd: bien (sin MariaDB: pon RS_PRUEBA_BD para probar las consultas)');
    process.exit(0);
  }

  // ── con MariaDB ─────────────────────────────────────────────────────────
  const [host, puerto, usuario, clave, base] = process.env.RS_PRUEBA_BD.split(':');
  const mysql = require('mysql2/promise');
  const directa = await mysql.createConnection({ host, port: Number(puerto), user: usuario, password: clave, database: base, multipleStatements: true });
  await directa.query(`DROP TABLE IF EXISTS rs_linea, rs_pedido;
    CREATE TABLE rs_pedido (id INT PRIMARY KEY, cliente VARCHAR(80), fecha DATE, total DECIMAL(10,2));
    CREATE TABLE rs_linea (id INT AUTO_INCREMENT PRIMARY KEY, pedido_id INT, concepto VARCHAR(80), cantidad INT, importe DECIMAL(10,2));
    INSERT INTO rs_pedido VALUES (1, 'Talleres Pérez', '2026-10-12', 150.50), (2, 'Ana López', '2026-10-15', 20);
    INSERT INTO rs_linea (pedido_id, concepto, cantidad, importe) VALUES (1, 'Tornillos', 100, 50.50), (1, 'Tuercas', 200, 100), (2, 'Arandelas', 10, 20);`);

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
    return { status: r.status, buf, json };
  };

  // La conexión: la contraseña no sale, y sin mandarla se conserva.
  let r = await pedir('POST', '/api/admin/conexiones', { nombre: 'erp', host, puerto, usuario, clave, base });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.conClave, true);
  assert.ok(!JSON.stringify(r.json).includes(clave) && !('clave' in r.json));
  r = await pedir('POST', '/api/admin/conexiones', { nombre: 'erp', host, puerto, usuario, base });
  assert.strictEqual(r.json.conClave, true, 'sin clave conserva la anterior');
  r = await pedir('POST', '/api/admin/conexiones/erp/probar', {});
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.base, base);
  r = await pedir('GET', '/api/admin/conexiones');
  assert.deepStrictEqual(r.json.map(c => c.nombre), ['erp']);
  assert.strictEqual((await pedir('POST', '/api/admin/conexiones/no-existe/probar', {})).status, 404);
  await pedir('POST', '/api/admin/conexiones', { nombre: 'mala', host: '127.0.0.1', puerto: 1, usuario: 'x', base: 'x' });
  r = await pedir('POST', '/api/admin/conexiones/mala/probar', {});
  assert.strictEqual(r.status, 502, 'sin servidor detrás');
  await pedir('DELETE', '/api/admin/conexiones/mala');

  // Solo lectura.
  const consulta = (sql, parametros) => pedir('POST', '/api/admin/consultar', { origen: { conexion: 'erp', consultas: [{ nombre: 'q', sql }] }, parametros });
  for (const sql of ['DELETE FROM rs_pedido', 'SELECT 1; DELETE FROM rs_pedido', "SELECT * FROM rs_pedido INTO OUTFILE '/tmp/x'"]) {
    r = await consulta(sql, {});
    assert.strictEqual(r.status, 400, sql);
  }
  r = await consulta('WITH x AS (SELECT 1 AS a) SELECT a FROM x', {});
  assert.deepStrictEqual(r.json.q, [{ a: 1 }]);
  r = await consulta('SELECT * FROM rs_pedido WHERE id = :id', {});
  assert.strictEqual(r.status, 400, 'falta el parámetro');
  r = await consulta('SELECT * FROM no_existe', {});
  assert.strictEqual(r.status, 422);
  // Un informe de pedido: parámetro id, la cabecera y sus líneas.
  const origen = {
    conexion: 'erp', parametros: [{ nombre: 'id', prueba: '1' }],
    consultas: [
      { nombre: 'pedido', una: true, sql: 'SELECT id, cliente, fecha, total FROM rs_pedido WHERE id = :id' },
      { nombre: 'lineas', sql: 'SELECT concepto, cantidad, importe FROM rs_linea WHERE pedido_id = :id ORDER BY id' }
    ]
  };
  r = await pedir('POST', '/api/admin/consultar', { origen });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual(r.json.parametros, { id: '1' }, 'sin parámetros, los de prueba');
  assert.deepStrictEqual(r.json.pedido, { id: 1, cliente: 'Talleres Pérez', fecha: '2026-10-12', total: 150.5 });
  assert.strictEqual(r.json.lineas.length, 2);

  const tablaEjemplo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'ejemplos', 'plantilla.json'), 'utf8')).schemas[0].find(c => c.type === 'table');
  const diseno = {
    basePdf: { width: 210, height: 297, padding: [15, 15, 15, 15] },
    schemas: [[
      { name: 'cabecera', type: 'text', position: { x: 15, y: 15 }, width: 180, height: 10, readOnly: true,
        content: 'Pedido {pedido.id} · {pedido.cliente} · {comoFecha(pedido.fecha)}' },
      { ...tablaEjemplo, position: { x: 15, y: 30 }, head: ['Concepto', 'Cantidad', 'Importe'], headWidthPercentages: [50, 20, 30],
        content: JSON.stringify([['{concepto}', '{cantidad}', '{enEuros(importe)}']]) }
    ]]
  };
  r = await pedir('POST', '/api/admin/plantillas', { nombre: 'pedido-venta', titulo: 'Pedido de venta', grupo: 'Pedido', plantilla: diseno, origen });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.grupo, 'pedido');
  await pedir('POST', '/api/admin/plantillas', { nombre: 'pedido-compra', titulo: 'Pedido de compra', grupo: 'pedido', plantilla: diseno, origen });
  await pedir('POST', '/api/admin/plantillas', { nombre: 'suelta', plantilla: diseno });
  r = await pedir('POST', '/api/admin/plantillas', { nombre: 'mal-grupo', grupo: 'con espacio', plantilla: diseno });
  assert.strictEqual(r.status, 400);

  // La app: elige del grupo y pide el PDF con el id.
  r = await pedir('POST', '/api/admin/llaves', { app: 'erp' });
  const conLlave = { Authorization: 'Bearer ' + r.json.llave };
  r = await pedir('GET', '/api/plantillas?grupo=pedido', null, conLlave);
  assert.deepStrictEqual(r.json.map(p => [p.nombre, p.parametros]), [['pedido-compra', ['id']], ['pedido-venta', ['id']]]);
  assert.strictEqual((await pedir('GET', '/api/plantillas', null, conLlave)).json.length, 3);

  const motor = require('../src/motor');
  const datos = { ...(await origenes.leer(origenes.validar(origen), { id: 2 })) };
  const { valores } = motor.preparar(diseno, datos);
  assert.strictEqual(valores.cabecera, 'Pedido 2 · Ana López · 15/10/2026');
  assert.deepStrictEqual(JSON.parse(valores.lineas), [['Arandelas', '10', '20,00 €']]);

  r = await pedir('POST', '/api/generar', { plantilla: 'pedido-venta', parametros: { id: 1 } }, conLlave);
  assert.strictEqual(r.status, 200, r.buf.toString().slice(0, 200));
  assert.strictEqual(r.buf.subarray(0, 5).toString(), '%PDF-');
  r = await pedir('POST', '/api/generar', { plantilla: 'pedido-venta' }, conLlave);
  assert.strictEqual(r.status, 400, 'la app tiene que mandar el id');
  assert.match(r.json.error, /parámetro «id»/);
  r = await pedir('POST', '/api/generar', { plantilla: 'pedido-venta', parametros: { id: { mal: 1 } } }, conLlave);
  assert.strictEqual(r.status, 400);
  // La pantalla prueba con los de prueba y con lo que se está editando.
  r = await pedir('POST', '/api/admin/probar', { plantilla: 'pedido-venta', origen: { ...origen, parametros: [{ nombre: 'id', prueba: '2' }] } });
  assert.strictEqual(r.status, 200, r.buf.toString().slice(0, 200));

  // Descargar todas y llevarlas a otro sitio: sin contraseñas.
  r = await pedir('GET', '/api/admin/exportar');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.plantillas.map(p => p.nombre), ['pedido-compra', 'pedido-venta', 'suelta']);
  assert.ok(!r.buf.toString().includes(clave), 'la contraseña no va en el paquete');
  const paquete = r.json;
  for (const p of paquete.plantillas) await pedir('DELETE', '/api/admin/plantillas/' + p.nombre);
  assert.strictEqual((await pedir('POST', '/api/admin/importar', { plantillas: [] })).status, 400);
  r = await pedir('POST', '/api/admin/importar', paquete);
  assert.deepStrictEqual(r.json.importadas, ['pedido-compra', 'pedido-venta', 'suelta']);
  r = await pedir('GET', '/api/admin/plantillas');
  assert.deepStrictEqual(r.json.find(p => p.nombre === 'pedido-venta').origen, origenes.validar(origen));

  await directa.query('DROP TABLE IF EXISTS rs_linea, rs_pedido');
  await directa.end();
  srv.close();
  console.log('bd: bien');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
