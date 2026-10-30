# 6108 and Minecraft family hubs

The existing family email/PIN login and registration now issue a seven-day HMAC
session using Directus's existing SECRET. Sessions are verified against the ready
family user and a fingerprint of their current PIN hash on every request. Changing
PIN, disabling a user, or rotating SECRET invalidates their session. The dedicated X-Family-Session header avoids Directus API-token authentication.
CORS_ALLOWED_HEADERS includes Content-Type,Authorization,X-Family-Session. Tokens are
stored in browser localStorage; PINs are never stored. A previously saved browser
profile must sign in once to obtain a session. Names and browser profile data do
not authorize writes. Management flags are read from the database on every call.

Carter and Chester manage reservations, blocked dates, property settings and
instant-booking grants. Both can book immediately. All other users need approval
until either manager enables instant booking in Manage. Pending requests hold
dates. PostgreSQL excludes overlapping pending/confirmed/blocked stays, including
concurrent requests; checkout is exclusive, so same-day handovers work. Members
can cancel their own active stays; managers can approve, decline, cancel, and
unblock. Managers can also open a stay from the calendar and edit its title, dates,
guests and notes; the page sends those fields with the revision on
PATCH /hub/reservations/:id, which the deployed router does not accept yet (it takes
status changes only). Until it does, to reschedule, cancel and create a new stay.
Closed stays remain in the database. Stays open from the calendar, where managers
approve, decline or cancel them.

Lake schedule: schema.sql adds a `lake_schedule` flag on users (set for Chester), a
`title` on reservations, and the family_lake_days, family_lake_away, family_lake_weekends
and family_lake_invites tables. `lake-schedule-2026.xlsx` beside this file holds Chester's
2026 data to load, one sheet per table. The /hub/lake routes the page calls (listed on
the spreadsheet's README sheet) are not written yet, so until they exist the page shows
the owner the ordinary manager view and keeps the lake tabs hidden.
Bookings name the guests in each suite (Master Suite and Disney Suite) in the
additive `suites` jsonb column; the guest count is derived from those names, and
the page sends the count too so it works until schema.sql is re-applied.
Anyone with the 6108 link can see availability (dates and status only, no names,
notes or ids) and request a stay without signing in. Those requests always wait
for manager approval, are rate limited per address, and store the first guest
named as the contact in `guest_name` with a null `user_id`. The site ribbon and
the Maintenance and Manage tabs appear only after signing in.

Defaults: 4 pm check-in, 10 am check-out, America/Chicago, no guest/stay limit beyond
input sanity bounds (100 guests, 365 nights), no advance notice. Managers should
set actual property limits, timezone, description and house rules in Manage.
Property configuration and task/reservation writes use revisions to prevent
silently overwriting another person's changes. Writes require the family origin.
No new public Directus collection permissions are granted.

Any signed-in member can report maintenance; cards are assigned to Jaime. Jaime,
Carter and Chester can edit/move/delete maintenance cards. All signed-in members
can create/edit/move/delete Minecraft build cards, with optional complete X/Y/Z
coordinates and an Overworld/Nether/End location. Column buttons support keyboard
and touch without requiring drag-and-drop. Deletion requires a second click.

## Map

Dynmap is already running on the host LAN address, http://192.168.1.148:8123.
The endpoint proxies only read-only map resources under /family/mc-map/ over HTTPS;
chat, login and administrative routes are excluded. No Minecraft restart required.
Dynmap's installed map.js uses `playername` for automatic following. The page picks
the first visible online player alphabetically, follows them through Dynmap's own
live updates, and picks a replacement when that player leaves. Pause following and
reduced-motion preferences disable automatic player tracking. Status checks pause
in background tabs; the embedded Dynmap keeps its normal update behavior.

The collector samples visible online-player positions once per minute into
256-block areas without storing player identities. With nobody online, the hero
chooses the area with the most samples across the last 21 days. Until player
samples exist, a one-time scan of recent region-file chunk-save timestamps provides
an explicitly labelled approximation, not historical player counts. Region paths
here match the current 26.3 dimension layout. Retention is 21 days. No chat, player
accounts, or precise movement trails are stored in the activity table.

## Installation

1. Back up fam using the normal private backup process. Apply schema.sql as the
   PostgreSQL owner (`docker exec -i gold-platform-postgres sh -c 'psql -v
   ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d fam' < schema.sql`). The migration is additive.
2. Run `python3 install-backend.py`. It backs up both active and canonical family
   extensions outside repositories, integrates sessions into login and registration,
   and preserves streaming endpoints. It also adds X-Family-Session to the family
   service’s CORS allowlist in compose.yml. Recreate only that service with
   `docker compose --env-file apps.env -f compose.yml up -d --no-deps directus-fam`
   from public-apps so the CORS environment setting takes effect.
3. Run `python3 collect-activity.py --seed-chunks` once. Install the service/timer in
   ~/.config/systemd/user, run daemon-reload, and enable --now fam-mc-activity.timer.
   The timer reads the deployed source at fam-site-src/deploy/family-hub.
4. Publish site files to main. /6108 and /mc resolve to static directory pages.
   The existing family ribbon already links to both.

Carter and Chester's existing directory rows get condo_manager and instant_booking;
Jaime gets maintenance_manager. Invited profiles retain their existing registration
flow; no PIN or email is assigned or reset by this migration. No real reservations,
maintenance tasks or Minecraft build cards are seeded.

Rollback: restore the previous extension backup, restart family Directus, revert
the site commit, and disable the activity timer. Keep additive tables/columns to
preserve bookings and work. Do not automatically drop user data on rollback.

## Tests

`node --test tests/family-hub-api.mjs` checks sessions, date validation and map
selection offline. The database integration test runs in an isolated PostgreSQL 16
container with synthetic users. It requires HUB_TEST_DATABASE ending in _test,
HUB_SOURCE pointing to these modules, and the existing Directus container's knex
module and database environment. It checks booking races, adjacent dates, manager
permissions, approval, cancellation, limits, task assignment and revision conflicts.

`node --test tests/family-hub-browser.mjs` checks both pages on mobile and desktop
with mocked APIs and no live writes. Existing ribbon, account and directory tests
also apply. Live verification uses signed sessions without revealing credentials;
no real bookings/cards need to be created to verify the deployment.

## Minecraft self-whitelisting and first names

The Minecraft hero now fills the first viewport, beneath the shared navigation.
Join instructions use one platform selector. The same widget lets signed-in family
members link one Java account and one Bedrock/Xbox account. These names are
self-reported; the service verifies account existence, not ownership of the game
account. Only the current family user's own requests are visible. Six attempts
per family profile per day and a unique active request per edition prevent bulk
additions; retries for the same active account are idempotent. Carter can reset
an incorrect link in the private database without removing any whitelist entry.

The directory row is the source of truth. schema.sql adds optional Minecraft account
columns to family_users: mc_java_username, mc_java_uuid, mc_bedrock_username and
mc_bedrock_uuid. Names follow whitelist.js (Bedrock gamertags without Floodgate's '.'
prefix) and each UUID can belong to only one family member. POST /hub/mc-whitelist
stores the self-reported name on the member's row and queues a family_mc_whitelist
request; GET lists the member's requests plus any account linked straight on their row
(pending until it has a UUID). Carter can also type a username into Directus: the worker
resolves its UUID within a minute. To unlink an account, clear its two columns and set
any 'added' request for that edition to 'failed'; the server's whitelist entry stays.

Apply whitelist-schema.sql to fam (schema.sql holds the account columns). Install
whitelist.js as hub-whitelist.js beside the existing extension and register
whitelistHub(router,{database}); install-backend.py performs that integration. Restart
family Directus afterwards. No public Directus collection permissions are added.

Install fam-mc-whitelist.service in the user service directory and enable it. It runs
whitelist-worker.py from the deployed fam-site-src tree. Every two seconds it claims one
pending request from PostgreSQL, verifies the account (Java account IDs come from
Minecraft's profile lookup; Bedrock XUIDs from Geyser's Xbox lookup, mapped with
Floodgate's UUID scheme, '.' prefix and space-to-underscore setting), writes the username
and UUID onto the member's row, and syncs. Every minute, and after each request, the sync
merges the directory into whitelist.json by UUID (adding or renaming, never removing an
entry, and never adding a disabled member) and sends `whitelist reload` over RCON. RCON
settings are read from server.properties (enable-rcon, rcon.port, rcon.password);
Minecraft binds RCON to server-ip, so it stays on the LAN. Only 'whitelist reload' and
'whitelist list' are ever sent, and names never become commands or shell arguments. A
request is marked added only after its UUID is present in whitelist.json; failures stay
retryable and a stale processing request retries after two minutes. The sync also writes
plugins/FamilyNames/names.json (account UUID -> first name) for the plugin below. The
Management Protocol is not used; it stays disabled in server.properties.

### FamilyNames plugin

family-names/ is a small Paper plugin. It reads names.json and, for each matching
player, sets the display name (chat, DiscordSRV's %displayname%, Dynmap labels), the tab
list name, and renames the player's profile, which changes the name tag above their head
for everyone else. It re-reads the file every 30 seconds and applies changes to online
players. config.yml can turn the profile rename off for everyone or for Bedrock players
only; chat and the tab list keep the first name either way. Permissions, ops and the
whitelist are keyed by UUID and are not affected. Build with `family-names/build.sh`
(Maven in Docker, no JDK needed) and copy target/FamilyNames.jar into the server's
plugins folder; loading it needs a server restart.

Verify without writes with `python3 deploy/family-hub/whitelist-worker.py --check`;
`--sync` runs one reconcile and prints the whitelist size. Worker tests:
`python3 -m unittest discover -s tests -p test_mc_whitelist.py`. The hub API and browser
suites also cover account isolation, input validation, idempotent requests, attempt
limits, all five platforms, and full-viewport layout.
