// Membangun server/data/wilayah.json dari dump GeoNames Indonesia.
// Sumber: https://download.geonames.org/export/dump/ID.zip + admin1CodesASCII.txt
//
// Pemakaian: node scripts/build-wilayah.mjs /tmp/ID.txt /tmp/admin1CodesASCII.txt
// Jalankan ulang hanya jika dataset wilayah mau diperbarui.

import fs from 'node:fs';

const [idTxtPath, admin1Path, outPath] = process.argv.slice(2);
if (!idTxtPath || !admin1Path || !outPath) {
  console.error('Pemakaian: node scripts/build-wilayah.mjs <ID.txt> <admin1CodesASCII.txt> <output.json>');
  process.exit(1);
}

// GeoNames menamai beberapa provinsi dalam bahasa Inggris; kita pakai nama resmi Indonesia.
const NAMA_PROVINSI = {
  'ID.01': 'Aceh',
  'ID.02': 'Bali',
  'ID.03': 'Bengkulu',
  'ID.04': 'DKI Jakarta',
  'ID.05': 'Jambi',
  'ID.07': 'Jawa Tengah',
  'ID.08': 'Jawa Timur',
  'ID.10': 'DI Yogyakarta',
  'ID.11': 'Kalimantan Barat',
  'ID.12': 'Kalimantan Selatan',
  'ID.13': 'Kalimantan Tengah',
  'ID.14': 'Kalimantan Timur',
  'ID.15': 'Lampung',
  'ID.17': 'Nusa Tenggara Barat',
  'ID.18': 'Nusa Tenggara Timur',
  'ID.21': 'Sulawesi Tengah',
  'ID.22': 'Sulawesi Tenggara',
  'ID.24': 'Sumatera Barat',
  'ID.26': 'Sumatera Utara',
  'ID.28': 'Maluku',
  'ID.29': 'Maluku Utara',
  'ID.30': 'Jawa Barat',
  'ID.31': 'Sulawesi Utara',
  'ID.32': 'Sumatera Selatan',
  'ID.33': 'Banten',
  'ID.34': 'Gorontalo',
  'ID.35': 'Kepulauan Bangka Belitung',
  'ID.36': 'Papua',
  'ID.37': 'Riau',
  'ID.38': 'Sulawesi Selatan',
  'ID.39': 'Papua Barat',
  'ID.40': 'Kepulauan Riau',
  'ID.41': 'Sulawesi Barat',
  'ID.42': 'Kalimantan Utara',
  'ID.PD': 'Papua Barat Daya',
  'ID.PT': 'Papua Tengah',
  'ID.PE': 'Papua Pegunungan',
  'ID.PS': 'Papua Selatan',
};

const ALIAS_PROVINSI = {
  'ID.04': ['Jakarta'],
  'ID.10': ['Yogyakarta', 'Jogja'],
  'ID.30': ['Jabar'],
  'ID.07': ['Jateng'],
  'ID.08': ['Jatim'],
  'ID.26': ['Sumut'],
  'ID.32': ['Sumsel'],
  'ID.24': ['Sumbar'],
  'ID.11': ['Kalbar'],
  'ID.12': ['Kalsel'],
  'ID.13': ['Kalteng'],
  'ID.14': ['Kaltim'],
  'ID.42': ['Kaltara'],
  'ID.35': ['Babel'],
  'ID.40': ['Kepri'],
  'ID.17': ['NTB'],
  'ID.18': ['NTT'],
  'ID.36': ['Papua'],
};

const kodeProvinsiTidakDikenal = new Set();

function namaProvinsi(code) {
  const nama = NAMA_PROVINSI[code];
  if (!nama) kodeProvinsiTidakDikenal.add(code);
  return nama ?? code;
}

// Nama baris GeoNames kadang bahasa Inggris ("South Tapanuli Regency").
// Nama Indonesia biasanya ada di kolom alternatenames ("Kabupaten Tapanuli Selatan").
function bersihkanNama(nama, alternates) {
  let m = nama.match(/^(Kota Administrasi|Kabupaten|Kota)\s+(.+)$/i);
  if (m) {
    return {
      type: /kabupaten/i.test(m[1]) ? 'kabupaten' : 'kota',
      name: m[2].replace(/^Administrasi\s+/i, ''),
    };
  }
  if (/(Regency|City|Municipality)$/i.test(nama)) {
    const kandidat = alternates
      .map((a) => a.match(/^(Kabupaten|Kota)\s+(.+)$/i))
      .filter(Boolean)
      .map((m2) => ({
        type: /kabupaten/i.test(m2[1]) ? 'kabupaten' : 'kota',
        name: m2[2],
      }));
    if (kandidat.length > 0) {
      const kataAsal = new Set(nama.replace(/(Regency|City|Municipality)$/i, '').toLowerCase().split(/\s+/));
      kandidat.sort((a, b) => skor(b) - skor(a));
      function skor(k) {
        let s = 0;
        for (const w of k.name.toLowerCase().split(/\s+/)) if (kataAsal.has(w)) s += 1;
        return s;
      }
      return kandidat[0];
    }
    return {
      type: /regency/i.test(nama) ? 'kabupaten' : 'kota',
      name: nama.replace(/(Regency|City|Municipality)$/i, '').trim(),
    };
  }
  return { type: 'kota', name: nama };
}

// --- Provinsi: nama dari admin1CodesASCII (untuk memastikan kode yang ada) ---
const kodeProvinsiAda = new Set();
for (const line of fs.readFileSync(admin1Path, 'utf8').split('\n')) {
  const [code] = line.split('\t');
  if (code && code.startsWith('ID.')) kodeProvinsiAda.add(code);
}
for (const code of kodeProvinsiAda) namaProvinsi(code);

// --- Kota/kabupaten dari baris ADM2 ---
const cities = new Map();
for (const line of fs.readFileSync(idTxtPath, 'utf8').split('\n')) {
  const f = line.split('\t');
  if (f.length < 12) continue;
  const [, name, , alternates, lat, lng, fclass, fcode, country, , admin1, admin2] = f;
  if (country !== 'ID' || fclass !== 'A' || fcode !== 'ADM2') continue;
  const provinceCode = `ID.${admin1}`;
  if (!NAMA_PROVINSI[provinceCode]) {
    kodeProvinsiTidakDikenal.add(provinceCode);
    continue;
  }
  const code = admin2 ? `${provinceCode}.${admin2}` : `g:${f[0]}`;
  if (cities.has(code)) continue;
  const { type, name: namaBersih } = bersihkanNama(name, (alternates || '').split(','));
  if (!namaBersih) continue;
  cities.set(code, {
    code,
    name: namaBersih,
    type,
    provinceCode,
    provinceName: NAMA_PROVINSI[provinceCode],
    lat: Number(lat),
    lng: Number(lng),
  });
}

// --- Centroid provinsi dari rata-rata kotanya ---
const akumulator = new Map();
for (const c of cities.values()) {
  const a = akumulator.get(c.provinceCode) ?? { lat: 0, lng: 0, n: 0 };
  a.lat += c.lat;
  a.lng += c.lng;
  a.n += 1;
  akumulator.set(c.provinceCode, a);
}
const provinces = [...akumulator.entries()].map(([code, a]) => ({
  code,
  name: NAMA_PROVINSI[code],
  aliases: ALIAS_PROVINSI[code] ?? [],
  lat: a.lat / a.n,
  lng: a.lng / a.n,
}));
provinces.sort((a, b) => a.name.localeCompare(b.name, 'id'));

const cityList = [...cities.values()].sort((a, b) => a.name.localeCompare(b.name, 'id'));

fs.writeFileSync(outPath, JSON.stringify({ provinces, cities: cityList }));

console.log(`Provinsi: ${provinces.length}, kabupaten/kota: ${cityList.length}`);
if (kodeProvinsiTidakDikenal.size > 0) {
  console.error('Kode provinsi tak dikenal (periksa mapping):', [...kodeProvinsiTidakDikenal]);
  process.exit(1);
}
