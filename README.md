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
- `deploy/` — config nginx, skrip setup HTTPS, skrip pemisahan landing/app (`setup-split.sh`), dan toggle mode pemeliharaan (`maintenance.sh`).
- `maintenance/` — halaman "under maintenance" + file penanda yang dibaca Caddy.
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

Tes backend memakai database uji yang sudah dibuat dan terpisah dari data aplikasi.
Jalankan dari `server/`; suite memulai backend sendiri pada port 3100
(tes crash memakai proses tambahan pada port 3191).

```bash
TEST_DATABASE_URL='postgres://postgres:postgres@localhost:54329/temanpeta_test' npm test
```

Smoke test berikut juga dijalankan dari `server/`, dengan backend uji sudah hidup:

```bash
# smoke test end-to-end (register 3 akun, pertemanan, chat WS, blokir, laporan)
node scripts/smoke-test.mjs
```

Tes browser untuk pergantian chat, respons terlambat, dan reconnect dijalankan dari `web/`:

```bash
npm ci
npx playwright install chromium
npm test
```

Jika Chromium sudah tersedia, arahkan `CHROMIUM_EXECUTABLE_PATH` ke binarinya.
Tes browser memakai halaman fixture lokal dan respons API terkontrol; tidak
memerlukan backend atau layanan peta eksternal.

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

### Mode pemeliharaan

Menampilkan halaman "under maintenance" ke pengunjung, tanpa menghentikan
container atau mengedit nginx:

```bash
./deploy/maintenance.sh status      # lihat keadaan sekarang
./deploy/maintenance.sh on          # nyalakan (app + landing)
./deploy/maintenance.sh on app      # hanya app.connext.web.id
./deploy/maintenance.sh on landing  # hanya connext.web.id
./deploy/maintenance.sh off         # kembalikan normal
./deploy/maintenance.sh verify      # cek hasilnya lewat HTTP
```

- **app** — Caddy menyajikan `maintenance/index.html` selama file penanda
  `maintenance/ON` ada (folder `maintenance/` di-mount ke `/srv/www/maint`).
  Saat aktif, `/api/*` dan `/ws` membalas `503` JSON supaya klien yang menunggu
  JSON tidak salah mengurai HTML. Toggle berlaku **seketika** — tanpa rebuild
  image maupun restart container.
- **landing** — `landing/index.html` ditukar sementara; salinan aslinya
  disimpan di `maintenance/.landing-index.orig.html` sampai `off`. nginx
  melayani folder itu langsung, jadi tidak perlu reload.

Halaman ada di `maintenance/index.html` + `maintenance/style.css` (tema 8-bit).
Sengaja **tanpa style/script inline** agar lolos CSP ketat milik app
(`style-src 'self' …`).

## Catatan penting

- **Peta** memakai tile gratis [OpenFreeMap](https://openfreemap.org) (OpenMapTiles, tanpa API key) dengan gaya kustom senada tema. Ganti sumber tile di `web/src/map.js` bila perlu.
- **Tanpa email di MVP**: password lupa = akun tidak bisa dipulihkan. Email opsional bisa ditambahkan belakangan.
- **Laporan pengguna** disimpan di tabel `reports` (ditinjau lewat SQL; panel admin menyusul).
- **Data wilayah** dapat dibangun ulang dari GeoNames: `server/scripts/build-wilayah.mjs`.
- Id login/publik dihindari dari karakter tertukar `O/0` dan `I/1`.
