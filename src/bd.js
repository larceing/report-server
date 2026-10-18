// Lo que la app guarda: las plantillas (la ficha; el fichero va en
// /datos/plantillas), las llaves de las apps, el registro de lo generado y las
// sesiones de la pantalla. Un fichero SQLite en /datos (el volumen que da el
// servidor DEV/PRO).

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATOS = process.env.RS_DATOS || '/datos';
const PLANTILLAS = path.join(DATOS, 'plantillas');
fs.mkdirSync(PLANTILLAS, { recursive: true });

const bd = new DatabaseSync(path.join(DATOS, 'report-server.db'));
bd.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS plantilla (
    nombre TEXT PRIMARY KEY,
    titulo TEXT NOT NULL,
    extension TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    ejemplo TEXT NOT NULL DEFAULT '{}',
    creada TEXT NOT NULL,
    actualizada TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS llave (
    id INTEGER PRIMARY KEY,
    app TEXT NOT NULL,
    hash TEXT NOT NULL UNIQUE,
    creada TEXT NOT NULL,
    usada TEXT,
    revocada TEXT
  );
  CREATE TABLE IF NOT EXISTS generado (
    id INTEGER PRIMARY KEY,
    app TEXT NOT NULL,
    plantilla TEXT NOT NULL,
    formato TEXT NOT NULL,
    estado TEXT NOT NULL,
    motivo TEXT NOT NULL DEFAULT '',
    bytes INTEGER NOT NULL DEFAULT 0,
    ms INTEGER NOT NULL DEFAULT 0,
    creado TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_generado_creado ON generado (creado);
  CREATE TABLE IF NOT EXISTS sesion (
    token_hash TEXT PRIMARY KEY,
    usuario TEXT NOT NULL,
    caduca TEXT NOT NULL
  );
`);

// Conexiones a bases de datos de las que leen los informes. La contraseña va cifrada (conexiones.js).
bd.exec(`
  CREATE TABLE IF NOT EXISTS conexion (
    nombre TEXT PRIMARY KEY,
    tipo TEXT NOT NULL DEFAULT 'mariadb',
    host TEXT NOT NULL,
    puerto INTEGER NOT NULL DEFAULT 3306,
    usuario TEXT NOT NULL,
    clave TEXT NOT NULL DEFAULT '',
    base TEXT NOT NULL,
    creada TEXT NOT NULL,
    actualizada TEXT NOT NULL
  );
`);

// Columnas que llegaron después: el grupo del informe (pedido, factura…) y de
// dónde saca los datos (conexión, parámetros y consultas).
const columnas = bd.prepare('PRAGMA table_info(plantilla)').all().map(c => c.name);
if (!columnas.includes('grupo')) bd.exec("ALTER TABLE plantilla ADD COLUMN grupo TEXT NOT NULL DEFAULT ''");
if (!columnas.includes('origen')) bd.exec("ALTER TABLE plantilla ADD COLUMN origen TEXT NOT NULL DEFAULT '{}'");

const ahora = () => new Date().toISOString();

module.exports = { bd, ahora, DATOS, PLANTILLAS };
