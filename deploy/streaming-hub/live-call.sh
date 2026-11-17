#!/bin/sh
# Call a real streaming-hub route as a named family member, from inside the Directus container.
# The session is signed there with Directus's own SECRET; nothing secret is printed. Usage:
#   live-call.sh Carter GET /streaming/me
#   live-call.sh Carter POST /streaming/requests '{"type":"movie","tmdbId":"10331"}'
set -e
NAME=$1; METHOD=$2; ROUTE=$3; BODY=${4:-}
ROW=$(echo "select id || ' ' || pin_hash from family_users where name = '$NAME' and status = 'ready'" | docker exec -i gold-platform-postgres sh -c 'psql -U "$POSTGRES_USER" -d fam -At')
docker exec -i -e ROW="$ROW" -e METHOD="$METHOD" -e ROUTE="$ROUTE" -e BODY="$BODY" homelab-directus-fam node --input-type=module -e '
import { issueSession } from "/directus/extensions/directus-extension-family-directory/hub-session.js";
const [id, pin_hash] = process.env.ROW.split(" ");
const r = await fetch("http://127.0.0.1:8055/family" + process.env.ROUTE, { method: process.env.METHOD,
  headers: { "X-Family-Session": issueSession({ id, pin_hash }, process.env.SECRET), Origin: "https://fam.xgold.tech", "Content-Type": "application/json" },
  body: process.env.BODY || undefined });
console.log(r.status, await r.text());'
