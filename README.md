# Report Server

Informes en PDF para todas las apps del servidor DEV/PRO, como Crystal Reports pero en la web y open
source: las plantillas se diseñan en la propia pantalla (arrastrar textos, tablas, imágenes, QR…), se
ven al momento con datos de ejemplo, y las apps mandan sus datos y reciben el PDF.

- **Diseñador en la web**: crear y editar plantillas, con vista previa del PDF.
- **Datos de la base de datos**: una plantilla puede leer de MariaDB/MySQL con sus consultas; la app
  solo manda el id (`{"plantilla": "pedido-venta", "parametros": {"id": 123}}`).
- **Grupos**: varios informes de un mismo documento (pedido de compra, de venta, confirmación…) para
  que la app deje elegir.
- **Una sola puerta para las apps**: `POST /api/generar`, con la llave de cada app.
- **Pantalla** (IT, con Keycloak): plantillas, conexiones, registro de lo generado y llaves.

Por dentro, todo open source: [pdfme](https://pdfme.com) (MIT) para el diseñador y para generar el
PDF, Express y SQLite. Sin LibreOffice: un PDF tarda décimas de segundo.

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
    "nombre": "Resumen octubre",
    "datos": { "cliente": { "nombre": "Multiforte SL" }, "lineas": [ { "concepto": "Soporte", "horas": 2 } ], "total": 80 }
  }'
```

Responde con el PDF (`Content-Disposition` con el nombre). Errores, con `{ "error": "…" }`: `400`
(datos), `401` (llave), `404` (no existe la plantilla), `422` (no se ha podido generar; queda en el
registro), `429` (más de 60 por minuto).

Si la plantilla lee de la base de datos, la app solo manda sus parámetros:

```
-d '{ "plantilla": "pedido-venta", "nombre": "Pedido 123", "parametros": { "id": 123 } }'
```

Lo que mande además en `datos` se suma a lo que sale de las consultas. Sin un parámetro, `400`; si la
base de datos no responde, `502`.

`GET /api/plantillas` (con la llave) devuelve `[{ nombre, titulo, grupo, formatos, parametros }]`;
`GET /api/plantillas?grupo=pedido`, solo las de ese grupo (para ofrecer «Pedido de venta», «Pedido de
compra»… y generar la elegida).

Una app puede **instalar sus plantillas de partida** con su llave, para que nadie tenga que importar
ficheros a mano: `POST /api/plantillas` con `{ nombre, titulo, grupo, plantilla, ejemplo }`. Solo
plantillas cuyo nombre empieza por el de la app de la llave (la llave de `sindri` instala
`sindri-factura`, no `factura`); `403` si no. Si ya existe, no la toca y responde
`{ "nombre": "…", "estado": "ya estaba" }`, así lo retocado en el diseñador se queda; con
`"sustituir": true` la vuelve a dejar como la de partida (`"sustituida"`). Si no existía,
`"instalada"`. Las consultas a bases de datos no se instalan así: solo desde la pantalla.

En la pantalla, «Copiar la llamada» da el cuerpo exacto con los datos de ejemplo de la plantilla.

## Cómo se hace una plantilla

En **Plantillas** → **Crear en blanco** (A4), y en el diseñador se arrastran los elementos a la
página. Los datos entran así:

| Elemento | Cómo recibe los datos |
|---|---|
| Texto | Texto con marcas entre llaves: `Cliente: {cliente.nombre}` |
| Tabla | Se llama como la lista de los datos (`lineas`). Su primera fila lleva la marca de cada columna (`{concepto}`, `{enEuros(importe)}`) y se repite por cada elemento; si no cabe, sigue en otra página |
| Imagen, QR… | Fijo (un logo), o «Editable» y con el nombre del dato que lo trae |

Formato en español dentro de las marcas:

| Marca | Sale |
|---|---|
| `{enEuros(total)}` | 1.234,50 € |
| `{conDecimales(horas)}`, `{conDecimales(horas, 1)}` | 6,75 · 6,8 |
| `{comoFecha(fecha)}`, `{comoFecha(fecha, 'larga')}`, `{comoFecha(creada, 'hora')}` | 12/10/2026 · 12 de octubre de 2026 · 12/10/2026, 18:30 |
| `{siVacio(notas, 'Sin notas')}` | Otro texto si viene vacío |
| `{hoy()}` | La fecha del día |
| `{lineas.length}`, `{horas * 40}`, `{pagado ? 'Pagado' : 'Pendiente'}` | Cuentas y condiciones sencillas |

Si una marca no se puede resolver (un dato que no viene), sale tal cual, entre llaves. Lo que manda
la app nunca se interpreta como marca. Ojo con los nombres de los elementos de texto: si uno se llama
como un dato (`cliente`), el diseñador lo confunde al dibujarlo; mejor `bloque-cliente`.

## Informes con datos de la base de datos

1. **Conexiones** → nombre (`erp`), servidor (el nombre del contenedor en la red del servidor, como
   `incidencias-db`, o una IP), puerto, usuario, contraseña y base. **Probar** dice si responde. La
   contraseña se guarda cifrada (AES-256-GCM, con la clave de `/datos/.clave-conexiones` o `RS_CLAVE`)
   y no sale nunca por la API.
2. En el editor de la plantilla, **De dónde salen los datos**: el grupo, la conexión, los parámetros
   (`id`, con un valor de prueba) y las consultas:

| Consulta | «una fila» | En el diseño |
|---|---|---|
| `pedido`: `SELECT numero, cliente, fecha, total FROM pedidos WHERE id = :id` | sí | `{pedido.cliente}`, `{enEuros(pedido.total)}` |
| `lineas`: `SELECT concepto, cantidad, importe FROM lineas_pedido WHERE pedido_id = :id` | no | la tabla que se llama `lineas` |

3. **Probar consultas** enseña lo que sale con los valores de prueba; **Vista previa** ya genera el
   PDF con esos datos.

Las consultas solo leen: tienen que empezar por `SELECT` o `WITH`, una sentencia, sin `INTO OUTFILE`,
y van dentro de una transacción de solo lectura. Como mucho 10 por plantilla, 5000 filas y 15 s cada
una. Aun así, mejor un usuario de la base de datos con permiso solo de lectura. Las fechas salen como
texto (`2026-10-12`), listas para `comoFecha`.

## Llevarlas a otro sitio

Una app puede enlazar directamente a una plantilla: `<dirección del Report Server>/#editar=<nombre>`
abre el diseñador con ella (si ya hay sesión).

**Descargar** da una plantilla (diseño, grupo, consultas y datos de ejemplo) en un `.json`; **Descargar
todas** da todas en `informes.json`, para guardarlas en una carpeta o pasarlas de DEV a PRO.
**Importar .json** acepta los dos. Las conexiones no viajan (llevan contraseña): en el otro entorno hay
que crear una con el mismo nombre. Al arrancar por primera vez, la app trae la plantilla
`ejemplo` (`ejemplos/plantilla.json` y `ejemplos/datos.json`).

## Configuración

El servidor pone Keycloak y la dirección pública; no hace falta nada a mano. Los datos (plantillas,
conexiones, registro, llaves) están en `/datos`, el volumen que da el servidor. El registro guarda qué se generó,
no el documento.

Entra en la pantalla quien está en IT o en `<ENTORNO>/ReportServer/Admin`.

Las plantillas de la primera versión (Word, con Carbone) siguen en la lista pero ya no salen: hay que
rehacerlas en el diseñador. La de ejemplo se cambia sola.

## Desplegar

En Ajustes del servidor: **Añadir una aplicación** `larceing/report-server`, **Poner** en DEV la
versión (`sha-xxxxxxx`, la del último push a `main`), probar en `dev.<dominio>/report-server/`,
**Pasar a PRO**. El paquete de GHCR nace privado: hay que hacerlo público una vez.

## En local

```
npm install
npm run web    # empaqueta el diseñador en public/js
npm test       # con RS_PRUEBA_BD=host:puerto:usuario:clave:base prueba también las consultas
RS_DATOS=./datos node server.js   # http://localhost:3000, sin Keycloak
```
