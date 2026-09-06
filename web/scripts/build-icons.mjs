// Generator ikon pixel-art TemanPeta (PNG murni, tanpa dependensi).
// Desain: pin lokasi teal dengan lubang krem di atas latar navy.
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Palet tema (harus senada style.css)
const BG = [16, 26, 46, 255]; // #101a2e navy
const TEAL = [63, 193, 176, 255]; // #3fc1b0
const CREAM = [240, 230, 210, 255]; // #f0e6d2
const AMBER = [233, 169, 78, 255]; // #e9a94e

// Grid desain 16x16: T=teal C=krem .=latar — pin lokasi teardrop simetris
const GRID = [
  '................',
  '.....TTTTTT.....',
  '....TTTTTTTT....',
  '...TTTTTTTTTT...',
  '...TTTTCCTTTT...',
  '...TTTTCCTTTT...',
  '...TTTTTTTTTT...',
  '...TTTTTTTTTT...',
  '....TTTTTTTT....',
  '.....TTTTTT.....',
  '.....TTTTTT.....',
  '......TTTT......',
  '......TTTT......',
  '.......TT.......',
  '................',
  '................',
];

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: none
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function renderIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = Math.floor((x * 16) / size);
      const gy = Math.floor((y * 16) / size);
      const ch = GRID[gy]?.[gx] ?? '.';
      const color = ch === 'T' ? TEAL : ch === 'C' ? CREAM : ch === 'A' ? AMBER : BG;
      const i = (y * size + x) * 4;
      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = color[3];
    }
  }
  return encodePNG(size, size, px);
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of [32, 180, 192, 512]) {
  fs.writeFileSync(path.join(OUT, `icon-${size}.png`), renderIcon(size));
  console.log(`icon-${size}.png ditulis`);
}
