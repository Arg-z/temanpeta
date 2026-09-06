import { Router } from 'express';
import { query, pair } from '../db.js';
import { requireAuth } from '../auth.js';
import { bad, rateLimit, audit } from '../util.js';
import { getUserByPublicId, isFriendPair, blockedBetween } from '../cards.js';
import { publish } from '../ws.js';

const router = Router();
router.use(requireAuth);
// Anti-spam: maks 30 pesan/menit per pengguna.
const msgLimiter = rateLimit({ windowMs: 60_000, max: 30, keyFn: (req) => `msg:${req.user.id}` });

async function requireConversation(req, res) {
  const other = await getUserByPublicId(req.params.publicId ?? req.body.to);
  if (!other) {
    bad(res, 404, 'Pengguna tidak ditemukan.');
    return null;
  }
  if (!(await isFriendPair(req.user.id, other.id))) {
    bad(res, 403, 'Hanya antar teman.');
    return null;
  }
  if (await blockedBetween(req.user.id, other.id)) {
    bad(res, 403, 'Chat dengan pengguna ini terblokir.');
    return null;
  }
  return other;
}

// Riwayat pesan, paling lama dulu. ?before=<id> untuk halaman sebelumnya.
router.get('/messages/:publicId', async (req, res, next) => {
  try {
    const other = await requireConversation(req, res);
    if (!other) return;
    const [low, high] = pair(req.user.id, other.id);
    const before = Number.isFinite(Number(req.query.before)) ? Number(req.query.before) : Number.MAX_SAFE_INTEGER;
    // Clamp ketat [1,100]: nilai negatif/nonsense tidak boleh sampai ke
    // PostgreSQL sebagai LIMIT (sebelumnya menyebabkan 500).
    const limit = Math.min(Math.max(Math.trunc(Number(req.query.limit) || 50), 1), 100);
    const { rows } = await query(
      `SELECT id, sender_id, body, created_at FROM messages
       WHERE user_low = $1 AND user_high = $2 AND id < $3
       ORDER BY id DESC LIMIT $4`,
      [low, high, before, limit],
    );
    rows.reverse();
    return res.json({
      messages: rows.map((r) => ({
        id: r.id,
        mine: r.sender_id === req.user.id,
        body: r.body,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/messages', msgLimiter, async (req, res, next) => {
  try {
    const other = await requireConversation(req, res);
    if (!other) return;
    const body = String(req.body.body ?? '').trim();
    if (body.length === 0 || body.length > 2000) {
      return bad(res, 400, 'Pesan harus 1-2000 karakter.');
    }
    const [low, high] = pair(req.user.id, other.id);
    const { rows } = await query(
      'INSERT INTO messages (user_low, user_high, sender_id, body) VALUES ($1, $2, $3, $4) RETURNING id, created_at',
      [low, high, req.user.id, body],
    );
    const message = {
      id: rows[0].id,
      from: req.user.public_id,
      body,
      createdAt: rows[0].created_at,
    };
    publish(other.id, { type: 'message.new', message });
    return res.status(201).json({ id: message.id, createdAt: message.createdAt });
  } catch (err) {
    return next(err);
  }
});

export default router;
