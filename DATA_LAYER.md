# Family site data

The page uses `directus-db.js` to keep the existing `window.claude.use('db'|'user')`
API. REST requests and a public WebSocket subscription connect to
`https://fam-api.xgold.tech`. A 15-second poll remains active if realtime is
unavailable. Existing `destin-uid` browser identities are retained.

The home `fam` PostgreSQL database contains `kv(key,coll,id,data)`. `key` is the
single primary key `coll + '/' + id`; `(coll,id)` remains unique. Only `plans`,
`bedrooms`, `flights`, `members`, `progress`, `meals` and `groceries` are allowed.
PostgreSQL enforces this allowlist and prevents changing an existing document's
path. Each document's JSON `data` remains editable.

Access preserves the former Supabase anonymous policy: anyone who can reach
the family API can read and modify these shared documents. The page's member/PIN
interface is unchanged and is not server authentication. No administrator token
is embedded in the site. Other Directus collections and administrator APIs
remain private.

The installed Directus build supports collection-wide public permissions but
does not support the custom filtered permissions proposed in issue #5. The
server therefore grants public CRUD only on `kv`, with the seven-coll restriction
enforced in PostgreSQL. Public WebSocket mode is enabled only on fam's REST
WebSocket endpoint. CORS permits this site and the Directus admin origin.

Migration runs entirely on the Linux server using the homelab-dashboard tools:
`scripts/migrate-supabase-kv.sh --skip-directus` exports and imports the source,
and `deploy/fam-kv-directus.sql` registers metadata and installs database rules.
Private exports and rollback configuration are stored outside this repository.
Never commit an export: member documents contain personal information.

Keep the Supabase project during the observation period. To roll back the site,
restore its previous HTML/shim; if people have edited data on Directus since
cutover, reconcile those edits before switching back. Do not delete Supabase as
part of this change.

Run `node test-directus-db.mjs` for offline shim checks. Server verification must
also check full source/destination content equality, all seven collections,
public CRUD, denied unknown colls/admin APIs, browser CORS and realtime updates.
