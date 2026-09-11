// Filter kata kasar — memindai teks dengan daftar dari data/badwords.json.
//
// Dua tier agar akurat untuk bahasa Indonesia (banyak kata baik mengandung
// "segmen" kasar: panta-I, kana-L, men-TAI-kan):
//   - "kasar": dicocokkan PERSIS per token setelah normalisasi. "pantai" lolos,
//     "tai" sendirian kena.
//   - "berat": kata vulgar berat (>= 4 huruf, kurasi manual) dicocokkan juga
//     pada teks TANPA SPASI, sehingga trik "n g e n t o t" atau "an jing" tetap
//     kena. Tier ini sempit sengaja, supaya substring tidak menimpa kata baik.
//
// Normalisasi per token (HANYA untuk pencocokan — teks asli tidak diubah):
//   - pemetaan leetspeak: anj1ng, b4bi, g0blok, k0nt0l
//   - huruf beruntun dirapatkan: anjiiing -> anjing
//   - pemisah dalam kata dibuang: a.nj.ing / a-njing -> anjing
//
// Dua pemakaian:
//   - containsBadword()  → nickname & bio DITOLAK bila memuat kata terlarang.
//   - maskBadwords()     → pesan chat TETAP TERKIRIM dengan token terlarang
//                          diganti bintang sepanjang panjang aslinya.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const data = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'badwords.json'), 'utf8'),
);
const KASAR = new Set(data.kasar);
const BERAT = data.berat;

// Pemetaan karakter ke huruf — dipakai penyanteri untuk menghindari filter.
const LEET = new Map(Object.entries({
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
  '@': 'a', '$': 's', '!': 'i', '+': 't',
}));

function normToken(token) {
  // Tanda baca di tepi token dibuang dulu — kalau tidak, "sialan!" dipetakan
  // "!"->i menjadi "sialani" dan lolos dari daftar.
  let s = String(token).toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  let out = '';
  for (const ch of s) out += LEET.get(ch) ?? ch;
  out = out.replace(/[^a-z]/g, '');
  // Rapatkan huruf beruntun setelah strip — "anjiiing" dan "a..njj.ing" jadi sama.
  return out.replace(/(.)\1+/g, '$1');
}

// Pindai teks dan kembalikan span token (posisi di teks ASLI) yang terlarang,
// berurutan kiri-ke-kanan. Satu mesin untuk deteksi maupun sensor.
function badTokenSpans(text) {
  if (typeof text !== 'string') return [];
  const tokens = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ start: m.index, end: m.index + m[0].length });
  }
  if (tokens.length === 0) return [];

  // Rangkai versi ternormalisasi sambil mencatat posisi tiap token di dalamnya,
  // agar kata tier "berat" yang membentang lintas token ("n g e n t o t") bisa
  // dipetakan balik ke token aslinya.
  const norms = tokens.map((_, i) => normToken(text.slice(tokens[i].start, tokens[i].end)));
  let joined = '';
  const spans = norms.map((n, i) => {
    const span = { start: joined.length, end: joined.length + n.length };
    joined += n;
    return span;
  });

  const bad = new Set();
  norms.forEach((n, i) => {
    if (n && KASAR.has(n)) bad.add(i);
  });
  for (const w of BERAT) {
    let p = joined.indexOf(w);
    while (p !== -1) {
      // Span ke-i milik token ke-i — pakai indeks entries(), bukan properti.
      for (const [i, s] of spans.entries()) {
        if (s.end > p && s.start < p + w.length) bad.add(i);
      }
      p = joined.indexOf(w, p + 1);
    }
  }
  return tokens.filter((_, i) => bad.has(i));
}

// true bila teks memuat kata kasar — dipakai untuk menolak nickname/bio.
export function containsBadword(text) {
  return badTokenSpans(text).length > 0;
}

// Sensor: token terlarang diganti bintang sepanjang panjang aslinya.
// Spasi dan tanda baca di sekelilingnya tetap utuh.
export function maskBadwords(text) {
  const bad = badTokenSpans(text);
  if (bad.length === 0) return text;
  let out = '';
  let last = 0;
  for (const t of bad) {
    out += text.slice(last, t.start) + '*'.repeat(t.end - t.start);
    last = t.end;
  }
  return out + text.slice(last);
}
