#!/bin/sh
set -eu

# La base de datos vive en /data, el volumen persistente del add-on o del contenedor.
mkdir -p /data

exec node /app/server.js
