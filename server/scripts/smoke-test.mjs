// Smoke test end-to-end: pertemanan, chat real-time, presence, blokir, laporan.
// Jalankan saat server hidup: node scripts/smoke-test.mjs
// Sesi via cookie HttpOnly (tp_session) — jar cookie sederhana di bawah.
import WebSocket from 'ws';

const B = process.env.BASE ?? 'http://localhost:3000';
const fail = (m) => {
  console.error('GAGAL:', m);
  process.exit(1);
};
const ok = (m) => console.log('✓', m);

const jars = new Map();
let idn = 0;

function client(name) {
  jars.set(name, null);
  idn += 1;
  const suffix = `${Date.now().toString(36)}${idn}`;
  return {
    name,
    loginId: null,
    publicId: null,
    async api(path, { method = 'GET', body } = {}) {
      const res = await fetch(B + '/api' + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(jars.get(name) ? { Cookie: jars.get(name) } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      for (const sc of res.headers.getSetCookie?.() ?? []) {
        const [pair] = sc.split(';');
        if (pair.startsWith('tp_session=')) {
          jars.set(name, pair.startsWith('tp_session=;') ? null : pair);
        }
      }
      const json = res.status === 204 ? null : await res.json().catch(() => null);
      return { status: res.status, json };
    },
    async daftar(nickname) {
      this.loginId = `${name}_${suffix}`;
      let r = await this.api('/register', {
        method: 'POST',
        body: { loginId: this.loginId, password: 'rahasia123', nickname },
      });
      if (r.status !== 201) fail(`daftar ${name}: ` + JSON.stringify(r.json));
      this.publicId = r.json.user.publicId;
      return r;
    },
    connectWs() {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(B.replace('http', 'ws') + '/ws', {
          headers: { Cookie: jars.get(name) ?? '' },
        });
        const events = [];
        ws.on('message', (raw) => events.push(JSON.parse(String(raw))));
        ws.on('open', async () => {
          // beri waktu server menuntaskan autentikasi koneksi (DB query async)
          await new Promise((r) => setTimeout(r, 400));
          resolve({ ws, events });
        });
        ws.on('error', reject);
      });
    },
  };
}

const budi = client('budi');
const sari = client('sari');
const dewi = client('dewi');

await budi.daftar('Budi');
await sari.daftar('Sari');
ok(`akun uji: budi=${budi.publicId}, sari=${sari.publicId}`);

const wb = await budi.connectWs();
const wsS = await sari.connectWs();
ok('2 klien WebSocket tersambung (sesi via cookie)');

// --- Pertemanan ---
let r = await budi.api('/friend-requests', {
  method: 'POST',
  body: { publicId: sari.publicId },
});
if (r.status !== 201) fail('kirim permintaan: ' + JSON.stringify(r.json));
const evReq = await waitFor(wsS.events, 'friend_request.new');
if (!evReq) fail('sari tidak menerima friend_request.new');
ok('friend_request.new → sari (dari ' + evReq.request.from.nickname + ')');

r = await sari.api(`/friend-requests/${evReq.request.id}/accept`, { method: 'POST' });
if (r.status !== 200) fail('terima permintaan: ' + JSON.stringify(r.json));
const evAcc = await waitFor(wb.events, 'friend_request.accepted');
if (!evAcc) fail('budi tidak menerima friend_request.accepted');
ok('friend_request.accepted → budi, teman baru: ' + evAcc.friend.nickname);

// --- Chat ---
r = await sari.api('/messages', {
  method: 'POST',
  body: { to: budi.publicId, body: 'Halo Budi!' },
});
if (r.status !== 201) fail('kirim pesan: ' + JSON.stringify(r.json));
const evMsg = await waitFor(wb.events, 'message.new');
if (!evMsg || evMsg.message.body !== 'Halo Budi!') fail('budi tidak menerima message.new');
ok('message.new → budi: "' + evMsg.message.body + '"');

r = await budi.api('/messages/' + sari.publicId);
if (r.status !== 200 || r.json.messages.length !== 1 || r.json.messages[0].mine) {
  fail('riwayat pesan salah: ' + JSON.stringify(r.json));
}
ok('riwayat chat terbaca (penanda mine benar)');

wb.ws.send(JSON.stringify({ type: 'typing', to: sari.publicId }));
const evTyping = await waitFor(wsS.events, 'typing');
if (!evTyping) fail('indikator mengetik tidak diteruskan');
ok('typing diteruskan → sari');

// --- Presence ---
wsS.ws.close();
const evOff = await waitFor(wb.events, 'friend.offline', 4000);
if (!evOff) fail('budi tidak menerima friend.offline');
ok('friend.offline → budi (' + evOff.publicId + ')');

// --- Pencarian & blokir ---
r = await budi.api('/users?q=' + sari.publicId);
if (!r.json.users.some((u) => u.publicId === sari.publicId)) fail('pencarian ID gagal');
ok('pencarian ID publik persis: ' + sari.publicId);

await dewi.daftar('Dewi');
r = await dewi.api('/blocks', { method: 'POST', body: { publicId: budi.publicId } });
if (r.status !== 201) fail('blokir gagal: ' + JSON.stringify(r.json));
r = await budi.api('/friend-requests', {
  method: 'POST',
  body: { publicId: dewi.publicId },
});
if (r.status !== 403) fail('blokir tidak mencegah permintaan: ' + r.status);
ok('blokir mencegah permintaan pertemanan');
r = await dewi.api('/reports', {
  method: 'POST',
  body: { publicId: budi.publicId, reason: 'tes laporan' },
});
if (r.status !== 201) fail('laporan gagal');
ok('laporan tersimpan');
await dewi.api('/blocks/' + budi.publicId, { method: 'DELETE' });
ok('buka blokir');

// --- Unfriend ---
r = await budi.api('/friends/' + sari.publicId, { method: 'DELETE' });
if (r.status !== 204) fail('unfriend gagal: ' + r.status);
ok('unfriend ok');

wb.ws.close();
console.log('\nSEMUA TES LULUS');
process.exit(0);

function waitFor(events, type, ms = 3000) {
  return (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const i = events.findIndex((e) => e.type === type);
      if (i >= 0) return events.splice(i, 1)[0];
      await new Promise((r2) => setTimeout(r2, 50));
    }
    return null;
  })();
}
