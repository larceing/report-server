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

function leerFichero(fichero) {
  return new Promise((ok, mal) => {
    const lector = new FileReader();
    lector.onload = () => ok(String(lector.result).split(',')[1] || '');
    lector.onerror = () => mal(new Error('No se ha podido leer el fichero.'));
    lector.readAsDataURL(fichero);
  });
}

function llamada(nombre, formato, datos) {
  return 'POST ' + base + '/api/generar\n' +
    'Authorization: Bearer $REPORT_LLAVE\nContent-Type: application/json\n\n' +
    JSON.stringify({ plantilla: nombre, formato: formato, nombre: 'Documento', datos: datos }, null, 2);
}

// ── pestañas ──────────────────────────────────────────────────────────────

const cargas = { plantillas: cargarPlantillas, registro: cargarRegistro, llaves: cargarLlaves, ayuda: async () => {} };

document.querySelectorAll('#pestanas button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#pestanas button').forEach(x => x.classList.toggle('activa', x === b));
  document.querySelectorAll('main > section').forEach(s => s.classList.toggle('hidden', s.id !== 'p-' + b.dataset.p));
  cargas[b.dataset.p]().catch(e => aviso(e.message));
}));

// ── plantillas ────────────────────────────────────────────────────────────

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
    d.textContent = p.nombre + ' · .' + p.extension + ' · sale en ' + p.formatos.join(', ') + ' · ' + fecha(p.actualizada);
    t.append(h, d);
    t.addEventListener('click', () => abrir(p));
    caja.append(t);
  });
  if (actual) {
    const sigue = lista.find(p => p.nombre === actual.nombre);
    if (sigue) abrir(sigue, true); else cerrar();
  }
}

function abrir(p, mantenerResultado) {
  actual = p;
  document.querySelectorAll('.tarjeta').forEach(t => t.classList.toggle('activa', t.dataset.nombre === p.nombre));
  $('editor').classList.remove('hidden');
  $('eNombre').textContent = p.nombre + ' (.' + p.extension + ')';
  $('eTitulo').value = p.titulo;
  $('eEjemplo').value = JSON.stringify(p.ejemplo, null, 2);
  const sel = $('eFormato');
  sel.replaceChildren(...p.formatos.map(f => new Option(f.toUpperCase(), f)));
  if (!mantenerResultado) limpiarResultado();
}

function cerrar() {
  actual = null;
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
  $('rInfo').textContent = 'Pulsa «Generar» para verlo con los datos de ejemplo.';
}

function ejemploEscrito() {
  try { return JSON.parse($('eEjemplo').value || '{}'); } catch (e) { throw new Error('Los datos de ejemplo no son JSON válido: ' + e.message); }
}

$('subir').addEventListener('click', async () => {
  const f = $('sFichero').files[0];
  if (!f) return aviso('Elige el fichero de la plantilla.');
  try {
    const p = await api('POST', '/plantillas', {
      nombre: $('sNombre').value.trim(), titulo: $('sTitulo').value.trim(), fichero: f.name, contenido: await leerFichero(f)
    });
    $('sNombre').value = '';
    $('sTitulo').value = '';
    $('sFichero').value = '';
    aviso('Plantilla «' + p.nombre + '» guardada.', true);
    actual = p;
    await cargarPlantillas();
    abrir(p);
  } catch (e) { aviso(e.message); }
});

$('eGuardar').addEventListener('click', async () => {
  try {
    const p = await api('PUT', '/plantillas/' + actual.nombre, { titulo: $('eTitulo').value, ejemplo: ejemploEscrito() });
    actual = p;
    aviso('Guardado.', true);
    await cargarPlantillas();
  } catch (e) { aviso(e.message); }
});

$('eBorrar').addEventListener('click', async () => {
  if (!confirm('¿Borrar la plantilla «' + actual.nombre + '»? Las apps que la usen dejarán de poder generarla.')) return;
  try {
    await api('DELETE', '/plantillas/' + actual.nombre);
    cerrar();
    await cargarPlantillas();
  } catch (e) { aviso(e.message); }
});

$('eDescargar').addEventListener('click', () => {
  location.href = 'api/admin/plantillas/' + encodeURIComponent(actual.nombre) + '/fichero';
});

$('eCopiar').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(llamada(actual.nombre, $('eFormato').value, ejemploEscrito()));
    aviso('Copiado.', true);
  } catch (e) { aviso(e.message); }
});

$('eGenerar').addEventListener('click', async () => {
  const boton = $('eGenerar');
  boton.disabled = true;
  $('rError').classList.add('hidden');
  $('rInfo').classList.remove('hidden');
  $('rInfo').textContent = 'Generando… (el primero tarda unos segundos)';
  try {
    const formato = $('eFormato').value;
    const inicio = Date.now();
    const r = await fetch('api/admin/probar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plantilla: actual.nombre, formato: formato, datos: ejemploEscrito() })
    });
    if (r.status === 401) { location.href = 'login'; return; }
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Error ' + r.status);
    const blob = await r.blob();
    limpiarResultado();
    urlResultado = URL.createObjectURL(blob);
    const enlace = $('rDescargar');
    enlace.href = urlResultado;
    enlace.download = actual.nombre + '.' + formato;
    enlace.classList.remove('hidden');
    $('rInfo').textContent = formato.toUpperCase() + ' · ' + tamano(blob.size) + ' · ' + ((Date.now() - inicio) / 1000).toFixed(1) + ' s' +
      (formato === 'pdf' ? '' : ' · descárgalo para verlo');
    if (formato === 'pdf') {
      $('rVista').src = urlResultado;
      $('rVista').classList.remove('hidden');
    }
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
    $('ejemploLlamada').textContent = llamada('ejemplo', 'pdf', { cliente: { nombre: 'Multiforte SL' }, total: 270 });
    await cargarPlantillas();
  } catch (e) { aviso(e.message); }
})();
