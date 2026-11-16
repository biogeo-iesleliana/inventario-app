# Inventario del Departamento de Biología y Geología

Aplicación web del inventario de material, equipos, reactivos y colecciones del Departamento de Biología y Geología del IES L'Eliana.

- **Este repositorio es público y no contiene datos.** Solo tiene el código de la app, que se publica con GitHub Pages.
- Los datos están en el repositorio privado `biogeo-iesleliana/inventario-datos`.
- Para entrar hace falta la contraseña del departamento. Con ella se descifra en el navegador un token de GitHub limitado al repositorio de datos (`config.json`).

## Archivos
| Archivo | Para qué sirve |
|---|---|
| `index.html` | Página de la app |
| `css/app.css` | Estilos |
| `js/app.js` | Arranque, acceso, inventario, fichas y avisos |
| `js/core.js` | Núcleo: cifrado, API de GitHub, guardado con reintento, diálogos y reglas del inventario |
| `js/vistas.js` | Catálogo de reactivos, importación (PDF, CSV, lista), listados y ajustes |
| `js/xlsx-mini.js` | Generador de archivos Excel propio (sin librerías externas) |
| `js/pdf-import.js` | Lectura local de PDF y reconstrucción de las columnas |
| `vendor/` | PDF.js (Mozilla, licencia Apache 2.0). Solo se carga al importar un PDF |
| `config.json` | Organización, repositorio de datos, token cifrado y fecha de caducidad. Se genera desde «Configurar el acceso» |
| `.nojekyll` | Indica a GitHub Pages que publique los archivos tal cual |

La app no carga nada de terceros: solo sus propios archivos y la API de GitHub (lo impone la política de seguridad de `index.html`).

## Cambiar la contraseña o renovar el token
1. Entra en la app y ve a **Ajustes → Configurar el acceso** (o abre la app con `#configurar` al final de la dirección).
2. Pega el token nuevo y escribe la contraseña (nueva o la misma).
3. Sustituye el contenido de `config.json` en este repositorio por el que genera la app.
4. Si el token antiguo pudo filtrarse, revócalo en GitHub (**Settings → Developer settings → Personal access tokens**).
