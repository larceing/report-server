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

function llamada(nombre, datos, parametros) {
  const cuerpo = parametros && Object.keys(parametros).length
    ? { plantilla: nombre, nombre: 'Documento', parametros }
    : { plantilla: nombre, nombre: 'Documento', datos };
  return 'POST ' + base + '/api/generar\n' +
    'Authorization: Bearer $REPORT_LLAVE\nContent-Type: application/json\n\n' + JSON.stringify(cuerpo, null, 2);
}

// ── pestañas ──────────────────────────────────────────────────────────────

const cargas = { plantillas: cargarPlantillas, registro: cargarRegistro, conexiones: cargarConexiones, llaves: cargarLlaves, ayuda: async () => {} };

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
  // Por grupos (pedido, factura…); las sueltas al final.
  let grupo = null;
  const conGrupos = lista.some(p => p.grupo);
  lista.forEach(p => {
    if (conGrupos && p.grupo !== grupo) {
      grupo = p.grupo;
      const h = document.createElement('div');
      h.className = 'grupo-titulo';
      h.textContent = grupo || 'Sin grupo';
      caja.append(h);
    }
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
  $('grupos').replaceChildren(...[...new Set(lista.map(p => p.grupo).filter(Boolean))].map(g => new Option(g)));
  return lista;
}

async function abrir(p) {
  if (cambios && actual && actual.nombre !== p.nombre && !confirm('Hay cambios sin guardar en «' + actual.nombre + '». ¿Salir sin guardarlos?')) return;
  actual = p;
  marcarCambios(false);
  document.querySelectorAll('.tarjeta').forEach(t => t.classList.toggle('activa', t.dataset.nombre === p.nombre));
  $('editor').classList.remove('hidden');
  document.querySelector('main').classList.add('ancho');
  $('eNombre').textContent = p.nombre;
  $('eTitulo').value = p.titulo;
  $('eEjemplo').value = JSON.stringify(p.ejemplo, null, 2);
  limpiarResultado();
  const nueva = p.formatos.length > 0;
  $('eAntigua').classList.toggle('hidden', nueva);
  $('eDatos').classList.toggle('hidden', !nueva);
  ['eGuardar', 'eCompleta', 'eVer', 'eCopiar', 'eDescargar'].forEach(id => { $(id).disabled = !nueva; });
  if (nueva) await ponerOrigen(p).catch(e => aviso(e.message));
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

// ── de dónde salen los datos: grupo, conexión, parámetros y consultas ──────

function quitar(boton, fila) {
  boton.addEventListener('click', () => { fila.remove(); marcarCambios(true); });
}

function filaParametro(prm) {
  const fila = document.createElement('div');
  fila.className = 'parametro';
  const nombre = Object.assign(document.createElement('input'), { placeholder: 'nombre (id)', value: prm.nombre || '' });
  nombre.className = 'p-nombre';
  const prueba = Object.assign(document.createElement('input'), { placeholder: 'valor de prueba (1)', value: prm.prueba || '' });
  prueba.className = 'p-prueba';
  const b = Object.assign(document.createElement('button'), { textContent: 'Quitar', className: 'enlace' });
  quitar(b, fila);
  fila.append(nombre, prueba, b);
  $('eParametros').append(fila);
}

function filaConsulta(c) {
  const fila = document.createElement('div');
  fila.className = 'consulta';
  const nombre = Object.assign(document.createElement('input'), { placeholder: 'nombre (pedido, lineas…)', value: c.nombre || '' });
  nombre.className = 'c-nombre';
  const una = document.createElement('label');
  una.className = 'una';
  una.title = 'Una sola fila: se usa como {pedido.cliente}. Sin marcar, una lista para una tabla.';
  const caja = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!c.una });
  caja.className = 'c-una';
  una.append(caja, 'una fila');
  const sql = Object.assign(document.createElement('textarea'), { placeholder: 'SELECT … FROM … WHERE id = :id', value: c.sql || '', spellcheck: false });
  sql.className = 'c-sql';
  const b = Object.assign(document.createElement('button'), { textContent: 'Quitar', className: 'enlace' });
  quitar(b, fila);
  fila.append(nombre, una, sql, b);
  $('eConsultas').append(fila);
}

function verConDatos() {
  $('eConDatos').classList.toggle('hidden', !$('eConexion').value);
  $('eProbarConsultas').classList.toggle('hidden', !$('eConexion').value);
}

async function ponerOrigen(p) {
  const o = p.origen || {};
  $('eGrupo').value = p.grupo || '';
  const lista = await api('GET', '/conexiones');
  const sel = $('eConexion');
  sel.replaceChildren(new Option('Ninguna: los datos los manda la app', ''), ...lista.map(c => new Option(c.nombre + ' (' + c.host + ' · ' + c.base + ')', c.nombre)));
  if (o.conexion && !lista.some(c => c.nombre === o.conexion)) sel.add(new Option(o.conexion + ' (no existe en este entorno)', o.conexion));
  sel.value = o.conexion || '';
  $('eParametros').replaceChildren();
  $('eConsultas').replaceChildren();
  (o.parametros || []).forEach(filaParametro);
  (o.consultas || []).forEach(filaConsulta);
  $('eResultado').classList.add('hidden');
  $('eConsultaError').classList.add('hidden');
  verConDatos();
}

function origenEscrito() {
  const conexion = $('eConexion').value;
  if (!conexion) return { conexion: '', parametros: [], consultas: [] };
  return {
    conexion,
    parametros: [...document.querySelectorAll('#eParametros .parametro')].map(f => ({
      nombre: f.querySelector('.p-nombre').value.trim(), prueba: f.querySelector('.p-prueba').value
    })),
    consultas: [...document.querySelectorAll('#eConsultas .consulta')].map(f => ({
      nombre: f.querySelector('.c-nombre').value.trim(), una: f.querySelector('.c-una').checked, sql: f.querySelector('.c-sql').value
    }))
  };
}

const parametrosPrueba = (o) => Object.fromEntries(o.parametros.filter(x => x.nombre).map(x => [x.nombre, x.prueba]));

$('eConexion').addEventListener('change', () => {
  verConDatos();
  if ($('eConexion').value && !document.querySelector('#eConsultas .consulta')) {
    filaParametro({ nombre: 'id', prueba: '1' });
    filaConsulta({ nombre: 'pedido', una: true, sql: '' });
  }
  marcarCambios(true);
});
$('eMasParametro').addEventListener('click', () => { filaParametro({}); marcarCambios(true); });
$('eMasConsulta').addEventListener('click', () => { filaConsulta({}); marcarCambios(true); });
$('eDatos').addEventListener('input', () => marcarCambios(true));

$('eProbarConsultas').addEventListener('click', async () => {
  const b = $('eProbarConsultas');
  b.disabled = true;
  $('eConsultaError').classList.add('hidden');
  try {
    const o = origenEscrito();
    const datos = await api('POST', '/consultar', { origen: o, parametros: parametrosPrueba(o) });
    $('eResultado').textContent = JSON.stringify(datos, null, 2);
    $('eResultado').classList.remove('hidden');
  } catch (e) {
    $('eResultado').classList.add('hidden');
    $('eConsultaError').textContent = e.message;
    $('eConsultaError').classList.remove('hidden');
  } finally {
    b.disabled = false;
  }
});

// Pantalla completa: el diseñador ocupa toda la ventana; la vista previa se abre en otra pestaña.
function pantallaCompleta(si) {
  $('editor').classList.toggle('completa', si);
  document.body.classList.toggle('sin-scroll', si);
  $('eCompleta').textContent = si ? 'Salir de pantalla completa' : 'Pantalla completa';
  // El diseñador se recoloca con el nuevo tamaño.
  window.dispatchEvent(new Event('resize'));
}
const enCompleta = () => $('editor').classList.contains('completa');

$('eCompleta').addEventListener('click', () => pantallaCompleta(!enCompleta()));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && enCompleta()) pantallaCompleta(false); });

function cerrar() {
  pantallaCompleta(false);
  actual = null;
  marcarCambios(false);
  if (disenador) { disenador.destroy(); disenador = null; }
  $('editor').classList.add('hidden');
  document.querySelector('main').classList.remove('ancho');
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

// Importa lo que da «Descargar» ({ nombre, titulo, grupo, origen, ejemplo, plantilla })
// o «Descargar todas» ({ plantillas: [...] }).
$('nFichero').addEventListener('change', async () => {
  const f = $('nFichero').files[0];
  $('nFichero').value = '';
  if (!f) return;
  try {
    let j;
    try { j = JSON.parse(await leerTexto(f)); } catch (e) { throw new Error('El fichero no es JSON.'); }
    if (j && Array.isArray(j.plantillas)) {
      const repetidas = j.plantillas.map(p => p.nombre).filter(plantillasConNombre);
      const pregunta = 'Importar ' + j.plantillas.length + ' plantillas' + (repetidas.length ? '; se sustituyen las que ya hay: ' + repetidas.join(', ') : '') + '. ¿Seguir?';
      if (!confirm(pregunta)) return;
      const r = await api('POST', '/importar', j);
      aviso('Importadas: ' + r.importadas.join(', '), true);
      await cargarPlantillas();
      return;
    }
    if (j && j.schemas) j = { plantilla: j };
    const nombre = $('nNombre').value.trim() || j.nombre || f.name.replace(/\.json$/i, '').toLowerCase();
    if (plantillasConNombre(nombre) && !confirm('Ya hay una plantilla «' + nombre + '». ¿Sustituirla?')) return;
    await crear({ nombre, titulo: $('nTitulo').value.trim() || j.titulo, plantilla: j.plantilla, ejemplo: j.ejemplo, grupo: j.grupo, origen: j.origen });
    $('nNombre').value = '';
    $('nTitulo').value = '';
  } catch (e) { aviso(e.message); }
});

const plantillasConNombre = (nombre) => [...document.querySelectorAll('.tarjeta')].some(t => t.dataset.nombre === nombre);

async function guardar() {
  if (!actual || !disenador) return;
  try {
    const p = await api('PUT', '/plantillas/' + encodeURIComponent(actual.nombre), {
      titulo: $('eTitulo').value, ejemplo: ejemploEscrito(), plantilla: disenador.getTemplate(),
      grupo: $('eGrupo').value, origen: origenEscrito()
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

$('descargarTodas').addEventListener('click', () => { location.href = 'api/admin/exportar'; });

$('eDescargar').addEventListener('click', () => {
  location.href = 'api/admin/plantillas/' + encodeURIComponent(actual.nombre) + '/fichero';
});

$('eCopiar').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(llamada(actual.nombre, ejemploEscrito(), parametrosPrueba(origenEscrito())));
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
      body: JSON.stringify({
        plantilla: actual.nombre, datos: ejemploEscrito(), diseno: disenador ? disenador.getTemplate() : undefined,
        origen: origenEscrito(), parametros: parametrosPrueba(origenEscrito())
      })
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
    if (enCompleta()) window.open(urlResultado, '_blank');
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

// ── conexiones ────────────────────────────────────────────────────────────

const campoConexion = { nombre: 'cNombre', host: 'cHost', puerto: 'cPuerto', usuario: 'cUsuario', base: 'cBase' };

async function cargarConexiones() {
  const lista = await api('GET', '/conexiones');
  const cuerpo = $('listaConexiones');
  cuerpo.replaceChildren();
  lista.forEach(c => {
    const tr = document.createElement('tr');
    celda(tr, c.nombre);
    celda(tr, c.host + ':' + c.puerto);
    celda(tr, c.usuario + (c.conClave ? '' : ' (sin contraseña)'));
    celda(tr, c.base);
    const td = celda(tr, '');
    const probar = Object.assign(document.createElement('button'), { textContent: 'Probar' });
    probar.addEventListener('click', async (e) => {
      e.stopPropagation();
      probar.disabled = true;
      try {
        const r = await api('POST', '/conexiones/' + encodeURIComponent(c.nombre) + '/probar', {});
        aviso('«' + c.nombre + '» responde: ' + r.version + ', base ' + r.base + '.', true);
      } catch (err) { aviso(err.message); } finally { probar.disabled = false; }
    });
    const borrar = Object.assign(document.createElement('button'), { textContent: 'Borrar', className: 'peligro' });
    borrar.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('¿Borrar la conexión «' + c.nombre + '»? Los informes que lean de ella dejarán de salir.')) return;
      try { await api('DELETE', '/conexiones/' + encodeURIComponent(c.nombre)); cargarConexiones(); } catch (err) { aviso(err.message); }
    });
    td.append(probar, ' ', borrar);
    tr.addEventListener('click', () => {
      for (const [k, id] of Object.entries(campoConexion)) $(id).value = c[k];
      $('cClave').value = '';
      $('cClave').placeholder = c.conClave ? 'contraseña (vacía: se queda la que tiene)' : 'contraseña';
    });
    cuerpo.append(tr);
  });
  if (!lista.length) {
    const tr = document.createElement('tr');
    celda(tr, 'Todavía no hay conexiones.').colSpan = 5;
    cuerpo.append(tr);
  }
}

$('cGuardar').addEventListener('click', async () => {
  try {
    const cuerpo = Object.fromEntries(Object.entries(campoConexion).map(([k, id]) => [k, $(id).value.trim()]));
    cuerpo.clave = $('cClave').value;
    const c = await api('POST', '/conexiones', cuerpo);
    Object.values(campoConexion).forEach(id => { $(id).value = id === 'cPuerto' ? '3306' : ''; });
    $('cClave').value = '';
    $('cClave').placeholder = 'contraseña';
    aviso('Conexión «' + c.nombre + '» guardada.', true);
    await cargarConexiones();
  } catch (e) { aviso(e.message); }
});

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
