// Sesión de la pantalla (cookie rs_sesion). Sin Keycloak configurado
// (AUTH_MODO distinto de sso) solo se entra fuera de producción: es el modo de
// probar en local.

const crypto = require('crypto');
const { bd, ahora } = require('./bd');
const sso = require('./sso');

const COOKIE = 'rs_sesion';
const COOKIE_SSO = 'rs_sso';
const HORAS = 12;

const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
const local = () => !sso.activo() && process.env.NODE_ENV !== 'production';

function opciones(req, maxAge) {
  return {
    httpOnly: true, sameSite: 'lax', path: (req.prefijo || '') + '/',
    secure: req.protocol === 'https', maxAge
  };
}

function leer(req, nombre) {
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + nombre + '=([A-Za-z0-9_-]+)'));
  return m ? m[1] : '';
}

function usuario(req) {
  if (local()) return 'local';
  const token = leer(req, COOKIE);
  if (!token) return null;
  const fila = bd.prepare('SELECT usuario, caduca FROM sesion WHERE token_hash = ?').get(hash(token));
  if (!fila || fila.caduca < ahora()) return null;
  return fila.usuario;
}

function abrir(req, res, nombre) {
  const token = crypto.randomBytes(32).toString('base64url');
  const caduca = new Date(Date.now() + HORAS * 3600 * 1000).toISOString();
  bd.prepare('DELETE FROM sesion WHERE caduca < ?').run(ahora());
  bd.prepare('INSERT INTO sesion (token_hash, usuario, caduca) VALUES (?, ?, ?)').run(hash(token), nombre, caduca);
  res.cookie(COOKIE, token, opciones(req, HORAS * 3600 * 1000));
}

function cerrar(req, res) {
  const token = leer(req, COOKIE);
  if (token) bd.prepare('DELETE FROM sesion WHERE token_hash = ?').run(hash(token));
  res.clearCookie(COOKIE, { path: (req.prefijo || '') + '/' });
}

function pagina(res, status, titulo, texto, enlace) {
  const esc = (v) => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  res.status(status).type('html').send('<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(titulo) + '</title><link rel="stylesheet" href="css/rs.css"></head><body><main class="aviso"><h1>' + esc(titulo) + '</h1><p>' + esc(texto) + '</p>' +
    (enlace ? '<p><a class="boton" href="' + esc(enlace.url) + '">' + esc(enlace.texto) + '</a></p>' : '') + '</main></body></html>');
}

function irAKeycloak(req, res) {
  if (!sso.activo()) return pagina(res, 503, 'Sin entrada', 'Keycloak no está configurado (AUTH_MODO=sso).');
  const estado = crypto.randomBytes(24).toString('hex');
  res.cookie(COOKIE_SSO, estado, opciones(req, 10 * 60 * 1000));
  res.redirect(sso.urlLogin(req, estado));
}

async function vuelta(req, res) {
  const estado = String(req.query.state || '');
  const guardado = leer(req, COOKIE_SSO);
  res.clearCookie(COOKIE_SSO, { path: (req.prefijo || '') + '/' });
  const otra = { url: 'login', texto: 'Volver a entrar' };

  if (!guardado || !req.query.code || estado.length !== guardado.length ||
      !crypto.timingSafeEqual(Buffer.from(estado), Buffer.from(guardado))) {
    return pagina(res, 400, 'No se ha podido entrar', 'La vuelta de Keycloak no es válida o ha caducado.', otra);
  }
  const p = await sso.completar(req, String(req.query.code)).catch(e => {
    console.error('Keycloak: ' + e.message);
    return null;
  });
  if (!p) return pagina(res, 502, 'No se ha podido entrar', 'Keycloak no ha confirmado la entrada.', otra);
  if (!p.admin) {
    return pagina(res, 403, 'Sin acceso', p.usuario + ' no administra Report Server.', { url: sso.urlLogout(req), texto: 'Entrar con otro usuario' });
  }
  abrir(req, res, p.usuario);
  res.redirect('/');
}

module.exports = { usuario, cerrar, irAKeycloak, vuelta, local };
