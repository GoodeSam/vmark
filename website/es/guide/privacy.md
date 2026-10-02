# Privacidad

VMark respeta tu privacidad. Aquí está exactamente lo que ocurre — y lo que no ocurre.

## Qué Envía VMark

VMark incluye un **verificador de actualizaciones automáticas** que periódicamente contacta a nuestro servidor para ver si hay una nueva versión disponible. Esta es la **única** solicitud de red que realiza VMark.

Cada verificación envía exactamente estos campos — nada más:

| Dato | Ejemplo | Propósito |
|------|---------|-----------|
| Dirección IP | `203.0.113.42` | Inherente a cualquier solicitud HTTP — no podemos no recibirla |
| SO | `darwin`, `windows`, `linux` | Para entregar el paquete de actualización correcto |
| Arquitectura | `aarch64`, `x86_64` | Para entregar el paquete de actualización correcto |
| Versión de la app | `0.5.10` | Para determinar si hay una actualización disponible |
| Hash de máquina | `a3f8c2...` (64 caracteres hexadecimales) | Contador anónimo de dispositivos — SHA-256 del nombre de host + SO + arquitectura; no reversible |

La URL completa tiene este aspecto:

```text
GET https://log.vmark.app/update/latest.json?target=darwin&arch=aarch64&version=0.5.10
X-Machine-Id: a3f8c2b1d4e5f6078a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1
```

Puedes verificarlo tú mismo — el endpoint está en [`tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json) (busca `"endpoints"`), y el hash está en [`lib.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/lib.rs) (busca `machine_id_hash`).

## Qué NO Envía VMark

- Tus documentos ni su contenido
- Nombres de archivos o rutas
- Patrones de uso ni análisis de características
- Información personal de ningún tipo
- Informes de errores
- Datos de pulsaciones de teclas o edición
- Identificadores de hardware reversibles o huellas digitales
- El hash de máquina es un resumen SHA-256 unidireccional — no puede revertirse para recuperar tu nombre de host ni ninguna otra entrada

## Cómo Usamos los Datos

Agregamos los registros de verificación de actualizaciones para producir las estadísticas en vivo que se muestran en nuestra [página de inicio](/es/):

| Métrica | Cómo se calcula |
|---------|-----------------|
| **Dispositivos únicos** | Recuento de hashes de máquina distintos por día/semana/mes |
| **IPs únicas** | Recuento de direcciones IP distintas por día/semana/mes |
| **Pings** | Número total de solicitudes de verificación de actualización |
| **Plataformas** | Recuento de pings por combinación de SO + arquitectura |
| **Versiones** | Recuento de pings por versión de la app |

Estos números se publican abiertamente en [`log.vmark.app/api/stats`](https://log.vmark.app/api/stats). Nada está oculto.

**Advertencias importantes:**
- Las IPs únicas subestiman a los usuarios reales — varias personas detrás del mismo router/VPN cuentan como uno
- Los dispositivos únicos proporcionan recuentos más precisos, pero un cambio de nombre de host o una instalación nueva del SO genera un nuevo hash
- Los pings sobreestiman a los usuarios reales — una misma persona puede verificar varias veces al día

## Retención de Datos

- Los registros se almacenan en nuestro servidor en formato estándar de registro de acceso
- Los archivos de registro rotan a 1 MB y solo se conservan los 3 archivos más recientes
- Los registros no se comparten con nadie
- No hay sistema de cuentas — VMark no sabe quién eres
- El hash de máquina no está vinculado a ninguna cuenta, correo electrónico o dirección IP — es únicamente un contador pseudónimo de dispositivos
- No usamos cookies de seguimiento, huellas digitales ni ningún SDK de análisis

## Qué Puede Leer VMark en el Disco

El acceso de VMark a los archivos es un ámbito de permisos acotado, no el disco entero:

- **Ámbito estático**: tu carpeta personal (`$HOME/**`) más los volúmenes montados — `/Volumes/**` en macOS, `/mnt/**` y `/media/**` en Linux. En Windows también abarca las unidades `C:\` a `F:\`, así que solo `G:\` y las unidades posteriores, y las carpetas compartidas de red, necesitan un permiso en tiempo de ejecución. En macOS y Linux, todo lo que está dentro de una carpeta oculta (cuyo nombre empieza por `.`) queda fuera del ámbito estático.
- **Permisos en tiempo de ejecución**: un archivo que abres expresamente — desde Finder o el Explorador de Archivos, la línea de comandos `vmark` o un diálogo de archivos — recibe un permiso solo para ese archivo. Una **carpeta** solo recibe permiso cuando VMark puede saber que la elegiste tú: la seleccionaste en el diálogo de carpetas de VMark o la abriste desde Finder. VMark guarda una lista de esas carpetas (`workspace-grants.json` en su carpeta de datos de la aplicación) y vuelve a concederles permiso en cada inicio, para que tu sesión restaurada y **Abrir espacio de trabajo reciente** sigan funcionando. Un espacio de trabajo reciente que no está en esa lista, y que el ámbito estático no cubre, abre el diálogo de carpetas en esa carpeta — elígela para confirmarlo. Cuando un asistente de IA pide abrir una carpeta así, VMark hace lo mismo después de que apruebes la solicitud.
- **Imágenes y multimedia**: las imágenes, los vídeos y el audio locales se muestran mediante el protocolo de recursos de VMark, que llega a los mismos lugares — el ámbito estático más los permisos en tiempo de ejecución anteriores. El visor multimedia añade un permiso para el único archivo que muestra, y solo si tiene una extensión multimedia; una solicitud para cualquier otra ruta se rechaza en lugar de ampliar el ámbito. Una imagen fuera de esos lugares, como una junto a un documento que abriste por separado desde fuera del ámbito estático, no se muestra hasta que abres su carpeta como espacio de trabajo.

Nada de esto se envía a ningún sitio; el ámbito decide lo que la propia aplicación puede leer.

## Transparencia de Código Abierto

VMark es completamente de código abierto. Puedes verificar todo lo descrito aquí:

- Configuración del endpoint de actualización: [`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json)
- Generación del hash de máquina: [`src-tauri/src/lib.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/lib.rs) — busca `machine_id_hash`
- Ámbito del sistema de archivos y de recursos: [`src-tauri/capabilities/default.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/capabilities/default.json), la entrada `assetProtocol` de [`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json), [`src-tauri/src/fs_scope.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/fs_scope.rs) y [`src-tauri/src/workspace_grants/`](https://github.com/xiaolai/vmark/tree/main/src-tauri/src/workspace_grants)
- Agregación de estadísticas del lado del servidor: [`scripts/vmark-stats-json`](https://github.com/xiaolai/vmark/blob/main/scripts/vmark-stats-json) — el script exacto que se ejecuta en nuestro servidor para producir las [estadísticas públicas](https://log.vmark.app/api/stats)
- No existen otras llamadas de red en el código base — busca `fetch`, `http` o `reqwest` tú mismo

## Deshabilitar las Verificaciones de Actualizaciones

Si prefieres deshabilitar completamente las verificaciones automáticas de actualizaciones, puedes bloquear `log.vmark.app` a nivel de red (cortafuegos, `/etc/hosts` o DNS). VMark continuará funcionando normalmente sin ellas — simplemente no recibirás notificaciones de actualización.

## Informar de un problema de seguridad

Si encuentra una vulnerabilidad en VMark, por ejemplo en el puente MCP, el navegador integrado, el actualizador o el manejo de archivos, comuníquela de forma privada mediante [el informe privado de vulnerabilidades de GitHub](https://github.com/xiaolai/vmark/security/advisories/new) en lugar de abrir una incidencia pública. La [política de seguridad](https://github.com/xiaolai/vmark/blob/main/SECURITY.md) indica qué entra en su alcance y qué puede esperar.
