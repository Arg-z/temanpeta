// Geolokasi IP dengan cache di tabel ip_geo. Sumber utama ipwho.is (HTTPS,
// tanpa API key); fallback ip-api.com (HTTP). Aturan pemakaian:
//  - IP privat/loopback tidak pernah dikirim ke API luar.
//  - Entri sukses dianggap segar 30 hari; kegagalan ditahan 1 jam (failed_at)
//    supaya IP "aneh" tidak menghambur kuota API di setiap login.
//  - lookupIp() boleh memanggil jaringan; cachedGeo() hanya baca DB dan
//    dipakai di jalur login yang sensitif latensi.
import { query } from './db.js';

const GEO_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 4000;

export function isPrivateIp(ip) {
  const s = String(ip ?? '');
  if (!s || s === 'unknown') return true;
  if (s === '::1' || s === '::') return true;
  if (s.includes(':')) {
    const h = s.toLowerCase();
    // fc00::/7 (ULA) dan fe80::/10 (link-local) — sisanya global unicast.
    return h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb');
  }
  const p = s.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

async function fetchIpWhoIs(ip) {
  const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ipwho.is HTTP ${res.status}`);
  const j = await res.json();
  if (!j.success) throw new Error(j.message ?? 'lookup ipwho.is gagal');
  return {
    city: j.city ?? null,
    region: j.region ?? null,
    country: j.country ?? null,
    isp: j.connection?.isp ?? null,
    lat: j.latitude ?? null,
    lon: j.longitude ?? null,
  };
}

async function fetchIpApi(ip) {
  const res = await fetch(
    `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,city,regionName,country,isp,lat,lon`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!res.ok) throw new Error(`ip-api HTTP ${res.status}`);
  const j = await res.json();
  if (j.status !== 'success') throw new Error(j.message ?? 'lookup ip-api gagal');
  return {
    city: j.city ?? null,
    region: j.regionName ?? null,
    country: j.country ?? null,
    isp: j.isp ?? null,
    lat: j.lat ?? null,
    lon: j.lon ?? null,
  };
}

// Hanya baca cache — aman dipanggil di jalur login, tidak pernah sentuh jaringan.
export async function cachedGeo(ip) {
  if (isPrivateIp(ip)) return null;
  const { rows } = await query(
    "SELECT * FROM ip_geo WHERE ip = $1 AND failed_at IS NULL AND fetched_at > now() - interval '30 days'",
    [ip],
  );
  return rows[0] ?? null;
}

export async function lookupIp(ip) {
  if (isPrivateIp(ip)) return null;
  const { rows } = await query('SELECT * FROM ip_geo WHERE ip = $1', [ip]);
  const row = rows[0];
  const now = Date.now();
  if (row) {
    if (row.failed_at && now - new Date(row.failed_at).getTime() < RETRY_MS) return null;
    if (!row.failed_at && now - new Date(row.fetched_at).getTime() < GEO_TTL_MS) return row;
  }
  let geo;
  try {
    geo = await fetchIpWhoIs(ip).catch(() => fetchIpApi(ip));
  } catch {
    await query(
      'INSERT INTO ip_geo (ip, failed_at) VALUES ($1, now()) ON CONFLICT (ip) DO UPDATE SET failed_at = now()',
      [ip],
    );
    return null;
  }
  await query(
    `INSERT INTO ip_geo (ip, city, region, country, isp, lat, lon, failed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NULL)
     ON CONFLICT (ip) DO UPDATE SET
       city = EXCLUDED.city, region = EXCLUDED.region, country = EXCLUDED.country,
       isp = EXCLUDED.isp, lat = EXCLUDED.lat, lon = EXCLUDED.lon,
       failed_at = NULL, fetched_at = now()`,
    [ip, geo.city, geo.region, geo.country, geo.isp, geo.lat, geo.lon],
  );
  return geo;
}
