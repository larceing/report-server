// El diseñador de plantillas (pdfme, MIT) para la pantalla. Se empaqueta con
// esbuild en public/js/disenador.js (npm run web; en la imagen lo hace el Dockerfile).
import { Designer } from '@pdfme/ui';
import { builtInPlugins, table, image, svg, line, rectangle, ellipse, list, barcodes } from '@pdfme/schemas';

const plugins = { ...builtInPlugins, Tabla: table, Lista: list, Imagen: image, SVG: svg, Línea: line, Rectángulo: rectangle, Elipse: ellipse, QR: barcodes.qrcode, 'Código de barras': barcodes.code128 };

window.RSDisenador = {
  crear(contenedor, plantilla) {
    return new Designer({ domContainer: contenedor, template: plantilla, plugins, options: { lang: 'es', theme: { token: { colorPrimary: '#1d4f7a' } } } });
  }
};
