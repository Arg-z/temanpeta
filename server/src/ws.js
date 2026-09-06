import { WebSocketServer } from 'ws';
import { query } from './db.js';
import { getRegion } from './regions.js';
import { SESSION_COOKIE } from './auth.js';

// Koneksi aktif per userId (satu pengguna bisa buka beberapa tab).
const online = new Map();

// Baca cookie sesi dari header Upgrade — token TIDAK lagi lewat query string.
function sessionTokenFromReq(req) {
  const header = req.headers.cookie ?? '';
  const match = header
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)) : null;
}

function send(ws, event) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
}

export function publish(userId, event) {
  for (const ws of online.get(userId) ?? []) send(ws, event);
}

export function isOnline(userId) {
  const set = online.get(userId);
  return Boolean(set && set.size > 0);
}

// Kirim event ke semua teman seorang pengguna.
export async function notifyFriends(userId, event) {
  const { rows } = await query(
    `SELECT CASE WHEN user_low = $1 THEN user_high ELSE user_low END AS other
     FROM friendships WHERE user_low = $1 OR user_high = $1`,
    [userId],
  );
  for (const row of rows) if (row.other !== userId) publish(row.other, event);
}

// Kirim event ke semua pengguna lain yang terhubung (kehadiran publik).
export function broadcastOthers(userId, event) {
  for (const [id, set] of online) {
    if (id === userId) continue;
    for (const ws of set) send(ws, event);
  }
}

// Tutup paksa semua koneksi milik satu pengguna (dipakai saat ban).
export function kickUser(userId) {
  for (const ws of online.get(userId) ?? []) {
    try {
      ws.close(4001, 'banned');
    } catch {
      // koneksi sudah tertutup
    }
  }
}

export function initWs(httpServer) {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: 4096, // pesan hanya typing — tolak payload besar sejak handshake
  });

  wss.on('connection', async (ws, req) => {
    // Cegah koneksi lintas origin (aplikasi hanya melayani origin sendiri).
    if (req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host) {
          ws.close(4003, 'origin ditolak');
          return;
        }
      } catch {
        ws.close(4003, 'origin tidak valid');
        return;
      }
    }

    // Sesi dibaca dari cookie HttpOnly — token tidak lagi lewat query string.
    const token = sessionTokenFromReq(req);
    const { rows } = await query(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = $1 AND s.expires_at > now()`,
      [token ?? ''],
    );
    if (rows.length === 0 || rows[0].banned) {
      ws.close(4001, 'unauthorized');
      return;
    }
    const user = rows[0];

    // Pembatas laju pesan per koneksi: typing hanya butuh sedikit bandwidth.
    let msgTimes = [];

    let set = online.get(user.id);
    if (!set) online.set(user.id, (set = new Set()));
    set.add(ws);
    if (set.size === 1) {
      await notifyFriends(user.id, {
        type: 'friend.online',
        publicId: user.public_id,
      });
      // Kehadiran pengguna bervisibilitas nyala diumumkan ke semua koneksi
      // (dipakai frontend untuk menampilkan/menghilangkan titik peta realtime).
      // Ikutkan nickname + centroid wilayah agar titik langsung bisa digambar.
      if (user.visibility) {
        const reg = user.region_code ? getRegion(user.region_code) : null;
        broadcastOthers(user.id, {
          type: 'user.online',
          publicId: user.public_id,
          nickname: user.nickname,
          lat: reg?.lat ?? null,
          lng: reg?.lng ?? null,
        });
      }
    }

    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', async (raw) => {
      // Banjir pesan: lebih dari 40 pesan / 10 detik → tutup koneksi.
      const nowMs = Date.now();
      msgTimes = msgTimes.filter((t) => nowMs - t < 10_000);
      msgTimes.push(nowMs);
      if (msgTimes.length > 40) {
        ws.close(4008, 'terlalu banyak pesan');
        return;
      }
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      // Indikator mengetik: diteruskan ke penerima bila memang berteman.
      if (msg.type === 'typing' && typeof msg.to === 'string') {
        const { rows: friend } = await query(
          `SELECT 1 FROM friendships
           WHERE (user_low, user_high) IN (
             SELECT LEAST($1, u.id), GREATEST($1, u.id)
             FROM users u WHERE u.public_id = $2
           )`,
          [user.id, msg.to.slice(0, 8)],
        );
        if (friend.length > 0) {
          const { rows: target } = await query('SELECT id FROM users WHERE public_id = $1', [
            msg.to.slice(0, 8),
          ]);
          if (target.length > 0) publish(target[0].id, { type: 'typing', from: user.public_id });
        }
      }
    });

    ws.on('close', async () => {
      const s = online.get(user.id);
      if (s) {
        s.delete(ws);
        if (s.size === 0) {
          online.delete(user.id);
          await notifyFriends(user.id, {
            type: 'friend.offline',
            publicId: user.public_id,
          });
          // Baca ulang visibilitas — bisa saja berubah selama sesi berjalan.
          const { rows: fresh } = await query(
            'SELECT visibility FROM users WHERE id = $1',
            [user.id],
          );
          if (fresh[0]?.visibility) {
            broadcastOthers(user.id, { type: 'user.offline', publicId: user.public_id });
          }
        }
      }
    });
  });

  // Bersihkan koneksi mati + tutup koneksi tanpa sesi valid setiap 30 detik
  // (logout, expiry, atau ban membuat sesi hilang dari tabel sessions).
  const interval = setInterval(async () => {
    const ids = [...online.keys()];
    let valid = new Set();
    if (ids.length > 0) {
      try {
        const { rows } = await query(
          `SELECT DISTINCT s.user_id FROM sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.expires_at > now() AND NOT u.banned
             AND s.user_id = ANY($1)`,
          [ids],
        );
        valid = new Set(rows.map((r) => r.user_id));
      } catch (err) {
        console.error('Gagal cek sesi WS:', err.message);
        return;
      }
    }
    for (const [userId, set] of online) {
      if (!valid.has(userId)) {
        for (const ws of set) {
          try { ws.close(4001, 'sesi berakhir'); } catch { /* sudah tertutup */ }
        }
        online.delete(userId);
        continue;
      }
      for (const ws of set) {
        if (!ws.isAlive) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }
  }, 30_000);
  wss.on('close', () => clearInterval(interval));

  return wss;
}
