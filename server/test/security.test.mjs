// Test keamanan TemanPeta — dijalankan dengan database TEST terpisah:
//   cd server && node --test test/
// Prasyarat: DATABASE_URL menunjuk ke DB test (bukan produksi) dan server
// di-spawn otomatis oleh file ini pada PORT 3100.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { spawn } from 'node:child_process';

import { resetRateLimits } from '../src/util.js';

// Suffix unik per run: database test tidak dibersihkan antar run.
const run = String(Date.now()).slice(-8);

const BASE = 'http://127.0.0.1:3100';
const DB = process.env.TEST_DATABASE_URL;
if (!DB) {
  console.error('Set TEST_DATABASE_URL ke database test.');
  process.exit(1);
}

// --- spawn server aplikasi (instance test) ---
process.env.PORT = '3100';
process.env.DATABASE_URL = DB;
process.env.NODE_ENV = 'test';
await import('../src/index.js');
await new Promise((resolve, reject) => {
  const t0 = Date.now();
  const poll = async () => {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return resolve();
    } catch { /* belum siap */ }
    if (Date.now() - t0 > 15000) return reject(new Error('server test tidak siap'));
    setTimeout(poll, 300);
  };
  poll();
});

// Semua test berasal dari IP yang sama — reset bucket limit antar test
// supaya test rate-limit yang penuh tidak membuat test lain kena 429.
beforeEach(() => resetRateLimits());

const jar = new Map(); // cookie jar sederhana per "klien"
function client(name) {
  jar.set(name, null);
  return {
    name,
    async fetch(path, { method = 'GET', body, headers = {} } = {}) {
      const cookie = jar.get(name);
      const res = await fetch(BASE + '/api' + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const setCookie = res.headers.getSetCookie?.() ?? [];
      for (const sc of setCookie) {
        const [pair] = sc.split(';');
        const [k, v] = pair.split('=');
        if (k.trim() === 'tp_session') jar.set(name, v ? `${k.trim()}=${v}` : null);
      }
      let json = null;
      try { json = await res.json(); } catch { /* 204 */ }
      return { status: res.status, json, res };
    },
  };
}

test('login: sesi via cookie HttpOnly/Secure/SameSite — token TIDAK ada di body', async () => {
  const c = client('t1');
  const { res, json } = await c.fetch('/register', {
    method: 'POST',
    body: { loginId: `sectest01_${run}`, password: 'test12345678', nickname: 'Sec One' },
  });
  assert.equal(res.status, 201);
  assert.equal(json.token, undefined, 'token tidak boleh ada di body respons');
  const setCookie = res.headers.getSetCookie().find((s) => s.startsWith('tp_session='));
  assert.ok(setCookie, 'cookie sesi harus diset');
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Max-Age=\d+/);
});

test('akses tanpa sesi → 401; dengan sesi → 200', async () => {
  const anon = client('anon');
  const { status: s1 } = await anon.fetch('/me');
  assert.equal(s1, 401);
  const c = client('t2');
  await c.fetch('/register', {
    method: 'POST',
    body: { loginId: `sectest02_${run}`, password: 'test12345678', nickname: 'Sec Two' },
  });
  const { status: s2, json } = await c.fetch('/me');
  assert.equal(s2, 200);
  assert.equal(json.user.nickname, 'Sec Two');
});

test('logout menghapus sesi di server (cookie lama tidak berlaku)', async () => {
  const c = client('t3');
  await c.fetch('/register', {
    method: 'POST',
    body: { loginId: `sectest03_${run}`, password: 'test12345678', nickname: 'Sec Three' },
  });
  const { status: s1 } = await c.fetch('/me');
  assert.equal(s1, 200);
  await c.fetch('/logout', { method: 'POST' });
  const { status: s2 } = await c.fetch('/me');
  assert.equal(s2, 401, 'sesi harus invalid setelah logout');
});

test('RBAC: user biasa ditolak dari endpoint admin (403)', async () => {
  const c = client('t4');
  await c.fetch('/register', {
    method: 'POST',
    body: { loginId: `sectest04_${run}`, password: 'test12345678', nickname: 'Sec Four' },
  });
  const { status } = await c.fetch('/admin/users');
  assert.equal(status, 403);
});

test('IDOR: chat hanya antar teman — bukan teman ditolak (403)', async () => {
  const a = client('t5');
  const b = client('t6');
  await a.fetch('/register', {
    method: 'POST',
    body: { loginId: `sectest05_${run}`, password: 'test12345678', nickname: 'Sec Five' },
  });
  const rb = await b.fetch('/register', {
    method: 'POST',
    body: { loginId: `sectest06_${run}`, password: 'test12345678', nickname: 'Sec Six' },
  });
  const { user: userB } = rb.json;
  const { status } = await a.fetch('/messages', {
    method: 'POST',
    body: { to: userB.publicId, body: 'kirim ke orang asing' },
  });
  assert.equal(status, 403);
});

test('WS: tanpa cookie ditolak (4001); query token TIDAK diterima lagi', async () => {
  const WebSocket = (await import('ws')).default;
  // server menolak sesi invalid DENGAN handshake sukses lalu close 4001 —
  // jadi yang dihitung adalah close code, bukan event open.
  const connect = (url, cookie) =>
    new Promise((resolve) => {
      const ws = new WebSocket(url, cookie ? { headers: { Cookie: cookie } } : {});
      const timer = setTimeout(() => resolve('timeout'), 5000);
      ws.on('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
      ws.on('error', () => {});
    });
  const tanpaCookie = await connect(`ws://127.0.0.1:3100/ws`);
  assert.equal(tanpaCookie, 4001, 'handshake tanpa sesi harus ditolak 4001');
  const viaQuery = await connect(`ws://127.0.0.1:3100/ws?token=apapun`);
  assert.equal(viaQuery, 4001, 'token di query string tidak boleh diterima');
});

test('ban: login ditolak 403 + sesi lama mati', async () => {
  // admin dibuat langsung via DB test
  const { query } = await import('../src/db.js');
  const v = client('v');
  const rv = await v.fetch('/register', {
    method: 'POST',
    body: { loginId: `sectest07_${run}`, password: 'test12345678', nickname: 'Sec Seven' },
  });
  const { user: victim } = rv.json;
  const adm = client('adm');
  const ra = await adm.fetch('/register', {
    method: 'POST',
    body: { loginId: `secadmin_${run}`, password: 'test12345678', nickname: 'Sec Admin' },
  });
  assert.equal(ra.status, 201);
  await query(`UPDATE users SET is_admin = true WHERE login_id = 'secadmin_${run}'`);

  const { status: sNonAdmin } = await v.fetch('/admin/users');
  assert.equal(sNonAdmin, 403);

  const rBan = await adm.fetch('/admin/ban', {
    method: 'POST',
    body: { publicId: victim.publicId, banned: true },
  });
  assert.equal(rBan.status, 200);
  const { status: sMe } = await v.fetch('/me');
  assert.equal(sMe, 401, 'sesi korban harus mati setelah diban');
  const { status: sLogin } = await v.fetch('/login', {
    method: 'POST',
    body: { loginId: `sectest07_${run}`, password: 'test12345678' },
  });
  assert.equal(sLogin, 403);
});

test('audit log: login gagal tercatat tanpa membocorkan password', async () => {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => { lines.push(String(args[0])); };
  const c = client('t8');
  await c.fetch('/login', {
    method: 'POST',
    body: { loginId: `audituser_${run}`, password: 'RAHASIA-email-saya-123' },
  });
  console.log = orig;
  const auditLine = lines.find((l) => l.includes('event=login_fail'));
  assert.ok(auditLine, 'harus ada baris [AUDIT] event=login_fail');
  assert.ok(!auditLine.includes('RAHASIA'), 'password tidak boleh masuk log audit');
});

test('rate limit login aktif (429 setelah batas)', async () => {
  const c = client('t7');
  let last = 0;
  for (let i = 0; i < 32; i += 1) {
    const r = await c.fetch('/login', {
      method: 'POST',
      body: { loginId: `tidakada_${run}`, password: 'salahbanget123' },
    });
    last = r.status;
    if (r.status === 429) break;
  }
  assert.equal(last, 429, 'harus kena 429 sebelum kehabisan 32 percobaan');
});

// ---------------------------------------------------------------------------
// Putaran hardening kedua (audit 2026-09-07)
// ---------------------------------------------------------------------------

test('H-1: cookie sesi malformed tidak boleh menjatuhkan server', async () => {
  const res = await fetch(`${BASE}/api/me`, { headers: { Cookie: 'tp_session=%' } });
  assert.equal(res.status, 401, 'cookie invalid harus dijawab 401, bukan crash');
  const health = await fetch(`${BASE}/api/health`);
  assert.equal(health.status, 200, 'proses server harus tetap hidup setelah cookie malformed');
});

test('H-1: cookie malformed pada handshake WS ditolak 4001 tanpa crash', async () => {
  const WebSocket = (await import('ws')).default;
  const code = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:3100/ws`, { headers: { Cookie: 'tp_session=%' } });
    const timer = setTimeout(() => resolve('timeout'), 5000);
    ws.on('close', (c) => {
      clearTimeout(timer);
      resolve(c);
    });
    ws.on('error', () => {});
  });
  assert.equal(code, 4001, 'handshake dengan cookie malformed harus ditutup 4001');
  const health = await fetch(`${BASE}/api/health`);
  assert.equal(health.status, 200, 'proses server harus tetap hidup');
});

test('M-1: trust proxy dibatasi ke jumlah hop eksplisit (bukan true)', async () => {
  const { default: app } = await import('../src/index.js');
  assert.notEqual(app.get('trust proxy'), true, 'trust proxy=true membuat req.ip bisa dipalsukan via XFF');
  assert.equal(app.get('trust proxy'), 2, 'di belakang nginx + Caddy, hop yang dipercaya tepat 2');
});

test('M-2: login_id di luar format ditolak 400 sebelum menyentuh DB/audit', async () => {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(String(a[0]));
  const c = client('fmt');
  const r = await c.fetch('/login', {
    method: 'POST',
    body: { loginId: 'bad\n[AUDIT] event=forged ip=1.2.3.4', password: 'test12345678' },
  });
  console.log = orig;
  assert.equal(r.status, 400, 'login_id invalid harus 400 tanpa query DB');
  assert.ok(!lines.join('\n').includes('event=forged'), 'log injection lewat login_id tidak boleh lolos');
});

test('M-2: timing login untuk login_id tak dikenal tetap menjalankan scrypt', async () => {
  const c = client('tm');
  const t0 = performance.now();
  await c.fetch('/login', {
    method: 'POST',
    body: { loginId: `tidakada_${run}`, password: 'salahbanget123' },
  });
  const durasiTanpaUser = performance.now() - t0;
  // scryptSync (N=16384) butuh belasan ms; kalau dilewati, respons < 5 ms.
  assert.ok(
    durasiTanpaUser > 5,
    `login untuk user tak dikenal harus tetap mahal (terukur ${durasiTanpaUser.toFixed(1)} ms)`,
  );
});

test('L-1: audit() membersihkan karakter kontrol dari input klien', async () => {
  const c = client('inj');
  await c.fetch('/register', {
    method: 'POST',
    body: { loginId: `sectest09_${run}`, password: 'test12345678', nickname: 'Sec Nine' },
  });
  const target = client('inj2');
  const rt = await target.fetch('/register', {
    method: 'POST',
    body: { loginId: `sectest10_${run}`, password: 'test12345678', nickname: 'Sec Ten' },
  });
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(String(a[0]));
  await c.fetch('/reports', {
    method: 'POST',
    body: { publicId: `${rt.json.user.publicId}\n[AUDIT] event=forged`, reason: 'uji' },
  });
  console.log = orig;
  const auditLines = lines.join('\n').split('\n').filter((l) => l.includes('[AUDIT]'));
  assert.equal(auditLines.length, 1, `harus tepat satu baris audit, dapat: ${JSON.stringify(auditLines)}`);
});

test('L-2: rate limit pada GET /api/users/:publicId (429 setelah batas)', async () => {
  const c = client('rlu');
  await c.fetch('/register', {
    method: 'POST',
    body: { loginId: `sectest11_${run}`, password: 'test12345678', nickname: 'Sec Eleven' },
  });
  let last = 0;
  for (let i = 0; i < 35; i += 1) {
    last = (await c.fetch('/users/ZZZZZZZZ')).status;
    if (last === 429) break;
  }
  assert.equal(last, 429, 'lookup langsung harus dibatasi juga');
});

test('IDOR: user ketiga tidak bisa menerima/menolak permintaan pertemanan orang lain', async () => {
  const a = client('ia');
  const b = client('ib');
  const c = client('ic');
  const ra = await a.fetch('/register', {
    method: 'POST',
    body: { loginId: `sectest12_${run}`, password: 'test12345678', nickname: 'Idor A' },
  });
  const rb = await b.fetch('/register', {
    method: 'POST',
    body: { loginId: `sectest13_${run}`, password: 'test12345678', nickname: 'Idor B' },
  });
  await c.fetch('/register', {
    method: 'POST',
    body: { loginId: `sectest14_${run}`, password: 'test12345678', nickname: 'Idor C' },
  });
  await a.fetch('/friend-requests', { method: 'POST', body: { publicId: rb.json.user.publicId } });
  const inbox = await b.fetch('/friend-requests');
  const id = inbox.json.incoming[0].id;
  const acc = await c.fetch(`/friend-requests/${id}/accept`, { method: 'POST' });
  assert.equal(acc.status, 403, 'penerimaan atas nama orang lain harus 403');
  const del = await c.fetch(`/friend-requests/${id}`, { method: 'DELETE' });
  assert.equal(del.status, 403, 'penghapusan atas nama orang lain harus 403');
  const ok = await b.fetch(`/friend-requests/${id}/accept`, { method: 'POST' });
  assert.equal(ok.status, 200, 'pemilik sah tetap bisa menerima');
});

test('IDOR: riwayat chat non-teman ditolak (403)', async () => {
  const a = client('ch1');
  const b = client('ch2');
  await a.fetch('/register', {
    method: 'POST',
    body: { loginId: `sectest15_${run}`, password: 'test12345678', nickname: 'Chat A' },
  });
  const rb = await b.fetch('/register', {
    method: 'POST',
    body: { loginId: `sectest16_${run}`, password: 'test12345678', nickname: 'Chat B' },
  });
  const { status } = await a.fetch(`/messages/${rb.json.user.publicId}`);
  assert.equal(status, 403);
});

test('L-5: query limit negatif/kedaluwarsa tidak menyebabkan 500', async () => {
  const a = client('lim1');
  const b = client('lim2');
  await a.fetch('/register', {
    method: 'POST',
    body: { loginId: `sectest17_${run}`, password: 'test12345678', nickname: 'Lim A' },
  });
  const rb = await b.fetch('/register', {
    method: 'POST',
    body: { loginId: `sectest18_${run}`, password: 'test12345678', nickname: 'Lim B' },
  });
  await a.fetch('/friend-requests', { method: 'POST', body: { publicId: rb.json.user.publicId } });
  const inbox = await b.fetch('/friend-requests');
  await b.fetch(`/friend-requests/${inbox.json.incoming[0].id}/accept`, { method: 'POST' });
  const negatif = await a.fetch(`/messages/${rb.json.user.publicId}?limit=-5`);
  assert.equal(negatif.status, 200, 'limit negatif harus di-clamp, bukan 500');
  const besar = await a.fetch(`/messages/${rb.json.user.publicId}?limit=99999`);
  assert.equal(besar.status, 200, 'limit raksasa harus di-clamp ke 100');
});

test('L-3: token sesi disimpan ter-hash di DB; sesi legacy plaintext otomatis di-upgrade', async () => {
  const crypto = await import('node:crypto');
  const { query } = await import('../src/db.js');
  const c = client('th');
  const r = await c.fetch('/register', {
    method: 'POST',
    body: { loginId: `sectest19_${run}`, password: 'test12345678', nickname: 'Hash Test' },
  });
  const setCookie = r.res.headers.getSetCookie().find((s) => s.startsWith('tp_session='));
  const token = setCookie.split(';')[0].split('=')[1];
  const hashed = `sha256$${crypto.createHash('sha256').update(token).digest('hex')}`;
  const { rows } = await query('SELECT token FROM sessions WHERE token = $1', [hashed]);
  assert.equal(rows.length, 1, 'sesi baru harus tersimpan sebagai hash, bukan plaintext');
  assert.equal((await query('SELECT 1 FROM sessions WHERE token = $1', [token])).rowCount, 0);
  assert.equal((await c.fetch('/me')).status, 200, 'sesi hash tetap valid');

  // Sesi legacy (token plaintext, pra-migrasi) harus tetap bisa dipakai lalu di-upgrade.
  const raw = crypto.randomBytes(32).toString('hex');
  await query(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES ($1, (SELECT id FROM users WHERE login_id = $2), now() + interval '1 day')`,
    [raw, `sectest19_${run}`],
  );
  const legacy = await fetch(`${BASE}/api/me`, { headers: { Cookie: `tp_session=${raw}` } });
  assert.equal(legacy.status, 200, 'sesi legacy plaintext harus tetap diterima');
  assert.equal((await query('SELECT 1 FROM sessions WHERE token = $1', [raw])).rowCount, 0, 'row legacy harus di-upgrade ke hash');
  assert.equal((await query('SELECT 1 FROM sessions WHERE token = $1', [hashed])).rowCount, 1);
});

test('WS: maksimal 5 koneksi bersamaan per pengguna (ke-6 ditutup 4008)', async () => {
  const WebSocket = (await import('ws')).default;
  const c = client('wscap');
  const r = await c.fetch('/register', {
    method: 'POST',
    body: { loginId: `sectest20_${run}`, password: 'test12345678', nickname: 'Ws Cap' },
  });
  const cookie = r.res.headers.getSetCookie().find((s) => s.startsWith('tp_session='));
  const openOne = () =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:3100/ws`, { headers: { Cookie: cookie } });
      ws.on('open', () => resolve(ws));
      ws.on('close', (code) => reject(new Error(`closed ${code}`)));
      ws.on('error', () => {});
    });
  const kept = [];
  for (let i = 0; i < 5; i += 1) {
    kept.push(await openOne());
    // Beri waktu handler server (auth query async) selesai mendaftarkan
    // socket ke set online sebelum koneksi berikutnya dibuka.
    await new Promise((r) => setTimeout(r, 150));
  }
  const sixth = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:3100/ws`, { headers: { Cookie: cookie } });
    const timer = setTimeout(() => resolve('timeout'), 5000);
    ws.on('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    ws.on('error', () => {});
  });
  assert.equal(sixth, 4008, 'koneksi ke-6 harus ditolak dengan close code 4008');
  for (const ws of kept) ws.close();
  const health = await fetch(`${BASE}/api/health`);
  assert.equal(health.status, 200);
});

// Regresi audit: privasi wilayah, blokir, pencabutan sesi, dan error frame WS.
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(predicate, timeout = 3000) {
  const end = Date.now() + timeout;
  while (!predicate() && Date.now() < end) await pause(20);
  assert.ok(predicate(), 'kondisi tidak tercapai sebelum timeout');
}

async function fixture(tag) {
  const c = client(`reg_${tag}`);
  c.loginId = `rg_${tag}_${run}`;
  const r = await c.fetch('/register', {
    method: 'POST', body: { loginId: c.loginId, password: 'test12345678', nickname: `Test ${tag}` },
  });
  assert.equal(r.status, 201);
  c.user = r.json.user;
  return c;
}

async function fixtureSocket(t, c) {
  const { query } = await import('../src/db.js');
  const { publish } = await import('../src/ws.js');
  const { rows: [user] } = await query('SELECT id FROM users WHERE public_id = $1', [c.user.publicId]);
  const ws = new WebSocket('ws://127.0.0.1:3100/ws', { headers: { Cookie: jar.get(c.name) } });
  ws.events = [];
  ws.on('error', () => {});
  ws.on('message', (raw) => ws.events.push(JSON.parse(String(raw))));
  ws.on('close', (code) => { ws.closeCode = code; });
  t.after(() => ws.terminate());
  await once(ws, 'open');
  // Handshake HTTP sudah selesai sebelum query autentikasi WS selesai.
  // Probe menunggu socket ini benar-benar terdaftar tanpa sleep arbitrer.
  await eventually(() => {
    publish(user.id, { type: 'test.ready' });
    return ws.events.some((e) => e.type === 'test.ready');
  });
  ws.events.length = 0;
  return ws;
}

test('privasi: pencarian ID menyembunyikan centroid non-teman tetapi mempertahankannya untuk teman', async () => {
  const a = await fixture('loca');
  const b = await fixture('locb');
  await a.fetch('/me/location', { method: 'POST', body: { lat: -6.9175, lng: 107.6191 } });
  const hidden = (await b.fetch('/users?q=' + a.user.publicId)).json.users[0];
  assert.equal(hidden.region, null);
  assert.equal(hidden.lat, null);
  assert.equal(hidden.lng, null);
  const fr = await a.fetch('/friend-requests', { method: 'POST', body: { publicId: b.user.publicId } });
  await b.fetch(`/friend-requests/${fr.json.id}/accept`, { method: 'POST' });
  const friend = (await b.fetch('/users?q=' + a.user.publicId)).json.users[0];
  assert.ok(friend.region);
  assert.equal(typeof friend.lat, 'number');
  assert.equal(typeof friend.lng, 'number');
});

test('blokir: peta dan broadcast menyaring kedua arah, pengguna lain tetap melihat', async (t) => {
  const a = await fixture('mapa');
  const b = await fixture('mapb');
  const c = await fixture('mapc');
  const wa = await fixtureSocket(t, a);
  const wb = await fixtureSocket(t, b);
  const wc = await fixtureSocket(t, c);
  for (const user of [a, b]) {
    await user.fetch('/me/location', { method: 'POST', body: { lat: -6.9175, lng: 107.6191 } });
    await user.fetch('/me', { method: 'PATCH', body: { visibility: true } });
  }
  await eventually(() => wc.events.some((e) => e.type === 'user.visibility' && e.publicId === b.user.publicId));
  await a.fetch('/blocks', { method: 'POST', body: { publicId: b.user.publicId } });
  assert.ok(!(await b.fetch('/presence-map')).json.users.some((u) => u.publicId === a.user.publicId));
  assert.ok(!(await a.fetch('/presence-map')).json.users.some((u) => u.publicId === b.user.publicId));
  assert.ok((await c.fetch('/presence-map')).json.users.some((u) => u.publicId === a.user.publicId));
  wa.events.length = wb.events.length = wc.events.length = 0;
  await a.fetch('/me', { method: 'PATCH', body: { visibility: false } });
  await b.fetch('/me', { method: 'PATCH', body: { visibility: false } });
  await eventually(() => wc.events.filter((e) => e.type === 'user.visibility').length === 2);
  assert.ok(!wb.events.some((e) => e.type === 'user.visibility' && e.publicId === a.user.publicId));
  assert.ok(!wa.events.some((e) => e.type === 'user.visibility' && e.publicId === b.user.publicId));
  // Jalur online/offline memakai filter yang sama.
  await a.fetch('/me', { method: 'PATCH', body: { visibility: true } });
  wa.close();
  await eventually(() => wc.events.some((e) => e.type === 'user.offline' && e.publicId === a.user.publicId));
  await fixtureSocket(t, a);
  await eventually(() => wc.events.some((e) => e.type === 'user.online' && e.publicId === a.user.publicId));
  assert.ok(!wb.events.some((e) => e.type.startsWith('user.') && e.publicId === a.user.publicId));
});

test('blokir: hanya pemblokir mendapat aksi buka blokir; profilnya tersembunyi dari pihak diblokir', async () => {
  const a = await fixture('dira');
  const b = await fixture('dirb');
  await a.fetch('/blocks', { method: 'POST', body: { publicId: b.user.publicId } });
  const ownBlock = await a.fetch('/users/' + b.user.publicId);
  assert.equal(ownBlock.json.blockedByMe, true);
  assert.equal((await b.fetch('/users/' + a.user.publicId)).status, 404);
  await a.fetch('/blocks/' + b.user.publicId, { method: 'DELETE' });
  const unblocked = await b.fetch('/users/' + a.user.publicId);
  assert.equal(unblocked.status, 200);
  assert.equal(unblocked.json.blockedByMe, false);
});

test('WS logout: hanya socket sesi yang dicabut mati, sesi lain tetap menerima chat', async (t) => {
  const a = await fixture('loga');
  const b = await fixture('logb');
  const second = client('log-second');
  second.user = a.user;
  await second.fetch('/login', { method: 'POST', body: { loginId: a.loginId, password: 'test12345678' } });
  const firstSocket = await fixtureSocket(t, a);
  const secondSocket = await fixtureSocket(t, second);
  const fr = await b.fetch('/friend-requests', { method: 'POST', body: { publicId: a.user.publicId } });
  await a.fetch(`/friend-requests/${fr.json.id}/accept`, { method: 'POST' });
  assert.equal((await a.fetch('/logout', { method: 'POST' })).status, 204);
  await eventually(() => firstSocket.closeCode === 4001);
  assert.equal((await second.fetch('/me')).status, 200);
  await b.fetch('/messages', { method: 'POST', body: { to: a.user.publicId, body: 'setelah logout' } });
  await eventually(() => secondSocket.events.some((e) => e.type === 'message.new'));
  assert.ok(!firstSocket.events.some((e) => e.type === 'message.new'));
  assert.equal(secondSocket.readyState, WebSocket.OPEN);
});

test('WS expiry: pemeriksaan berkala mencabut sesi tertentu walau ada sesi lain', { timeout: 35000 }, async (t) => {
  const { query } = await import('../src/db.js');
  const { hashToken } = await import('../src/util.js');
  const a = await fixture('expa');
  const second = client('exp-second');
  second.user = a.user;
  await second.fetch('/login', { method: 'POST', body: { loginId: a.loginId, password: 'test12345678' } });
  const expired = await fixtureSocket(t, a);
  const active = await fixtureSocket(t, second);
  await query('UPDATE sessions SET expires_at = now() - interval \'1 second\' WHERE token = $1', [hashToken(jar.get(a.name).split('=')[1])]);
  await eventually(() => expired.closeCode === 4001, 31000);
  assert.equal(active.readyState, WebSocket.OPEN);
  assert.equal((await second.fetch('/me')).status, 200);
});

// Jalankan proses biasa: node:test menangkap uncaughtException dan dapat
// membuat crash backend tampak seolah-olah proses tetap sehat.
test('WS oversized: koneksi ditutup 1009 tanpa menjatuhkan server', async (t) => {
  const a = await fixture('frame');
  const child = spawn(process.execPath, [new URL('../src/index.js', import.meta.url).pathname], {
    env: { ...process.env, PORT: '3191' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  });
  await eventually(() => output.includes('server siap di port 3191'));
  const ws = new WebSocket('ws://127.0.0.1:3191/ws', { headers: { Cookie: jar.get(a.name) } });
  ws.on('error', () => {});
  ws.on('close', (code) => { ws.closeCode = code; });
  t.after(() => ws.terminate());
  await once(ws, 'open');
  ws.send('x'.repeat(4097));
  await eventually(() => ws.closeCode === 1009);
  assert.equal((await fetch('http://127.0.0.1:3191/api/health')).status, 200);
  assert.equal(child.exitCode, null, output);
  assert.ok(!output.includes("Unhandled 'error' event"), output);
});

test('bio: tersimpan ternormalisasi, publik, dan divalidasi', async () => {
  const a = await fixture('bioA');
  const b = await fixture('bioB');

  // Bawaan: belum diisi.
  assert.equal((await a.fetch('/me')).json.user.bio, null);

  // Simpan bio berantakan — server merapikan spasi/baris & membuang kontrol.
  const simpan = await a.fetch('/me', {
    method: 'PATCH',
    body: { bio: '  Halo   dunia\x07\n\n\n\nbaris dua  ' },
  });
  assert.equal(simpan.status, 200);
  assert.equal(simpan.json.user.bio, 'Halo dunia\n\nbaris dua');

  // Publik: pengguna lain melihat bio walau visibilitas wilayah pemiliknya mati.
  const lihat = await b.fetch(`/users/${a.user.publicId}`);
  assert.equal(lihat.status, 200);
  assert.equal(lihat.json.user.bio, 'Halo dunia\n\nbaris dua');

  // Terlalu panjang (> 160) dan bukan string ditolak.
  assert.equal((await a.fetch('/me', { method: 'PATCH', body: { bio: 'x'.repeat(161) } })).status, 400);
  assert.equal((await a.fetch('/me', { method: 'PATCH', body: { bio: 123 } })).status, 400);

  // Batas atas tepat 160 karakter tetap diterima.
  assert.equal((await a.fetch('/me', { method: 'PATCH', body: { bio: 'x'.repeat(160) } })).status, 200);

  // Bio kosong/spasi saja = hapus.
  const hapus = await a.fetch('/me', { method: 'PATCH', body: { bio: '   ' } });
  assert.equal(hapus.status, 200);
  assert.equal(hapus.json.user.bio, null);

  // Karakter kendali/tak terlihat dibuang, tetapi emoji tetap utuh.
  // Bidi override (U+202E) bisa memutar balik arah teks di bio orang lain,
  // jadi wajib tidak ikut tersimpan.
  const bidi = await a.fetch('/me', {
    method: 'PATCH',
    body: { bio: 'halo\u202ehgnis\u200b dan \u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466} \u2764\uFE0F' },
  });
  assert.equal(bidi.status, 200);
  assert.equal(bidi.json.user.bio, 'halohgnis dan \u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466} \u2764\uFE0F');
  assert.ok(!bidi.json.user.bio.includes('\u202e'), 'bidi override harus dibuang');
  assert.ok(!bidi.json.user.bio.includes('\u200b'), 'zero-width space harus dibuang');
  assert.ok(bidi.json.user.bio.includes('\u200d'), 'ZWJ harus dipertahankan untuk emoji');

  // Pemblokir tidak mendapat bio pihak yang ia blokir.
  await a.fetch('/me', { method: 'PATCH', body: { bio: 'rahasia' } });
  await b.fetch('/blocks', { method: 'POST', body: { publicId: a.user.publicId } });
  const diblokir = await b.fetch(`/users/${a.user.publicId}`);
  assert.equal(diblokir.status, 200);
  assert.equal(diblokir.json.blockedByMe, true);
  assert.equal(diblokir.json.user.bio, null, 'bio disembunyikan dari pemblokir');
});

