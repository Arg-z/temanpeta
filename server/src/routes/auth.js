import { Router } from 'express';
import { query } from '../db.js';
import {
  hashPassword,
  verifyPassword,
  generatePublicId,
  LOGIN_ID_RE,
  bad,
  rateLimit,
  audit,
} from '../util.js';
import {
  createSession,
  deleteSession,
  requireAuth,
  setSessionCookie,
  clearSessionCookie,
  tokenFromRequest,
} from '../auth.js';
import { selfUser } from '../cards.js';

const router = Router();
const limiter = rateLimit({ windowMs: 10 * 60_000, max: 30 });

router.post('/register', limiter, async (req, res, next) => {
  try {
    const loginId = String(req.body.loginId ?? '').trim().toLowerCase();
    const password = String(req.body.password ?? '');
    const nickname = String(req.body.nickname ?? '').trim();

    if (!LOGIN_ID_RE.test(loginId)) {
      return bad(res, 400, 'ID login harus 3-24 karakter: huruf kecil, angka, atau garis bawah.');
    }
    if (password.length < 8 || password.length > 72) {
      return bad(res, 400, 'Password minimal 8 karakter.');
    }
    if (nickname.length < 2 || nickname.length > 24) {
      return bad(res, 400, 'Nickname harus 2-24 karakter.');
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const { rows } = await query(
          'INSERT INTO users (login_id, password_hash, public_id, nickname) VALUES ($1, $2, $3, $4) RETURNING *',
          [loginId, hashPassword(password), generatePublicId(), nickname],
        );
        const token = await createSession(rows[0].id);
        setSessionCookie(res, token);
        audit('register', req, `user=${rows[0].public_id}`);
        return res.status(201).json({ user: selfUser(rows[0]) });
      } catch (err) {
        if (err.code === '23505') {
          if (err.constraint?.includes('login_id')) {
            audit('register_dup', req, `login=${loginId}`);
            return bad(res, 409, 'ID login sudah dipakai.');
          }
          continue; // ID publik bentrok, coba karakter acak baru.
        }
        throw err;
      }
    }
    return bad(res, 500, 'Gagal membuat ID publik, coba lagi.');
  } catch (err) {
    return next(err);
  }
});

router.post('/login', limiter, async (req, res, next) => {
  try {
    const loginId = String(req.body.loginId ?? '').trim().toLowerCase();
    const password = String(req.body.password ?? '');
    const { rows } = await query('SELECT * FROM users WHERE login_id = $1', [loginId]);
    if (rows.length === 0 || !verifyPassword(password, rows[0].password_hash)) {
      audit('login_fail', req, `login=${loginId}`);
      return bad(res, 401, 'ID login atau password salah.');
    }
    if (rows[0].banned) {
      audit('login_banned', req, `user=${rows[0].public_id}`);
      return bad(res, 403, 'Akun kamu diblokir admin.');
    }
    const token = await createSession(rows[0].id);
    setSessionCookie(res, token);
    audit('login_ok', req, `user=${rows[0].public_id}`);
    return res.json({ user: selfUser(rows[0]) });
  } catch (err) {
    return next(err);
  }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await deleteSession(req.token);
    clearSessionCookie(res);
    audit('logout', req, `user=${req.user.public_id}`);
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
});

router.get('/me', requireAuth, (req, res) => {
  // Respons data pribadi: jangan ikut di-cache.
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ user: selfUser(req.user) });
});

export default router;
