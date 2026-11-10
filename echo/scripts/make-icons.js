'use strict';

/**
 * Genera los iconos PNG de Echo sin dependencias externas.
 * Marca: ondas concéntricas blancas sobre verde institucional.
 *
 *   node scripts/make-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'icons');
fs.mkdirSync(OUT, { recursive: true });

/* ----------------------------- PNG encoder ----------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------- Drawing ------------------------------- */

const GREEN_DARK = [0x00, 0x5f, 0x28];
const GREEN = [0x00, 0x7a, 0x33];
const GREEN_LIGHT = [0x00, 0x95, 0x40];

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function renderIcon(size, paddingRatio = 0.15) {
  const SS = 3;
  const dim = size * SS;
  const image = Buffer.alloc(dim * dim * 4);

  const cx = dim * 0.5;
  const cy = dim * 0.5;
  const maxR = dim * (0.5 - paddingRatio);

  const rings = [
    { r: maxR * 0.96, width: maxR * 0.085, alpha: 0.32 },
    { r: maxR * 0.67, width: maxR * 0.095, alpha: 0.62 },
    { r: maxR * 0.38, width: maxR * 0.11, alpha: 1 },
  ];
  const dotR = maxR * 0.115;

  for (let y = 0; y < dim; y += 1) {
    for (let x = 0; x < dim; x += 1) {
      const index = (y * dim + x) * 4;
      const t = (x / dim) * 0.55 + (y / dim) * 0.45;
      const base = t < 0.5 ? mix(GREEN_DARK, GREEN, t * 2) : mix(GREEN, GREEN_LIGHT, (t - 0.5) * 2);

      let r = base[0];
      let g = base[1];
      let b = base[2];

      // Viñeta sutil para dar profundidad editorial.
      const nx = x / dim - 0.5;
      const ny = y / dim - 0.5;
      const vignette = Math.max(0, 1 - Math.hypot(nx, ny) * 1.15) * 0.06;
      r = Math.round(r * (1 - vignette) + 255 * vignette * 0.12);
      g = Math.round(g * (1 - vignette) + 255 * vignette * 0.12);
      b = Math.round(b * (1 - vignette) + 255 * vignette * 0.12);

      const distance = Math.hypot(x - cx, y - cy);

      if (distance <= dotR) {
        r = 255;
        g = 255;
        b = 255;
      } else {
        for (const ring of rings) {
          const edge = Math.abs(distance - ring.r);
          if (edge <= ring.width / 2) {
            const feather = Math.max(0, 1 - edge / (ring.width / 2));
            const alpha = ring.alpha * Math.min(1, feather * 2.2);
            r = Math.round(r * (1 - alpha) + 255 * alpha);
            g = Math.round(g * (1 - alpha) + 255 * alpha);
            b = Math.round(b * (1 - alpha) + 255 * alpha);
          }
        }
      }

      image[index] = r;
      image[index + 1] = g;
      image[index + 2] = b;
      image[index + 3] = 255;
    }
  }

  // Downsample (supersampling) para bordes suaves.
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const index = ((y * SS + sy) * dim + (x * SS + sx)) * 4;
          r += image[index];
          g += image[index + 1];
          b += image[index + 2];
        }
      }
      const count = SS * SS;
      const index = (y * size + x) * 4;
      out[index] = Math.round(r / count);
      out[index + 1] = Math.round(g / count);
      out[index + 2] = Math.round(b / count);
      out[index + 3] = 255;
    }
  }
  return out;
}

const outputs = [
  [path.join(OUT, 'icon-192.png'), 192, 0.15],
  [path.join(OUT, 'icon-512.png'), 512, 0.15],
  [path.join(OUT, 'icon-maskable-512.png'), 512, 0.23],
  [path.join(OUT, 'apple-touch-icon.png'), 180, 0.16],
  [path.join(OUT, 'favicon-32.png'), 32, 0.12],
  [path.join(ROOT, 'icon.png'), 192, 0.15],
  [path.join(ROOT, 'logo.png'), 512, 0.15],
];

for (const [file, size, padding] of outputs) {
  const png = encodePng(size, size, renderIcon(size, padding));
  fs.writeFileSync(file, png);
  console.log(`✓ ${path.relative(ROOT, file)} (${size}px, ${png.length} bytes)`);
}
