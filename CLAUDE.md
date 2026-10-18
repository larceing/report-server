# CLAUDE.md

Report Server: PDF reports for the apps of the DEV/PRO server (larceing/servidor).
Templates are designed in the browser (pdfme Designer); apps POST a template name plus JSON data with
their key and get a PDF back. README.md (Spanish) is the user doc and the API spec.

- Node 22, Express, pdfme 6 (MIT, pinned) for both the designer and generation; no LibreOffice.
  pdfme is ESM: `src/motor.js` loads it with `import()`. Storage is `node:sqlite` in `/datos`:
  template records, keys (sha256 hashes), generation log (no document content), UI sessions.
  Template JSON lives in `/datos/plantillas/<nombre>.json`.
- Data binding (`src/motor.js`): markers are resolved server-side before pdfme sees anything, so app
  data is never evaluated. Read-only text = content with `{expr}`; table = first row holds cell
  markers, repeated per item of the data list named like the table; editable field = data key with
  its name. Spanish formatting helpers in `src/ayudas.js`.
- Databases (`src/conexiones.js`, `src/origen.js`): MariaDB/MySQL connections via mysql2, password
  AES-256-GCM encrypted (`/datos/.clave-conexiones` or `RS_CLAVE`), never returned. A template's
  `origen` = connection + declared parameters + named queries (`:param` → `?`); queries are read-only
  (SELECT/WITH, one statement, inside `START TRANSACTION READ ONLY`). Templates have a `grupo`.
  `tests/bd.js` needs `RS_PRUEBA_BD` for the DB part (CI runs a MariaDB service).
- The designer bundle (`web/disenador.js` → `public/js/disenador.js` + `pdfium.esm.wasm`) is built
  with esbuild (`npm run web`, and in the Dockerfile's first stage); it is not committed.
- The UI is for admins only (IT or `<ENV>/ReportServer/Admin`) via Keycloak (`src/sso.js`, same as
  Mail). Without `AUTH_MODO=sso` it is open only when `NODE_ENV` is not production (local).
- Deployed by the server from the image (`servidor.json`, type `servidor`); `/version/` is what the
  server checks. CI: `.github/workflows/imagen.yml` (PRs build the image and render a real PDF).
- UI text and docs are in Spanish. Tests: `npm test`.
