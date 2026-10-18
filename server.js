const fs = require('fs');
const path = require('path');
const express = require('express');
const llaves = require('./src/llaves');
const plantillas = require('./src/plantillas');
const { generar, registro } = require('./src/generar');
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

// Las plantillas suben en base64 dentro del JSON; los datos de un documento, hasta 2 MB.
app.use('/api/admin/plantillas', express.json({ limit: '14mb' }));
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
    res.json(plantillas.lista().map(p => ({ nombre: p.nombre, titulo: p.titulo, formatos: p.formatos })));
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
admin.get('/yo', (req, res) => res.json({ usuario: req.usuario, base: req.protocol + '://' + req.get('host') + req.prefijo }));
admin.get('/plantillas', (req, res) => res.json(plantillas.lista()));
admin.post('/plantillas', (req, res) => res.json(plantillas.guardar(req.body || {})));
admin.put('/plantillas/:nombre', (req, res) => res.json(plantillas.editar(req.params.nombre, req.body || {})));
admin.delete('/plantillas/:nombre', (req, res) => { plantillas.borrar(req.params.nombre); res.json({ ok: true }); });
admin.get('/plantillas/:nombre/fichero', (req, res) => {
  const p = plantillas.una(req.params.nombre);
  if (!p) return res.status(404).json({ error: 'No existe esa plantilla.' });
  enviarDocumento(res, { tipo: plantillas.TIPOS[p.extension], fichero: p.nombre + '.' + p.extension, contenido: fs.readFileSync(plantillas.fichero(p)) });
});
admin.post('/probar', async (req, res, next) => {
  try { enviarDocumento(res, await generar('pantalla', req.body || {})); } catch (e) { next(e); }
});
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

// La primera vez, una plantilla de ejemplo para ver cómo funciona.
function sembrarEjemplo() {
  if (plantillas.lista().length) return;
  const dir = path.join(__dirname, 'ejemplos');
  plantillas.guardar({
    nombre: 'ejemplo', titulo: 'Ejemplo: resumen de servicios', fichero: 'ejemplo.docx',
    contenido: fs.readFileSync(path.join(dir, 'ejemplo.docx')).toString('base64'),
    ejemplo: fs.readFileSync(path.join(dir, 'ejemplo.json'), 'utf8')
  });
}

if (require.main === module) {
  sembrarEjemplo();
  const puerto = Number(process.env.PORT) || 3000;
  app.listen(puerto, () => console.log('Report Server escuchando en el puerto ' + puerto));
}

module.exports = app;
