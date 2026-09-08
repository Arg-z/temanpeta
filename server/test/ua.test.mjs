// Test parser user-agent & klasifikasi IP privat — murni unit, tanpa DB.
//   cd server && node --test test/ua.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseUserAgent } from '../src/ua.js';
import { isPrivateIp } from '../src/geo.js';

// UA asli dari log nginx produksi (pengguna via aplikasi Facebook iOS).
const FB_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22H355 Safari/604.1 [FBAN/FBIOS;FBAV/577.1.0.69.74;FBBV/1058113930;FBDV/iPhone11,2;FBMD/iPhone;FBSN/iOS;FBSV/18.7.9;FBSS/3;FBID/phone;FBLC/en_Qaau_US;FBOP/5;FBRV/1062376047;IABMV/1]';

test('UA Facebook iOS: model perangkat, OS, dan browser terbaca', () => {
  const { device, os, browser } = parseUserAgent(FB_IOS);
  assert.equal(device, 'iPhone XS'); // iPhone11,2
  assert.equal(os, 'iOS 18.7.9'); // FBSV, bukan token WebKit 18_7
  assert.match(browser, /^Facebook iOS 577\.1\.0\.69\.74 \(in-app\)$/);
});

test('UA Safari iPhone polos', () => {
  const ua =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const { device, os, browser } = parseUserAgent(ua);
  assert.equal(device, 'iPhone'); // tanpa FBDV → generik
  assert.equal(os, 'iOS 17.5.1');
  assert.equal(browser, 'Safari 17');
});

test('UA Android Chrome: model dari segmen keduanya', () => {
  const ua =
    'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
  const { device, os, browser } = parseUserAgent(ua);
  assert.equal(device, 'SM-S918B');
  assert.equal(os, 'Android 14');
  assert.equal(browser, 'Chrome 126');
});

test('UA Android WebView: model tidak salah baca dari "wv"', () => {
  const ua =
    'Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.54.222;]';
  const { device, os, browser } = parseUserAgent(ua);
  assert.equal(device, null);
  assert.equal(os, 'Android 13');
  assert.match(browser, /^Facebook Android 470\.0\.0\.54\.222 \(in-app\)$/);
});

test('UA desktop Windows & Mac', () => {
  const win = parseUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  );
  assert.equal(win.device, 'PC Windows');
  assert.equal(win.os, 'Windows 10/11');
  assert.equal(win.browser, 'Edge 126');

  const mac = parseUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
  );
  assert.equal(mac.device, 'Mac');
  assert.equal(mac.os, 'macOS 10.15.7');
  assert.equal(mac.browser, 'Safari 17');
});

test('UA bot & UA kosong tidak melempar error', () => {
  assert.equal(parseUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1)').browser, 'Bot/crawler');
  assert.deepEqual(parseUserAgent(''), { device: null, os: null, browser: null });
  assert.deepEqual(parseUserAgent(undefined), { device: null, os: null, browser: null });
});

test('isPrivateIp menolak loopback/privat dan menerima IP publik', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.10', '172.16.0.1', '172.31.255.255', '169.254.9.9', '::1', 'unknown', '']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['103.255.163.15', '114.79.7.68', '8.8.8.8', '2606:4700:4700::1111']) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
  // 172.15/172.32 adalah publik — batas blok privat 172.16-31 harus tepat.
  assert.equal(isPrivateIp('172.15.0.1'), false);
  assert.equal(isPrivateIp('172.32.0.1'), false);
});
