// Llaves de las apps. Cada app que genera documentos llama con la suya
// (Authorization: Bearer rs_…); aquí solo se guarda su sha256.

const crypto = require('crypto');
const { bd, ahora } = require('./bd');

const POR_MINUTO = 60;

function error(mensaje, status) {
  return Object.assign(new Error(mensaje), { status: status || 400 });
}

const hash = (llave) => crypto.createHash('sha256').update(llave).digest('hex');

function crear(app) {
  app = String(app || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,39}$/.test(app)) throw error('Nombre de app: minúsculas, números, punto o guion (como su ruta: soporte, tareas…).');
  const llave = 'rs_' + crypto.randomBytes(24).toString('base64url');
  bd.prepare('INSERT INTO llave (app, hash, creada) VALUES (?, ?, ?)').run(app, hash(llave), ahora());
  return llave;
}

const lista = () => bd.prepare('SELECT id, app, creada, usada, revocada FROM llave ORDER BY revocada IS NOT NULL, app, id').all();

function revocar(id) {
  bd.prepare('UPDATE llave SET revocada = ? WHERE id = ? AND revocada IS NULL').run(ahora(), Number(id));
}

const ventanas = new Map();

// La app que llama, según su llave. Como mucho POR_MINUTO documentos por minuto.
function appDe(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(rs_[A-Za-z0-9_-]{20,})$/);
  if (!m) throw error('Falta la llave (Authorization: Bearer rs_…).', 401);
  const fila = bd.prepare('SELECT id, app FROM llave WHERE hash = ? AND revocada IS NULL').get(hash(m[1]));
  if (!fila) throw error('Llave no válida o revocada.', 401);

  const minuto = Math.floor(Date.now() / 60000);
  const v = ventanas.get(fila.id);
  const usados = v && v.minuto === minuto ? v.usados + 1 : 1;
  ventanas.set(fila.id, { minuto, usados });
  if (usados > POR_MINUTO) throw error('Demasiados documentos seguidos: espera un minuto.', 429);

  bd.prepare('UPDATE llave SET usada = ? WHERE id = ?').run(ahora(), fila.id);
  return fila.app;
}

module.exports = { crear, lista, revocar, appDe, error };
