import { query } from './db.js';
import { newToken, bad } from './util.js';
import { config } from './config.js';

export const SESSION_COOKIE = 'tp_session';

export async function createSession(userId) {
  const token = newToken();
  await query(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))',
    [token, userId, config.tokenTtlDays],
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

// Ambil token sesi dari cookie (browser) atau Authorization Bearer
// (kompatibilitas skrip/tes — frontend tidak lagi memakai localStorage).
export function tokenFromRequest(req) {
  const header = req.headers.cookie ?? '';
  const match = header
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (match) return decodeURIComponent(match.slice(SESSION_COOKIE.length + 1));
  const auth = req.headers.authorization ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

export async function deleteSession(token) {
  await query('DELETE FROM sessions WHERE token = $1', [token]);
}

// Mengisi req.user (baris users) dari cookie sesi / Authorization: Bearer.
export async function requireAuth(req, res, next) {
  const token = tokenFromRequest(req);
  if (!token) return bad(res, 401, 'Belum masuk.');
  const { rows } = await query(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  );
  if (rows.length === 0) return bad(res, 401, 'Sesi kedaluwarsa, silakan masuk lagi.');
  if (rows[0].banned) return bad(res, 401, 'Akun kamu diblokir admin.');
  req.user = rows[0];
  req.token = token;
  return next();
}
