#!/usr/bin/env bash
# Setup produksi TemanPeta (connext.web.id) — jalankan dengan sudo:
#   sudo bash /home/arga/temanpeta/deploy/setup-sudo.sh
# Aman untuk situs lain: nginx hanya DITAMBAH satu site, tidak ada config lama yang diubah.
set -euo pipefail

echo "==> [1/4] Instal Docker + Compose plugin (apt)"
apt-get update -qq
apt-get install -y -qq docker.io docker-compose-v2 >/dev/null
systemctl enable --now docker

echo "==> [2/4] Masukkan arga ke grup docker (berlaku penuh setelah login ulang)"
usermod -aG docker arga || true

echo "==> [3/4] Pasang konfigurasi nginx untuk connext.web.id"
cp /home/arga/temanpeta/deploy/conf.d-websocket-map.conf /etc/nginx/conf.d/websocket-map.conf
cp /home/arga/temanpeta/deploy/nginx-connext.web.id.conf /etc/nginx/sites-available/connext.web.id
ln -sf /etc/nginx/sites-available/connext.web.id /etc/nginx/sites-enabled/connext.web.id
nginx -t
systemctl reload nginx

echo "==> [4/4] Build & jalankan stack temanpeta"
cd /home/arga/temanpeta
docker compose up -d --build

sleep 3
docker compose ps
curl -fsS -o /dev/null -w "Caddy via loopback 127.0.0.1:8088 : HTTP %{http_code}\n" http://127.0.0.1:8088/ || {
  echo "GAGAL: Caddy belum menjawab. Cek: docker compose logs web"; exit 1; }
curl -fsS -o /dev/null -w "nginx dengan Host connext.web.id   : HTTP %{http_code}\n" -H "Host: connext.web.id" http://127.0.0.1/ || {
  echo "GAGAL: nginx belum meneruskan. Cek: nginx -t && tail -20 /var/log/nginx/error.log"; exit 1; }

echo ""
echo "SELESAI. Site hidup (HTTP). Langkah berikutnya:"
echo "  1. Pastikan A record  connext.web.id -> 45.202.199.142  sudah dibuat di registrar."
echo "  2. Setelah DNS resolve, jalankan: sudo bash /home/arga/temanpeta/deploy/setup-https.sh"
