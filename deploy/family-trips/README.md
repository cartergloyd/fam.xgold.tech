# Trips, rooms and house photos

The home page used to hardcode one trip: the title, dates, airports, the house,
its bedrooms and about 1.9 MB of inline photos. It now reads everything from the
fam database through `GET /family/trip` and renders the trip in progress or the
next one to start. Photos are plain files under `photos/<property>/` on the site;
the database stores their URLs.

## Data

- `family_properties` gains `kind`, `address`, `bedrooms`, `bathrooms`, `sleeps`,
  `spaces`, `amenities`, `nearby`, `hero`, `gallery` and `cards`. The Destin house
  is the row `seastar-palazzo` (kind `rental`); 6108 is unchanged except for the
  new empty columns, which its hub endpoint ignores.
- `family_rooms`: one row per claimable bedroom. `slug` (b1…) is the kv bedroom id.
- `family_trips`: `destin-2027` with dates, STL origin, local airports VPS/ECP/PNS,
  Jaime as the airport driver, the strip tagline and the countdown noun.
- `kv.trip`: every trip document carries its trip id (default and backfill
  `destin-2027`, foreign key to `family_trips`). Documents with caller-chosen ids
  (bedrooms, progress, meals) are stored as `trip:id`, for example
  `bedrooms/destin-2027:b1`, so a later trip can reuse `b1`. The migration renames
  the existing six trip documents; `members` rows are left alone. The site adds and
  strips the prefix in `directus-db.js`, so page code still sees `b1`.

The public kv permission already covers all fields, so `trip` needs no permission
change. `family_trips`, `family_rooms` and `family_properties` get no public Directus
access; the endpoint serializes only the fields the page renders.

## Install

The site is already published. While the API answers `ROUTE_NOT_FOUND` for
`/family/trip`, the home page renders `trip.json`, the site's own snapshot of the
same response built from the seed rows in `schema.sql`, and kv documents keep their
unprefixed ids. Do the steps below back to back; nothing needs to be published after.

1. Back up fam with the normal private process. Apply `schema.sql` as the owner:
   `docker exec -i gold-platform-postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d fam' < schema.sql`.
   It is additive and idempotent; seeded rows use `ON CONFLICT DO NOTHING`.
2. Run `python3 install.py`. It copies `endpoint.js` as `family-trips.js` into both the
   active and canonical extension directories and registers `familyTrips(router,{database})`.
3. Restart family Directus so it reloads the extension and its schema cache.
4. Check `curl -s https://fam-api.xgold.tech/family/trip | head -c 400` shows the trip.
   Reload the home page: it now reads the database and scopes documents by trip.

Between steps 1 and 3 the page still uses the snapshot with unprefixed ids although
the migration has already renamed the documents, so a claim made in that window
lands as an unprefixed row. Re-running `schema.sql` afterwards renames such strays.

Whenever the trip, house or rooms change in Directus, refresh the snapshot so the
fallback stays truthful: `curl -s https://fam-api.xgold.tech/family/trip > trip.json`,
then commit it. `tests/family-trips.mjs` checks the snapshot's shape and that every
photo it references exists in the repo.

## Next trip

Insert a `family_trips` row in Directus admin (and a property row with rooms and
photos if it is a new house). Commit the photos under `photos/<property>/`. The home
page switches to the new trip once its end date is the next one in the future;
`?trip=<id>` shows a specific trip. Trip documents for the old trip stay in `kv`
under their trip id.

## Rollback

Restore the extension backup named by `install.py` and restart family Directus; the
page falls back to the snapshot on its own. Keep the tables and the `kv.trip`
column, but the snapshot mode expects unprefixed ids, so also reverse the
migration's INSERT/DELETE if claims and plans must keep showing.

## Tests

`node --test tests/family-trips.mjs` checks trip selection and the response shape
offline. `node --test tests/home-trip.mjs` renders the home page against a mocked
API at phone and desktop widths and checks that bedroom claims and plans are
written with the trip id and prefix.
