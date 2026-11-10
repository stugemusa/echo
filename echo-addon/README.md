# Echo

Sistema de arrastre para oposiciones: calendario de repaso espaciado, historial,
planificación en cascada hasta la fecha del examen y señales de constancia.

Este add-on expone la interfaz web en el puerto **3000**. La base de datos se
guarda en `/data/echo.db` y se incluye en las copias de seguridad del add-on.

- Repositorio y documentación completa: https://github.com/stugemusa/echo
- Interfaz: `http://homeassistant.local:3000` o `http://IP_DE_TU_HA:3000`
- PIN inicial: el valor de `app_pin` (cámbialo antes de empezar).

> La app funciona por HTTP en tu red local. Para instalar la PWA y usar la caché
> offline, el navegador exige HTTPS; sin HTTPS puedes usarla normalmente en el
> navegador y añadir un acceso directo a la pantalla de inicio.
