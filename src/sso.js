// Entrada a la pantalla con Keycloak, como las demás apps del servidor DEV/PRO.
// Flujo Authorization Code: /login manda a Keycloak, que vuelve a /sso con un
// code; la app lo cambia por un token y pide /userinfo, las dos cosas directas
// al issuer. El servidor pone en app.env KEYCLOAK_ISSUER, KEYCLOAK_CLIENT_ID,
// KEYCLOAK_CLIENT_SECRET, KEYCLOAK_GRUPO_APP (PRO/ReportServer) y
// KEYCLOAK_GRUPO_ADMIN_GLOBAL (IT).

function activo() {
  return process.env.AUTH_MODO === 'sso' && !!process.env.KEYCLOAK_ISSUER && !!process.env.KEYCLOAK_CLIENT_ID;
}

const issuer = () => String(process.env.KEYCLOAK_ISSUER || '').replace(/\/+$/, '');
const interno = () => String(process.env.KEYCLOAK_INTERNO || process.env.KEYCLOAK_ISSUER || '').replace(/\/+$/, '');
const sinBarras = (g) => String(g || '').trim().replace(/^\/+|\/+$/g, '');

function base(req) {
  return req.protocol + '://' + req.get('host') + (req.prefijo || '');
}

const vuelta = (req) => base(req) + '/sso';

function urlLogin(req, estado) {
  const p = new URLSearchParams({
    client_id: process.env.KEYCLOAK_CLIENT_ID, response_type: 'code', scope: 'openid',
    redirect_uri: vuelta(req), state: estado
  });
  return issuer() + '/protocol/openid-connect/auth?' + p;
}

function urlLogout(req) {
  const p = new URLSearchParams({ client_id: process.env.KEYCLOAK_CLIENT_ID, post_logout_redirect_uri: base(req) + '/' });
  return issuer() + '/protocol/openid-connect/logout?' + p;
}

// La pantalla es de administración: entra IT o <grupo de la app>/Admin.
function esAdmin(grupos) {
  const nombres = new Set((Array.isArray(grupos) ? grupos : []).map(sinBarras));
  const it = sinBarras(process.env.KEYCLOAK_GRUPO_ADMIN_GLOBAL || 'IT');
  const app = sinBarras(process.env.KEYCLOAK_GRUPO_APP);
  return (!!it && nombres.has(it)) || (!!app && nombres.has(app + '/Admin'));
}

// { usuario, admin } o null.
async function completar(req, code) {
  const r = await fetch(interno() + '/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: vuelta(req),
      client_id: process.env.KEYCLOAK_CLIENT_ID, client_secret: process.env.KEYCLOAK_CLIENT_SECRET || ''
    }),
    signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) return null;
  const token = (await r.json()).access_token;
  if (!token) return null;

  const u = await fetch(interno() + '/protocol/openid-connect/userinfo', {
    headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(8000)
  });
  if (!u.ok) return null;
  const d = await u.json();
  if (!d.preferred_username) return null;
  return { usuario: String(d.preferred_username).slice(0, 64), admin: esAdmin(d.groups) };
}

module.exports = { activo, urlLogin, urlLogout, completar, esAdmin };
