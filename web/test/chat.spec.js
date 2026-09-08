import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Halaman fixture memakai modul DOM asli, tanpa backend atau tile peta.
  await page.route('http://127.0.0.1:5179/', (route) => route.fulfill({
    contentType: 'text/html', body: '<div id="app"></div><section id="chat"></section>',
  }));
  await page.goto('/');
  await page.evaluate(async () => {
    const { createChat } = await import('/src/chat.js');
    window.pending = [];
    window.fetch = (url, options) => new Promise((resolve) => pending.push({ url, options, resolve }));
    window.reply = (path, body, status = 200) => {
      const i = pending.findIndex((r) => r.url === '/api' + path);
      if (i < 0) throw new Error('request tidak ditemukan: ' + path);
      pending.splice(i, 1)[0].resolve(new Response(JSON.stringify(body), { status }));
    };
    window.message = (body, id = 1) => ({ id, body, mine: false, createdAt: '2026-09-08T00:00:00Z' });
    window.alice = { publicId: 'AAAAAAAA', nickname: 'Alice' };
    window.bob = { publicId: 'BBBBBBBB', nickname: 'Bob' };
    window.seen = [];
    window.chat = createChat(document.getElementById('chat'), {
      onTyping() {}, onOpenProfile() {}, onSeen: (...args) => seen.push(args),
    });
  });
});

test('riwayat yang terlambat tidak masuk ke percakapan lain', async ({ page }) => {
  await page.evaluate(async () => {
    window.oldOpen = chat.open(alice);
    const current = chat.open(bob);
    reply('/messages/BBBBBBBB', { messages: [message('pesan Bob')] });
    await current;
    reply('/messages/AAAAAAAA', { messages: [message('rahasia Alice')] });
    await oldOpen;
  });
  await expect(page.locator('.chat-head .n')).toHaveText('Bob');
  await expect(page.locator('.msg')).toHaveCount(1);
  await expect(page.locator('.msg')).toContainText('pesan Bob');
});

test('menutup lalu membuka orang yang sama tetap membuang respons lama', async ({ page }) => {
  await page.evaluate(async () => {
    const old = chat.open(alice);
    const oldRequest = pending.shift();
    chat.close();
    const current = chat.open(alice);
    reply('/messages/AAAAAAAA', { messages: [message('riwayat terbaru')] });
    await current;
    oldRequest.resolve(new Response(JSON.stringify({ messages: [message('riwayat lama')] })));
    await old;
  });
  await expect(page.locator('.msg')).toHaveCount(1);
  await expect(page.locator('.msg')).toContainText('riwayat terbaru');
});

for (const status of [200, 500]) {
  test(`respons kirim ${status} tidak mengubah chat lain`, async ({ page }) => {
    await page.evaluate(async () => {
      const ready = chat.open(alice);
      reply('/messages/AAAAAAAA', { messages: [] });
      await ready;
    });
    await page.locator('.chat-input input').fill('pesan untuk Alice');
    await page.locator('.chat-input button').click();
    await page.evaluate(async (responseStatus) => {
      const sent = pending.find((r) => r.url === '/api/messages');
      if (JSON.parse(sent.options.body).to !== alice.publicId) throw new Error('penerima salah');
      const ready = chat.open(bob);
      reply('/messages/BBBBBBBB', { messages: [] });
      await ready;
      reply('/messages', responseStatus === 200
        ? { id: 2, createdAt: '2026-09-08T00:00:00Z' }
        : { error: 'Pengiriman gagal.' }, responseStatus);
      // Tunggu konsumsi body Response fetch sebelum memeriksa efek handler submit.
      await new Promise((resolve) => setTimeout(resolve, 100));
    }, status);
    await expect(page.locator('.msg')).toHaveCount(0);
    await expect(page.locator('.chat-input input')).toHaveValue('');
  });
}

test('pengiriman di percakapan aktif tetap tampil dan ditandai terbaca', async ({ page }) => {
  await page.evaluate(async () => {
    const ready = chat.open(alice);
    reply('/messages/AAAAAAAA', { messages: [] });
    await ready;
  });
  await page.locator('.chat-input input').fill('halo Alice');
  await page.locator('.chat-input button').click();
  await page.evaluate(() => reply('/messages', { id: 2, createdAt: '2026-09-08T00:00:00Z' }));
  await expect(page.locator('.msg.mine')).toContainText('halo Alice');
  expect(await page.evaluate(() => seen.at(-1))).toEqual(['AAAAAAAA', 2]);
});

test('halaman pesan lama diabaikan setelah pindah chat', async ({ page }) => {
  await page.evaluate(async () => {
    const ready = chat.open(alice);
    reply('/messages/AAAAAAAA', { messages: Array.from({ length: 50 }, (_, i) => message('Alice ' + i, i + 51)) });
    await ready;
  });
  await page.locator('.chat-more').click();
  await page.evaluate(async () => {
    const ready = chat.open(bob);
    reply('/messages/BBBBBBBB', { messages: [message('Bob saja')] });
    await ready;
    reply('/messages/AAAAAAAA?before=51', { messages: [message('halaman lama Alice')] });
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  await expect(page.locator('.msg')).toHaveCount(1);
  await expect(page.locator('.msg')).toContainText('Bob saja');
});

test('socket yang ditutup tidak menyambung ulang dari timer lama', async ({ page }) => {
  const count = await page.evaluate(async () => {
    const { createSocket } = await import('/src/ws.js');
    const scheduled = new Map();
    const sockets = [];
    window.setTimeout = (callback) => { const id = scheduled.size + 1; scheduled.set(id, callback); return id; };
    window.clearTimeout = (id) => scheduled.delete(id);
    window.WebSocket = class {
      constructor() { sockets.push(this); }
      close() { this.onclose?.({ code: 1000 }); }
    };
    const socket = createSocket({ onEvent() {} });
    sockets[0].onclose({ code: 1006 });
    socket.close();
    for (const callback of scheduled.values()) callback();
    return sockets.length;
  });
  expect(count).toBe(1);
});

test('socket tetap menyambung ulang setelah gangguan jaringan biasa', async ({ page }) => {
  const count = await page.evaluate(async () => {
    const { createSocket } = await import('/src/ws.js');
    const scheduled = [];
    const sockets = [];
    window.setTimeout = (callback) => { scheduled.push(callback); return scheduled.length; };
    window.WebSocket = class { constructor() { sockets.push(this); } };
    createSocket({ onEvent() {} });
    sockets[0].onclose({ code: 1006 });
    scheduled[0]();
    return sockets.length;
  });
  expect(count).toBe(2);
});
