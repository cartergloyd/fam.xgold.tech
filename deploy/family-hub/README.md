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
unblock. To reschedule, cancel and create a new stay. Closed stays remain in the
database. The UI shows upcoming reservations, including closed requests.

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
