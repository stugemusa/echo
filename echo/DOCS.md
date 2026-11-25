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

**De fábrica** (`app_pin: 1234` y `admin_pin` vacío) el PIN `1234` sirve para los dos perfiles. En cuanto rellenes `admin_pin`, quedan separados: el PIN de usuario ya no verá Ajustes ni podrá marcar señales, y el de administrador entra como administrador, no como usuario.

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

**Desde fuera de casa no se llega, y es intencionado.** El puerto `9001` no se reenvía en el router, así que Echo solo existe en la red local. El dominio DuckDNS sirve para tener HTTPS válido en casa (si resuelve a la IP local con un DNS propio), no para publicarlo. Lo que sí es accesible desde fuera es Home Assistant (`443` → `8123`), que es otro servicio. Si necesitas acceso remoto a Echo, usa una VPN (Tailscale o la VPN de Home Assistant); abrir el `9001` lo expondría a Internet.

## HTTPS opcional

Activa `ssl` para que el add-on sirva HTTPS reutilizando el certificado de DuckDNS/Let's Encrypt de Home Assistant (vive en `/ssl`):

1. Activa `ssl: true` y deja `certfile: fullchain.pem` y `keyfile: privkey.pem`.
2. Reinicia el add-on. El puerto 9001 pasará a hablar HTTPS.
3. Para usarlo **solo en casa** no hay que tocar el router: haz que el dominio DuckDNS resuelva a la IP local (por ejemplo, reescritura en AdGuard Home) y entra por `https://TU-DOMINIO.duckdns.org:9001` con candado válido.
4. Reenviar el `9001` en el router es opcional y **no recomendado**: es lo único que publicaría Echo en Internet.

> El certificado está emitido para tu dominio, no para la IP local. Por `https://` con IP verás un aviso de certificado: en la red local sigue usando `http://IP_DE_TU_HA:9001`.

## Datos y copias

La base de datos vive en `/data/echo.db`, dentro del volumen persistente del
add-on. Las copias de seguridad de Home Assistant la incluyen si el add-on está
incluido en la copia.

Desde **Ajustes → Datos, copias y restauración** (solo administración):

- **Exportar**: copia JSON completa, CSV de datos (repasos y señales) o PDF.
- **Restaurar**: elige un JSON de Echo o un CSV. Muestra un resumen y reemplaza
  los datos actuales tras confirmar. El CSV no lleva la fecha del examen (se
  conserva la actual); un CSV antiguo sin señales avisa de que se perderán.
- **Empezar de cero**: borra temas, repasos y señales. Puedes conservar la fecha
  del examen y el máximo diario.

## HTTP y PWA

Echo funciona completamente por HTTP en la red local. El service worker y la
instalación como PWA requieren un contexto seguro (HTTPS o `localhost`), así que
por HTTP no habrá modo offline. No expongas el puerto directamente a Internet sin
HTTPS.

## Repasos

- **Registrar un estudio**: el campo **Fecha del estudio** viene con hoy por defecto y admite cualquier día del último año, para apuntar algo que olvidaste. Nunca admite fechas futuras ni anteriores a un estudio ya registrado del mismo tema; la cadena se recalcula desde la fecha indicada.
- **Planificar a mano**: en la vista diaria, **Planificar repaso** reserva un repaso en cualquier día futuro sin registrar un estudio.
- **Cambiar la fecha**: recalcula toda la cadena posterior del tema. La nueva fecha puede ser pasada o futura, siempre posterior al último estudio. En el diálogo, la tira de carga semanal es pulsable: al tocar un día se fija esa fecha.
- **Eliminar**: la papelera de cada repaso pendiente (o **Eliminar** al cambiar la fecha) borra ese repaso con confirmación.
- **Deshacer un estudio**: desde el Historial, el botón de deshacer devuelve el repaso a pendiente y recalcula la cadena.
- **Ficha de un tema**: el botón de calendario junto a cada tema del Historial abre todos sus repasos, pasados y futuros, en lista o en calendario mensual.
- Los días futuros no permiten registrar estudio.

## Móvil

La interfaz se adapta sola: en pantallas pequeñas el mes usa números grandes y puntos de color por día, la semana se muestra como lista vertical y la agenda diaria usa botones táctiles.

## Problemas conocidos (probados en real)

**El móvil no llega a la IP del add-on (y el PC sí).** Dos causas habituales, y las dos son del dispositivo o del router, no de Echo:

1. **Android 16 o superior (Pixel y otros):** Chrome necesita el permiso **«Dispositivos cercanos»** para hablar con equipos de la red local. Sin él, todo da `ERR_TOO_MANY_RETRIES`. Se concede en *Ajustes → Aplicaciones → Chrome → Permisos → Dispositivos cercanos*.
2. **DNS por IPv6 anunciado por el router (Servicio RA):** los móviles usan esos DNS en vez del local, el dominio resuelve a la IP pública y falla. Se arregla desactivando el *Servicio RA* en el router. Comprueba con `chrome://net-internals/#dns` a qué IP resuelve el dominio.

Otros: aislamiento de clientes (AP isolation) en el router o en un punto de acceso, VPN o bloqueador con VPN local en el móvil, «DNS privado» de Android y «DNS seguro» de Chrome (los dos se saltan el DNS local).

## Sesión

Cualquier perfil puede cerrar sesión desde el icono de salida de la barra superior. La administración lo tiene también en Ajustes.

## Señales

Las señales no se planifican con antelación. Desde la última señal, el calendario
solo muestra **la siguiente marca** y solo **dos días antes** de su fecha; las
marcas ya alcanzadas se mantienen. Cadencia: ❤️ el día de la señal, 😢 +7, 😭 +14,
💔 +21 y un corazón roto más cada 5 días. Una nueva señal reinicia el ciclo.

No hay leyenda ni aviso del próximo icono: el diseño es discreto a propósito.

Al marcar una señal (**Dejar señal** / **Marcar señal**) se indica la fecha en un
diálogo: hoy por defecto, o un día pasado. Nunca se admite una fecha futura. El
ciclo se reinicia desde esa fecha; si ya había una señal posterior, la nueva se
añade al calendario pero no reinicia el ciclo.

## API externa

```bash
curl -X POST "http://homeassistant.local:9001/api/signal" \
  -H "x-api-token: TU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"home-assistant","note":"Sigo aquí"}'
```

El token es el valor de `api_token` en la configuración del add-on.
