import { Router } from 'express';
import { query, pair } from '../db.js';
import { requireAuth } from '../auth.js';
import { bad, rateLimit, audit } from '../util.js';
import { getUserByPublicId } from '../cards.js';
import { publish } from '../ws.js';
import { notifyReportByEmail } from '../mailer.js';

const router = Router();
router.use(requireAuth);
// Laporan dibatasi agar tidak jadi sarang spam.
const reportLimiter = rateLimit({ windowMs: 3600_000, max: 10, keyFn: (req) => `rep:${req.user.id}` });

// Memblokir: sekaligus memutus pertemanan dan permintaan yang menghubungkan.
router.post('/blocks', async (req, res, next) => {
  try {
    const other = await getUserByPublicId(req.body.publicId);
    if (!other) return bad(res, 404, 'Pengguna tidak ditemukan.');
    if (other.id === req.user.id) return bad(res, 400, 'Tidak bisa memblokir diri sendiri.');
    await query('INSERT INTO blocks (blocker, blocked) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
      req.user.id,
      other.id,
    ]);
    const [low, high] = pair(req.user.id, other.id);
    await query('DELETE FROM friendships WHERE user_low = $1 AND user_high = $2', [low, high]);
    await query(
      'DELETE FROM friend_requests WHERE (from_user = $1 AND to_user = $2) OR (from_user = $2 AND to_user = $1)',
      [req.user.id, other.id],
    );
    publish(other.id, { type: 'friend.removed', publicId: req.user.public_id });
    return res.status(201).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

router.get('/blocks', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT u.public_id, u.nickname FROM blocks b
       JOIN users u ON u.id = b.blocked WHERE b.blocker = $1 ORDER BY u.nickname`,
      [req.user.id],
    );
    return res.json({ blocks: rows });
  } catch (err) {
    return next(err);
  }
});

router.delete('/blocks/:publicId', async (req, res, next) => {
  try {
    const other = await getUserByPublicId(req.params.publicId);
    if (!other) return bad(res, 404, 'Pengguna tidak ditemukan.');
    await query('DELETE FROM blocks WHERE blocker = $1 AND blocked = $2', [
      req.user.id,
      other.id,
    ]);
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
});

// Laporan disimpan untuk ditinjau admin lewat database (panel moderasi menyusul).
router.post('/reports', reportLimiter, async (req, res, next) => {
  audit('report', req, `target=${req.body.publicId ?? '?'}`);
  try {
    const other = await getUserByPublicId(req.body.publicId);
    if (!other) return bad(res, 404, 'Pengguna tidak ditemukan.');
    const reason = String(req.body.reason ?? '').trim().slice(0, 500);
    await query('INSERT INTO reports (reporter, reported, reason) VALUES ($1, $2, $3)', [
      req.user.id,
      other.id,
      reason || null,
    ]);
    // Email notifikasi dikirim asinkron — kegagalan SMTP tidak gagalkan laporan.
    notifyReportByEmail({ reporter: req.user, reported: other, reason: reason || null }).catch(
      (err) => console.error('Gagal kirim email laporan:', err.message),
    );
    return res.status(201).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
