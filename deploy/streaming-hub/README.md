# Streaming hub (discover, request, approve, track)

Backend for `https://fam.xgold.tech/streaming/`. One Directus extension file, `endpoint.js`, installed as `streaming-hub.js`. The page is `streaming/hub.js` + `hub.css`. Infrastructure is in `../media-automation/`.

## Roles
`family_users.streaming_role`: `standard` (default for everyone), `trusted`, `admin`. Enforced server side on every route; the browser only gets a role label.
- Standard: request is `pending` until an admin approves.
- Trusted: request is approved at once and handed to Radarr/Sonarr.
- Admin: same as Trusted, plus the approvals queue, all requests, retry, people and roles, and a system health list. The last admin cannot be demoted. Carter is the admin today. Change roles on the page (Admin > People) or in Directus (family_users.streaming_role); `setrole.sh Name role` does it from the server.

## Request states
`pending` (waiting for approval) > `approved` > `searching` > `downloading` (with progress) > `importing` > `available`. Also `declined`, `cancelled`, `failed`. A background loop (every 30 s) reads Radarr/Sonarr queues and the Jellyfin library and updates the row, including actionable text such as "Needs attention: ..." from Radarr/Sonarr. Handing a request to Radarr/Sonarr is idempotent and retried every minute (20 tries, then `failed` with a Retry button for admins). One open request per title for the whole family; a second person asking gets the existing one. Titles already on Jellyfin return 409 and show Watch.

## Routes (all under `/family/streaming/`, header `X-Family-Session`, POSTs need Origin `https://fam.xgold.tech`)
`GET me`, `discover`, `search?q=`, `title/:type/:tmdbId`, `requests?scope=mine|all`; `POST requests {type,tmdbId,seasons?}`, `requests/:id/approve|deny|retry|cancel`; admin: `GET admin/users`, `admin/health`, `POST admin/users/:id/role`. Radarr, Sonarr and Jellyfin keys live in `extensions/.family-media.json` and `.family-streaming.json` (mode 0600, server only) and never reach a browser.

The old anonymous form routes (`/streaming-search`, `/streaming-requests`, folder `../streaming-requests/`) are retired; their table and the two earlier requests were kept and now appear in the approvals queue.

## Install or update (on the server)
```
psql ... -d fam -f schema.sql            # additive, safe to re-run (docker exec -i gold-platform-postgres ...)
python3 install.py                       # copies endpoint.js, patches index.js, writes .family-media.json
docker restart homelab-directus-fam
```
After editing `endpoint.js` only, copy it over `streaming-hub.js` in both extension folders and restart the container. Tests: `npm run test:streaming`. Live checks without a PIN: `live-call.sh Carter GET /streaming/me` (signs a session inside the container with its own secret).

## Limits
Titles without a TMDB id are not shown. TV discovery uses TVmaze's free US schedule (no key) matched through Sonarr; movie discovery uses Radarr's TMDB lists. No email or Discord alert to admins for new pending requests yet (they see a badge on the page). Directus must be able to reach `media-net`; if the container is ever recreated from another compose file, `docker network connect media-net homelab-directus-fam`.
