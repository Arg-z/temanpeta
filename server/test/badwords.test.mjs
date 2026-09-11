// Test filter kata kasar — murni unit, tanpa DB.
//   cd server && node --test test/badwords.test.mjs
// Kasus paling kritis: kata BAIK yang mengandung segmen kasar tidak boleh kena
// (pantai, kanal, mentai), dan variasi penghindaran tetap terdeteksi.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { containsBadword, maskBadwords } from '../src/badwords.js';

test('kata baik yang mengandung segmen kasar TETAP LOLOS', () => {
  // "pantai" memuat "tai", "kanal" memuat segmen vulgur bahasa Inggris.
  const aman = [
    'liburan ke pantai',
    'Pantai Mentai enak banget',
    'latai goreng',
    'masuk kanal group',
    'kereta bala bala',
    'aku butuh bantuan',
    'suhu di Bandung sejuk',
    'perut buncit',
    'warna item',
    'kamu kocak banget',
    'sate dan gado-gado',
    'massal dan klasik',
    'anita datang nanti',
    'sampai jumpa besok pagi',
  ];
  for (const t of aman) {
    assert.equal(containsBadword(t), false, `harus lolos: ${t}`);
  }
});

test('kata kasar polos terdeteksi, kapitalisasi diabaikan', () => {
  for (const t of ['anjing', 'ANJING LU', 'tai lahan', 'goblok sih', 'sialan!']) {
    assert.equal(containsBadword(t), true, `harus kena: ${t}`);
  }
});

test('leetspeak & angka pengganti terdeteksi', () => {
  for (const t of ['anj1ng', 'b4bi', 'g0blok', 'k0nt0l', 't@i']) {
    assert.equal(containsBadword(t), true, `harus kena: ${t}`);
  }
});

test('huruf beruntun & pemisah dalam kata terdeteksi', () => {
  for (const t of ['anjiiing', 'anjiiiing banget', 'a.nj.ing', 'a-n-j-i-n-g', 'b..a..b..i']) {
    assert.equal(containsBadword(t), true, `harus kena: ${t}`);
  }
});

test('tier berat: kata dipisah spasi tetap kena', () => {
  for (const t of ['n g e n t o t', 'an jing', 'k o n t o l']) {
    assert.equal(containsBadword(t), true, `harus kena: ${t}`);
  }
});

test('tier berat tidak menimpa teks yang mengandung segmen mirip', () => {
  // "tai" sengaja TIDAK di tier berat — jika ya, gabungan tanpa spasi
  // seperti kata-kata ini akan salah kena. (Catatan: frasa yang memuat
  // token kasar utuh seperti "men tai" memang kena — itu perilaku benar.)
  assert.equal(containsBadword('pantai'), false);
  assert.equal(containsBadword('ikan tuna bakar'), false);
  assert.equal(containsBadword('tinta kanan'), false);
});

test('teks kosong / bukan string → tidak ada pelanggaran', () => {
  assert.equal(containsBadword(''), false);
  assert.equal(containsBadword('   '), false);
  assert.equal(containsBadword(null), false);
  assert.equal(containsBadword(123), false);
});

// Sensor: pesan tetap utuh, kata terlarang jadi bintang sepanjang aslinya.
test('mask: kata kasar diganti bintang, sisanya utuh', () => {
  assert.equal(maskBadwords('anjing laka'), '****** laka');
  // "b4nget" = "banget" — bukan kata terlarang, ikut lolos.
  assert.equal(maskBadwords('anj1ing b4nget'), '******* b4nget');
  // Tanda baca yang menempel pada token ikut tersensor ("sialan!" = 7 karakter).
  assert.equal(maskBadwords('sialan! tau'), '******* tau');
  assert.equal(maskBadwords('a.nj.ing'), '********');
  // Tier berat lintas token: semua token penyusun ikut tersensor.
  assert.equal(maskBadwords('n g e n t o t'), '* * * * * * *');
  assert.equal(maskBadwords('an jing'), '** ****');
  // Spasi beruntun, kapital, dan tanda baca dipertahankan.
  assert.equal(maskBadwords('ANJING  laka!!'), '******  laka!!');
  assert.equal(maskBadwords('tai lahan, ok'), '*** lahan, ok');
});

test('mask: teks bersih kembali apa adanya', () => {
  assert.equal(maskBadwords('pantai mentai'), 'pantai mentai');
  assert.equal(maskBadwords('aku butuh bantuan'), 'aku butuh bantuan');
  assert.equal(maskBadwords(''), '');
});
