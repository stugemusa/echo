# Documentación de Echo

## Opciones

| Opción | Por defecto | Descripción |
| --- | --- | --- |
| `app_pin` | `1234` | PIN del **usuario normal** (calendario, estudio, historial y fecha del examen). **Cámbialo.** |
| `admin_pin` | vacío | PIN de **administración** (ajustes, señales y API). Si lo dejas vacío, `app_pin` actúa como administrador. |
| `api_token` | vacío | Token de `POST /api/signal`. Si está vacío, la API externa queda desactivada. |
| `session_secret` | vacío | Secreto para firmar la cookie. Si se deja vacío se genera y guarda en SQLite. |
| `exam_date` | vacío | Fecha inicial del examen (`YYYY-MM-DD`). También se puede cambiar desde Ajustes. |
| `ssl` | `false` | Sirve Echo por HTTPS en el mismo puerto. |
| `certfile` | `fullchain.pem` | Certificado TLS. Ruta relativa a `/ssl` o absoluta. |
| `keyfile` | `privkey.pem` | Clave privada TLS. Ruta relativa a `/ssl` o absoluta. |

## Perfiles

El PIN introducido decide el perfil. No hay pistas en la pantalla de acceso:

- **Usuario normal** (`app_pin`): calendario, estudio, historial, planificación manual y fecha del examen. No ve Ajustes ni puede marcar señales.
- **Administración** (`admin_pin`): todo lo anterior más Ajustes, señales, máximo diario, API y exportaciones.

Si solo defines `app_pin`, ese PIN se comporta como administrador (compatibilidad).

## Acceso

El add-on publica el puerto interno `3000` en el host `9001`. Abre:

```text
http://homeassistant.local:9001
```

o

```text
http://IP_DE_TU_HOME_ASSISTANT:9001
```

Si el puerto 9001 está ocupado, cámbialo en **Configuración → Red** del add-on.

## HTTPS opcional

Activa `ssl` para que el add-on sirva HTTPS reutilizando el certificado de DuckDNS/Let's Encrypt de Home Assistant (vive en `/ssl`):

1. Activa `ssl: true` y deja `certfile: fullchain.pem` y `keyfile: privkey.pem`.
2. Reinicia el add-on. El puerto 9001 pasará a hablar HTTPS.
3. Si quieres acceso remoto, reenvía el puerto `9001` en el router hacia `IP_DE_TU_HA:9001` y entra por `https://TU-DOMINIO.duckdns.org:9001`.

> El certificado está emitido para tu dominio, no para la IP local. Por `https://` con IP verás un aviso de certificado: en la red local sigue usando `http://IP_DE_TU_HA:9001`.

## Datos y copias

La base de datos vive en `/data/echo.db`, dentro del volumen persistente del
add-on. Las copias de seguridad de Home Assistant la incluyen si el add-on está
incluido en la copia. También puedes exportar JSON/CSV desde **Ajustes**.

## HTTP y PWA

Echo funciona completamente por HTTP en la red local. El service worker y la
instalación como PWA requieren un contexto seguro (HTTPS o `localhost`), así que
por HTTP no habrá modo offline. No expongas el puerto directamente a Internet sin
HTTPS.

## Repasos

- **Planificar a mano**: en la vista diaria, **Planificar repaso** reserva un repaso en cualquier día futuro sin registrar un estudio.
- **Cambiar la fecha**: recalcula toda la cadena posterior del tema. En el diálogo, la tira de carga semanal es pulsable: al tocar un día se fija esa fecha.
- **Eliminar**: la papelera de cada repaso pendiente (o **Eliminar** al cambiar la fecha) borra ese repaso con confirmación.
- **Deshacer un estudio**: desde el Historial, el botón de deshacer devuelve el repaso a pendiente y recalcula la cadena.
- Los días futuros no permiten registrar estudio.

## Móvil

La interfaz se adapta sola: en pantallas pequeñas el mes usa números grandes y puntos de color por día, la semana se muestra como lista vertical y la agenda diaria usa botones táctiles.

## Sesión

Cualquier perfil puede cerrar sesión desde el icono de salida de la barra superior. La administración lo tiene también en Ajustes.

## Señales

Las señales no se planifican con antelación. Desde la última señal, el calendario
solo muestra **la siguiente marca** y solo **dos días antes** de su fecha; las
marcas ya alcanzadas se mantienen. Cadencia: ❤️ el día de la señal, 😢 +7, 😭 +14,
💔 +21 y un corazón roto más cada 5 días. Una nueva señal reinicia el ciclo.

No hay leyenda ni aviso del próximo icono: el diseño es discreto a propósito.

## API externa

```bash
curl -X POST "http://homeassistant.local:9001/api/signal" \
  -H "x-api-token: TU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"home-assistant","note":"Sigo aquí"}'
```

El token es el valor de `api_token` en la configuración del add-on.
