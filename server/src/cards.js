import { query, pair } from './db.js';
import { regionName, getRegion } from './regions.js';
import { isOnline } from './ws.js';

// Bentuk data pengguna yang aman ditampilkan ke orang lain.
export function userCard(row, { isFriend = false } = {}) {
  const showRegion = isFriend || row.visibility;
  const reg = showRegion && row.region_code ? getRegion(row.region_code) : null;
  return {
    publicId: row.public_id,
    nickname: row.nickname,
    // Bio bersifat publik seperti nickname — tidak ikut aturan visibilitas wilayah.
    bio: row.bio ?? null,
    visibility: row.visibility,
    // Wilayah hanya tampak bila visibilitas nyala, atau bagi teman.
    region: reg ? { code: row.region_code, name: regionName(row.region_code) } : null,
    // Centroid wilayah hanya ikut bila wilayahnya memang terlihat — dipakai
    // frontend untuk menaruh titik realtime (mis. teman baru diterima) tanpa
    // harus menunggu /friends-map. Tanpa kunci ini kartu tanpa lat/lng membuat
    // putMarker() di frontend melewatkan titik.
    ...(reg ? { lat: reg.lat, lng: reg.lng } : {}),
    online: isOnline(row.id),
    isFriend,
  };
}

export function selfUser(row) {
  // Centroid wilayah ikut dikirim supaya frontend bisa menaruh titik sendiri.
  const region = row.region_code ? getRegion(row.region_code) : null;
  return {
    publicId: row.public_id,
    loginId: row.login_id,
    nickname: row.nickname,
    bio: row.bio ?? null,
    visibility: row.visibility,
    isAdmin: Boolean(row.is_admin),
    region: region
      ? { code: region.code, name: regionName(row.region_code) }
      : null,
    lat: region?.lat ?? null,
    lng: region?.lng ?? null,
    createdAt: row.created_at,
  };
}

export async function getUserByPublicId(publicId) {
  const { rows } = await query('SELECT * FROM users WHERE public_id = $1', [
    String(publicId ?? '').toUpperCase(),
  ]);
  return rows[0] ?? null;
}

export async function isFriendPair(a, b) {
  const [low, high] = pair(a, b);
  const { rows } = await query(
    'SELECT 1 FROM friendships WHERE user_low = $1 AND user_high = $2',
    [low, high],
  );
  return rows.length > 0;
}

export async function blockedBetween(a, b) {
  const { rows } = await query(
    `SELECT 1 FROM blocks
     WHERE (blocker = $1 AND blocked = $2) OR (blocker = $2 AND blocked = $1)`,
    [a, b],
  );
  return rows.length > 0;
}

// 'self' | 'friend' | 'incoming' | 'outgoing' | 'none'
export async function relationTo(meId, otherId) {
  if (meId === otherId) return 'self';
  if (await isFriendPair(meId, otherId)) return 'friend';
  const { rows } = await query(
    `SELECT from_user FROM friend_requests
     WHERE (from_user = $1 AND to_user = $2) OR (from_user = $2 AND to_user = $1)`,
    [meId, otherId],
  );
  if (rows.length === 0) return 'none';
  return rows[0].from_user === meId ? 'outgoing' : 'incoming';
}
