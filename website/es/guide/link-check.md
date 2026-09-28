# Comprobación de Enlaces

VMark verifica que los destinos locales de enlaces e imágenes en tu markdown existan realmente en disco. Se ejecuta junto al [motor de lint de markdown](/es/guide/lint) con `Alt + Mod + V` o **Vista → Comprobar Markdown**.

## Qué comprueba

Para cada enlace e imagen local en el documento:

- `[text](./other.md)` — el archivo `./other.md` se resuelve y existe
- `![alt](./image.png)` — el archivo de imagen existe
- `[text](./other.md#section)` — el archivo existe (la comprobación del ancla la maneja la [regla `linkFragments`](/es/guide/lint#referencia-de-reglas))

Cuando un destino falta, aparece una entrada en la insignia de lint y en la navegación con `F2` / `Shift + F2`. Cómo se dibuja depende del modo: en modo Fuente el enlace recibe el subrayado rojo de diagnóstico de CodeMirror; en modo WYSIWYG todo el bloque que contiene el enlace se marca con una barra roja a lo largo de su borde izquierdo y un tinte tenue — las marcas de lint en WYSIWYG son de nivel de bloque, nunca un subrayado en línea.

## Qué omite

- **Enlaces solo de fragmento** (`#anchor`) — los maneja la regla `linkFragments`, que comprueba contra los encabezados del documento actual
- **URLs externas** — cualquier esquema de URI (`http:`, `https:`, `mailto:`, `obsidian:`, `vscode:`, …) y las URLs relativas al protocolo `//host/…`. Las rutas de Windows con letra de unidad (`C:\…`, `C:/…`) sí se comprueban como rutas de archivo
- **Documentos sin título** — sin una ruta de archivo guardada, las URLs relativas no se pueden resolver contra ningún directorio
- **Rutas de red y rutas relativas a una unidad** — una ruta UNC (`\\server\share\…`) nunca se consulta, porque comprobarla en Windows contactaría con ese host a través de la red (y podría ofrecerle tus credenciales de inicio de sesión de Windows). También se omite una ruta `C:file.md` relativa a una unidad (una letra de unidad sin barra detrás): es relativa al directorio de trabajo de la aplicación, no al documento

## Cómo funciona la resolución

La Comprobación de Enlaces resuelve una ruta relativa respecto al directorio del archivo de origen, y toma una ruta absoluta como el archivo que nombra:

| Enlace en `/repo/docs/intro.md` | Se resuelve a |
|---|---|
| `[a](./other.md)` | `/repo/docs/other.md` |
| `[a](../shared.md)` | `/repo/shared.md` |
| `[a](images/logo.png)` | `/repo/docs/images/logo.png` |
| `[a](/docs/intro.md)` | `/docs/intro.md` (una ruta absoluta nombra ese archivo; en Windows se sitúa en la propia unidad del documento) |

Los fragmentos se eliminan antes de la búsqueda del archivo — `[a](./other.md#section)` solo comprueba `./other.md`.

## Rendimiento

- **Asíncrono** — se ejecuta en paralelo con las reglas síncronas; los resultados se fusionan cuando están listos
- **Deduplicado** — cada ruta única resuelta se comprueba una vez por ejecución, incluso si está enlazada varias veces
- **Sin activación por pulsación de tecla** — `fs.exists` en cada pulsación saturaría el sistema; solo se ejecuta con el activador explícito de lint
- **Tolerancia a errores operativos** — si `fs.exists` lanza una excepción (permiso denegado, problema de alcance de capacidad), el resultado es `error` (omitido), no `missing`. Mejor silencioso que erróneo.

## Códigos de diagnóstico

| Código | Severidad | Activador |
|---|---|---|
| **M001** | Error | Archivo de imagen no encontrado en la ruta local resuelta |
| **M002** | Error | Archivo enlazado no encontrado en la ruta local resuelta |

## Ver también

- [Lint de Markdown](/es/guide/lint) — referencia completa de reglas
- [Configuración → Markdown → Lint](/es/guide/settings#lint)
