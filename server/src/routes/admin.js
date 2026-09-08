// Endpoint khusus admin: daftar pengguna, ban/unban, dan laporan masuk.
// Semua route di sini menuntut sesi aktif dengan is_admin = true.
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { bad, rateLimit, audit } from '../util.js';
import { getUserByPublicId } from '../cards.js';
import { kickUser } from '../ws.js';
import { lookupIp } from '../geo.js';

const router = Router();
router.use(requireAuth);
router.use(rateLimit({ windowMs: 60_000, max: 60, keyFn: (req) => `adm:${req.user.id}` }));
router.use((req, res, next) => {
  if (!req.user.is_admin) return bad(res, 403, 'Khusus admin.');
  audit('admin_access', req);
  return next();
});

// Daftar pengguna (termasuk ID login — data sensitif khusus admin).
router.get('/users', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    const pat = `%${q}%`;
    const { rows } = await query(
      `SELECT u.public_id, u.login_id, u.nickname, u.region_code, u.visibility,
              u.banned, u.created_at,
              EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id) AS sesi_aktif
       FROM users u
       WHERE ($1 = '%%' OR u.nickname ILIKE $1 OR u.login_id ILIKE $1 OR u.public_id ILIKE $1)
       ORDER BY u.created_at DESC
       LIMIT 100`,
      [pat],
    );
    return res.json({ users: rows });
  } catch (err) {
    return next(err);
  }
});

// Ban / unban. Ban menutup semua sesi & koneksi WS secara paksa.
router.post('/ban', async (req, res, next) => {
  try {
    const other = await getUserByPublicId(req.body.publicId);
    if (!other) return bad(res, 404, 'Pengguna tidak ditemukan.');
    if (other.is_admin) return bad(res, 400, 'Tidak bisa memblokir akun admin.');
    const banned = Boolean(req.body.banned);
    await query('UPDATE users SET banned = $2 WHERE id = $1', [other.id, banned]);
    if (banned) {
      await query('DELETE FROM sessions WHERE user_id = $1', [other.id]);
      kickUser(other.id);
    }
    audit(banned ? 'ban' : 'unban', req, `target=${other.public_id}`);
    return res.json({ ok: true, banned });
  } catch (err) {
    return next(err);
  }
});

// Laporan masuk, terbaru dulu.
router.get('/reports', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT r.created_at, rep.nickname AS pelapor, rep.public_id AS pelapor_id,
              rrep.nickname AS dilaporkan, rrep.public_id AS dilaporkan_id, r.reason
       FROM reports r
       JOIN users rep ON rep.id = r.reporter
       JOIN users rrep ON rrep.id = r.reported
       ORDER BY r.created_at DESC
       LIMIT 100`,
    );
    return res.json({ reports: rows });
  } catch (err) {
    return next(err);
  }
});

// Log peristiwa masuk: perangkat, IP, dan perkiraan lokasi IP. Baris tanpa
// lokasi (baru masuk / lookup belum selesai) dipicu ulang di sini secara
// fire-and-forget — tampilan berikutnya sudah terisi dari cache ip_geo.
router.get('/logins', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    const pat = `%${q}%`;
    const { rows } = await query(
      `SELECT l.created_at, l.event, l.ip, l.device, l.os, l.browser, l.user_agent,
              l.geo_city, l.geo_region, l.geo_country, l.geo_isp, l.geo_lat, l.geo_lon,
              u.nickname, u.login_id, u.public_id
       FROM login_events l
       LEFT JOIN users u ON u.id = l.user_id
       WHERE ($1 = '%%' OR u.nickname ILIKE $1 OR u.login_id ILIKE $1
              OR u.public_id ILIKE $1 OR l.ip ILIKE $1)
       ORDER BY l.created_at DESC
       LIMIT 200`,
      [pat],
    );
    for (const ip of [...new Set(rows.filter((r) => r.geo_city === null).map((r) => r.ip))]) {
      lookupIp(ip).catch(() => {});
    }
    audit('admin_logins', req, `n=${rows.length}`);
    return res.json({ logins: rows });
  } catch (err) {
    return next(err);
  }
});

export default router;
