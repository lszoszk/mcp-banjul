#!/bin/bash
# mcp-banjul behind nginx at /banjul-mcp/. Run from the laptop (sudo asks for your VM password):
#   ssh -t amuvmuser@150.254.115.204 'bash ~/mcp-banjul/deploy/apply_nginx.sh'
# 1) /etc/nginx/conf.d/banjul-mcp.conf (rate-limit zone); 2) the location block into the 443 server block of
# sites-enabled/default, right before `location /unhrdb-api/` (skipped if already there); backup, nginx -t,
# reload; on a failed test the backup is restored and nothing changes.
set -eu
D="$HOME/mcp-banjul/deploy"
SITE=/etc/nginx/sites-enabled/default
sudo -v
sudo cp "$D/nginx-banjul-mcp.conf" /etc/nginx/conf.d/banjul-mcp.conf
if ! sudo grep -q "location /banjul-mcp/" "$SITE"; then
  TS=$(date +%Y%m%d-%H%M%S)
  sudo cp "$SITE" "/home/amuvmuser/mcp-banjul/default.bak-$TS"
  sudo python3 - "$SITE" "$D/nginx-banjul-mcp-location.conf" <<'PY'
import sys
site, snip = sys.argv[1], open(sys.argv[2]).read()
t = open(site).read()
anchor = "location /unhrdb-api/"
i = t.find(anchor)
if i < 0:
    sys.exit("anchor 'location /unhrdb-api/' not found – nothing changed")
open(site, "w").write(t[:i] + snip.strip() + "\n\n  " + t[i:])
print("location /banjul-mcp/ inserted")
PY
fi
if sudo nginx -t; then
  sudo systemctl reload nginx && echo "OK: nginx reloaded"
  curl -s -o /dev/null -w "check GET /banjul-mcp/mcp (html) -> %{http_code}\n" -H 'Accept: text/html' https://150.254.115.204/banjul-mcp/mcp
else
  echo "nginx -t failed – restoring the backup"; [ -n "${TS:-}" ] && sudo cp "/home/amuvmuser/mcp-banjul/default.bak-$TS" "$SITE"
  sudo rm -f /etc/nginx/conf.d/banjul-mcp.conf; sudo nginx -t
fi
