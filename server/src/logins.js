// Pencatat peristiwa masuk: siapa, dari perangkat apa, IP berapa. Geolokasi
// diisi belakangan lewat cache ip_geo (fire-and-forget) supaya jalur login
// tidak pernah menunggu API luar. Pencatatan gagal TIDAK BOLEH menggagalkan
// login — semua error ditelan ke log.
import { query } from './db.js';
import { parseUserAgent } from './ua.js';
import { cachedGeo, lookupIp } from './geo.js';

export async function recordLogin(userId, event, req) {
  try {
    const ip = String(req.ip ?? 'unknown').slice(0, 64);
    const ua = String(req.headers['user-agent'] ?? '').slice(0, 400);
    const { device, os, browser } = parseUserAgent(ua);
    const geo = await cachedGeo(ip);
    const { rows } = await query(
      `INSERT INTO login_events
         (user_id, event, ip, user_agent, device, os, browser,
          geo_city, geo_region, geo_country, geo_isp, geo_lat, geo_lon, geo_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id`,
      [
        userId, event, ip, ua, device, os, browser,
        geo?.city ?? null, geo?.region ?? null, geo?.country ?? null,
        geo?.isp ?? null, geo?.lat ?? null, geo?.lon ?? null,
        geo ? new Date() : null,
      ],
    );
    if (!geo) enrichLoginEvent(rows[0].id, ip);
  } catch (err) {
    console.error('Gagal mencatat peristiwa login:', err.message);
  }
}

function enrichLoginEvent(id, ip) {
  lookupIp(ip)
    .then((geo) => {
      if (!geo) return;
      return query(
        `UPDATE login_events
         SET geo_city = $2, geo_region = $3, geo_country = $4, geo_isp = $5,
             geo_lat = $6, geo_lon = $7, geo_at = now()
         WHERE id = $1`,
        [id, geo.city, geo.region, geo.country, geo.isp, geo.lat, geo.lon],
      );
    })
    .catch((err) => console.error('Geolokasi IP gagal:', err.message));
}
