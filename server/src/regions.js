import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { haversineKm } from './util.js';
import { config } from './config.js';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'wilayah.json'), 'utf8'));

const provinces = raw.provinces.map((p) => ({ ...p, kind: 'province' }));
const cities = raw.cities.map((c) => ({ ...c, kind: 'city' }));

const byCode = new Map();
for (const r of [...provinces, ...cities]) byCode.set(r.code, r);

// Normalisasi istilah sehari-hari agar pencarian tetap kena.
const ALIAS_KOTA = {
  'jakarta pusat': ['Jakarta'],
  'jakarta selatan': ['Jaksel'],
  'jakarta timur': ['Jaktim'],
  'jakarta barat': ['Jakbar'],
  'jakarta utara': ['Jakut'],
};

function cocokAlias(region, q) {
  // Salin dulu ke array baru: push ke region.aliases (objek yang dipakai
  // bersama selama proses hidup) akan menumpuk duplikat di setiap pencarian.
  const alias = [...(region.aliases ?? []), ...(ALIAS_KOTA[region.name.toLowerCase()] ?? [])];
  return alias.some((a) => a.toLowerCase().includes(q));
}

export function searchRegions(q, limit = 8) {
  const needle = String(q ?? '').trim().toLowerCase();
  if (needle.length < 2) return [];
  const skor = (r) => {
    const nama = r.name.toLowerCase();
    if (nama === needle) return 0;
    if (nama.startsWith(needle)) return 1;
    if (cocokAlias(r, needle)) return 2;
    if (nama.includes(needle)) return 3;
    return Infinity;
  };
  return [...provinces, ...cities]
    .map((r) => ({ r, s: skor(r) }))
    .filter((x) => x.s !== Infinity)
    .sort((a, b) => a.s - b.s || a.r.name.localeCompare(b.r.name, 'id'))
    .slice(0, limit)
    .map(({ r }) => r);
}

export function getRegion(code) {
  return byCode.get(String(code ?? '')) ?? null;
}

export function regionName(code) {
  const r = getRegion(code);
  if (!r) return null;
  return r.kind === 'city' ? `${r.name}, ${r.provinceName}` : r.name;
}

// Koordinat pengguna dilengkapi ke wilayah: kabupaten/kota terdekat bila dekat,
// selain itu provinsi terdekat. Tidak ada koordinat yang disimpan.
export function snapLocation(lat, lng) {
  let best = null;
  let bestKm = Infinity;
  for (const c of cities) {
    const km = haversineKm(lat, lng, c.lat, c.lng);
    if (km < bestKm) {
      bestKm = km;
      best = c;
    }
  }
  if (best && bestKm <= config.snapMaxCityKm) {
    return {
      code: best.code,
      name: `${best.name}, ${best.provinceName}`,
      provinceCode: best.provinceCode,
      kind: 'city',
    };
  }
  let prov = null;
  let provKm = Infinity;
  for (const p of provinces) {
    const km = haversineKm(lat, lng, p.lat, p.lng);
    if (km < provKm) {
      provKm = km;
      prov = p;
    }
  }
  return prov
    ? { code: prov.code, name: prov.name, provinceCode: prov.code, kind: 'province' }
    : null;
}
