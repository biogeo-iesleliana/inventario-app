# Lector de etiquetas (OCR)

Esta carpeta contiene el motor que lee el texto de las fotos en «Alta por foto». Todo se ejecuta en el navegador: ni la foto ni el texto salen del dispositivo.

| Contenido | Origen | Licencia |
|---|---|---|
| `lang/spa.traineddata.gz`, `lang/eng.traineddata.gz` | Modelos `tessdata_fast` del proyecto Tesseract (español e inglés), comprimidos | Apache 2.0 |
| `tesseract.min.js`, `worker.min.js`, `core/` | [tesseract.js](https://github.com/naptha/tesseract.js) y tesseract.js-core, descargados de npm | Apache 2.0 |

`tesseract.min.js`, `worker.min.js` y `core/` no se suben a mano: los instala el flujo **Actions → «Instalar el lector de etiquetas (OCR)» → Run workflow**, que deja en `VERSIONES.txt` las versiones y las huellas SHA-256 de cada archivo. Para actualizar el motor, vuelve a ejecutar el mismo flujo.
