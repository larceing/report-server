# Report Server

Documentos a partir de plantillas para todas las apps del servidor DEV/PRO, como Crystal Reports
pero con Word: diseñas la plantilla en Word, LibreOffice o Excel, con marcas donde van los datos
(`{d.cliente}`), y las apps mandan los datos y reciben el PDF.

- **Una sola puerta**: `POST /api/generar`, con la llave de la app.
- **Plantillas**: `.docx`, `.odt`, `.xlsx`, `.ods`. Salen en PDF, o en Word, LibreOffice, Excel o CSV.
- **Pantalla** (IT, con Keycloak): subir plantillas, probarlas con datos de ejemplo y ver el PDF,
  registro de lo generado y llaves.

Por dentro: [Carbone](https://carbone.io) 3.8 (Carbone Community License: gratis mientras no se
ofrezca como servicio de generación de documentos a terceros) y LibreOffice sin interfaz para el PDF.

## Cómo genera una app

1. En Report Server → **Llaves**, crea una para la app (`soporte`, `tareas`…). Se ve una sola vez.
2. Ponla en el `app.env` de esa app, en el servidor:
   `/opt/apps/servidor/apps/<app>/<entorno>/app.env` → `REPORT_LLAVE=rs_…` y
   `REPORT_URL=http://report-server-<entorno>:3000` (por dentro, sin salir a internet).
3. La app llama así:

```
curl -X POST "$REPORT_URL/api/generar" \
  -H "Authorization: Bearer $REPORT_LLAVE" -H "Content-Type: application/json" \
  -o resumen.pdf \
  -d '{
    "plantilla": "resumen",
    "formato": "pdf",
    "nombre": "Resumen octubre",
    "datos": { "cliente": { "nombre": "Multiforte SL" }, "lineas": [ { "concepto": "Soporte", "horas": 2 } ], "total": 80 }
  }'
```

Responde con el fichero (`Content-Disposition` con el nombre). `formato` es opcional (el primero
de los que admite la plantilla, normalmente `pdf`). Errores, con `{ "error": "…" }`: `400` (datos
o formato), `401` (llave), `404` (no existe la plantilla), `422` (la plantilla no se ha podido
rellenar; queda en el registro), `429` (más de 60 por minuto).

`GET /api/plantillas` (con la llave) devuelve `[{ nombre, titulo, formatos }]`.

En la pantalla, «Copiar la llamada» da el cuerpo exacto con los datos de ejemplo de la plantilla.

## Cómo se hace una plantilla

Un documento normal, con el diseño que quieras, y marcas donde van los datos:

| Marca | Qué hace |
|---|---|
| `{d.cliente.nombre}` | Un dato de los que manda la app (`d`) |
| `{d.lineas[i].concepto}` en una fila y `{d.lineas[i+1].concepto}` en la de debajo | Repite la fila por cada elemento de la lista |
| `{d.total:formatC(2)}` | Moneda: 1.234,50 € |
| `{d.horas:formatN(2)}` | Número: 6,75 |
| `{d.fecha:formatD('DD/MM/YYYY')}` | Fecha (la app la manda como `2026-10-12`) |
| `{d.notas:ifEmpty('Sin notas')}` | Texto si viene vacío |

Todas en la [documentación de Carbone](https://carbone.io/documentation.html). Escribe cada marca
de una vez para que Word no la parta por dentro. Al arrancar por primera vez, la app trae la
plantilla `ejemplo` (`ejemplos/ejemplo.docx`, un resumen de servicios con la marca).

## Configuración

El servidor pone Keycloak y la dirección pública; no hace falta nada a mano. Los datos (plantillas,
registro, llaves) están en `/datos`, el volumen que da el servidor. El registro guarda qué se generó,
no el documento.

Entra en la pantalla quien está en IT o en `<ENTORNO>/ReportServer/Admin`.

LibreOffice usa unos 300 MB mientras está en marcha; los documentos esperan su turno de uno en uno.
El primero tras arrancar tarda un par de segundos más.

## Desplegar

En Ajustes del servidor: **Añadir una aplicación** `larceing/report-server`, **Poner** en DEV la
versión (`sha-xxxxxxx`, la del último push a `main`), probar en `dev.<dominio>/report-server/`,
**Pasar a PRO**. El paquete de GHCR nace privado: hay que hacerlo público una vez.

## En local

Hace falta LibreOffice para el PDF (sin él, solo sale en el formato de la plantilla).

```
npm install
npm test
RS_DATOS=./datos PATH="$PATH:/usr/lib/libreoffice/program" node server.js   # http://localhost:3000, sin Keycloak
```
