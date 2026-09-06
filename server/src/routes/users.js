import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { bad, rateLimit } from '../util.js';
import { searchRegions, snapLocation, getRegion } from '../regions.js';
import { userCard, selfUser, getUserByPublicId, isFriendPair, blockedBetween, relationTo } from '../cards.js';
import { broadcastOthers, isOnline } from '../ws.js';

const router = Router();
router.use(requireAuth);
// Pencarian & peta dibatasi agar tidak jadi alat enumerasi massal.
const searchLimiter = rateLimit({ windowMs: 60_000, max: 30, keyFn: (req) => `srch:${req.user.id}` });
const presenceLimiter = rateLimit({ windowMs: 60_000, max: 30, keyFn: (req) => `pres:${req.user.id}` });
const meLimiter = rateLimit({ windowMs: 60_000, max: 20, keyFn: (req) => `me:${req.user.id}` });

router.get('/regions', (req, res) => {
  res.json({
    regions: searchRegions(req.query.q).map((r) => ({
      code: r.code,
      name: r.kind === 'city' ? `${r.name}, ${r.provinceName}` : r.name,
      kind: r.kind,
      type: r.type ?? null,
      lat: r.lat,
      lng: r.lng,
    })),
  });
});

// Peta global: semua pengguna lain yang sedang online dengan visibilitas nyala.
// Aturan saling visibilitas — saklar nyala = bisa dilihat semua user lain.
router.get('/presence-map', presenceLimiter, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM users
       WHERE id <> $1 AND visibility AND region_code IS NOT NULL`,
      [req.user.id],
    );
    const users = rows
      .filter((row) => isOnline(row.id))
      .map((row) => {
        const reg = getRegion(row.region_code);
        return {
          ...userCard(row),
          lat: reg?.lat ?? null,
          lng: reg?.lng ?? null,
        };
      })
      .filter((u) => u.lat != null);
    return res.json({ users });
  } catch (err) {
    return next(err);
  }
});

router.patch('/me', meLimiter, async (req, res, next) => {
  try {
    const updates = [];
    const params = [req.user.id];
    if (req.body.nickname !== undefined) {
      const nickname = String(req.body.nickname).trim();
      if (nickname.length < 2 || nickname.length > 24) {
        return bad(res, 400, 'Nickname harus 2-24 karakter.');
      }
      params.push(nickname);
      updates.push(`nickname = $${params.length}`);
    }
    if (req.body.visibility !== undefined) {
      params.push(Boolean(req.body.visibility));
      updates.push(`visibility = $${params.length}`);
    }
    if (updates.length === 0) return bad(res, 400, 'Tidak ada perubahan.');
    const { rows } = await query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
      params,
    );
    // Perubahan visibilitas diumumkan realtime: titiknya muncul/hilang
    // di peta pengguna lain tanpa perlu refresh. Saat menyala, ikutkan
    // nickname + centroid wilayah agar titik bisa langsung digambar.
    if (req.body.visibility !== undefined) {
      const reg = rows[0].region_code ? getRegion(rows[0].region_code) : null;
      broadcastOthers(req.user.id, {
        type: 'user.visibility',
        publicId: rows[0].public_id,
        visible: rows[0].visibility,
        ...(rows[0].visibility
          ? { nickname: rows[0].nickname, lat: reg?.lat ?? null, lng: reg?.lng ?? null }
          : {}),
      });
    }
    return res.json({ user: selfUser(rows[0]) });
  } catch (err) {
    return next(err);
  }
});

// Koordinat dikirim hanya saat mengaktifkan visibilitas; server menyimpan
// wilayahnya saja, tidak ada koordinat presisi di database.
router.post('/me/location', async (req, res, next) => {
  try {
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return bad(res, 400, 'Koordinat tidak valid.');
    }
    const region = snapLocation(lat, lng);
    if (!region) return bad(res, 400, 'Lokasi tidak dikenali.');
    const { rows } = await query(
      'UPDATE users SET region_code = $2 WHERE id = $1 RETURNING *',
      [req.user.id, region.code],
    );
    return res.json({ region: { code: region.code, name: region.name } , user: selfUser(rows[0]) });
  } catch (err) {
    return next(err);
  }
});

// Cari pengguna: cocokkan ID publik persis atau nickname.
// ID publik yang dibagikan secara sengaja selalu bisa dicari — visibilitas
// hanya mengatur tampil di peta/daftar wilayah dan pencarian nickname.
router.get('/users', searchLimiter, async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) return res.json({ users: [] });
    const exact = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const { rows } = await query(
      `SELECT * FROM users u
       WHERE u.id <> $1
         AND (
           u.public_id = $2
           OR (
             u.nickname ILIKE $3
             AND (
               u.visibility
               OR EXISTS (SELECT 1 FROM friendships f
                          WHERE (f.user_low = $1 AND f.user_high = u.id)
                             OR (f.user_high = $1 AND f.user_low = u.id))
             )
           )
         )
         AND NOT EXISTS (SELECT 1 FROM blocks b
                         WHERE (b.blocker = $1 AND b.blocked = u.id)
                            OR (b.blocker = u.id AND b.blocked = $1))
       ORDER BY (u.public_id = $2) DESC, u.nickname
       LIMIT 20`,
      // Kecocokan ID publik persis hanya bila q tepat 8 karakter; string kosong
      // tidak akan pernah cocok dengan ID publik.
      [req.user.id, exact.length === 8 ? exact : '', `%${q}%`],
    );
    const users = [];
    for (const row of rows) {
      const reg = row.region_code ? getRegion(row.region_code) : null;
      users.push({
        ...userCard(row, { isFriend: await isFriendPair(req.user.id, row.id) }),
        lat: reg?.lat ?? null,
        lng: reg?.lng ?? null,
      });
    }
    return res.json({ users });
  } catch (err) {
    return next(err);
  }
});

// Daftar pengguna bervisibilitas nyala di suatu wilayah (kota atau provinsi).
router.get('/users/region/:code', async (req, res, next) => {
  try {
    const region = getRegion(req.params.code);
    if (!region) return bad(res, 404, 'Wilayah tidak ditemukan.');
    const { rows } = await query(
      `SELECT * FROM users u
       WHERE u.visibility AND u.id <> $1
         AND (u.region_code = $2 OR u.region_code LIKE $3 || '.%')
         AND NOT EXISTS (SELECT 1 FROM blocks b
                         WHERE (b.blocker = $1 AND b.blocked = u.id)
                            OR (b.blocker = u.id AND b.blocked = $1))
       ORDER BY u.nickname
       LIMIT 100`,
      [req.user.id, region.code, region.code],
    );
    const users = [];
    for (const row of rows) {
      const reg = row.region_code ? getRegion(row.region_code) : null;
      users.push({
        ...userCard(row, { isFriend: await isFriendPair(req.user.id, row.id) }),
        lat: reg?.lat ?? null,
        lng: reg?.lng ?? null,
      });
    }
    return res.json({ region: { code: region.code, name: region.kind === 'city' ? `${region.name}, ${region.provinceName}` : region.name, lat: region.lat, lng: region.lng }, users });
  } catch (err) {
    return next(err);
  }
});

router.get('/users/:publicId', async (req, res, next) => {
  try {
    const other = await getUserByPublicId(req.params.publicId);
    if (!other) return bad(res, 404, 'Pengguna tidak ditemukan.');
    const relation = await relationTo(req.user.id, other.id);
    const blockedByMe = await blockedBetween(req.user.id, other.id);
    return res.json({
      user: userCard(other, { isFriend: relation === 'friend' }),
      relation,
      blockedByMe,
    });
  } catch (err) {
    return next(err);
  }
});

// Daftar teman + koordinat wilayah untuk marker peta.
router.get('/friends-map', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT u.* FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_low = $1 THEN f.user_high ELSE f.user_low END
       WHERE f.user_low = $1 OR f.user_high = $1
       ORDER BY u.nickname`,
      [req.user.id],
    );
    const friends = rows.map((row) => {
      const card = userCard(row, { isFriend: true });
      const region = row.region_code ? getRegion(row.region_code) : null;
      return { ...card, lat: region?.lat ?? null, lng: region?.lng ?? null };
    });
    return res.json({ friends });
  } catch (err) {
    return next(err);
  }
});

export default router;
