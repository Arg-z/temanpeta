import crypto from 'node:crypto';

// Alfabet ID publik tanpa karakter mudah tertukar (tanpa O, 0, I, 1).
export const PUBLIC_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePublicId(len = 8) {
  const bytes = crypto.randomBytes(len);
  let id = '';
  for (let i = 0; i < len; i += 1) id += PUBLIC_ID_ALPHABET[bytes[i] % PUBLIC_ID_ALPHABET.length];
  return id;
}

export function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Token sesi disimpan ter-hash di DB (prefix membedakan dari token plaintext
// legacy yang belum ter-upgrade). Kebocoran baca DB tidak lagi = ambil alih sesi.
export function hashToken(token) {
  return `sha256$${crypto.createHash('sha256').update(token).digest('hex')}`;
}

// Token sesi selalu 64 hex dari crypto.randomBytes — allowlist ketat ini
// menolak nilai cookie malformed tanpa perlu decode apa pun (CWE-248).
export const TOKEN_RE = /^[0-9a-f]{64}$/;

// Hash scrypt dummy untuk menjaga timing login tetap mahal ketika user tidak
// ditemukan (anti-enumerasi via timing, CWE-208). Nilainya bukan rahasia.
export const DUMMY_PASSWORD_HASH =
  'scrypt$3f9c2b1a7e5d40c8b6a29d31f4e8c07a$c4f2a86be1d93c0758af2e61d4b98c05e7a31f6c8d29b407ae15f3d8c06b2197e5a48f1c3d20b697e4f8a1c5d30b2e79f46a18c5d2e3b708f49a1c6d5e03bf';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}

export function haversineKm(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const LOGIN_ID_RE = /^[a-z0-9_]{3,24}$/;

// Bio profil: panjang maksimum dalam satuan UTF-16 (selaras dengan atribut
// maxlength pada textarea di frontend).
export const BIO_MAX = 160;

// Rapikan bio sebelum disimpan. Baris baru diizinkan (bio boleh dua baris),
// tetapi karakter kontrol C0/C1 lain dibuang supaya input klien tidak bisa
// menyelipkan karakter kendali ke tampilan orang lain. Zero-width joiner
// (U+200D) sengaja DIPERTAHANKAN agar emoji gabungan tetap utuh.
// Mengembalikan null bila nilai bukan string (pemanggil membalas 400).
export function normalizeBio(value) {
  if (typeof value !== 'string') return null;
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[^\S\n]+/g, ' ') // tab/spasi beruntun → satu spasi
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function bad(res, status, message) {
  return res.status(status).json({ error: message });
}

// Pembatas laju sederhana per IP / per pengguna untuk endpoint sensitif.
const buckets = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.reset < now) buckets.delete(key);
  }
}, 10 * 60_000).unref();

export function rateLimit({ windowMs, max, keyFn }) {
  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : (req.ip ?? 'unknown');
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.reset < now) {
      buckets.set(key, { count: 1, reset: now + windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > max) return bad(res, 429, 'Terlalu banyak percobaan, coba lagi nanti.');
    return next();
  };
}

// Reset bucket rate limit — untuk test saja.
export function resetRateLimits() {
  buckets.clear();
}

// Catatan audit ringkas ke log container. JANGAN pernah memasukkan
// password, token, cookie, atau isi pesan ke sini.
function cleanLog(value, max = 200) {
  // Karakter kontrol/newline dibuang agar input klien tidak bisa memalsukan
  // baris audit sendiri (CWE-117 log injection).
  return String(value).replace(/[\x00-\x1f\x7f]/g, '').slice(0, max);
}

export function audit(event, req, extra = '') {
  const ip = cleanLog(req.ip ?? 'unknown', 64);
  const user = req.user?.public_id ?? '-';
  console.log(`[AUDIT] ${new Date().toISOString()} event=${cleanLog(event, 32)} ip=${ip} user=${user}${extra ? ` ${cleanLog(extra)}` : ''}`);
}
