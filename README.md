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
- **Señales de constancia** con emojis en el calendario:
  - ❤️ el día que se recibe una señal;
  - 😢 a los 7 días sin señal;
  - 😭 a los 14 días;
  - 💔 a los 21 días y un corazón roto adicional cada 5 días.
- **API externa** `POST /api/signal` protegida con token, ideal para automatizaciones de Home Assistant.
- **Exportación** a JSON y CSV, y vista de impresión limpia para PDF.
- **Acceso con PIN** y cookie de sesión firmada (30 días).
- **PWA instalable** con service worker y lectura offline de los últimos datos.

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
# Edita .env: cambia APP_PIN, define API_TOKEN y SESSION_SECRET
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
| `APP_PIN` | `1234` | PIN de acceso a la app. **Cámbialo.** |
| `API_TOKEN` | vacío | Token de `POST /api/signal`. Si está vacío, la API externa queda desactivada. |
| `SESSION_SECRET` | autogenerado | Secreto para firmar la cookie. Si se omite, se genera y guarda en SQLite. |
| `DB_PATH` | `/data/echo.db` en Docker | Ruta del archivo SQLite. |
| `PORT` | `3000` | Puerto HTTP del servidor. |
| `TZ` | `Europe/Madrid` | Zona horaria del contenedor. |
| `EXAM_DATE` | vacío | Fecha inicial del examen (`YYYY-MM-DD`). Después se puede cambiar desde Ajustes. |

Puedes generar tokens seguros con:

```bash
openssl rand -hex 24   # API_TOKEN
openssl rand -hex 32   # SESSION_SECRET
```

---

## Instalación como add-on de Home Assistant OS

El repositorio incluye `config.yaml`, `repository.yaml`, `Dockerfile` y `run.sh`, por lo que puede añadirse como repositorio de add-ons local.

1. En Home Assistant entra en **Ajustes → Add-ons → Tienda de add-ons**.
2. Pulsa el menú de los tres puntos (arriba a la derecha) → **Repositorios**.
3. Añade la URL del repositorio:
   ```text
   https://github.com/stugemusa/echo
   ```
4. Busca **Echo** en la tienda, instálalo y ábrelo.
5. En la pestaña **Configuración** del add-on define:
   - `app_pin`: tu PIN de acceso.
   - `api_token`: token para la API externa (opcional).
   - `session_secret`: opcional; si lo dejas vacío se genera uno.
   - `exam_date`: opcional (`YYYY-MM-DD`).
6. Inicia el add-on y abre la interfaz web. También puedes activar **Mostrar en la barra lateral**.
7. Para que la PWA se pueda instalar en el móvil y funcione offline, accede por **HTTPS**: usa el proxy inverso de Home Assistant, Nabu Casa o un certificado propio. El service worker no se registra en `http://IP:3000` (salvo en `localhost`).

> **Almacenamiento:** en modo add-on, la base de datos se guarda en `/data/echo.db`, dentro del volumen persistente del add-on. Los backups de Home Assistant la incluyen si activas la copia de seguridad del add-on.

### Puerto

El add-on expone el puerto `3000`. Home Assistant permite cambiar el puerto del host desde la configuración del add-on (`3000/tcp`).

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

### 5. Mover un repaso

Desde la vista diaria puedes pulsar el icono de mover en cualquier repaso pendiente. Al cambiar la fecha:

- el repaso elegido se coloca en la nueva fecha (con búsqueda de hueco si está llena);
- todos los repasos posteriores de ese tema se recalculan manteniendo los intervalos guardados;
- si hay desplazamientos por carga, se muestran igualmente en el modal de confirmación.

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
curl -X POST "http://homeassistant.local:3000/api/signal" \
  -H "x-api-token: $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"home-assistant","note":"Sigo aquí"}'
```

### Automatización de Home Assistant

```yaml
# configuration.yaml
rest_command:
  echo_signal:
    url: "http://homeassistant.local:3000/api/signal"
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

Una nueva llamada a `POST /api/signal` reinicia por completo el ciclo y vuelve a dibujar ❤️ en el día actual. Los corazones de señales anteriores se conservan como historial visual.

Desde Ajustes también puedes **marcar la señal de hoy** manualmente (sin necesidad de token).

---

## API HTTP

Todas las rutas, salvo `/api/auth`, `/api/session`, `/api/health` y `/api/signal`, requieren la cookie de sesión.

| Método | Ruta | Descripción |
| --- | --- | --- |
| `POST` | `/api/auth` | Valida el PIN y crea la cookie de sesión. |
| `POST` | `/api/logout` | Cierra la sesión. |
| `GET` | `/api/session` | Estado de autenticación. |
| `GET` | `/api/overview` | Resumen de hoy, atrasados, próximos 7 días, examen y señal. |
| `GET` | `/api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD` | Repasos y marcas de señal por día (máx. 150 días). |
| `POST` | `/api/studies` | Registra un estudio y genera la cascada. |
| `PATCH` | `/api/reviews/:id` | Mueve un repaso y recalcula los posteriores. |
| `DELETE` | `/api/reviews/:id` | Elimina un repaso pendiente. |
| `GET` | `/api/history?q=&sort=date\|topic` | Historial agrupado por tema. |
| `GET` | `/api/settings` | Ajustes, estado de la API y señal. |
| `PUT` | `/api/settings` | Guarda la fecha de examen y el máximo diario. |
| `POST` | `/api/signals` | Marca la señal de hoy desde la interfaz. |
| `GET` | `/api/export?format=json\|csv` | Copia de seguridad completa o CSV de repasos. |
| `POST` | `/api/signal` | API externa protegida por `API_TOKEN`. |

Si `POST /api/studies` o `PATCH /api/reviews/:id` detectan colisiones, responden `409` con `requiresConfirmation: true`, la lista de `collisions` y un `preview` del plan. Reenvía la misma petición con `"confirm": true` para aplicarlo.

---

## Estructura del proyecto

```text
echo/
├── server.js              # Servidor Express, seguridad y arranque
├── schema.sql             # Esquema SQLite
├── src/
│   ├── api.js             # Endpoints HTTP
│   ├── auth.js            # PIN, sesión firmada y token de API
│   ├── config.js          # Variables de entorno y opciones del add-on
│   ├── db.js              # SQLite y ajustes persistentes
│   ├── dates.js           # Utilidades de fechas
│   ├── scheduler.js       # Intervalos, cascada y colisiones
│   └── signals.js         # Señales y emojis del calendario
├── public/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── manifest.json
│   ├── sw.js
│   ├── fonts/
│   └── icons/
├── scripts/
│   └── make-icons.js      # Genera los PNG de la marca sin dependencias
├── Dockerfile
├── docker-compose.yml
├── config.yaml            # Add-on de Home Assistant OS
├── repository.yaml        # Repositorio de add-ons
├── run.sh
├── .env.example
└── README.md
```

---

## Copias de seguridad

- **Automática:** copia el archivo `data/echo.db` (o `/data/echo.db` en el add-on). Los archivos `-wal` y `-shm` aparecen junto a la base de datos mientras está en uso; para una copia en caliente, usa la exportación JSON desde Ajustes.
- **Manual desde la app:** Ajustes → **JSON** descarga un volcado completo (ajustes, temas, repasos, señales y estadísticas).
- **CSV:** útil para abrir la planificación y el historial en una hoja de cálculo.
- **Imprimir / PDF:** genera una vista limpia con la planificación pendiente y el historial completo.

Para restaurar un JSON necesitarías importarlo en una instalación nueva mediante SQLite; el formato está documentado y es estable. Si necesitas un importador, abre una issue.

---

## Desarrollo local

```bash
npm install
APP_PIN=1234 API_TOKEN=test-token npm start
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
- La base de datos es un archivo local. Protege el acceso a tu red y no expongas el puerto 3000 directamente a Internet sin HTTPS y autenticación.

---

## Notas para Raspberry Pi

- Usa una Raspberry Pi 4 o superior y una imagen de 64 bits (Home Assistant OS ya lo es).
- La imagen `node:22-bookworm-slim` incluye los binarios de `better-sqlite3` para `amd64` y `arm64`. La arquitectura `armv7` (32 bits) no está soportada por los binarios actuales.
- El consumo es mínimo: SQLite en un único archivo y una app estática sin frameworks pesados.
- Si usas Docker directamente y el contenedor no puede escribir en `./data`, crea la carpeta antes con `mkdir -p data` y revisa los permisos del host.

---

## Licencia

Proyecto personal. Puedes usarlo y adaptarlo para tu propia preparación. Si lo publicas, se agradece una mención a Echo.
