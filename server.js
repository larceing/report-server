const fs = require('fs');
const path = require('path');
const express = require('express');
const llaves = require('./src/llaves');
const plantillas = require('./src/plantillas');
const { generar, registro } = require('./src/generar');
const conexiones = require('./src/conexiones');
const origenes = require('./src/origen');
const sesion = require('./src/sesion');
const { prefijoDe, conPrefijo } = require('./src/ruta');

const PUBLICO = path.join(__dirname, 'public');
const app = express();

app.disable('x-powered-by');
// Delante van Nginx Proxy Manager y la entrada del entorno.
app.set('trust proxy', Number(process.env.RS_PROXIES) || 2);

// Bajo /report-server/ o en la raíz de un dominio: ver src/ruta.js.
app.use((req, res, next) => {
  req.prefijo = prefijoDe(req);
  const redirigir = res.redirect.bind(res);
  res.redirect = function (status, url) {
    if (url === undefined) { url = status; status = 302; }
    return redirigir(status, conPrefijo(req.prefijo, url));
  };
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
  next();
});

app.get(['/version', '/version/'], (req, res) => res.json({ version: process.env.APP_VERSION || 'local' }));
app.use('/marca', express.static(path.join(PUBLICO, 'marca'), { redirect: false, maxAge: '7d' }));

// Las plantillas (con sus imágenes) llegan desde la pantalla; los datos de un documento, hasta 2 MB.
app.use(['/api/admin/plantillas', '/api/admin/probar'], express.json({ limit: '14mb' }));
app.use('/api/admin/importar', express.json({ limit: '60mb' }));
app.use(express.json({ limit: '2mb' }));
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'DELETE' && !req.is('application/json')) {
    return res.status(415).json({ error: 'Solo JSON.' });
  }
  next();
});

function enviarDocumento(res, doc) {
  res.set({
    'Content-Type': doc.tipo,
    'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(doc.fichero),
    'Cache-Control': 'no-store'
  });
  res.send(doc.contenido);
}

// ── lo que usan las demás apps (con su llave) ──────────────────────────────

app.get('/api/plantillas', (req, res, next) => {
  try {
    llaves.appDe(req);
    // ?grupo=pedido: los informes de un tipo de documento, para que la app deje elegir.
    const grupo = String(req.query.grupo || '').trim().toLowerCase();
    res.json(plantillas.lista().filter(p => p.formatos.length && (!grupo || p.grupo === grupo)).map(p => ({
      nombre: p.nombre, titulo: p.titulo, grupo: p.grupo, formatos: p.formatos, parametros: p.origen.parametros.map(x => x.nombre)
    })));
  } catch (e) { next(e); }
});

app.post('/api/generar', async (req, res, next) => {
  try {
    const appQueLlama = llaves.appDe(req);
    enviarDocumento(res, await generar(appQueLlama, req.body || {}));
  } catch (e) { next(e); }
});

// ── la pantalla (IT, con Keycloak) ─────────────────────────────────────────

app.use('/css', express.static(path.join(PUBLICO, 'css'), { redirect: false }));
app.get('/login', (req, res) => (sesion.usuario(req) ? res.redirect('/') : sesion.irAKeycloak(req, res)));
app.get('/sso', (req, res, next) => sesion.vuelta(req, res).catch(next));

const requiere = (req, res, next) => {
  const u = sesion.usuario(req);
  if (!u) return req.originalUrl.startsWith('/api/')
    ? res.status(401).json({ error: 'Vuelve a entrar.' })
    : res.redirect('/login');
  req.usuario = u;
  next();
};

const admin = express.Router();
const espera = (f) => (req, res, next) => Promise.resolve(f(req, res)).catch(next);
admin.get('/yo', (req, res) => res.json({ usuario: req.usuario, base: req.protocol + '://' + req.get('host') + req.prefijo }));
admin.get('/plantillas', (req, res) => res.json(plantillas.lista()));
admin.post('/plantillas', espera(async (req, res) => {
  const b = req.body || {};
  if (b.plantilla === undefined && plantillas.una(b.nombre)) throw llaves.error('Ya hay una plantilla con ese nombre.', 409);
  res.json(await plantillas.guardar(b));
}));
admin.get('/plantillas/:nombre/diseno', (req, res) => {
  const p = plantillas.una(req.params.nombre);
  if (!p || p.extension !== plantillas.TIPO) return res.status(404).json({ error: 'No existe esa plantilla.' });
  res.set('Cache-Control', 'no-store').json(plantillas.diseno(p));
});
admin.put('/plantillas/:nombre', espera(async (req, res) => res.json(await plantillas.editar(req.params.nombre, req.body || {}))));
admin.delete('/plantillas/:nombre', (req, res) => { plantillas.borrar(req.params.nombre); res.json({ ok: true }); });
admin.get('/plantillas/:nombre/fichero', (req, res) => {
  const p = plantillas.una(req.params.nombre);
  if (!p) return res.status(404).json({ error: 'No existe esa plantilla.' });
  if (p.extension !== plantillas.TIPO) return res.status(404).json({ error: 'Es de la versión anterior: ya no se descarga.' });
  // La plantilla y sus datos de ejemplo, para guardarla o llevarla de DEV a PRO.
  enviarDocumento(res, { tipo: plantillas.TIPOS.json, fichero: p.nombre + '.json', contenido: JSON.stringify(plantillas.exportar(p), null, 2) });
});
// Todas de una vez (para guardarlas en una carpeta o pasarlas a otro entorno) y su vuelta.
admin.get('/exportar', (req, res) => {
  const todas = plantillas.lista().filter(p => p.extension === plantillas.TIPO).map(plantillas.exportar);
  enviarDocumento(res, { tipo: plantillas.TIPOS.json, fichero: 'informes.json', contenido: JSON.stringify({ plantillas: todas }, null, 2) });
});
admin.post('/importar', espera(async (req, res) => {
  const lista = Array.isArray((req.body || {}).plantillas) ? req.body.plantillas : [];
  if (!lista.length) throw llaves.error('No hay plantillas que importar.');
  const hechas = [];
  for (const p of lista) hechas.push((await plantillas.guardar(p)).nombre);
  res.json({ importadas: hechas });
}));

// Conexiones a bases de datos (la contraseña no sale nunca).
admin.get('/conexiones', (req, res) => res.json(conexiones.lista()));
admin.post('/conexiones', (req, res) => res.json(conexiones.guardar(req.body || {})));
admin.delete('/conexiones/:nombre', (req, res) => { conexiones.borrar(req.params.nombre); res.json({ ok: true }); });
admin.post('/conexiones/:nombre/probar', espera(async (req, res) => res.json(await conexiones.probar(req.params.nombre))));
// Lanza las consultas de un informe con parámetros de prueba: lo que verá el diseño.
admin.post('/consultar', espera(async (req, res) => {
  const b = req.body || {};
  const o = origenes.validar(b.origen);
  if (!origenes.conDatos(o)) throw llaves.error('Elige una conexión y escribe al menos una consulta.');
  res.json(await origenes.leer(o, b.parametros || origenes.parametrosPrueba(o)));
}));
admin.post('/probar', espera(async (req, res) => enviarDocumento(res, await generar('pantalla', req.body || {}, true))));
admin.get('/registro', (req, res) => res.json(registro(req.query)));
admin.get('/llaves', (req, res) => res.json(llaves.lista()));
admin.post('/llaves', (req, res) => res.json({ llave: llaves.crear((req.body || {}).app) }));
admin.delete('/llaves/:id', (req, res) => { llaves.revocar(req.params.id); res.json({ ok: true }); });
admin.post('/salir', (req, res) => {
  sesion.cerrar(req, res);
  const sso = require('./src/sso');
  res.json({ salir: sso.activo() ? sso.urlLogout(req) : 'login' });
});
app.use('/api/admin', requiere, admin);

app.use('/js', requiere, express.static(path.join(PUBLICO, 'js'), { redirect: false }));
app.get('/', requiere, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(PUBLICO, 'index.html'));
});

app.use((req, res) => res.status(404).json({ error: 'No encontrado.' }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'El JSON no se entiende.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Demasiado grande.' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Error interno.' : err.message });
});

// La primera vez, una plantilla de ejemplo para ver cómo funciona. Si la que hay
// es la de la versión anterior (Word), se cambia por la nueva.
async function sembrarEjemplo() {
  const ejemplo = plantillas.una('ejemplo');
  if (ejemplo ? ejemplo.extension === plantillas.TIPO : plantillas.lista().length) return;
  const leer = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'ejemplos', f), 'utf8'));
  await plantillas.guardar({ nombre: 'ejemplo', titulo: 'Ejemplo: resumen de servicios', plantilla: leer('plantilla.json'), ejemplo: leer('datos.json') });
}

if (require.main === module) {
  sembrarEjemplo().catch(e => console.error('No se ha podido poner la plantilla de ejemplo: ' + e.message));
  const puerto = Number(process.env.PORT) || 3000;
  app.listen(puerto, () => console.log('Report Server escuchando en el puerto ' + puerto));
}

module.exports = app;
module.exports.sembrarEjemplo = sembrarEjemplo;
