// Peta MapLibre dengan gaya kustom senada tema 8-bit.
// Tile vektor: OpenFreeMap (skema OpenMapTiles, tanpa API key).
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import indonesiaOutline from './indonesia-outline.json';

// ——— Mask "hanya Indonesia": dunia di luar batas Indonesia ditutup warna laut. ———
// Mask = poligon dengan ring dunia sebagai luarnya dan tiap pulau Indonesia
// sebagai lubang (winding mengikuti RFC 7946: luarnya CCW, lubang CW).
function signedArea(ring) {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return s / 2;
}
const WORLD_RING = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
];
if (signedArea(WORLD_RING) < 0) WORLD_RING.reverse();
const islandHoles = indonesiaOutline.coordinates.map((poly) => {
  const ring = poly[0];
  return signedArea(ring) > 0 ? [...ring].reverse() : ring;
});
const OUTSIDE_INDONESIA = {
  type: 'Feature',
  properties: {},
  geometry: { type: 'Polygon', coordinates: [WORLD_RING, ...islandHoles] },
};

const STYLE = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    ofm: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
    mask: { type: 'geojson', data: OUTSIDE_INDONESIA },
  },
  layers: [
    // Background = warna darat (laut digambar layer water di atasnya).
    { id: 'bg', type: 'background', paint: { 'background-color': '#1b2b4d' } },
    {
      id: 'landcover',
      type: 'fill',
      source: 'ofm',
      'source-layer': 'landcover',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#16324a', 'fill-opacity': 0.55 },
    },
    {
      id: 'landuse',
      type: 'fill',
      source: 'ofm',
      'source-layer': 'landuse',
      filter: ['==', ['geometry-type'], 'Polygon'],
      minzoom: 6,
      paint: { 'fill-color': '#22355c', 'fill-opacity': 0.8 },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'ofm',
      'source-layer': 'water',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#0d1830' },
    },
    {
      id: 'waterway',
      type: 'line',
      source: 'ofm',
      'source-layer': 'waterway',
      minzoom: 6,
      paint: { 'line-color': '#0d1830', 'line-width': 1.2 },
    },
    // Sengaja tanpa lapisan jalan/gang: peta cukup sampai level wilayah,
    // jangan sampai terlihat seperti peta jalanan sungguhan.
    {
      id: 'boundary-country',
      type: 'line',
      source: 'ofm',
      'source-layer': 'boundary',
      filter: ['<=', ['get', 'admin_level'], 2],
      paint: { 'line-color': '#5a6c96', 'line-width': 1.4 },
    },
    {
      id: 'boundary-province',
      type: 'line',
      source: 'ofm',
      'source-layer': 'boundary',
      filter: ['==', ['get', 'admin_level'], 4],
      paint: { 'line-color': '#43537d', 'line-width': 0.9, 'line-dasharray': [3, 2] },
    },
    {
      // Tutup semua yang di luar Indonesia (daratan tetangga + lautnya)
      // dengan warna laut, supaya yang tampak benar-benar hanya Indonesia.
      id: 'mask-outside-indonesia',
      type: 'fill',
      source: 'mask',
      paint: { 'fill-color': '#0d1830' },
    },
    {
      id: 'place-label',
      type: 'symbol',
      source: 'ofm',
      'source-layer': 'place',
      filter: [
        'all',
        ['in', ['get', 'class'], ['literal', ['country', 'state', 'city', 'town']]],
        // Sembunyikan label di luar batas Indonesia (Singapura, KL, Dili, dst).
        ['within', indonesiaOutline],
      ],
      layout: {
        'text-field': ['coalesce', ['get', 'name:id'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 7, 14],
        'text-max-width': 8,
      },
      paint: {
        'text-color': '#cfc4ab',
        'text-halo-color': '#101a2e',
        'text-halo-width': 1.4,
      },
    },
  ],
};

// Offset kecil agar pengguna satu wilayah tidak menumpuk di titik yang sama.
function jitter(publicId) {
  let h = 0;
  for (const ch of publicId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = ((h % 1000) / 1000 - 0.5) * 0.24;
  const b = ((Math.floor(h / 1000) % 1000) / 1000 - 0.5) * 0.24;
  return [a, b];
}

// Fokus peta: Indonesia saja. Pengguna tidak bisa keluar dari wilayah ini.
const INDONESIA_BOUNDS = [
  [94.8, -11.4], // barat daya (Aceh — Rote)
  [141.2, 6.4],  // timur laut (Papua — Natuna)
];
// Sedikit longgar dari bbox Indonesia agar tepi viewport tetap ada konteks.
const MAP_MAX_BOUNDS = [
  [92.5, -13.0],
  [143.5, 8.2],
];

export function initMap(container, { onMarkerClick }) {
  const map = new maplibregl.Map({
    container,
    style: STYLE,
    bounds: INDONESIA_BOUNDS,
    fitBoundsOptions: {
      padding: { top: 90, left: 40, right: 40, bottom: 40 },
      duration: 0,
    },
    maxBounds: MAP_MAX_BOUNDS,
    maxZoom: 10, // cegah selam ke level rincian mikro (jalan/gang/bangunan)
    renderWorldCopies: false,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
  map.dragRotate.disable();

  // Diagnostik: kumpulkan error peta untuk diperiksa saat development.
  window.__mapErrors = [];
  map.on('error', (e) => {
    window.__mapErrors.push(String(e?.error?.message ?? e?.error ?? 'unknown'));
    if (window.__mapErrors.length > 20) window.__mapErrors.splice(0, 10);
  });

  const markers = new Map(); // publicId -> { marker, kind }

  function putMarker(key, user, kind) {
    if (user.lat == null || user.lng == null) return;
    const [dx, dy] = jitter(user.publicId);
    const el = document.createElement('div');
    el.className = `tp-marker ${kind}`;
    el.title = user.nickname;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      onMarkerClick(user, kind);
    });
    markers.get(key)?.marker.remove();
    markers.set(key, {
      kind,
      marker: new maplibregl.Marker({ element: el })
        .setLngLat([user.lng + dx, user.lat + dy])
        .addTo(map),
    });
  }

  return {
    map,
    // Tampilkan/perbarui titik satu pengguna secara langsung (presence realtime).
    showUser(user, kind) {
      putMarker(user.publicId, user, kind);
    },
    // Hilangkan titik satu pengguna (offline / tidak lagi relevan).
    removeUser(publicId) {
      markers.get(publicId)?.marker.remove();
      markers.delete(publicId);
    },
    // Hapus semua titik kecuali diri sendiri (dipakai saat visibilitas mati:
    // aturan saling visibilitas — yang mati tidak melihat siapa pun).
    clearOthers() {
      for (const [id, m] of markers) {
        if (id === '__me__') continue;
        m.marker.remove();
        markers.delete(id);
      }
    },
    setFriends(friends) {
      for (const f of friends) putMarker(f.publicId, f, 'friend');
    },
    setStrangers(users) {
      const keep = new Set(users.map((u) => u.publicId));
      for (const [id, m] of markers) {
        if (m.kind === 'stranger' && !keep.has(id)) {
          m.marker.remove();
          markers.delete(id);
        }
      }
      for (const u of users) if (!u.isFriend) putMarker(u.publicId, u, 'stranger');
    },
    setMe(user) {
      markers.get('__me__')?.marker.remove();
      markers.delete('__me__');
      if (!user.visibility || !user.region) return;
      putMarker('__me__', { ...user, publicId: user.publicId }, 'me');
    },
    clearStrangers() {
      for (const [id, m] of markers) {
        if (m.kind === 'stranger') {
          m.marker.remove();
          markers.delete(id);
        }
      }
    },
    flyTo(lat, lng, zoom) {
      map.flyTo({ center: [lng, lat], zoom, duration: 900 });
    },
  };
}
