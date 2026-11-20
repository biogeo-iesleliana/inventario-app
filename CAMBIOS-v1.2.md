# Versión 1.2 — Alta por foto

## Novedad: pestaña «Alta por foto»
- Haces una foto de la etiqueta de un frasco (o eliges varias fotos desde el ordenador) y la app lee el **código del fabricante**, el nombre, el CAS, el lote, la caducidad y el envase.
- Propone el reactivo del catálogo, por este orden: código ya conocido → CAS con dígito de control correcto → nombre aproximado (da igual el orden: «Potasio cloruro»).
- Revisas la ficha, corriges lo que haga falta y confirmas. Los frascos confirmados se van acumulando en una lista que **se guarda en el dispositivo** hasta que la das de alta.
- **Dar de alta en el inventario**: si el reactivo ya está en la misma ubicación y armario, pregunta si sumar los envases o crear líneas nuevas.
- **Exportar CSV**: la misma lista en un archivo que se importa en «Importar» con las columnas reconocidas solas.
- **Aprende**: cada código de fabricante confirmado se guarda en `data/equivalencias.json` (repositorio privado) y la próxima vez ese frasco se reconoce solo. Vienen precargados los 14 códigos identificados en la prueba del 14/11/2026.
- Lector de códigos de barras (GS1: lote y caducidad) en los navegadores que lo admiten, como Chrome en Android.
- Privacidad: la foto se lee en el dispositivo, no se envía a ningún sitio y no se guarda.

## Otros cambios
- «Importar» reconoce también fabricante, código del fabricante, lote, envase, caducidad, armario de seguridad y pictogramas de los reactivos.
- La copia de seguridad incluye las equivalencias.

## Cómo actualizar
1. Sube los cambios al repositorio `inventario-app` (o acepta el *pull request*).
2. **Una sola vez**: pestaña **Actions** → **«Instalar el lector de etiquetas (OCR)»** → **Run workflow**. Descarga Tesseract.js de npm y lo guarda en `vendor/tesseract`. Hasta entonces la pestaña funciona, pero el reactivo hay que buscarlo a mano.
3. Espera unos 10 minutos (caché de GitHub Pages) y recarga con Ctrl+F5. Abajo debe poner «v1.2.0».

No hay que tocar el repositorio de datos: `data/equivalencias.json` se crea solo la primera vez que se da de alta un frasco con un código nuevo.
