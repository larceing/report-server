# CLAUDE.md

Report Server: document generation for the apps of the DEV/PRO server (larceing/servidor).
Apps POST a template name plus JSON data with their key and get a file back (PDF by default).
README.md (Spanish) is the user doc and the API spec.

- Node 22, Express, Carbone 3.8 (pinned) + headless LibreOffice for conversions (in the image;
  Carbone looks for `soffice.bin` on PATH). Storage is `node:sqlite` in `/datos`: template records,
  keys (sha256 hashes), generation log (no document content), UI sessions. Template files live in
  `/datos/plantillas/<nombre>.<ext>`.
- One LibreOffice (`factories: 1`): documents queue instead of using more memory.
- The UI is for admins only (IT or `<ENV>/ReportServer/Admin`) via Keycloak (`src/sso.js`, same as
  Mail). Without `AUTH_MODO=sso` it is open only when `NODE_ENV` is not production (local).
- Deployed by the server from the image (`servidor.json`, type `servidor`); `/version/` is what the
  server checks. CI: `.github/workflows/imagen.yml` (PRs build the image and render a real PDF).
- UI text and docs are in Spanish. Tests: `npm test` (PDF checks run only if LibreOffice is on PATH).
