# Primeros Pasos con VMark

VMark es el espacio de trabajo de texto plano donde personas e IA colaboran. Ambas partes leen y escriben directamente los mismos artefactos — markdown, YAML, JSON, TOML, Mermaid, SVG, HTML, código — sin ninguna capa de traducción de por medio. Cuando el archivo es un artefacto conocido (un flujo de trabajo de GitHub Actions, `Cargo.toml`, `package.json`, `pyproject.toml`), VMark muestra la vista *adecuada*, no un árbol JSON genérico.

Lo que marca la diferencia no es "abrir más tipos de archivo" — cualquier IDE lo hace. Son las **vistas previas conscientes del esquema**: la vista estructurada propia de cada artefacto, acompañada de un panel de código fuente en vivo.

## Inicio Rápido

1. **Descarga e instala** VMark desde la [página de descarga](/es/download)
2. **Inicia la aplicación** y comienza a escribir de inmediato
3. **Abre un archivo** con **Archivo → Abrir archivo…** o arrastra y suelta cualquier [formato compatible](/es/guide/formats) — `Cmd/Ctrl + O` es **Apertura rápida**, para saltar a un archivo reciente, abierto o del espacio de trabajo
4. **Abre una carpeta** con `Cmd/Ctrl + Shift + O` para el modo de espacio de trabajo

## Descripción General de la Interfaz

### Áreas Principales

- **Editor**: El área principal de escritura donde redactas tus documentos
- **Barra lateral**: Navegación del árbol de archivos (activar/desactivar con `Ctrl + Shift + 2`)
- **Esquema**: Vista de la estructura del documento (activar/desactivar con `Ctrl + Shift + 1`)
- **Barra de estado**: Contador de palabras, caracteres y estado del guardado automático (activar/desactivar con `F7`)
- **Terminal**: Panel de shell integrado (activar/desactivar con `` Ctrl + ` ``)

### Barra de Menú

- **Archivo**: Nuevo, Apertura rápida, archivos y espacios de trabajo recientes, historial del documento, guardar, exportar, imprimir, cerrar
- **Editar**: Deshacer/rehacer, portapapeles, buscar (incluido Buscar en archivos), selección, operaciones de línea, finales de línea, Genios
- **Formato**: Estilos de texto, encabezados, listas, citas en bloque, transformaciones de texto, formato CJK, limpieza de texto, limpieza de imágenes
- **Insertar**: Enlaces, imágenes, vídeo, audio, tablas, bloques de código, matemáticas, diagramas, notas al pie, bloques desplegables, cuadros de información
- **Vista**: Modos del editor, paneles, paneles de la barra lateral, modos de enfoque/máquina de escribir, barra de herramientas, terminal, Estado de ventanas, Comprobar Markdown, zoom
- **Ventana** (macOS): Minimizar, Maximizar, Desglose de coherencia, Traer todo al frente
- **Ayuda**: Ayuda de VMark, Atajos de teclado, el comando de shell `vmark` (macOS), Informar de un problema

### Modos de Edición

VMark admite tres modos de edición entre los que puedes alternar:

| Modo | Descripción | Atajo |
|------|-------------|-------|
| Texto Enriquecido | Edición WYSIWYG con formato en vivo | Por defecto |
| Fuente | Markdown sin procesar con resaltado de sintaxis | `F6` |
| Dividido | Código fuente a la izquierda, vista previa en vivo de solo lectura a la derecha | `Shift + F6` |

### Modos de Vista

Mejora tu concentración al escribir con estos modos de vista:

| Modo | Descripción | Atajo |
|------|-------------|-------|
| Enfoque | Resalta el párrafo actual | `F8` |
| Máquina de Escribir | Mantiene el cursor centrado | `F9` |
| Ajuste de Línea | Alterna el ajuste de línea | `Alt + Z` |

## Formato Básico

### Estilos de Texto

| Estilo | Sintaxis | Atajo |
|--------|----------|-------|
| **Negrita** | `**texto**` | `Cmd/Ctrl + B` |
| *Cursiva* | `*texto*` | `Cmd/Ctrl + I` |
| ~~Tachado~~ | `~~texto~~` | `Cmd/Ctrl + Shift + X` |
| `Código` | `` `código` `` | `Cmd/Ctrl + Shift + `` ` `` |

### Elementos de Bloque

- **Encabezados**: Usa símbolos `#` o `Cmd/Ctrl + 1-6`
- **Listas**: Empieza líneas con `-`, `*`, `1.`, o `- [ ]` para listas de tareas
- **Citas**: Empieza con `>` o usa `Alt/Option + Cmd + Q`
- **Bloques de código**: Usa tres comillas invertidas con lenguaje opcional
- **Tablas**: Usa **Insertar → Tabla** o `Cmd/Ctrl + Shift + T`

## Trabajar con Archivos

### Crear y Abrir

- **Nuevo archivo**: `Cmd/Ctrl + N`
- **Abrir archivo**: **Archivo → Abrir archivo…** (sin atajo predeterminado)
- **Apertura rápida**: `Cmd/Ctrl + O` — salta a un archivo reciente, abierto o del espacio de trabajo
- **Abrir carpeta**: `Cmd/Ctrl + Shift + O` (modo de espacio de trabajo)

### Guardar

- **Guardar**: `Cmd/Ctrl + S`
- **Guardar como**: `Cmd/Ctrl + Shift + S`
- **Guardado automático**: Habilitado por defecto, configurable en ajustes

### Exportar

- **Exportar HTML**: **Archivo → Exportar → HTML** — una carpeta con `index.html`, `standalone.html` y el VMark Reader interactivo
- **Exportar PDF**: **Archivo → Exportar → PDF** — configuración de página, fuentes, números de página y un esquema en la barra lateral; o Imprimir (`Cmd/Ctrl + P`) y usar la opción de guardar como PDF del diálogo del sistema
- **Copiar como HTML**: `Cmd/Ctrl + Shift + C`

El HTML exportado incluye VMark Reader con tabla de contenidos, panel de configuración y más. [Más información →](/es/guide/export)

## Configuración

Abre la configuración con `Cmd/Ctrl + ,` para personalizar:

- **Apariencia**: Tema, fuentes, tamaño de fuente, altura de línea
- **Editor**: Intervalo de guardado automático, comportamientos predeterminados
- **Archivos e Imágenes**: Gestión de recursos, herramientas de documentos
- **Integraciones**: Proveedores de IA, servidor MCP
- **Idioma**: Reglas de formato CJK
- **Markdown**: Opciones de exportación, preferencias de formato
- **Atajos**: Personalizar atajos de teclado
- **Terminal**: Tamaño de fuente y altura de línea del terminal

## Asistencia de Escritura con IA

VMark incluye Genios de IA integrados — selecciona texto y pulsa `Mod + Y` para pulir, expandir, traducir o transformar tu escritura con IA. Configura tu proveedor preferido en **Configuración > Integraciones**.

[Más información sobre los Genios de IA →](/es/guide/ai-genies) | [Configurar proveedores →](/es/guide/ai-providers)

## Consejos para Empezar

1. **Navega con el esquema**: Haz clic en los elementos del esquema para saltar a secciones
2. **Prueba el modo enfoque**: `F8` atenúa todo excepto el párrafo actual
3. **Valida mientras escribes**: `Alt + Mod + V` (**Vista → Comprobar Markdown**) ejecuta el motor de lint de markdown y la comprobación de enlaces rotos
4. **Aprende los atajos**: la referencia completa está en la [guía de atajos](/es/guide/shortcuts)

## Próximos Pasos

- Aprende sobre todas las [características](/es/guide/features)
- Domina los [atajos de teclado](/es/guide/shortcuts)
- Explora las herramientas de [formato CJK](/es/guide/cjk-formatting)
