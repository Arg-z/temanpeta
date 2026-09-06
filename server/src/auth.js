import { query } from './db.js';
import { newToken, bad, hashToken, TOKEN_RE } from './util.js';
import { config } from './config.js';

export const SESSION_COOKIE = 'tp_session';

export async function createSession(userId) {
  const token = newToken();
  await query(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))',
    [hashToken(token), userId, config.tokenTtlDays],
  );
  return token;
}

// Cookie sesi: HttpOnly (tak terbaca JS), Secure (HTTPS saja),
// SameSite=Lax (memblokir CSRF lintas-situs untuk POST/DELETE).
export function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${config.tokenTtlDays * 86400}`,
  );
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

// Ambil token mentah dari header Cookie. Nilai divalidasi lewat allowlist
// hex — string malformed (mis. berisi '%') ditolak tanpa decode, sehingga
// input klien tidak pernah menyentuh decodeURIComponent (CWE-248).
export function sessionTokenFromCookie(header) {
  const match = String(header ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!match) return null;
  const raw = match.slice(SESSION_COOKIE.length + 1);
  return TOKEN_RE.test(raw) ? raw : null;
}

// Ambil token sesi dari cookie (browser) atau Authorization Bearer
// (kompatibilitas skrip/tes — frontend tidak lagi memakai localStorage).
export function tokenFromRequest(req) {
  const fromCookie = sessionTokenFromCookie(req.headers.cookie);
  if (fromCookie) return fromCookie;
  const auth = req.headers.authorization ?? '';
  if (auth.startsWith('Bearer ')) {
    const raw = auth.slice(7).trim();
    return TOKEN_RE.test(raw) ? raw : null;
  }
  return null;
}

export async function deleteSession(token) {
  await query('DELETE FROM sessions WHERE token IN ($1, $2)', [hashToken(token), token]);
}

// Cari sesi berdasarkan token: baris baru tersimpan sebagai hash, baris
// legacy (pra-migrasi) masih plaintext dan otomatis di-upgrade saat terbaca.
async function findSessionUser(token) {
  const hashed = hashToken(token);
  const { rows } = await query(
    `SELECT u.*, s.token AS s_token FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE (s.token = $1 OR s.token = $2) AND s.expires_at > now()`,
    [hashed, token],
  );
  if (rows.length === 0) return [];
  if (rows[0].s_token === token) {
    // Row legacy — upgrade diam-diam ke format hash.
    await query('UPDATE sessions SET token = $1 WHERE token = $2', [hashed, token]);
  }
  return rows;
}

// Mengisi req.user (baris users) dari cookie sesi / Authorization: Bearer.
export async function requireAuth(req, res, next) {
  const token = tokenFromRequest(req);
  if (!token) return bad(res, 401, 'Belum masuk.');
  let rows;
  try {
    rows = await findSessionUser(token);
  } catch (err) {
    return next(err);
  }
  if (rows.length === 0) return bad(res, 401, 'Sesi kedaluwarsa, silakan masuk lagi.');
  if (rows[0].banned) return bad(res, 401, 'Akun kamu diblokir admin.');
  req.user = rows[0];
  req.token = token;
  return next();
}
