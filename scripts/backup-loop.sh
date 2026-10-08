#!/bin/sh
# Sao lưu CSDL bot hằng ngày (service `backup` trong docker-compose.yml, chạy trong image mysql:8.4 — có sẵn mysqldump
# đúng phiên bản máy chủ). Mỗi 30 phút thức dậy một lần: từ 02:00 giờ Việt Nam mà hôm nay chưa có bản sao lưu thì dump.
# Bản sao lưu ghi vào /backups (thư mục ./backups của máy); tiến trình worker đưa lên R2 và dọn bản cũ trên R2.
# Trên đĩa chỉ giữ 7 ngày gần nhất.
set -u
mkdir -p /backups
while true; do
  now=$(( $(date +%s) + 7 * 3600 ))
  today=$(date -u -d "@$now" +%Y%m%d)
  hour=$(date -u -d "@$now" +%H)
  file="/backups/bot_tro_ly_${today}.sql.gz"
  if [ ! -f "$file" ] && [ "$hour" -ge 2 ]; then
    if MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -h "${MYSQL_HOST:-mysql}" -uroot --single-transaction --quick --routines \
         --no-tablespaces --default-character-set=utf8mb4 "${MYSQL_DATABASE:-bot_tro_ly}" | gzip > "$file.tmp"; then
      mv "$file.tmp" "$file"
      echo "$(date -u +%FT%TZ) đã sao lưu $file ($(wc -c < "$file") byte)"
    else
      rm -f "$file.tmp"
      echo "$(date -u +%FT%TZ) sao lưu LỖI — thử lại sau 30 phút"
    fi
    find /backups -name 'bot_tro_ly_*.sql.gz' -mtime +7 -delete
  fi
  sleep 1800
done
