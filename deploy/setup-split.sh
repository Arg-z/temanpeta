#!/usr/bin/env bash
# Pindah TemanPeta ke arsitektur dua-domain:
#   connext.web.id      -> landing statis (/home/arga/landing-temanpeta)
#   app.connext.web.id  -> aplikasi (proxy 127.0.0.1:8088, container Caddy)
#
# Jalankan dengan sudo SETELAH A record berikut ada di registrar:
#   connext.web.id      A  45.202.199.142   (sudah ada sejak bootstrap)
#   app.connext.web.id  A  45.202.199.142   (BARU — syarat mutlak)
#
#   sudo bash /home/arga/temanpeta/deploy/setup-split.sh
#
# Yang dilakukan skrip ini:
#   1. Verifikasi DNS kedua domain mengarah ke 45.202.199.142.
#   2. Backup config live connext.web.id ke deploy/ (beri timestamp).
#   3. Pasang config landing (root) + app (subdomain), lalu reload nginx.
#      Pada jendela singkat sebelum certbot jalan, kedua domain HTTP-only.
#   4. certbot --nginx untuk kedua domain (TLS + redirect 80->443).
#   5. Verifikasi: root menyajikan landing, subdomain menyajikan app,
#      /api/health hidup di subdomain dan MATI di root.
#   6. Snapshot config live (versi TLS) kembali ke deploy/ sebagai
#      sumber kebenaran berikutnya.
set -euo pipefail

DEPLOY_DIR='/home/arga/temanpeta/deploy'
IP_WAJIB='45.202.199.142'

echo "==> [1/6] Cek DNS"
if ! getent hosts app.connext.web.id | grep -q "$IP_WAJIB"; then
  echo "DNS app.connext.web.id BELUM mengarah ke $IP_WAJIB."
  getent hosts app.connext.web.id || echo "(belum resolve sama sekali)"
  echo "Tambahkan A record 'app' -> $IP_WAJIB di registrar, tunggu propagasi,"
  echo "lalu ulangi skrip ini."
  exit 1
fi
if ! getent hosts connext.web.id | grep -q "$IP_WAJIB"; then
  echo "PERINGATAN: DNS connext.web.id tidak lagi mengarah ke $IP_WAJIB — cek registrar."
  exit 1
fi
echo "DNS OK: connext.web.id dan app.connext.web.id -> $IP_WAJIB"

echo "==> [2/6] Backup config live connext.web.id"
ts=$(date +%Y%m%d-%H%M%S)
cp /etc/nginx/sites-available/connext.web.id "$DEPLOY_DIR/backup-connext.web.id.conf.$ts"
echo "Backup: $DEPLOY_DIR/backup-connext.web.id.conf.$ts"

echo "==> [3/6] Pasang config landing (root) + app (subdomain)"
install -m 644 "$DEPLOY_DIR/nginx-connext.web.id.conf"     /etc/nginx/sites-available/connext.web.id
install -m 644 "$DEPLOY_DIR/nginx-app.connext.web.id.conf" /etc/nginx/sites-available/app.connext.web.id
ln -sf /etc/nginx/sites-available/app.connext.web.id /etc/nginx/sites-enabled/app.connext.web.id
nginx -t
systemctl reload nginx

echo "==> [4/6] Terbitkan/perbarui sertifikat (connext.web.id + app.connext.web.id)"
# --expand: wajib — sertifikat lama hanya berisi connext.web.id, order baru
# menambahkan app.connext.web.id sehingga certbot butuh konfirmasi expand
# yang tidak bisa dijawab dalam mode non-interaktif (-n).
certbot --nginx -n -d connext.web.id -d app.connext.web.id \
  --agree-tos --redirect --keep-until-expiring --expand

nginx -t
systemctl reload nginx

echo "==> [5/6] Verifikasi"
if curl -fsS https://connext.web.id/ | grep -q 'MASUK APP'; then
  echo "https://connext.web.id      : landing OK"
else
  echo "GAGAL: https://connext.web.id tidak menyajikan landing."
  exit 1
fi
if curl -fsS https://app.connext.web.id/ | grep -q '<title>TemanPeta</title>'; then
  echo "https://app.connext.web.id  : app OK"
else
  echo "GAGAL: https://app.connext.web.id tidak menyajikan app."
  exit 1
fi
if curl -fsS https://app.connext.web.id/api/health >/dev/null; then
  echo "https://app.connext.web.id/api/health : OK"
else
  echo "GAGAL: /api/health tidak menjawab di subdomain app."
  exit 1
fi
if curl -fsS https://connext.web.id/api/health >/dev/null 2>&1; then
  echo "PERINGATAN: /api masih hidup di root — kondisi ini tidak berbahaya,"
  echo "tapi berarti config root masih mem-proxy alih-alih statis."
else
  echo "https://connext.web.id/api/* sudah mati (root murni landing) : OK"
fi

echo "==> [6/6] Snapshot config live kembali ke deploy/"
cp /etc/nginx/sites-available/connext.web.id     "$DEPLOY_DIR/nginx-connext.web.id.conf"
cp /etc/nginx/sites-available/app.connext.web.id "$DEPLOY_DIR/nginx-app.connext.web.id.conf"

echo ""
echo "SELESAI. Landing live di https://connext.web.id, app di https://app.connext.web.id"
