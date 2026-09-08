import { WebSocketServer } from 'ws';
import { query } from './db.js';
import { getRegion } from './regions.js';
import { sessionTokenFromCookie } from './auth.js';
import { hashToken } from './util.js';

// Koneksi aktif per userId (satu pengguna bisa buka beberapa tab).
const online = new Map();
// Batas koneksi bersamaan per pengguna — mencegah resource exhaustion
// lewat pembukaan socket sebanyak-banyaknya dengan satu sesi (CWE-770).
const MAX_SOCKETS_PER_USER = 5;
// Handshake bersamaan di seluruh proses: tiap handshake menelan satu query
// DB sebelum terbukti sah, jadi banjir handshake harus dibatasi sejak awal.
const MAX_PENDING_HANDSHAKES = 100;
let pendingHandshakes = 0;

// Baca cookie sesi dari header Upgrade — token TIDAK lagi lewat query string.
// Validasi lewat allowlist hex di auth.js: input malformed ditolak aman.
function sessionTokenFromReq(req) {
  return sessionTokenFromCookie(req.headers.cookie);
}

function send(ws, event) {
  if (Date.now() >= ws.sessionExpiresAt) {
    ws.close(4001, 'sesi berakhir');
    return;
  }
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

// Kehadiran publik tetap menghormati blokir di kedua arah.
export async function broadcastOthers(userId, event) {
  const { rows } = await query(
    `SELECT CASE WHEN blocker = $1 THEN blocked ELSE blocker END AS other
     FROM blocks WHERE blocker = $1 OR blocked = $1`,
    [userId],
  );
  const excluded = new Set(rows.map((row) => row.other));
  for (const [id, set] of online) {
    if (id === userId || excluded.has(id)) continue;
    for (const ws of set) send(ws, event);
  }
}

// Logout hanya mencabut socket milik sesi ini; perangkat lain tetap aktif.
export function kickSession(userId, token) {
  const hashed = hashToken(token);
  for (const ws of online.get(userId) ?? []) {
    if (ws.sessionHash === hashed) ws.close(4001, 'sesi berakhir');
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
    // Error frame dipancarkan oleh EventEmitter, di luar try/catch async.
    // Pasang sebelum await pertama, termasuk untuk handshake yang ditolak.
    ws.on('error', (err) => console.error('WS socket error:', err.message));
    // Listener async ws tidak diproses EventEmitter — rejection yang lolos
    // menjadi unhandledRejection dan menjatuhkan proses. Semua jalur
    // dibungkus try/catch (CWE-248).
    if (pendingHandshakes >= MAX_PENDING_HANDSHAKES) {
      ws.close(4008, 'terlalu banyak koneksi');
      return;
    }
    pendingHandshakes += 1;
    try {
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
      if (!token) {
        ws.close(4001, 'unauthorized');
        return;
      }
      const { rows } = await query(
        `SELECT u.*, s.expires_at AS session_expires_at FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE (s.token = $1 OR s.token = $2) AND s.expires_at > now()`,
        [hashToken(token), token],
      );
      if (rows.length === 0 || rows[0].banned) {
        ws.close(4001, 'unauthorized');
        return;
      }
      const user = rows[0];
      if (ws.readyState !== ws.OPEN) return;
      ws.sessionHash = hashToken(token);
      ws.sessionExpiresAt = new Date(user.session_expires_at).getTime();

      // Pembatas laju pesan per koneksi: typing hanya butuh sedikit bandwidth.
      let msgTimes = [];

      let set = online.get(user.id);
      if (!set) online.set(user.id, (set = new Set()));
      if (set.size >= MAX_SOCKETS_PER_USER) {
        ws.close(4008, 'terlalu banyak koneksi');
        return;
      }
      set.add(ws);

      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', async (raw) => {
        try {
          if (ws.readyState !== ws.OPEN) return;
          if (Date.now() >= ws.sessionExpiresAt) {
            ws.close(4001, 'sesi berakhir');
            return;
          }
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
        } catch (err) {
          console.error('WS message error:', err.message);
        }
      });

      ws.on('close', async () => {
        try {
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
              const { rows: fresh } = await query('SELECT visibility FROM users WHERE id = $1', [
                user.id,
              ]);
              if (fresh[0]?.visibility) {
                await broadcastOthers(user.id, { type: 'user.offline', publicId: user.public_id });
              }
            }
          }
        } catch (err) {
          console.error('WS close error:', err.message);
        }
      });

      // Listener cleanup sudah terpasang sebelum query notifikasi dimulai.
      if (set.size === 1) {
        await notifyFriends(user.id, {
          type: 'friend.online',
          publicId: user.public_id,
        });
        if (user.visibility && ws.readyState === ws.OPEN) {
          const reg = user.region_code ? getRegion(user.region_code) : null;
          await broadcastOthers(user.id, {
            type: 'user.online',
            publicId: user.public_id,
            nickname: user.nickname,
            lat: reg?.lat ?? null,
            lng: reg?.lng ?? null,
          });
        }
      }
    } catch (err) {
      console.error('WS connection error:', err.message);
      try {
        ws.close(1011, 'server error');
      } catch {
        // koneksi sudah tertutup
      }
    } finally {
      pendingHandshakes -= 1;
    }
  });

  // Bersihkan koneksi mati + tutup koneksi tanpa sesi valid setiap 30 detik
  // (logout, expiry, atau ban membuat sesi hilang dari tabel sessions).
  const interval = setInterval(async () => {
    const ids = [...online.keys()];
    let valid = new Set();
    if (ids.length > 0) {
      try {
        const { rows } = await query(
          `SELECT s.token FROM sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.expires_at > now() AND NOT u.banned
             AND s.user_id = ANY($1)`,
          [ids],
        );
        // Sesi legacy dapat di-upgrade oleh request REST selama socket aktif.
        valid = new Set(rows.map((r) => r.token.startsWith('sha256$') ? r.token : hashToken(r.token)));
      } catch (err) {
        console.error('Gagal cek sesi WS:', err.message);
        return;
      }
    }
    for (const set of online.values()) {
      for (const ws of set) {
        if (ws.readyState !== ws.OPEN) continue;
        if (!valid.has(ws.sessionHash) || Date.now() >= ws.sessionExpiresAt) {
          ws.close(4001, 'sesi berakhir');
          continue;
        }
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
