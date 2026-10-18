'use strict';

const $ = (id) => document.getElementById(id);
let base = '';
let actual = null;
let urlResultado = null;

async function api(metodo, ruta, cuerpo) {
  const r = await fetch('api/admin' + ruta, {
    method: metodo,
    headers: cuerpo ? { 'Content-Type': 'application/json' } : {},
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  if (r.status === 401) { location.href = 'login'; throw new Error('Vuelve a entrar.'); }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error || 'Error ' + r.status);
  return datos;
}

function aviso(texto, ok) {
  const a = $('aviso');
  a.textContent = texto;
  a.classList.toggle('ok', !!ok);
  a.classList.toggle('hidden', !texto);
  if (texto) setTimeout(() => { if (a.textContent === texto) a.classList.add('hidden'); }, 6000);
}

const fecha = (iso) => iso ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const tamano = (b) => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

function celda(fila, texto, clase) {
  const td = document.createElement('td');
  td.textContent = texto;
  if (clase) td.className = clase;
  fila.appendChild(td);
  return td;
}

function leerTexto(fichero) {
  return new Promise((ok, mal) => {
    const lector = new FileReader();
    lector.onload = () => ok(String(lector.result));
    lector.onerror = () => mal(new Error('No se ha podido leer el fichero.'));
    lector.readAsText(fichero);
  });
}

function llamada(nombre, datos) {
  return 'POST ' + base + '/api/generar\n' +
    'Authorization: Bearer $REPORT_LLAVE\nContent-Type: application/json\n\n' +
    JSON.stringify({ plantilla: nombre, nombre: 'Documento', datos: datos }, null, 2);
}

// ── pestañas ──────────────────────────────────────────────────────────────

const cargas = { plantillas: cargarPlantillas, registro: cargarRegistro, llaves: cargarLlaves, ayuda: async () => {} };

document.querySelectorAll('#pestanas button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#pestanas button').forEach(x => x.classList.toggle('activa', x === b));
  document.querySelectorAll('main > section').forEach(s => s.classList.toggle('hidden', s.id !== 'p-' + b.dataset.p));
  cargas[b.dataset.p]().catch(e => aviso(e.message));
}));

// ── plantillas ────────────────────────────────────────────────────────────

let disenador = null;
let cambios = false;

function marcarCambios(si) {
  cambios = si;
  $('eCambios').classList.toggle('hidden', !si);
}

window.addEventListener('beforeunload', (e) => { if (cambios) e.preventDefault(); });

// El diseñador pesa: se carga la primera vez que se abre una plantilla.
let cargaDisenador = null;
function cargarDisenador() {
  if (!cargaDisenador) {
    cargaDisenador = new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.type = 'module';
      s.src = 'js/disenador.js';
      s.onload = () => ok(window.RSDisenador);
      s.onerror = () => { cargaDisenador = null; mal(new Error('No se ha podido cargar el diseñador.')); };
      document.head.appendChild(s);
    });
  }
  return cargaDisenador;
}

async function cargarPlantillas() {
  const lista = await api('GET', '/plantillas');
  const caja = $('listaPlantillas');
  caja.replaceChildren();
  if (!lista.length) {
    const p = document.createElement('p');
    p.className = 'suave';
    p.textContent = 'Todavía no hay plantillas.';
    caja.append(p);
  }
  lista.forEach(p => {
    const t = document.createElement('div');
    t.className = 'tarjeta' + (actual && actual.nombre === p.nombre ? ' activa' : '');
    t.dataset.nombre = p.nombre;
    const h = document.createElement('h3');
    h.textContent = p.titulo;
    const d = document.createElement('p');
    d.className = 'suave';
    d.textContent = p.nombre + ' · ' + (p.formatos.length ? tamano(p.bytes) : 'versión anterior') + ' · ' + fecha(p.actualizada);
    t.append(h, d);
    t.addEventListener('click', () => abrir(p).catch(e => aviso(e.message)));
    caja.append(t);
  });
  return lista;
}

async function abrir(p) {
  if (cambios && actual && actual.nombre !== p.nombre && !confirm('Hay cambios sin guardar en «' + actual.nombre + '». ¿Salir sin guardarlos?')) return;
  actual = p;
  marcarCambios(false);
  document.querySelectorAll('.tarjeta').forEach(t => t.classList.toggle('activa', t.dataset.nombre === p.nombre));
  $('editor').classList.remove('hidden');
  $('eNombre').textContent = p.nombre;
  $('eTitulo').value = p.titulo;
  $('eEjemplo').value = JSON.stringify(p.ejemplo, null, 2);
  limpiarResultado();
  const nueva = p.formatos.length > 0;
  $('eAntigua').classList.toggle('hidden', nueva);
  ['eGuardar', 'eVer', 'eCopiar', 'eDescargar'].forEach(id => { $(id).disabled = !nueva; });
  if (disenador) { disenador.destroy(); disenador = null; }
  $('lienzo').replaceChildren();
  if (!nueva) return;

  $('eCargando').classList.remove('hidden');
  try {
    const [rs, diseno] = await Promise.all([cargarDisenador(), api('GET', '/plantillas/' + encodeURIComponent(p.nombre) + '/diseno')]);
    if (actual !== p) return;
    disenador = rs.crear($('lienzo'), diseno);
    // Al abrirlo, el diseñador completa la plantilla y avisa de un cambio que no lo es.
    let inicial = null;
    setTimeout(() => { if (disenador) inicial = JSON.stringify(disenador.getTemplate()); }, 300);
    disenador.onChangeTemplate((t) => { if (inicial !== null && JSON.stringify(t) !== inicial) marcarCambios(true); });
    disenador.onSaveTemplate(() => guardar());
  } finally {
    $('eCargando').classList.add('hidden');
  }
}

function cerrar() {
  actual = null;
  marcarCambios(false);
  if (disenador) { disenador.destroy(); disenador = null; }
  $('editor').classList.add('hidden');
}

function limpiarResultado() {
  if (urlResultado) URL.revokeObjectURL(urlResultado);
  urlResultado = null;
  $('rVista').classList.add('hidden');
  $('rVista').removeAttribute('src');
  $('rDescargar').classList.add('hidden');
  $('rError').classList.add('hidden');
  $('rInfo').classList.remove('hidden');
  $('rInfo').textContent = 'Pulsa «Vista previa» para verla con los datos de ejemplo.';
}

function ejemploEscrito() {
  try { return JSON.parse($('eEjemplo').value || '{}'); } catch (e) { throw new Error('Los datos de ejemplo no son JSON válido: ' + e.message); }
}

async function crear(cuerpo) {
  const p = await api('POST', '/plantillas', cuerpo);
  aviso('Plantilla «' + p.nombre + '» guardada.', true);
  marcarCambios(false);
  await cargarPlantillas();
  await abrir(p);
}

$('crear').addEventListener('click', () => {
  crear({ nombre: $('nNombre').value.trim(), titulo: $('nTitulo').value.trim(), ejemplo: {} })
    .then(() => { $('nNombre').value = ''; $('nTitulo').value = ''; })
    .catch(e => aviso(e.message));
});

// Importa lo que da «Descargar»: { nombre, titulo, ejemplo, plantilla }.
$('nFichero').addEventListener('change', async () => {
  const f = $('nFichero').files[0];
  $('nFichero').value = '';
  if (!f) return;
  try {
    let j;
    try { j = JSON.parse(await leerTexto(f)); } catch (e) { throw new Error('El fichero no es JSON.'); }
    if (j && j.schemas) j = { plantilla: j };
    const nombre = $('nNombre').value.trim() || j.nombre || f.name.replace(/\.json$/i, '').toLowerCase();
    if (plantillasConNombre(nombre) && !confirm('Ya hay una plantilla «' + nombre + '». ¿Sustituirla?')) return;
    await crear({ nombre, titulo: $('nTitulo').value.trim() || j.titulo, plantilla: j.plantilla, ejemplo: j.ejemplo });
    $('nNombre').value = '';
    $('nTitulo').value = '';
  } catch (e) { aviso(e.message); }
});

const plantillasConNombre = (nombre) => [...document.querySelectorAll('.tarjeta')].some(t => t.dataset.nombre === nombre);

async function guardar() {
  if (!actual || !disenador) return;
  try {
    const p = await api('PUT', '/plantillas/' + encodeURIComponent(actual.nombre), {
      titulo: $('eTitulo').value, ejemplo: ejemploEscrito(), plantilla: disenador.getTemplate()
    });
    actual = p;
    marcarCambios(false);
    aviso('Guardada.', true);
    await cargarPlantillas();
  } catch (e) { aviso(e.message); }
}

$('eGuardar').addEventListener('click', guardar);
$('eTitulo').addEventListener('input', () => marcarCambios(true));
$('eEjemplo').addEventListener('input', () => marcarCambios(true));
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && actual && disenador) { e.preventDefault(); guardar(); }
});

$('eBorrar').addEventListener('click', async () => {
  if (!confirm('¿Borrar la plantilla «' + actual.nombre + '»? Las apps que la usen dejarán de poder generarla.')) return;
  try {
    await api('DELETE', '/plantillas/' + encodeURIComponent(actual.nombre));
    cerrar();
    await cargarPlantillas();
  } catch (e) { aviso(e.message); }
});

$('eDescargar').addEventListener('click', () => {
  location.href = 'api/admin/plantillas/' + encodeURIComponent(actual.nombre) + '/fichero';
});

$('eCopiar').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(llamada(actual.nombre, ejemploEscrito()));
    aviso('Copiado.', true);
  } catch (e) { aviso(e.message); }
});

$('eVer').addEventListener('click', async () => {
  const boton = $('eVer');
  boton.disabled = true;
  $('rError').classList.add('hidden');
  $('rInfo').classList.remove('hidden');
  $('rInfo').textContent = 'Generando…';
  try {
    const inicio = Date.now();
    const r = await fetch('api/admin/probar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plantilla: actual.nombre, datos: ejemploEscrito(), diseno: disenador ? disenador.getTemplate() : undefined })
    });
    if (r.status === 401) { location.href = 'login'; return; }
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Error ' + r.status);
    const blob = await r.blob();
    limpiarResultado();
    urlResultado = URL.createObjectURL(blob);
    const enlace = $('rDescargar');
    enlace.href = urlResultado;
    enlace.download = actual.nombre + '.pdf';
    enlace.classList.remove('hidden');
    $('rInfo').textContent = 'PDF · ' + tamano(blob.size) + ' · ' + ((Date.now() - inicio) / 1000).toFixed(1) + ' s';
    $('rVista').src = urlResultado;
    $('rVista').classList.remove('hidden');
  } catch (e) {
    $('rInfo').classList.add('hidden');
    $('rError').textContent = e.message;
    $('rError').classList.remove('hidden');
  } finally {
    boton.disabled = false;
  }
});

// ── registro ──────────────────────────────────────────────────────────────

async function cargarRegistro() {
  const filas = await api('GET', '/registro?' + new URLSearchParams({ app: $('filtroApp').value }));
  const cuerpo = $('listaRegistro');
  cuerpo.replaceChildren();
  filas.forEach(g => {
    const tr = document.createElement('tr');
    celda(tr, fecha(g.creado));
    celda(tr, g.app);
    celda(tr, g.plantilla);
    celda(tr, g.formato.toUpperCase());
    celda(tr, g.bytes ? tamano(g.bytes) : '—');
    celda(tr, (g.ms / 1000).toFixed(1) + ' s');
    celda(tr, g.estado === 'generado' ? 'Generado' : 'Falló: ' + g.motivo, 'estado-' + g.estado);
    cuerpo.append(tr);
  });
  if (!filas.length) {
    const tr = document.createElement('tr');
    celda(tr, 'Todavía no se ha generado nada.').colSpan = 7;
    cuerpo.append(tr);
  }
  const sel = $('filtroApp');
  [...new Set(filas.map(f => f.app))].filter(a => ![...sel.options].some(o => o.value === a)).forEach(a => sel.add(new Option(a, a)));
}

$('filtroApp').addEventListener('change', () => cargarRegistro().catch(e => aviso(e.message)));

// ── llaves ────────────────────────────────────────────────────────────────

async function cargarLlaves() {
  const lista = await api('GET', '/llaves');
  const cuerpo = $('listaLlaves');
  cuerpo.replaceChildren();
  lista.forEach(l => {
    const tr = document.createElement('tr');
    celda(tr, l.app);
    celda(tr, fecha(l.creada));
    celda(tr, l.revocada ? 'Revocada ' + fecha(l.revocada) : fecha(l.usada));
    const td = celda(tr, '');
    if (!l.revocada) {
      const b = document.createElement('button');
      b.className = 'peligro';
      b.textContent = 'Revocar';
      b.addEventListener('click', async () => {
        if (!confirm('¿Revocar la llave de ' + l.app + '? Esa app dejará de poder generar documentos.')) return;
        try { await api('DELETE', '/llaves/' + l.id); cargarLlaves(); } catch (e) { aviso(e.message); }
      });
      td.append(b);
    }
    cuerpo.append(tr);
  });
}

$('crearLlave').addEventListener('click', async () => {
  try {
    const r = await api('POST', '/llaves', { app: $('lApp').value });
    $('llaveNueva').textContent = 'REPORT_LLAVE=' + r.llave + '   (cópiala ahora: no se vuelve a mostrar)';
    $('llaveNueva').classList.remove('hidden');
    $('lApp').value = '';
    cargarLlaves();
  } catch (e) { aviso(e.message); }
});

// ── inicio ────────────────────────────────────────────────────────────────

$('salir').addEventListener('click', async () => {
  const r = await api('POST', '/salir', {}).catch(() => ({ salir: 'login' }));
  location.href = r.salir;
});

(async () => {
  try {
    const yo = await api('GET', '/yo');
    base = yo.base;
    $('yo').textContent = yo.usuario;
    $('ejemploLlamada').textContent = llamada('ejemplo', { cliente: { nombre: 'Multiforte SL' }, total: 270 });
    const lista = await cargarPlantillas();
    if (lista.length === 1) await abrir(lista[0]);
  } catch (e) { aviso(e.message); }
})();
