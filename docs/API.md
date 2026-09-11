# Kontrak API TemanPeta

Semua respons JSON. Error berbentuk `{ "error": "pesan dalam bahasa Indonesia" }` dengan kode HTTP yang sesuai (400/401/403/404/409/429/500).

## Autentikasi

Setelah `POST /api/register` atau `POST /api/login`, server menyetel **cookie sesi `tp_session`** (`HttpOnly; Secure; SameSite=Lax; Max-Age=30 hari`, dapat diubah lewat `TOKEN_TTL_DAYS`). Klien tidak pernah melihat atau menyimpan token — browser otomatis mengirim cookie pada setiap request same-origin (`credentials: 'same-origin'`). Token tidak pernah dikirim via URL/query string, dan tidak disimpan di localStorage.

Koneksi WebSocket `/ws` memakai cookie yang sama saat handshake; sesi invalid ditutup dengan close code `4001`.

Logout menutup seluruh socket yang memakai sesi tersebut; sesi lain milik akun
yang sama tetap aktif. Masa berlaku diperiksa per sesi socket, bukan per akun.

Untuk skrip/tes non-browser, header `Authorization: Bearer <token>` masih diterima sebagai fallback (token tidak pernah dikembalikan di body respons; ambil dari header `Set-Cookie`). Token di sisi server disimpan sebagai hash SHA-256.

### Dua lapis identitas

| Nama | Sumber | Sifat | Kegunaan |
|---|---|---|---|
| ID login | dipilih sendiri pengguna | privat, tak pernah tampil ke orang lain | masuk akun |
| ID publik | dibuat server, 8 karakter `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (tanpa `O/0/I/1`) | publik | pencarian & tampilan |

Tidak ada email di MVP — password yang lupa tidak dapat dipulihkan.

---

## REST API

### Auth

| Metode & path | Body | Respons | Catatan |
|---|---|---|---|
| `POST /api/register` | `{loginId, password, nickname}` | `201 {token, user}` | `loginId`: 3-24 `[a-z0-9_]`; `password` ≥ 8; `nickname` 2-24 (dirapikan server: satu baris, tanpa karakter kendali/bidi). Dibatasi 30 percobaan/10 menit per IP. |
| `POST /api/login` | `{loginId, password}` | `200 {token, user}` | 401 bila salah. |
| `POST /api/logout` | — | `204` | Menghapus sesi. |
| `GET /api/me` | — | `200 {user}` | |

Bentuk `user` (milik sendiri):

```json
{
  "publicId": "9SSS73HX",
  "loginId": "budi",
  "nickname": "Budi",
  "bio": "Suka kopi dan peta 🗺️" | null,
  "visibility": false,
  "region": { "code": "ID.30.3273", "name": "Bandung, Jawa Barat" } | null,
  "createdAt": "2026-09-05T09:08:39.619Z"
}
```

### Profil & lokasi

| Metode & path | Body | Respons | Catatan |
|---|---|---|---|
| `PATCH /api/me` | `{nickname?, visibility?, bio?}` | `200 {user}` | `nickname` 2-24 dan `bio` maks 160 karakter; string kosong menghapus bio (jadi `null`). Server merapikan teks: spasi/baris berlebih dirapatkan, dan karakter kendali/tak terlihat (C0/C1, bidi override, zero-width) dibuang — emoji gabungan (ZWJ) tetap utuh. Berlaku sama untuk nickname dan isi pesan chat. |
| `POST /api/me/location` | `{lat, lng}` | `200 {region, user}` | Server melengkapi koordinat ke kabupaten/kota terdekat (≤ 60 km) atau provinsi terdekat. **Tidak ada koordinat yang disimpan** — hanya kode wilayah. |

### Wilayah & pencarian

| Metode & path | Query | Respons | Catatan |
|---|---|---|---|
| `GET /api/regions` | `q` (min 2 huruf) | `{regions: [{code, name, kind, type, lat, lng}]}` | `kind`: `province`/`city`; `type`: `kota`/`kabupaten`/null. Ada alias ("jogja", "jakarta", dll). |
| `GET /api/users` | `q` (min 2 karakter) | `{users: [UserCard]}` | ID publik persis (q tepat 8 karakter) **selalu** ditemukan bila tidak saling memblokir — visibilitas tidak menghalanginya; pencarian nickname hanya cocok untuk pengguna bervisibilitas nyala atau teman. |
| `GET /api/users/region/:code` | — | `{region: {code, name, lat, lng}, users: [UserCard]}` | Pengguna bervisibilitas nyala di kota tsb, atau di seluruh kab/kota bila `:code` provinsi. |
| `GET /api/users/:publicId` | — | `{user, relation, blockedByMe}` | `relation`: `self`/`friend`/`incoming`/`outgoing`/`none`. |
| `GET /api/friends-map` | — | `{friends: [UserCard + {lat, lng}]}` | Teman + centroid wilayahnya untuk marker peta. |
| `GET /api/presence-map` | — | `{users: [UserCard + {lat, lng}]}` | Peta global: semua pengguna lain yang **sedang online** dengan visibilitas nyala + centroid wilayahnya (di luar diri sendiri). |

Bentuk `UserCard` (pengguna lain):

```json
{
  "publicId": "88PSZJQP",
  "nickname": "Sari",
  "bio": "Anak Bandung, hobi fotografi" | null,
  "visibility": true,
  "region": { "code": "...", "name": "Bandung, Jawa Barat" } | null,
  "lat": -6.9, "lng": 107.6,
  "online": true,
  "isFriend": false
}
```

`region` bernilai `null` bila visibilitas mati, **kecuali** untuk teman (teman selalu melihat wilayah, tanpa koordinat presisi). Centroid `lat`/`lng` hanya ikut saat wilayahnya memang terlihat (bila disembunyikan kedua kunci itu tidak ada) — dipakai frontend untuk menaruh titik realtime, mis. kartu teman pada `friend_request.accepted`.

`bio` bersifat **publik** seperti `nickname` — tidak ikut aturan visibilitas wilayah, jadi tetap terlihat walau `visibility` mati. Satu-satunya pengecualian: pada lookup profil oleh pemblokir (`blockedByMe: true`), `bio` ikut disembunyikan (`null`) bersama `region` dan `online`.

Blokir berlaku dua arah pada peta kehadiran dan event kehadiran WebSocket.
Lookup profil pemblokir dari pihak yang diblokir mendapat `404`. Pemblokir
tetap dapat membuka profil pihak yang ia blokir dengan `blockedByMe: true`
untuk membatalkan blokir, tetapi wilayah dan status online pihak itu disembunyikan.

### Pertemanan

| Metode & path | Body | Respons | Catatan |
|---|---|---|---|
| `POST /api/friend-requests` | `{publicId}` | `201 {id}` atau `201 {accepted: true, friend}` | Bila lawan sudah lebih dulu mengirim permintaan, otomatis diterima. 409 bila sudah berteman/sudah dikirim. |
| `GET /api/friend-requests` | — | `{incoming: [Req], outgoing: [Req]}` | `Req = {id, createdAt, from|to: {publicId, nickname, online}}`. |
| `POST /api/friend-requests/:id/accept` | — | `200 {friend}` | Hanya penerima. |
| `DELETE /api/friend-requests/:id` | — | `204` | Menolak (penerima) atau menarik (pengirim). |
| `GET /api/friends` | — | `{friends: [UserCard]}` | |
| `DELETE /api/friends/:publicId` | — | `204` | Unfriend. |

### Chat

| Metode & path | Body | Respons | Catatan |
|---|---|---|---|
| `GET /api/messages/:publicId` | — | `{messages: [{id, mine, body, createdAt}]}` | Terlama → terbaru, maks 50. `?before=<id>` untuk halaman sebelumnya, `?limit=` maks 100. Hanya antar teman. |
| `POST /api/messages` | `{to, body}` | `201 {id, createdAt}` | `body` 1-2000 karakter. Teman saja; diblokir → 403. |

### Blokir & laporan

| Metode & path | Body | Respons | Catatan |
|---|---|---|---|
| `POST /api/blocks` | `{publicId}` | `201 {ok}` | Sekaligus memutus pertemanan dan permintaan terkait. |
| `GET /api/blocks` | — | `{blocks: [{publicId, nickname}]}` | |
| `DELETE /api/blocks/:publicId` | — | `204` | Buka blokir. |
| `POST /api/reports` | `{publicId, reason?}` | `201 {ok}` | `reason` maks 500 karakter; disimpan untuk admin. |

### Lain-lain

- `GET /api/health` → `200 {ok: true}` (tanpa auth, untuk healthcheck).

---

## WebSocket `/ws`

Autentikasi lewat cookie sesi saat handshake (bukan query string). Koneksi ditolak dengan close code `4001` bila sesi tidak valid/banned, `4003` bila origin berbeda, dan `4008` bila melebihi batas laju/koneksi. Kirim `{"type":"ping"}`? — tidak perlu; server mengirim ping protocol tiap 30 detik.

### Pesan yang DIKIRIM klien → server

```json
{ "type": "typing", "to": "88PSZJQP" }
```

Diteruskan ke penerima bila keduanya berteman. Kirim maksimal sekali per 2 detik saat mengetik.

### Event yang DITERIMA klien dari server

| `type` | Payload | Arti |
|---|---|---|
| `message.new` | `{message: {id, from, body, createdAt}}` | Pesan baru dari teman (`from` = ID publik pengirim). |
| `typing` | `{from: "publicId"}` | Lawan sedang mengetik. |
| `friend_request.new` | `{request: {id, from: {publicId, nickname, online}}}` | Permintaan pertemanan masuk. |
| `friend_request.accepted` | `{friend: UserCard}` | Permintaanmu diterima. |
| `friend.online` / `friend.offline` | `{publicId}` | Teman masuk/keluar. |
| `user.online` / `user.offline` | `{publicId, nickname, lat, lng}` | Pengguna bervisibilitas nyala masuk/keluar — broadcast umum untuk titik peta realtime (`user.offline` cukup `{publicId}`). Teman selalu menerima `friend.*` terlepas dari visibilitas. |
| `user.visibility` | `{publicId, visible, nickname?, lat?, lng?}` | Seseorang menyalakan/mematikan "tampilkan saya di peta" — titiknya muncul/hilang realtime bagi pengguna lain (koordinat hanya ikut saat `visible`). |
| `friend.removed` | `{publicId}` | Dihapus teman / diblokir seseorang. |

Klien yang terputus otomatis menyambung ulang (disarankan jeda eksponensial).

---

## Aturan privasi yang dijamin server

1. Koordinat presisi tidak pernah disimpan — hanya kode wilayah hasil pelengkapan.
2. Visibilitas bawaan **mati**; wilayah pengguna hanya tampak saat nyala (atau bagi temannya).
3. Pengguna yang saling memblokir tidak saling terlihat di pencarian/daftar wilayah.
4. ID login dan hash password tidak pernah muncul di respons apa pun.
5. Bio bersifat publik (seperti nickname), tetapi karakter kontrol C0/C1 dibuang saat disimpan agar input satu pengguna tidak merusak tampilan pengguna lain.

---

## Admin (khusus akun `is_admin`)

| Metode & path | Body | Respons | Catatan |
|---|---|---|---|
| `GET /api/admin/users?q=` | — | `{users: [{publicId, login_id, nickname, region_code, visibility, banned, created_at, sesi_aktif}]}` | Termasuk ID login (data sensitif admin). |
| `POST /api/admin/ban` | `{publicId, banned}` | `{ok, banned}` | Ban menutup semua sesi & koneksi WS paksa; unban membebaskan. |
| `GET /api/admin/reports` | — | `{reports: [{created_at, pelapor, dilaporkan, reason}]}` | Terbaru dulu, maks 100. |

Non-admin yang mengakses endpoint ini mendapat 403. Akun dengan `banned = true` tidak bisa login dan sesi lamanya langsung mati.
