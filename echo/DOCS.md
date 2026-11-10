# Documentación de Echo

## Opciones

| Opción | Por defecto | Descripción |
| --- | --- | --- |
| `app_pin` | `1234` | PIN de acceso. **Cámbialo.** |
| `api_token` | vacío | Token de `POST /api/signal`. Si está vacío, la API externa queda desactivada. |
| `session_secret` | vacío | Secreto para firmar la cookie. Si se deja vacío se genera y guarda en SQLite. |
| `exam_date` | vacío | Fecha inicial del examen (`YYYY-MM-DD`). También se puede cambiar desde Ajustes. |

## Acceso

El add-on publica el puerto `3000` en el host. Abre:

```text
http://homeassistant.local:3000
```

o

```text
http://IP_DE_TU_HOME_ASSISTANT:3000
```

Si el puerto 3000 está ocupado, cámbialo en **Configuración → Red** del add-on.

## Datos y copias

La base de datos vive en `/data/echo.db`, dentro del volumen persistente del
add-on. Las copias de seguridad de Home Assistant la incluyen si el add-on está
incluido en la copia. También puedes exportar JSON/CSV desde **Ajustes**.

## HTTP y PWA

Echo funciona completamente por HTTP en la red local. El service worker y la
instalación como PWA requieren un contexto seguro (HTTPS o `localhost`), así que
por HTTP no habrá modo offline. No expongas el puerto 3000 directamente a
Internet.

## API externa

```bash
curl -X POST "http://homeassistant.local:3000/api/signal" \
  -H "x-api-token: TU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"home-assistant","note":"Sigo aquí"}'
```

El token es el valor de `api_token` en la configuración del add-on.
