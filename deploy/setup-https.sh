#!/usr/bin/env bash
# Terbitkan sertifikat Let's Encrypt untuk connext.web.id — jalankan dengan sudo
# SETELAH A record connext.web.id -> 45.202.199.142 resolve:
#   sudo bash /home/arga/temanpeta/deploy/setup-https.sh
set -euo pipefail

echo "==> Cek DNS connext.web.id"
if ! getent hosts connext.web.id | grep -q '45\.202\.199\.142'; then
  echo "DNS connext.web.id BELUM mengarah ke 45.202.199.142."
  getent hosts connext.web.id || echo "(belum resolve sama sekali)"
  echo "Tambahkan A record di registrar dulu, tunggu propagasi, lalu ulangi skrip ini."
  exit 1
fi

echo "==> Terbitkan sertifikat (certbot --nginx)"
certbot --nginx -n -d connext.web.id --agree-tos --redirect --keep-until-expiring

nginx -t
systemctl reload nginx
curl -fsS -o /dev/null -w "https://connext.web.id : HTTP %{http_code}\n" https://connext.web.id/
echo "SELESAI — TemanPeta live di https://connext.web.id"
