import { Router } from 'express';
import { query } from '../db.js';
import {
  hashPassword,
  verifyPassword,
  generatePublicId,
  LOGIN_ID_RE,
  DUMMY_PASSWORD_HASH,
  normalizeNickname,
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
import { kickSession } from '../ws.js';
import { recordLogin } from '../logins.js';
import { containsBadword } from '../badwords.js';

const router = Router();
const limiter = rateLimit({ windowMs: 10 * 60_000, max: 30 });

router.post('/register', limiter, async (req, res, next) => {
  try {
    const loginId = String(req.body.loginId ?? '').trim().toLowerCase();
    const password = String(req.body.password ?? '');
    // Nickname dinormalisasi: satu baris, tanpa karakter kendali/bidi —
    // teksnya tampil di kartu pengguna lain.
    const nickname = normalizeNickname(req.body.nickname);

    if (!LOGIN_ID_RE.test(loginId)) {
      return bad(res, 400, 'ID login harus 3-24 karakter: huruf kecil, angka, atau garis bawah.');
    }
    if (password.length < 8 || password.length > 72) {
      return bad(res, 400, 'Password minimal 8 karakter.');
    }
    if (nickname === null || nickname.length < 2 || nickname.length > 24) {
      return bad(res, 400, 'Nickname harus 2-24 karakter.');
    }
    if (containsBadword(nickname)) {
      return bad(res, 400, 'Nickname mengandung kata yang tidak pantas. Pilih yang lain ya.');
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
        await recordLogin(rows[0].id, 'register', req);
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
    // Validasi format sebelum menyentuh DB maupun log — menolak karakter
    // kontrol yang bisa memalsukan baris audit (CWE-117).
    if (!LOGIN_ID_RE.test(loginId)) {
      return bad(res, 400, 'Format ID login tidak valid.');
    }
    const { rows } = await query('SELECT * FROM users WHERE login_id = $1', [loginId]);
    if (rows.length === 0) {
      // Jalankan scrypt terhadap hash dummy agar waktu respons user yang
      // tidak ada sama dengan yang salah password (anti-enumerasi, CWE-208).
      verifyPassword(password, DUMMY_PASSWORD_HASH);
      audit('login_fail', req, `login=${loginId}`);
      return bad(res, 401, 'ID login atau password salah.');
    }
    if (!verifyPassword(password, rows[0].password_hash)) {
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
    await recordLogin(rows[0].id, 'login_ok', req);
    return res.json({ user: selfUser(rows[0]) });
  } catch (err) {
    return next(err);
  }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await deleteSession(req.token);
    kickSession(req.user.id, req.token);
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
