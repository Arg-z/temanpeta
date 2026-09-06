import { Router } from 'express';
import { query, pair } from '../db.js';
import { requireAuth } from '../auth.js';
import { bad, rateLimit, audit } from '../util.js';
import { getUserByPublicId, userCard, blockedBetween, isFriendPair } from '../cards.js';
import { publish, isOnline } from '../ws.js';

const router = Router();
router.use(requireAuth);
// Anti-abuse: maks 10 permintaan pertemanan / 10 menit per pengguna.
const frLimiter = rateLimit({ windowMs: 10 * 60_000, max: 10, keyFn: (req) => `fr:${req.user.id}` });

function requestCard(row, side) {
  return {
    id: row.id,
    createdAt: row.created_at,
    [side]: {
      publicId: row.public_id,
      nickname: row.nickname,
      online: isOnline(row.user_id),
    },
  };
}

// Kirim permintaan pertemanan. Bila lawan sudah lebih dulu mengirim ke kita,
// permintaannya otomatis diterima.
router.post('/friend-requests', frLimiter, async (req, res, next) => {
  audit('friend_request', req, `target=${req.body.publicId ?? '?'}`);
  try {
    const other = await getUserByPublicId(req.body.publicId);
    if (!other) return bad(res, 404, 'Pengguna tidak ditemukan.');
    if (other.id === req.user.id) return bad(res, 400, 'Tidak bisa menambahkan diri sendiri.');
    if (await blockedBetween(req.user.id, other.id)) {
      return bad(res, 403, 'Tidak bisa mengirim permintaan ke pengguna ini.');
    }
    if (await isFriendPair(req.user.id, other.id)) return bad(res, 409, 'Sudah berteman.');

    // Mereka sudah lebih dulu mengirim permintaan → terima saja.
    const { rows: existingFromThem } = await query(
      'SELECT * FROM friend_requests WHERE from_user = $2 AND to_user = $1',
      [req.user.id, other.id],
    );
    if (existingFromThem.length > 0) {
      const [low, high] = pair(req.user.id, other.id);
      await query(
        'INSERT INTO friendships (user_low, user_high) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [low, high],
      );
      await query('DELETE FROM friend_requests WHERE from_user = $1 AND to_user = $2', [
        other.id,
        req.user.id,
      ]);
      publish(other.id, {
        type: 'friend_request.accepted',
        friend: userCard(req.user, { isFriend: true }),
      });
      return res.status(201).json({ accepted: true, friend: userCard(other, { isFriend: true }) });
    }

    const { rows: mine } = await query(
      'SELECT * FROM friend_requests WHERE from_user = $1 AND to_user = $2',
      [req.user.id, other.id],
    );
    if (mine.length > 0) return bad(res, 409, 'Permintaan sudah dikirim sebelumnya.');

    const { rows } = await query(
      'INSERT INTO friend_requests (from_user, to_user) VALUES ($1, $2) RETURNING id',
      [req.user.id, other.id],
    );
    publish(other.id, {
      type: 'friend_request.new',
      request: {
        id: rows[0].id,
        from: { publicId: req.user.public_id, nickname: req.user.nickname, online: true },
      },
    });
    return res.status(201).json({ id: rows[0].id });
  } catch (err) {
    return next(err);
  }
});

router.get('/friend-requests', async (req, res, next) => {
  try {
    const incoming = await query(
      `SELECT r.*, u.public_id, u.nickname, u.id AS user_id
       FROM friend_requests r JOIN users u ON u.id = r.from_user
       WHERE r.to_user = $1 ORDER BY r.created_at DESC`,
      [req.user.id],
    );
    const outgoing = await query(
      `SELECT r.*, u.public_id, u.nickname, u.id AS user_id
       FROM friend_requests r JOIN users u ON u.id = r.to_user
       WHERE r.from_user = $1 ORDER BY r.created_at DESC`,
      [req.user.id],
    );
    return res.json({
      incoming: incoming.rows.map((r) => requestCard(r, 'from')),
      outgoing: outgoing.rows.map((r) => requestCard(r, 'to')),
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/friend-requests/:id/accept', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT r.id AS request_id, r.from_user, r.to_user, u.*
       FROM friend_requests r JOIN users u ON u.id = r.from_user WHERE r.id = $1`,
      [req.params.id],
    );
    const request = rows[0];
    if (!request) return bad(res, 404, 'Permintaan tidak ditemukan.');
    if (request.to_user !== req.user.id) return bad(res, 403, 'Bukan permintaan untukmu.');

    const [low, high] = pair(request.from_user, request.to_user);
    await query(
      'INSERT INTO friendships (user_low, user_high) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [low, high],
    );
    await query('DELETE FROM friend_requests WHERE id = $1', [request.request_id]);
    publish(request.from_user, {
      type: 'friend_request.accepted',
      friend: userCard(req.user, { isFriend: true }),
    });
    return res.json({ friend: userCard(request, { isFriend: true }) });
  } catch (err) {
    return next(err);
  }
});

// Menolak permintaan masuk atau menarik permintaan keluar.
router.delete('/friend-requests/:id', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM friend_requests WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return bad(res, 404, 'Permintaan tidak ditemukan.');
    if (rows[0].to_user !== req.user.id && rows[0].from_user !== req.user.id) {
      return bad(res, 403, 'Bukan permintaanmu.');
    }
    await query('DELETE FROM friend_requests WHERE id = $1', [req.params.id]);
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
});

router.get('/friends', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT u.* FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_low = $1 THEN f.user_high ELSE f.user_low END
       WHERE f.user_low = $1 OR f.user_high = $1
       ORDER BY u.nickname`,
      [req.user.id],
    );
    return res.json({ friends: rows.map((row) => userCard(row, { isFriend: true })) });
  } catch (err) {
    return next(err);
  }
});

router.delete('/friends/:publicId', async (req, res, next) => {
  try {
    const other = await getUserByPublicId(req.params.publicId);
    if (!other) return bad(res, 404, 'Pengguna tidak ditemukan.');
    const [low, high] = pair(req.user.id, other.id);
    await query('DELETE FROM friendships WHERE user_low = $1 AND user_high = $2', [low, high]);
    publish(other.id, { type: 'friend.removed', publicId: req.user.public_id });
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
});

export default router;
