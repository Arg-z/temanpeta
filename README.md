# TemanPeta

Aplikasi web sosial untuk chat pribadi 1-lawan-1 berdasarkan wilayah di Indonesia.
Pengguna mendaftar dengan ID login + password pilihannya sendiri, lalu menerima
**ID publik acak 8 karakter** dari server untuk dicari orang lain — lewat peta
Indonesia atau kolom pencarian. Tidak ada grup, tidak ada koordinat GPS presisi.

Tampilan bertema 8-bit tenang: navy, krem, teal, amber. Peta adalah fokus utama.

## Arsitektur

```text
nginx (host) — TLS untuk connext.web.id + app.connext.web.id (certbot)
      ├─ connext.web.id      → landing/ (statis, tanpa build)
      └─ app.connext.web.id  → Caddy (container, 127.0.0.1:8088)
                                 ├─ static file hasil build Vite (SPA)
                                 └─ /api/* dan /ws → Backend Node.js (Express + ws)
                                                       ↓
                                                  PostgreSQL
```

- `server/` — REST API, WebSocket, skema DB, data wilayah 38 provinsi + 514 kab/kota.
- `web/` — frontend vanilla JS + MapLibre (tanpa framework), tema 8-bit.
- `landing/` — landing page publik di `connext.web.id`, dilayani nginx langsung dari folder ini (edit = langsung live, tanpa build). CTA-nya mengarah ke `app.connext.web.id`.
- `deploy/` — config nginx, skrip setup HTTPS, dan skrip pemisahan landing/app (`setup-split.sh`).
- `docs/API.md` — kontrak lengkap REST + WebSocket (untuk frontend alternatif/AI).

## Menjalankan untuk development (tanpa Docker)

Prasyarat: Node 20+.

```bash
# 1. PostgreSQL dev (binari diunduh otomatis, tanpa sudo, port 54329)
cd server
npm install
npm run pg            # biarkan jalan di terminalnya

# 2. Server API + WebSocket (terminal kedua)
DATABASE_URL='postgres://postgres:postgres@localhost:54329/temanpeta' npm run dev

# 3. Frontend (terminal ketiga, dari folder web/)
cd ../web
npm install
npm run dev           # buka http://localhost:5173
```

Skema database dibuat otomatis saat server pertama kali jalan.

### Tes

```bash
# smoke test end-to-end (register 3 akun, pertemanan, chat WS, blokir, laporan)
node scripts/smoke-test.mjs
```

## Memindahkan ke server produksi (Ubuntu 24.04 + Docker)

Prasyarat: Docker + Docker Compose plugin terpasang, dan domain yang mengarah (A record) ke IP server.

```bash
# 1. Salin folder proyek ke server, mis. via git atau scp:
scp -r temanpeta/ user@server:/opt/temanpeta

# 2. Di server:
cd /opt/temanpeta
cp .env.example .env
nano .env             # isi POSTGRES_PASSWORD kuat + SITE_ADDRESS=domainmu.com

# 3. Jalankan:
docker compose up -d --build

# 4. Cek:
docker compose ps
docker compose logs -f web    # Caddy menerbitkan sertifikat HTTPS otomatis
```

- Untuk uji lokal di server tanpa domain: biarkan `SITE_ADDRESS=:80` lalu buka `http://IP-server`.
- Database berada di volume `pgdata` — aman saat `docker compose down` (hilang hanya jika `down -v`).
- Backup database: `docker compose exec db pg_dump -U temanpeta temanpeta > backup.sql`

### Update aplikasi

```bash
git pull            # atau salin ulang kode
docker compose up -d --build
```

Skema database dimigrasi otomatis (idempoten) saat server boot.

## Catatan penting

- **Peta** memakai tile gratis [OpenFreeMap](https://openfreemap.org) (OpenMapTiles, tanpa API key) dengan gaya kustom senada tema. Ganti sumber tile di `web/src/map.js` bila perlu.
- **Tanpa email di MVP**: password lupa = akun tidak bisa dipulihkan. Email opsional bisa ditambahkan belakangan.
- **Laporan pengguna** disimpan di tabel `reports` (ditinjau lewat SQL; panel admin menyusul).
- **Data wilayah** dapat dibangun ulang dari GeoNames: `server/scripts/build-wilayah.mjs`.
- Id login/publik dihindari dari karakter tertukar `O/0` dan `I/1`.
