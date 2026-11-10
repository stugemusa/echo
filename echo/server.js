'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const express = require('express');
const config = require('./src/config');
const { db } = require('./src/db');
const api = require('./src/api');

const app = express();

app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'same-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "connect-src 'self'",
      "manifest-src 'self'",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );
  next();
});

app.use('/api', api);

app.use(
  express.static(config.publicDir, {
    etag: true,
    maxAge: '1h',
    setHeaders(res, filePath) {
      const name = path.basename(filePath);
      if (name === 'index.html' || name === 'sw.js' || name === 'manifest.json') {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    return res.sendFile(path.join(config.publicDir, 'index.html'));
  }
  return next();
});

app.use((req, res) => {
  res.status(404).json({ error: 'not_found', message: 'Recurso no encontrado.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid_json', message: 'Cuerpo de la petición no válido.' });
  }
  console.error('[echo] Error:', err);
  return res.status(err?.status || 500).json({
    error: 'server_error',
    message: err?.status ? err.message : 'Error interno del servidor.',
  });
});

let server;
let protocol = 'http';

if (config.ssl) {
  const options = {
    cert: fs.readFileSync(config.certFile),
    key: fs.readFileSync(config.keyFile),
  };
  server = https.createServer(options, app);
  protocol = 'https';
} else {
  server = http.createServer(app);
}

server.listen(config.port, config.host, () => {
  console.log('');
  console.log('  Echo · Repaso espaciado');
  console.log(`  ▸ ${protocol}://localhost:${config.port}`);
  console.log(`  ▸ Base de datos: ${config.dbPath}`);
  console.log(`  ▸ Entorno Home Assistant: ${config.isAddon ? 'sí' : 'no'}`);
  if (config.ssl) {
    console.log(`  ▸ HTTPS activo · cert: ${config.certFile} · key: ${config.keyFile}`);
  } else {
    console.log('  ▸ HTTP sin cifrar. Activa «ssl» en las opciones para servir HTTPS.');
  }
  if (config.appPin === '1234') {
    console.log('  ⚠ PIN de usuario por defecto (1234). Define APP_PIN para cambiarlo.');
  }
  if (!config.adminPin) {
    console.log('  ⚠ Sin ADMIN_PIN: el PIN de usuario también actúa como administrador.');
  }
  if (!config.apiToken) {
    console.log('  ⚠ API externa desactivada. Define API_TOKEN para habilitar /api/signal.');
  }
  console.log('');
});

function shutdown(signal) {
  console.log(`[echo] ${signal} recibido, cerrando…`);
  server.close(() => {
    try {
      db.close();
    } catch (_) {
      // noop
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 4000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;
