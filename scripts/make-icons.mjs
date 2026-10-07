// Generates public/icon/{16,32,48,128}.png (a magnifier on an orange tile)
// without any image dependency: rasterised with signed distances, encoded
// with node:zlib. Run: node scripts/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const clamp = (v) => Math.max(0, Math.min(1, v));
function icon(size) {
  const S = 4; // supersampling
  return png(size, (px, py) => {
    let tile = 0, glyph = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const x = (px + (sx + 0.5) / S) / size, y = (py + (sy + 0.5) / S) / size;
      // rounded square tile
      const r = 0.2, qx = Math.abs(x - 0.5) - (0.5 - r), qy = Math.abs(y - 0.5) - (0.5 - r);
      const dTile = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
      if (dTile <= 0) tile++;
      // magnifier: ring + handle
      const cx = 0.43, cy = 0.43, R = 0.22, w = 0.075;
      const ring = Math.abs(Math.hypot(x - cx, y - cy) - R) - w / 2;
      const t = clamp(((x - 0.6) * 1 + (y - 0.6) * 1) / (2 * 0.2 * 0.2 + 2 * 0.2 * 0.2) * 0.4);
      const hx = 0.6 + t * 0.2, hy = 0.6 + t * 0.2;
      const handle = Math.hypot(x - hx, y - hy) - 0.06;
      if (Math.min(ring, handle) <= 0) glyph++;
    }
    const a = tile / (S * S), g = glyph / (S * S);
    const bg = [194, 65, 12];
    return [Math.round(bg[0] + (255 - bg[0]) * g), Math.round(bg[1] + (255 - bg[1]) * g), Math.round(bg[2] + (255 - bg[2]) * g), Math.round(255 * a)];
  });
}

mkdirSync('public/icon', { recursive: true });
for (const s of [16, 32, 48, 128]) writeFileSync(`public/icon/${s}.png`, icon(s));
console.log('icons written');
