// Lo que se puede usar dentro de una marca para dar formato en español:
// {enEuros(total)}, {conDecimales(horas, 1)}, {comoFecha(dia)}, {comoFecha(dia, 'larga')}…
// Nombres que no suelen chocar con los de los datos (si chocan, gana la ayuda).

const vacio = (v) => v === undefined || v === null || v === '';

function aFecha(v) {
  if (vacio(v)) return null;
  const t = String(v);
  // "2026-10-12" es un día, no un instante: sin zona horaria.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(t) ? new Date(t + 'T12:00:00Z') : new Date(t);
  return isNaN(d) ? null : d;
}

const AYUDAS = {
  enEuros: (v, decimales = 2) => vacio(v) || isNaN(Number(v)) ? '' : new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: 'EUR', useGrouping: 'always',
    minimumFractionDigits: decimales, maximumFractionDigits: decimales
  }).format(Number(v)),
  conDecimales: (v, decimales = 2) => vacio(v) || isNaN(Number(v)) ? '' : new Intl.NumberFormat('es-ES', {
    useGrouping: 'always', minimumFractionDigits: decimales, maximumFractionDigits: decimales
  }).format(Number(v)),
  comoFecha: (v, forma) => {
    const d = aFecha(v);
    if (!d) return vacio(v) ? '' : String(v);
    const opciones = forma === 'larga' ? { day: 'numeric', month: 'long', year: 'numeric' }
      : forma === 'hora' ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { day: '2-digit', month: '2-digit', year: 'numeric' };
    return new Intl.DateTimeFormat('es-ES', { ...opciones, timeZone: 'Europe/Madrid' }).format(d);
  },
  siVacio: (v, otro) => vacio(v) || (Array.isArray(v) && !v.length) ? otro : v,
  hoy: () => new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Madrid' }).format(new Date())
};

module.exports = { AYUDAS };
