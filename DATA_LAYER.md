# Family website data

The family `fam` PostgreSQL database and its Directus API at
https://fam-api.xgold.tech hold shared trip data and the family user directory.
The main page and fantasy football page read public profiles from
`family-directory.js`. Names, profile photos, family editing groups and fantasy
team associations come from `family_users`, rather than a roster embedded in
HTML. People without a photo get an initial avatar.

## Shared user directory

The CSV was imported once into `family_users`: 22 people, 17 photos, four existing
email/PIN registrations. Database edits are now authoritative; the source CSV is
private operational input, not a file served by this website. Original photo
uploads remain in Personal; the family database has its own copies.

Manage people in fam's Directus admin → family_users. Set name, email, status,
photo, fantasy_team and group_id. Enter four digits in `pin` to set/change a PIN;
the database hashes it and clears that input. Leaving it blank keeps the existing
PIN. A saved PIN cannot be read back through Directus. `invited` means not yet
registered; `ready` enables sign-in/Jellyfin; `disabled` blocks sign-in and disables
the linked Jellyfin account. Users with the same group_id can edit each other's
trip entries; a blank group means that person edits their own entries.

The public API exposes id, name, photo_url, group_id, fantasy_team and registered
only. It never publishes email lists, PINs, PIN hashes or Jellyfin account IDs.
The collection itself has no anonymous Directus permissions. The server extension
`directus-extension-family-directory` provides:

- GET /family/users: public profiles.
- GET /family/photos/:id: only the assigned raster photo for an active user.
- POST /family/lookup: checks an exact email and returns id/name only.
- POST /family/login: checks email/PIN on the server.
- POST /family/register: atomically claims an invited row using email/PIN.

The existing site keeps a browser identity and local signed-in display. Trip
collections retain the previous shared/public editing model; directory sign-in
does not introduce server authorization for those existing trip documents.
Sign-in attempts are rate limited, and credentials stay in the private table.

## Jellyfin

`fam-jellyfin-sync.timer` reads this same table every minute. Rows with an email,
PIN and ready status receive an account; invited rows wait until registration.
The email is the Jellyfin username and the family PIN is the password. Profile
photos also synchronize. Linked Jellyfin IDs are retained so an email change
renames the existing account and preserves its watch history. Disabled rows
disable their linked account; no account is deleted automatically. The separate
cartgold administrator is outside this directory.

## Trips, houses and rooms

The home page reads the featured trip from the public, read-only
`GET /family/trip`: the trip (`family_trips`), its house (`family_properties`,
which also holds 6108) and the claimable bedrooms (`family_rooms`). Title, dates,
airports, the airport driver, house facts, spaces, amenities, nearby places, the
hero slideshow, gallery, highlight-card art and pins, and bedroom names and photos
are all database rows; the page has no trip literals. Photos are plain files under
`photos/<property>/` and the rows store their URLs. The featured trip is the one in
progress or the next to start; `?trip=<id>` shows another. Manage trips, properties
and rooms in fam's Directus admin. Until the endpoint is installed, the page renders
`trip.json`, a snapshot of the same response built from the seed rows, and leaves kv
ids unprefixed. See `deploy/family-trips/README.md`.

## Trip data

`directus-db.js` preserves the `window.claude.use('db'|'user')` document API for
`kv(key,coll,id,data,trip)`. Allowed collections remain plans, bedrooms, flights,
members, progress, meals and groceries. PostgreSQL enforces the allowlist and
immutable paths. Every document carries its `trip`; the page calls `db.trip(id)`
once, after which stored ids are `trip:id` (so `bedrooms/destin-2027:b1`) while page
code keeps using `b1`. Public WebSocket subscriptions fall back to 15-second polling.
No administrator token is embedded in the site. Legacy member claim credentials
are retired; registration writes the directory instead.

Server migration, extension code and tests are in the homelab dashboard's
`deploy/family-directory/`; private import/state/rollback files stay outside both
repositories. Never commit users.csv, exports, PINs or operational credentials.

Run `node test-directus-db.mjs` and `node test-family-directory.mjs` for offline
client checks. Server verification covers profiles/privacy, all assigned photos,
CORS, sign-in, duplicate registrations and concurrent claims, PIN handling,
disabled users, Jellyfin links/photos and unchanged shared trip collections.

## 6108 bookings and Minecraft builds

`/6108/` and `/mc/` use the authenticated endpoints in `deploy/family-hub/`.
Email/PIN login and registration now also issue a signed seven-day session.
Existing browser profiles must sign in once for these pages. The shared trip
collections keep their existing behavior. No new public collection access is
introduced. Carter and Chester manage condo reservations/settings/instant-booking
access; Jaime manages maintenance. Minecraft cards are shared by signed-in family
members.
Members link their Minecraft accounts on `/mc/`: the Java username, Xbox gamertag and
verified UUIDs live on `family_users`, the server whitelist follows those rows, and the
FamilyNames plugin shows each player by their directory first name. See `deploy/family-hub/README.md` for database constraints, installation,
map activity collection, verification and rollback.
