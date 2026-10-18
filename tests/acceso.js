// En producción la pantalla no se abre sin Keycloak, y solo entra quien administra.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.RS_DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-'));
process.env.NODE_ENV = 'production';
process.env.KEYCLOAK_GRUPO_APP = 'PRO/ReportServer';
process.env.KEYCLOAK_GRUPO_ADMIN_GLOBAL = 'IT';
const sso = require('../src/sso');

assert.strictEqual(sso.esAdmin(['/IT']), true);
assert.strictEqual(sso.esAdmin(['/PRO/ReportServer/Admin']), true);
assert.strictEqual(sso.esAdmin(['/PRO/ReportServer']), false);
assert.strictEqual(sso.esAdmin(['/DEV/ReportServer/Admin']), false);
assert.strictEqual(sso.esAdmin(undefined), false);

(async () => {
  const app = require('../server');
  const srv = app.listen(0);
  await new Promise(r => srv.on('listening', r));
  const url = 'http://127.0.0.1:' + srv.address().port;

  assert.strictEqual((await fetch(url + '/api/admin/llaves')).status, 401);
  assert.strictEqual((await fetch(url + '/', { redirect: 'manual' })).status, 302);
  assert.strictEqual((await fetch(url + '/js/app.js', { redirect: 'manual' })).status, 302);
  assert.strictEqual((await fetch(url + '/login')).status, 503, 'sin Keycloak configurado no hay entrada');
  assert.strictEqual((await fetch(url + '/sso?code=x&state=y')).status, 400, 'una vuelta sin estado guardado no vale');
  assert.strictEqual((await fetch(url + '/marca/monograma.png')).status, 200, 'el logo es público');

  srv.close();
  console.log('acceso: bien');
})().catch(e => { console.error(e); process.exit(1); });
