#!/usr/bin/env bash
#
# maintenance — nyalakan / matikan mode pemeliharaan TemanPeta.
#
#   ./deploy/maintenance.sh status          # lihat keadaan sekarang
#   ./deploy/maintenance.sh on   [target]   # nyalakan
#   ./deploy/maintenance.sh off  [target]   # matikan
#   ./deploy/maintenance.sh verify          # cek hasilnya lewat HTTP
#
# target:
#   app      -> app.connext.web.id  (lewat file penanda yang dibaca Caddy)
#   landing  -> connext.web.id      (tukar landing/index.html sementara)
#   all      -> keduanya (default)
#
# Tidak butuh sudo. Tidak ada rebuild image maupun restart container:
#   - app     : cukup buat/hapus ./maintenance/ON; Caddy membacanya langsung.
#   - landing : nginx menyajikan landing/ langsung dari disk, jadi tukar file
#               langsung berlaku tanpa reload.
#
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAINT="$REPO/maintenance"
FLAG="$MAINT/ON"
LANDING="$REPO/landing"
LANDING_BAK="$MAINT/.landing-index.orig.html"
LANDING_CSS="$LANDING/style.css"

APP_URL="https://app.connext.web.id"
LANDING_URL="https://connext.web.id"

usage() {
  sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

# ---------- app ----------

app_state() { [ -f "$FLAG" ] && echo on || echo off; }
app_on()    { touch "$FLAG"; }
app_off()   { rm -f "$FLAG"; }

# ---------- landing ----------
# landing/index.html adalah file yang dilacak git. Sebelum ditukar, salinan
# aslinya disimpan di maintenance/.landing-index.orig.html (di-gitignore)
# supaya `off` bisa mengembalikan persis seperti semula — termasuk perubahan
# lokal yang belum di-commit.

landing_state() {
  if [ -f "$LANDING_BAK" ]; then echo on; return; fi
  if cmp -s "$LANDING/index.html" "$MAINT/index.html"; then echo on; return; fi
  echo off
}

landing_on() {
  if [ "$(landing_state)" = on ]; then
    echo "  landing: sudah dalam mode pemeliharaan"
    return 0
  fi
  cp -p "$LANDING/index.html" "$LANDING_BAK" || return 1
  cp "$MAINT/index.html" "$LANDING/index.html" || return 1
  cp "$MAINT/style.css" "$LANDING_CSS" || return 1
  echo "  landing: mode pemeliharaan AKTIF (asli disimpan di maintenance/.landing-index.orig.html)"
}

landing_off() {
  if [ ! -f "$LANDING_BAK" ]; then
    echo "  landing: tidak dalam mode pemeliharaan"
    return 0
  fi
  cp -p "$LANDING_BAK" "$LANDING/index.html" || return 1
  rm -f "$LANDING_BAK" "$LANDING_CSS"
  echo "  landing: kembali normal"
}

# ---------- aksi ----------

do_on() {
  case "$1" in
    app|all)     app_on;     echo "  app: mode pemeliharaan AKTIF (penanda: maintenance/ON)" ;;
  esac
  case "$1" in
    landing|all) landing_on ;;
  esac
}

do_off() {
  case "$1" in
    app|all)     app_off;    echo "  app: kembali normal" ;;
  esac
  case "$1" in
    landing|all) landing_off ;;
  esac
}

show_status() {
  echo "TemanPeta — status pemeliharaan"
  echo "  app     (app.connext.web.id) : $(app_state)"
  echo "  landing (connext.web.id)     : $(landing_state)"
  if [ "$(app_state)" = off ] && [ ! -f "$FLAG" ]; then
    # Deteksi dini: penanda tidak dibaca kalau mount belum terpasang.
    if ! docker inspect temanpeta-web-1 --format '{{range .Mounts}}{{.Destination}}{{"\n"}}{{end}}' 2>/dev/null | grep -q '^/srv/www/maint$'; then
      echo
      echo "  ⚠  Container web belum punya mount /srv/www/maint, jadi mode app"
      echo "     tidak akan berpengaruh. Jalankan sekali:"
      echo "       cd $REPO && docker compose up -d web"
    fi
  fi
}

verify() {
  echo "Verifikasi lewat HTTP:"
  for u in "$APP_URL/" "$APP_URL/api/health" "$LANDING_URL/"; do
    printf '  %-40s HTTP %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$u" 2>/dev/null || echo ERR)"
  done
  local body
  body="$(curl -s --max-time 15 "$APP_URL/" 2>/dev/null || true)"
  case "$body" in
    *"UNDER"*|*"MAINTENANCE"*) echo "  → app menyajikan HALAMAN PEMELIHARAAN" ;;
    *"<title>TemanPeta</title>"*) echo "  → app menyajikan APLIKASI (normal)" ;;
    *) echo "  → isi app tidak dikenali" ;;
  esac
}

# ---------- main ----------

CMD="${1:-status}"
TARGET="${2:-all}"

case "$TARGET" in
  app|landing|all) ;;
  *) echo "Target tidak dikenal: $TARGET (pakai: app | landing | all)"; exit 2 ;;
esac

case "$CMD" in
  on)     echo "Menyalakan mode pemeliharaan ($TARGET):"; do_on "$TARGET" ;;
  off)    echo "Mematikan mode pemeliharaan ($TARGET):"; do_off "$TARGET" ;;
  status) show_status ;;
  verify) verify ;;
  -h|--help|help) usage 0 ;;
  *) echo "Perintah tidak dikenal: $CMD"; usage 2 ;;
esac
