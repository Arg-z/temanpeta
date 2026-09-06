// Test keamanan TemanPeta — dijalankan dengan database TEST terpisah:
//   cd server && node --test test/
// Prasyarat: DATABASE_URL menunjuk ke DB test (bukan produksi) dan server
// di-spawn otomatis oleh file ini pada PORT 3100.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

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
  console.error('DEBUG ban respons:', rBan.status, JSON.stringify(rBan.json));
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


