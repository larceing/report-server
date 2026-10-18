// Conexiones a bases de datos (MariaDB / MySQL) de las que leen los informes.
//
// La contraseña se guarda cifrada (AES-256-GCM) con una clave que se crea la
// primera vez en /datos/.clave-conexiones (o RS_CLAVE, 64 hex). Nunca sale
// por la API. Las consultas solo leen: tienen que empezar por SELECT o WITH,
// van en una sola sentencia y dentro de una transacción de solo lectura, así
// que aunque se cuele una escritura, MariaDB la rechaza. Aun así, lo mejor es
// un usuario de la base de datos que solo tenga permiso de lectura.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const { bd, ahora, DATOS } = require('./bd');
const { error } = require('./llaves');

const NOMBRE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const HOST = /^[A-Za-z0-9.-]{1,253}$/;
const MAX_FILAS = 5000;
const ESPERA_MS = 15000;

// ── la clave para cifrar contraseñas ──────────────────────────────────────

let claveCifrado = null;
function clave() {
  if (claveCifrado) return claveCifrado;
  if (/^[0-9a-f]{64}$/i.test(process.env.RS_CLAVE || '')) {
    claveCifrado = Buffer.from(process.env.RS_CLAVE, 'hex');
  } else {
    const f = path.join(DATOS, '.clave-conexiones');
    if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    claveCifrado = Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex');
  }
  return claveCifrado;
}

function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', clave(), iv);
  const dentro = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), dentro].map(b => b.toString('base64')).join('.');
}

function descifrar(guardado) {
  if (!guardado) return '';
  const [iv, etiqueta, dentro] = guardado.split('.').map(p => Buffer.from(p, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', clave(), iv);
  d.setAuthTag(etiqueta);
  return Buffer.concat([d.update(dentro), d.final()]).toString('utf8');
}

// ── las conexiones ────────────────────────────────────────────────────────

const ficha = (f) => f && { nombre: f.nombre, tipo: f.tipo, host: f.host, puerto: f.puerto, usuario: f.usuario, base: f.base,
  conClave: !!f.clave, creada: f.creada, actualizada: f.actualizada };

const lista = () => bd.prepare('SELECT * FROM conexion ORDER BY nombre').all().map(ficha);
const fila = (nombre) => bd.prepare('SELECT * FROM conexion WHERE nombre = ?').get(String(nombre || ''));
const una = (nombre) => ficha(fila(nombre));

const grupos = new Map();
function olvidar(nombre) {
  const g = grupos.get(nombre);
  if (g) g.end().catch(() => {});
  grupos.delete(nombre);
}

// Crear o cambiar. Sin «clave», conserva la que tenía.
function guardar({ nombre, host, puerto, usuario, clave: nueva, base }) {
  nombre = String(nombre || '').trim();
  if (!NOMBRE.test(nombre)) throw error('Nombre: minúsculas, números, guion o guion bajo (erp, soporte-dev…).');
  host = String(host || '').trim();
  if (!HOST.test(host)) throw error('Servidor: un nombre (bd-erp, incidencias-db) o una IP.');
  const p = Number(puerto || 3306);
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw error('Puerto no válido.');
  usuario = String(usuario || '').trim().slice(0, 80);
  if (!usuario) throw error('Falta el usuario de la base de datos.');
  base = String(base || '').trim().slice(0, 64);
  if (!/^[A-Za-z0-9_$-]{1,64}$/.test(base)) throw error('Falta el nombre de la base de datos.');

  const anterior = fila(nombre);
  const cifrada = nueva !== undefined && nueva !== '' ? cifrar(nueva) : anterior ? anterior.clave : '';
  bd.prepare(`INSERT INTO conexion (nombre, tipo, host, puerto, usuario, clave, base, creada, actualizada)
    VALUES (?, 'mariadb', ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (nombre) DO UPDATE SET host = excluded.host, puerto = excluded.puerto, usuario = excluded.usuario,
      clave = excluded.clave, base = excluded.base, actualizada = excluded.actualizada`)
    .run(nombre, host, p, usuario, cifrada, base, ahora(), ahora());
  olvidar(nombre);
  return una(nombre);
}

function borrar(nombre) {
  olvidar(nombre);
  bd.prepare('DELETE FROM conexion WHERE nombre = ?').run(String(nombre || ''));
}

function grupo(nombre) {
  if (grupos.has(nombre)) return grupos.get(nombre);
  const f = fila(nombre);
  if (!f) throw error('No existe la conexión «' + String(nombre || '').slice(0, 40) + '».', 404);
  const g = mysql.createPool({
    host: f.host, port: f.puerto, user: f.usuario, password: descifrar(f.clave), database: f.base,
    connectionLimit: 3, connectTimeout: 8000, dateStrings: true, decimalNumbers: true,
    supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false, timezone: 'Z'
  });
  grupos.set(nombre, g);
  return g;
}

// ── las consultas ─────────────────────────────────────────────────────────

// Quita comentarios y cambia :nombre por ? (fuera de las comillas). Devuelve
// el SQL y el orden de los parámetros.
function traducir(sql) {
  let salida = '';
  const nombres = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < sql.length && sql[j] !== c) j += sql[j] === '\\' ? 2 : 1;
      salida += sql.slice(i, j + 1);
      i = j + 1;
    } else if (c === '-' && sql[i + 1] === '-' || c === '#') {
      while (i < sql.length && sql[i] !== '\n') i++;
      salida += ' ';
    } else if (c === '/' && sql[i + 1] === '*') {
      const fin = sql.indexOf('*/', i + 2);
      i = fin < 0 ? sql.length : fin + 2;
      salida += ' ';
    } else if (c === ':' && /[A-Za-z_]/.test(sql[i + 1] || '') && sql[i - 1] !== ':') {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(i + 1));
      nombres.push(m[0]);
      salida += '?';
      i += 1 + m[0].length;
    } else {
      salida += c;
      i++;
    }
  }
  return { sql: salida.trim().replace(/;\s*$/, '').trim(), nombres };
}

function comprobarLectura(sql) {
  if (!/^(select|with)\b/i.test(sql)) throw error('Una consulta tiene que empezar por SELECT o WITH: los informes solo leen.');
  if (sql.includes(';')) throw error('Una sola sentencia por consulta (sin «;» en medio).');
  if (/\binto\s+(outfile|dumpfile)\b/i.test(sql)) throw error('Las consultas no pueden escribir ficheros.');
}

// Las filas de una consulta, con sus parámetros. Las fechas salen como texto
// ("2026-10-12" o "2026-10-12 18:30:00"), los decimales como números.
async function consultar(nombreConexion, sqlOriginal, parametros) {
  const { sql, nombres } = traducir(String(sqlOriginal || ''));
  comprobarLectura(sql);
  const valores = nombres.map(n => {
    if (!parametros || !Object.prototype.hasOwnProperty.call(parametros, n)) throw error('Falta el parámetro «' + n + '».');
    const v = parametros[n];
    if (v !== null && typeof v === 'object') throw error('El parámetro «' + n + '» tiene que ser un texto o un número.');
    return v;
  });

  const con = await grupo(nombreConexion).getConnection().catch(e => {
    throw error('No se ha podido conectar a «' + nombreConexion + '»: ' + e.message, 502);
  });
  try {
    await con.query('START TRANSACTION READ ONLY');
    const [filas] = await con.query({ sql, values: valores, timeout: ESPERA_MS, rowsAsArray: false });
    if (!Array.isArray(filas)) throw error('La consulta no ha devuelto filas.');
    if (filas.length > MAX_FILAS) throw error('La consulta devuelve más de ' + MAX_FILAS + ' filas: filtra más.');
    return filas.map(f => ({ ...f }));
  } catch (e) {
    if (e.status) throw e;
    throw error('La consulta ha fallado: ' + e.message, 422);
  } finally {
    await con.query('ROLLBACK').catch(() => {});
    con.release();
  }
}

async function probar(nombre) {
  const filas = await consultar(nombre, 'SELECT VERSION() AS version, DATABASE() AS base');
  return filas[0];
}

module.exports = { lista, una, guardar, borrar, consultar, probar, traducir, cifrar, descifrar };
