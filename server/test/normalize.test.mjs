// Test normalisasi teks (nickname & pesan) + pencarian wilayah — murni unit,
// tanpa DB.   cd server && node --test test/normalize.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeNickname, normalizeMessage } from '../src/util.js';
import { searchRegions } from '../src/regions.js';

test('nickname: bidi override & karakter kendali dibuang', () => {
  // U+202E membalik arah teks — tidak boleh lolos ke kartu pengguna lain.
  assert.equal(normalizeNickname('Budi\u202Eevil'), 'Budievil');
  assert.equal(normalizeNickname('Ani\u200Bda'), 'Anida');
  assert.equal(normalizeNickname('Budi\u0000X'), 'BudiX');
});

test('nickname: satu baris, spasi beruntun dirapatkan, ujung di-trim', () => {
  assert.equal(normalizeNickname('  Budi \t Santoso\n'), 'Budi Santoso');
  assert.equal(normalizeNickname('Rina\nSari'), 'Rina Sari');
});

test('nickname: emoji tetap utuh', () => {
  assert.equal(normalizeNickname('Sari🗺️'), 'Sari🗺️');
  // ZWJ di emoji keluarga tidak boleh hilang.
  assert.equal(normalizeNickname('👨\u200D👩\u200D👧'), '👨\u200D👩\u200D👧');
});

test('nickname: bukan string → null (jangan jadi "[object Object]")', () => {
  assert.equal(normalizeNickname(null), null);
  assert.equal(normalizeNickname(undefined), null);
  assert.equal(normalizeNickname({}), null);
  assert.equal(normalizeNickname(42), null);
});

test('pesan: bidi & zero-width dibuang, sisanya utuh', () => {
  assert.equal(normalizeMessage('halo\u202EretsaM'), 'haloretsaM');
  // Spasi beruntun & baris baru adalah gaya penulisan — dipertahankan.
  assert.equal(normalizeMessage('baris 1\n\nbaris   2'), 'baris 1\n\nbaris   2');
  assert.equal(normalizeMessage('👨\u200D👩\u200D👧 ok'), '👨\u200D👩\u200D👧 ok');
});

test('pesan: bukan string → null', () => {
  assert.equal(normalizeMessage(null), null);
  assert.equal(normalizeMessage({}), null);
});

test('pencarian alias kota tetap stabil dipanggil berulang', () => {
  // cocokAlias dahulu menumpuk alias ke array bersama tiap panggilan.
  const first = searchRegions('jaksel').map((r) => r.code);
  assert.ok(first.includes('ID.04.3171'), 'Jaksel harus menemukan Jakarta Selatan');
  for (let i = 0; i < 50; i += 1) searchRegions('jaksel');
  assert.deepEqual(searchRegions('jaksel').map((r) => r.code), first);
});
