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
export function audit(event, req, extra = '') {
  const ip = req.ip ?? 'unknown';
  const user = req.user?.public_id ?? '-';
  console.log(`[AUDIT] ${new Date().toISOString()} event=${event} ip=${ip} user=${user}${extra ? ` ${extra}` : ''}`);
}
