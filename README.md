# Echo · Repaso espaciado para oposiciones

**Echo** es una PWA personal para preparar oposiciones con un sistema de arrastre basado en repaso espaciado. Planifica cada tema en cascada hasta la fecha del examen, evita la sobrecarga con un máximo de 3 temas al día y te muestra el calendario, el historial y las señales de constancia en una interfaz editorial, rápida y offline-first.

Está pensada para ejecutarse en **Home Assistant OS** sobre una Raspberry Pi, como **add-on local** o como **contenedor Docker** con un volumen persistente. Todos los datos viven en un único archivo SQLite que puedes copiar y restaurar fácilmente.

![Icono de Echo](logo.png)

---

## Características

- **Calendario navegable** con vistas mensual, semanal y diaria.
- **Registro de estudio** con temas pendientes de hoy, temas atrasados de días anteriores o un identificador libre.
- **Cadencia automática** de repaso: `3 → 7 → 14 → 21 → 30 → cada 30 días`.
- **Proyección en cascada** de todos los repasos futuros hasta la fecha del examen.
- **Gestión de colisiones** con máximo de **3 temas por día**:
  - repasos de 3 y 7 días buscan hueco hacia delante;
  - repasos de 14, 21 y 30+ días buscan hueco hacia atrás;
  - si no hay hueco en la dirección preferente, se busca en ambas direcciones.
- **Confirmación de ajustes**: cualquier movimiento por exceso de carga se muestra en un modal antes de guardarse.
- **Recálculo de cadencia**: al mover un repaso, todos los posteriores de ese tema se recalculan manteniendo los intervalos.
- **Historial por tema** con número de repasos, fechas, intervalos y comentarios; buscador y ordenación.
- **Deshacer un estudio** registrado por error: el repaso vuelve a estar pendiente y la cadena se recalcula sola.
- **Eliminar repasos**: si un repaso se creó por error, puedes borrarlo desde la vista diaria con confirmación.
- **Vista móvil específica**: calendario con números grandes y puntos de carga (sin texto microscópico), semana en lista vertical y agenda táctil.
- **Cierre de sesión** disponible en la barra superior para cualquier perfil.
- **Señales de constancia** con emojis en el calendario:
  - ❤️ el día que se recibe una señal;
  - 😢 a los 7 días sin señal;
  - 😭 a los 14 días;
  - 💔 a los 21 días y un corazón roto adicional cada 5 días;
  - solo se muestra la **siguiente** marca, y únicamente **dos días antes** de su fecha;
  - sin leyenda ni pistas: no se anuncia qué icono saldrá ni cuándo.
- **Dos perfiles con PIN**: usuario normal (calendario, estudio y fecha del examen) y administración (ajustes, señales y API).
- **Planificación manual**: reserva un repaso en cualquier día futuro sin registrar un estudio.
- **API externa** `POST /api/signal` protegida con token, ideal para automatizaciones de Home Assistant.
- **Exportación** a JSON y CSV, y vista de impresión limpia para PDF.
- **Restauración y reset** desde Ajustes: recupera una copia (JSON o CSV) o empieza de cero sin tocar el servidor.
- **Acceso con PIN** y cookie de sesión firmada (30 días).
- **PWA instalable** con service worker y lectura offline de los últimos datos.
- **HTTPS opcional**: sirve Echo por TLS reutilizando el certificado de DuckDNS/Let's Encrypt de Home Assistant.

---

## Stack

| Capa | Tecnología |
| --- | --- |
| Frontend | HTML5, CSS3 propio (design system editorial), JavaScript vanilla |
| Backend | Node.js 22 + Express 5 |
| Base de datos | SQLite con `better-sqlite3` |
| PWA | `manifest.json` + service worker |
| Despliegue | Docker multi-arquitectura (`amd64`, `arm64`) y add-on de Home Assistant |
| Tipografías | Instrument Serif + Inter, servidas localmente (sin CDN) |

No hay build de frontend: el servidor sirve los archivos estáticos de `public/`. Esto simplifica el despliegue en la Raspberry Pi y permite que todo funcione sin conexión.

---

## Inicio rápido con Docker Compose

```bash
git clone https://github.com/stugemusa/echo.git
cd echo
cp .env.example .env
# Edita .env: cambia APP_PIN, define ADMIN_PIN, API_TOKEN y SESSION_SECRET
docker compose up -d --build
```

Abre `http://IP_DE_TU_RASPBERRY:3000` e introduce el PIN definido en `APP_PIN`.

La base de datos se guarda en `./data/echo.db` (volumen persistente). Para hacer una copia de seguridad manual basta con copiar esa carpeta:

```bash
tar -czf echo-backup-$(date +%F).tar.gz data/
```

### Variables de entorno

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `APP_PIN` | `1234` | PIN del **usuario normal**: calendario, estudio, historial y fecha del examen. **Cámbialo.** |
| `ADMIN_PIN` | vacío | PIN de **administración**: añade ajustes, señales y API. Si lo dejas vacío, `APP_PIN` actúa como administrador. |
| `API_TOKEN` | vacío | Token de `POST /api/signal`. Si está vacío, la API externa queda desactivada. |
| `SESSION_SECRET` | autogenerado | Secreto para firmar la cookie. Si se omite, se genera y guarda en SQLite. |
| `DB_PATH` | `/data/echo.db` en Docker | Ruta del archivo SQLite. |
| `PORT` | `3000` | Puerto HTTP (o HTTPS) del servidor. |
| `SSL` | `false` | Sirve HTTPS en lugar de HTTP. |
| `CERTFILE` | `/ssl/fullchain.pem` | Certificado TLS (PEM). Acepta ruta absoluta o relativa a `/ssl`. |
| `KEYFILE` | `/ssl/privkey.pem` | Clave privada TLS (PEM). Acepta ruta absoluta o relativa a `/ssl`. |
| `TZ` | `Europe/Madrid` | Zona horaria del contenedor. |
| `EXAM_DATE` | vacío | Fecha inicial del examen (`YYYY-MM-DD`). Después se puede cambiar desde Ajustes. |

Puedes generar tokens seguros con:

```bash
openssl rand -hex 24   # API_TOKEN
openssl rand -hex 32   # SESSION_SECRET
```

---

## Instalación como add-on de Home Assistant OS

El repositorio incluye `repository.yaml`, y el add-on está en la carpeta `echo/`, por lo que puede añadirse como repositorio de add-ons de Home Assistant. **No hay que publicar ninguna imagen**: el Supervisor clona el repositorio y construye el contenedor localmente en tu Raspberry Pi.

[![Abrir Home Assistant y añadir el repositorio de Echo](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fstugemusa%2Fecho)

> **Requisito:** Home Assistant OS de 64 bits (`aarch64` en Raspberry Pi 4/5, `amd64` en x86). En instalaciones de 32 bits (`armv7`) el add-on no aparecerá en la tienda.

1. En Home Assistant entra en **Ajustes → Add-ons → Tienda de add-ons**.
2. Pulsa el menú de los tres puntos (arriba a la derecha) → **Repositorios**.
3. Añade la URL del repositorio:
   ```text
   https://github.com/stugemusa/echo
   ```
4. Busca **Echo** en la tienda, instálalo y ábrelo. La primera compilación puede tardar varios minutos en una Raspberry Pi.
5. En la pestaña **Configuración** del add-on define:
   - `app_pin`: PIN del usuario normal.
   - `admin_pin`: PIN del administrador (opcional; si lo dejas vacío, `app_pin` manda).
   - `api_token`: token para la API externa (opcional).
   - `session_secret`: opcional; si lo dejas vacío se genera uno.
   - `exam_date`: opcional (`YYYY-MM-DD`).
   - `ssl`, `certfile`, `keyfile`: opcionales, para servir Echo por HTTPS (ver más abajo).
6. Inicia el add-on y pulsa **Abrir interfaz web**.
7. Entra con el PIN que corresponda. El usuario normal ve el calendario y el historial; el administrador ve además **Ajustes** y puede marcar señales.

> **Almacenamiento:** en modo add-on, la base de datos se guarda en `/data/echo.db`, dentro del volumen persistente del add-on. Los backups de Home Assistant la incluyen si activas la copia de seguridad del add-on.

### Perfiles: usuario y administración

Echo decide el perfil según el PIN que introduzcas. No hay ningún selector ni pista en la pantalla de acceso:

| | Usuario normal | Administración |
| --- | --- | --- |
| Calendario, estudio, historial | ✅ | ✅ |
| Establecer la fecha del examen | ✅ | ✅ |
| Planificar repasos a mano | ✅ | ✅ |
| Sección **Ajustes** | ❌ (oculta) | ✅ |
| Marcar la señal del día | ❌ | ✅ |
| Cambiar máximo diario y ver la API | ❌ | ✅ |

El usuario normal **no sabe** que existe un modo de administración: la pestaña de Ajustes y los botones de señal simplemente no están. Si defines un solo PIN (`app_pin`), ese PIN actúa como administrador para no romper instalaciones existentes.

### Puerto

El add-on expone el contenedor `3000` en el host `9001`. Home Assistant permite cambiarlo desde la configuración de red del add-on (`3000/tcp`).

```text
http://homeassistant.local:9001
http://IP_DE_TU_HA:9001
```

### Servir Echo por HTTPS (opcional)

El add-on puede servir HTTPS directamente, reutilizando el certificado de DuckDNS/Let's Encrypt que ya guarda Home Assistant en `/ssl`:

1. En la pestaña **Configuración** del add-on activa `ssl` y deja `certfile: fullchain.pem` y `keyfile: privkey.pem` (las rutas relativas se resuelven dentro de `/ssl`).
2. Guarda y reinicia el add-on. El puerto `9001` pasará a hablar HTTPS.
3. En el router, reenvía el puerto externo `9001` hacia `IP_DE_TU_HA:9001` si quieres acceder desde fuera. Con el certificado de DuckDNS, la URL correcta es `https://TU-DOMINIO.duckdns.org:9001`.

> El certificado está emitido para tu dominio DuckDNS, no para la IP local: si entras por `https://192.168.…:9001` el navegador avisará de que el certificado no coincide. Desde la red local, lo más cómodo es seguir usando `http://IP_DE_TU_HA:9001`; el HTTPS queda para el acceso remoto y para tener PWA/offline.

### Sin HTTPS: qué funciona y qué no

- ✅ La aplicación completa, el calendario, el historial, las exportaciones y la API externa funcionan por HTTP.
- ✅ Puedes abrirla desde el móvil y crear un acceso directo en la pantalla de inicio.
- ❌ El navegador no permitirá instalar la PWA ni usar la caché offline, porque el service worker exige HTTPS o `localhost`.
- ⚠️ El PIN viaja sin cifrar por la red local. Úsala solo en tu red de confianza y no expongas el puerto directamente a Internet sin HTTPS.

No necesitas Nabu Casa ni un proxy inverso para este uso. Si más adelante quieres instalarla como PWA y tener offline, la opción más sencilla es Tailscale con HTTPS o un túnel de Cloudflare; no es necesario para empezar.

### Acceso directo en el móvil (sin HTTPS)

Con HTTP puedes tener Echo como un icono más, a pantalla completa, sin instalar nada adicional:

**Android (Chrome, Edge, Brave)**

1. Abre `http://IP_DE_TU_HA:9001` en el navegador e introduce el PIN.
2. Menú `⋮` → **Añadir a pantalla de inicio** → **Añadir**.
3. El icono abre Echo sin barra de direcciones. Si el navegador ofrece «Instalar aplicación», ignóralo: sin HTTPS no llegará a completarse.

**iPhone / iPad (Safari)**

1. Abre la URL en **Safari** (en iOS sólo Safari crea el acceso directo a pantalla completa).
2. Botón **Compartir** → **Añadir a pantalla de inicio** → **Añadir**.
3. Se abre a pantalla completa, sin la barra de Safari.

**Qué cambia respecto a una PWA instalada**

| | Acceso directo por HTTP | PWA con HTTPS |
| --- | --- | --- |
| Icono y pantalla completa | ✅ | ✅ |
| Datos, sesión y avisos | ✅ | ✅ |
| Funciona sin cobertura | ❌ | ✅ |
| Actualizaciones | Al abrir la página | En segundo plano |

> **Usa siempre la misma URL.** La sesión está ligada al origen: si un día entras por `http://192.168.1.50:9001` y otro por `http://homeassistant.local:9001`, te pedirá el PIN de nuevo.

### La vista móvil

En pantallas de móvil Echo cambia de forma automática:

- el **calendario** del mes muestra el número del día en grande y hasta tres **puntos de color** por día (verde = pendiente, gris = completado, ámbar = atrasado) en lugar de los chips de texto;
- la **señal** aparece como emoji en la esquina del día;
- la vista **semanal** se convierte en una lista vertical: cada día es una fila con su fecha a la izquierda y sus repasos a la derecha, sin scroll lateral;
- al tocar un día se abre su **agenda** con los temas a tamaño de lectura y botones táctiles (registrar, cambiar fecha, eliminar);
- los repasos completados del Historial llevan su botón de **deshacer** siempre visible.

El **cierre de sesión** está en la barra superior (icono de salida), disponible para cualquier perfil.

No hace falta configurar nada: se adapta por el ancho de la pantalla y por si el dispositivo tiene puntero o es táctil.


### Instalar con Portainer (opcional, sin publicar imagen)

No hace falta subir la imagen a Docker Hub ni a ningún registro. Portainer puede clonar este repositorio y construir la imagen localmente:

1. En Portainer: **Stacks → Add stack → Repository**.
2. Repository URL: `https://github.com/stugemusa/echo`
3. Reference: `refs/heads/main`
4. Compose path: `docker-compose.yml`
5. Añade las variables de entorno `APP_PIN`, `ADMIN_PIN` (opcional), `API_TOKEN`, `SESSION_SECRET` y `TZ`.
6. Pulsa **Deploy the stack**. Portainer clona el repo y ejecuta el `build` definido en `docker-compose.yml`, usando `echo/` como contexto.

La base de datos quedará en la carpeta `data/` del stack. En HA OS, sin embargo, **el add-on es más sencillo**: Home Assistant ya construye y gestiona el contenedor, lo arranca al inicio, lo incluye en las copias de seguridad y no requiere Portainer.

---

## Cómo funciona el sistema de arrastre

### 1. Registrar un estudio

Al pulsar **Registrar estudio** Echo te ofrece:

1. los repasos planificados para **hoy**;
2. los repasos de **días anteriores sin completar** (atrasados);
3. o un **identificador libre** para un tema nuevo.

Al guardar, el tema queda registrado como repaso completado con la fecha real de hoy y los comentarios opcionales.

### 2. Intervalos

El escalón estándar es:

```text
3 días → 7 días → 14 días → 21 días → 30 días → cada 30 días
```

Puedes aceptar el intervalo sugerido (+3 por defecto), elegir otro de los cinco rápidos o fijar una fecha exacta en el calendario. Antes de guardar, la interfaz muestra la **carga de los días cercanos** (0/3, 1/3, 2/3, 3/3) para que veas el impacto del cambio.

### 3. Cascada hasta el examen

Si has definido la **fecha del examen** en Ajustes, al registrar un tema Echo genera y guarda **todos los repasos futuros** hasta esa fecha (por ejemplo: +3, +7, +14, +21, +30, +60, +90…). Si no hay fecha de examen, la proyección se limita a 365 días.

### 4. Colisiones y máximo de 3 temas

Cada día admite un máximo de **3 repasos pendientes**. Si al calcular una fecha el día está lleno:

- para intervalos de **3 y 7 días**, se busca el primer hueco en los días **posteriores**;
- para intervalos de **14, 21, 30+ días**, se busca el primer hueco en los días **anteriores**;
- si no hay hueco en esa dirección, se alternan ambas direcciones;
- si el día elegido está completo, la app muestra un **modal** con el movimiento propuesto y espera tu confirmación.

Los repasos de un mismo tema nunca se apilan en el mismo día y no se programa nada más allá de la fecha del examen.

### 5. Mover o replanificar un repaso

Desde la vista diaria puedes pulsar el icono de mover en cualquier repaso pendiente, sea de hoy o de un día futuro. Al cambiar la fecha:

- el repaso elegido se coloca en la nueva fecha (con búsqueda de hueco si está llena);
- **todos los repasos posteriores de ese tema se recalculan** manteniendo los intervalos guardados;
- si hay desplazamientos por carga, se muestran igualmente en el modal de confirmación.

Dentro del diálogo, la tira **Carga de la semana** también sirve para elegir: **pulsa cualquiera de esos días** y se fija como fecha, sin abrir el selector nativo. Los días que no son válidos (anteriores a hoy, o no posteriores al estudio) aparecen atenuados y no responden al toque.

### 6. Planificar un repaso a mano

En cualquier día (hoy o futuro) puedes pulsar **Planificar repaso** para reservar un repaso sin registrar un estudio previo. Indica el tema y la fecha; Echo comprueba el máximo diario y te propone otro día si está completo.

Los **días futuros** no permiten registrar estudio: pulsar un repaso futuro abre directamente el cambio de fecha, y el botón de registrar solo aparece en hoy o en días pasados. Así el registro de estudio siempre refleja algo que ya ha ocurrido.

### 7. Deshacer un estudio registrado

Si registraste un estudio por error (te equivocaste de tema, o no era hoy), en el **Historial** cada repaso completado tiene un botón de deshacer. Al confirmarlo:

- el repaso **vuelve a estar pendiente** en su fecha original;
- **toda la cadena posterior de ese tema se recalcula** desde él, igual que si lo hubieras movido a mano;
- el estudio desaparece del historial.

No se puede deshacer un estudio si hay otro posterior del mismo tema ya registrado: primero deshaces el más reciente.

### 8. Eliminar un repaso creado por error

Desde la vista diaria, cada repaso pendiente tiene un botón de papelera (también aparece como **Eliminar** al abrir el cambio de fecha). Pide confirmación y borra **solo ese repaso**: el historial del tema y los demás repasos no se tocan.

### 9. La cadena sigue siempre al último repaso

Los repasos siguientes de un tema se derivan siempre del último punto «fijo»: el último estudio registrado o el último repaso que moviste a mano. Por eso, si mueves un repaso a otro día, **todo lo que venía detrás se desplaza** para mantener la cadencia.

### 10. Señales: solo la siguiente

Las señales **no se planifican con antelación** como los repasos. A partir de la última señal:

- el calendario solo dibuja **la siguiente marca**, y solo **dos días antes** de su fecha;
- las marcas ya alcanzadas (😢, 😭, 💔…) se mantienen visibles como historial;
- una nueva señal reinicia el ciclo y vuelve a dibujar ❤️.

Ejemplo: si hoy hay señal y la siguiente marca toca a los 7 días, el icono 😢 aparecerá el día 5 **en la casilla del día 7** y se quedará a partir de ahí. Hasta entonces, el calendario solo muestra el corazón de hoy.

El diseño es deliberadamente discreto: no hay leyenda de emojis, ni se anuncia cuándo aparecerá la próxima marca o con qué icono, para que la sorpresa forme parte del recordatorio. El aviso del calendario y la nota al pie solo indican **cuánto tiempo ha pasado** desde la última señal, con mensajes variados que se vuelven menos sutiles conforme pasa el tiempo (y solo la administración puede dejar la señal desde ahí).

---

## API externa: señal de constancia

### Endpoint

```http
POST /api/signal
```

Requiere el token en una de estas formas:

- Cabecera `x-api-token: TU_TOKEN`
- Cabecera `Authorization: Bearer TU_TOKEN`
- Query `?token=TU_TOKEN`

Cuerpo opcional:

```json
{
  "source": "home-assistant",
  "note": "Sigo aquí",
  "date": "2026-11-09"
}
```

`date` es opcional y solo permite fechas de hoy o pasadas (para registrar una señal olvidada).

### Ejemplo con curl

```bash
curl -X POST "http://homeassistant.local:9001/api/signal" \
  -H "x-api-token: $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"home-assistant","note":"Sigo aquí"}'
```

### Automatización de Home Assistant

```yaml
# configuration.yaml
rest_command:
  echo_signal:
    url: "http://homeassistant.local:9001/api/signal"
    method: POST
    headers:
      x-api-token: !secret echo_api_token
    payload: '{"source":"home-assistant"}'

automation:
  - alias: "Echo · señal diaria"
    triggers:
      - trigger: time
        at: "21:30:00"
    actions:
      - action: rest_command.echo_signal
```

Guarda el token en `secrets.yaml`:

```yaml
echo_api_token: "tu_token_generado"
```

### Reglas de los emojis

A partir de la **última señal**:

| Día | Emoji |
| --- | --- |
| Día de la señal | ❤️ |
| +7 días sin señal | 😢 |
| +14 días sin señal | 😭 |
| +21 días sin señal | 💔 |
| +26 días sin señal | 💔💔 |
| +31 días sin señal | 💔💔💔 |
| … cada 5 días | un 💔 más |

> **Visibilidad:** cada marca aparece en el calendario **dos días antes** de su fecha y se queda a partir de entonces. Nunca se muestran varias marcas futuras a la vez: solo la siguiente.

Una nueva llamada a `POST /api/signal` reinicia por completo el ciclo y vuelve a dibujar ❤️ en el día actual. Los corazones de señales anteriores se conservan como historial visual.

El perfil de administración puede **marcar la señal de hoy** desde Ajustes o desde la nota del pie del calendario (sin necesidad de token).

Además, al pie del panel lateral hay una **nota discreta** con el último icono, los días transcurridos desde la última señal y un mensaje variado que se vuelve menos sutil con el tiempo, para invitar a dejar un corazón nuevo. No hay leyenda ni aviso del próximo icono: la sorpresa forma parte del recordatorio.

---

## API HTTP

Todas las rutas, salvo `/api/auth`, `/api/session`, `/api/health` y `/api/signal`, requieren la cookie de sesión. Las marcadas como **admin** exigen además el perfil de administración.

| Método | Ruta | Perfil | Descripción |
| --- | --- | --- | --- |
| `POST` | `/api/auth` | — | Valida el PIN, resuelve el perfil y crea la cookie de sesión. |
| `POST` | `/api/logout` | — | Cierra la sesión. |
| `GET` | `/api/session` | — | Estado de autenticación y perfil activo. |
| `GET` | `/api/overview` | usuario | Resumen de hoy, atrasados, próximos 7 días, examen y señal. |
| `GET` | `/api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD` | usuario | Repasos y marcas de señal por día (máx. 150 días). |
| `POST` | `/api/studies` | usuario | Registra un estudio de hoy o del pasado y genera la cascada. |
| `POST` | `/api/reviews/:id/undo` | usuario | Deshace un estudio: el repaso vuelve a pendiente y se recalcula la cadena. |
| `POST` | `/api/plan` | usuario | Planifica un repaso manual en una fecha (hoy o futura). |
| `PATCH` | `/api/reviews/:id` | usuario | Cambia la fecha de un repaso y recalcula los posteriores. |
| `DELETE` | `/api/reviews/:id` | usuario | Elimina un repaso pendiente. |
| `GET` | `/api/history?q=&sort=date\|topic` | usuario | Historial agrupado por tema. |
| `GET` | `/api/settings` | usuario | Ajustes básicos; el administrador recibe además API, intervalos y señal. |
| `PUT` | `/api/settings` | usuario | Guarda la fecha de examen (el máximo diario solo lo cambia el administrador). |
| `POST` | `/api/signals` | **admin** | Marca la señal de hoy desde la interfaz. |
| `GET` | `/api/export?format=json\|csv` | usuario | Copia JSON completa o CSV de datos (repasos y señales). |
| `POST` | `/api/reset` | **admin** | Vacía los datos de estudio (`keep_settings` conserva examen y máximo diario). |
| `POST` | `/api/restore` | **admin** | Restaura una copia (mismo formato que la exportación JSON). Reemplaza todo. |
| `POST` | `/api/signal` | — | API externa protegida por `API_TOKEN`. |

Si `POST /api/studies` o `PATCH /api/reviews/:id` detectan colisiones, responden `409` con `requiresConfirmation: true`, la lista de `collisions` y un `preview` del plan. Reenvía la misma petición con `"confirm": true` para aplicarlo. `POST /api/plan` responde `409` con `suggestedDate` cuando el día está completo.

---

## Estructura del proyecto

```text
repo/
├── echo/                    # Add-on y aplicación
│   ├── config.yaml          # Configuración del add-on
│   ├── Dockerfile
│   ├── run.sh
│   ├── server.js            # Servidor Express, seguridad y arranque
│   ├── schema.sql           # Esquema SQLite
│   ├── src/
│   │   ├── api.js           # Endpoints HTTP
│   │   ├── auth.js          # PIN, sesión firmada y token de API
│   │   ├── config.js        # Variables de entorno y opciones del add-on
│   │   ├── db.js            # SQLite y ajustes persistentes
│   │   ├── dates.js         # Utilidades de fechas
│   │   ├── scheduler.js     # Intervalos, cascada y colisiones
│   │   └── signals.js       # Señales y emojis del calendario
│   ├── public/
│   │   ├── index.html
│   │   ├── styles.css
│   │   ├── app.js
│   │   ├── manifest.json
│   │   ├── sw.js
│   │   ├── fonts/
│   │   └── icons/
│   ├── scripts/
│   │   └── make-icons.js    # Genera los PNG de la marca sin dependencias
│   ├── README.md            # Ficha del add-on
│   └── DOCS.md              # Documentación del add-on
├── docker-compose.yml
├── repository.yaml          # Repositorio de add-ons de Home Assistant
├── .env.example
└── README.md
```

---

## Copias de seguridad, restauración y reset

En **Ajustes → Datos, copias y restauración**:

- **Copia JSON:** descarga un volcado completo (ajustes, temas, repasos y señales). Es el formato bueno para restaurar.
- **CSV de datos:** una fila por repaso **y una por señal** (columna `Tipo`), útil para abrir todo en una hoja de cálculo.
- **Imprimir / PDF:** genera una vista limpia con la planificación pendiente y el historial completo.
- **Restaurar:** elige un archivo **JSON** (copia de Echo) o un **CSV de datos**. Antes de tocar nada te muestra un resumen (temas, repasos completados y pendientes, señales) y pide confirmación. La restauración **reemplaza** los datos actuales.
  - El JSON restaura todo, incluida la fecha del examen y las señales.
  - El CSV restaura temas, repasos y señales. La fecha del examen no viaja en el CSV, así que se conserva la que tengas puesta.
  - Un CSV antiguo (sin columna `Tipo`) no trae señales: el diálogo te avisa antes de continuar.
- **Empezar de cero:** borra todos los temas, repasos y señales. Puedes conservar la fecha del examen y el máximo diario (marcado por defecto).

Todo esto es solo para el perfil de administración, y tanto el reset como la restauración piden confirmación porque reemplazan datos.

### Copia del archivo SQLite

Para una copia «en frío», copia `data/echo.db` (o `/data/echo.db` en el add-on). Mientras la app está en marcha aparecen también `-wal` y `-shm`: para una copia en caliente, lo más seguro es la **Copia JSON** desde Ajustes.

---

## Desarrollo local

```bash
cd echo
npm install
APP_PIN=1234 ADMIN_PIN=5678 API_TOKEN=test-token npm start
```

Abre `http://localhost:3000`. El archivo SQLite se crea en `./data/echo.db`.

Para regenerar los iconos:

```bash
npm run icons
```

No hay paso de compilación del frontend. El service worker se registra automáticamente en `localhost` o HTTPS.

---

## Seguridad y privacidad

- No hay cuentas, telemetría ni servicios externos.
- El PIN se compara en tiempo constante y hay límite de intentos por IP.
- La sesión es una cookie `HttpOnly`, `SameSite=Lax` y firmada con HMAC-SHA256. En HTTPS se añade `Secure`.
- La API externa está desactivada si no defines `API_TOKEN`; el token nunca se envía al navegador.
- Cabeceras CSP, `X-Frame-Options`, `X-Content-Type-Options` y `Referrer-Policy`.
- La base de datos es un archivo local. Protege el acceso a tu red y no expongas el puerto del add-on directamente a Internet sin HTTPS y autenticación.

---

## Notas para Raspberry Pi

- Usa una Raspberry Pi 4 o superior y una imagen de 64 bits (Home Assistant OS ya lo es).
- La imagen `node:22-bookworm-slim` incluye los binarios de `better-sqlite3` para `amd64` y `arm64`. La arquitectura `armv7` (32 bits) no está soportada por los binarios actuales.
- El consumo es mínimo: SQLite en un único archivo y una app estática sin frameworks pesados.
- Si usas Docker directamente y el contenedor no puede escribir en `./data`, crea la carpeta antes con `mkdir -p data` y revisa los permisos del host.

---

## Solución de problemas

### El PC entra, pero el móvil no llega a la IP del add-on

Casi siempre es el dispositivo o la red, no Echo. **Por este orden**, que es de más frecuente a menos:

1. **Android 16 o superior: permiso «Dispositivos cercanos».** Chrome necesita ese permiso para poder hablar con equipos de la red local. Sin él, las conexiones a `192.168.x.x` fallan con `ERR_TOO_MANY_RETRIES` (o `ERR_CONNECTION_TIMED_OUT`) aunque todo lo demás esté bien.
   → **Ajustes → Aplicaciones → Chrome → Permisos → Dispositivos cercanos → Permitir.**
   Otros navegadores y apps tienen permisos equivalentes; si un navegador no llega a la IP y otro sí, mira ahí.

2. **DNS anunciado por IPv6 (RA).** Si el router anuncia servidores DNS por IPv6 (lo que en algunos routers se llama **«Servicio RA»**, *Router Advertisement*), los móviles pueden usar **esos** DNS en vez del tuyo local. Entonces el dominio resuelve a tu **IP pública** y, como el puerto no está reenviado, sale `ERR_CONNECTION_REFUSED`.
   → Desactiva el *Servicio RA* en el router, o asegúrate de que tu DNS local también se anuncia por IPv6.
   → Para comprobarlo en el móvil: `chrome://net-internals/#dns` y mira a qué IP resuelve el dominio. Si es tu IP pública, es esto.

3. **Aislamiento de clientes.** Muchos routers, puntos de acceso y repetidores traen «AP isolation» / «aislamiento de clientes»: los dispositivos salen a Internet, pero no se ven entre ellos en la red local. Es típico cuando el PC va por **cable** y el móvil por **Wi-Fi** (o cuando el móvil está en un AP distinto). Desactívalo, o conecta el móvil a la red del router principal.

4. **VPN en el móvil.** Una VPN activa (o un bloqueador de anuncios con VPN local: AdGuard, Blokada, DNS66…) corta el acceso a `192.168…`. Desactívala y prueba. Mira también «DNS privado» (Ajustes → Red) y el «DNS seguro» de Chrome: los dos **se saltan** tu DNS local.

5. **Otra red: banda, AP o repetidor.** Comprueba la **IP y la puerta de enlace** del móvil: deben empezar por lo mismo que las del PC. Si el móvil cuelga de un repetidor o de otra banda, puede estar aislado o en otra subred.

6. **El puerto del add-on.** En el log del add-on verás `▸ https://localhost:9001`. En **Configuración → Red** revisa el mapeo del puerto del host.

7. **Firewall o control parental del router** bloqueando dispositivos inalámbricos o puertos poco comunes.

### `https://TU-DOMINIO.duckdns.org:9001` no funciona

Ese `:9001` no es el mismo camino que tu Home Assistant en `https://TU-DOMINIO.duckdns.org` (ese va por el `443` → HA). Tienes dos formas:

- **Desde fuera de casa (o con reenvío):** reenvía en el router el puerto externo `9001` hacia `IP_DE_TU_HA:9001`. Así funciona con el certificado de DuckDNS y desde cualquier sitio, pero **deja Echo publicado en Internet**.
- **Solo en casa, sin exponer nada:** haz que el dominio resuelva a la IP local **en el propio dispositivo**. Con un DNS local (por ejemplo el add-on **AdGuard Home** con una reescritura `TU-DOMINIO.duckdns.org → IP_DE_TU_HA`) el navegador va directo a la caja, el certificado de DuckDNS es válido y **no hace falta reenviar ningún puerto**.
  > Requisito imprescindible: que el dispositivo use **de verdad** ese DNS. Los puntos 1 y 2 de arriba (permiso de Android y RA/IPv6) son justo los que rompen esto sin que te enteres.

Con un certificado válido y contexto seguro, el navegador ofrece **Instalar aplicación** y el service worker queda registrado (modo sin conexión). Con un certificado no válido (por ejemplo entrando por IP con aviso), Chrome **no** instala la PWA.

### El service worker sirve una versión antigua

- La app se sirve con `no-cache` + etag: en la primera recarga tras actualizar debería entrar la versión nueva.
- Si sigues viendo algo viejo, fuerza la recarga (o cierra la app del todo y ábrela). El service worker también cachea: en Chrome, `chrome://net-internals/#dns` (limpiar caché de DNS) y `#sockets` (flush) ayudan cuando hay cachés raras.

---

## Licencia

Proyecto personal. Puedes usarlo y adaptarlo para tu propia preparación. Si lo publicas, se agradece una mención a Echo.
