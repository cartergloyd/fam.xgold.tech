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

1. Back up fam with the normal private process. Apply `schema.sql` as the owner:
   `docker exec -i gold-platform-postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d fam' < schema.sql`.
   It is additive and idempotent; seeded rows use `ON CONFLICT DO NOTHING`.
2. Run `python3 install.py`. It copies `endpoint.js` as `family-trips.js` into both the
   active and canonical extension directories and registers `familyTrips(router,{database})`.
3. Restart family Directus so it reloads the extension and its schema cache.
4. Check `curl -s https://fam-api.xgold.tech/family/trip | head -c 400` shows the trip.
5. Publish the site to main. Until this step, the old page keeps working except
   that renamed bedroom claims and plans are not shown; nothing is lost.

Between steps 1 and 5 the old page does not see the renamed documents, and the new
page needs step 3, so do them together.

## Next trip

Insert a `family_trips` row in Directus admin (and a property row with rooms and
photos if it is a new house). Commit the photos under `photos/<property>/`. The home
page switches to the new trip once its end date is the next one in the future;
`?trip=<id>` shows a specific trip. Trip documents for the old trip stay in `kv`
under their trip id.

## Rollback

Restore the extension backup named by `install.py`, restart family Directus and
revert the site commit. Keep the tables and the `kv.trip` column; the old page
ignores the extra column but expects unprefixed ids, so only roll back the site if
you also rename `kv` ids back (reverse the migration's INSERT/DELETE).

## Tests

`node --test tests/family-trips.mjs` checks trip selection and the response shape
offline. `node --test tests/home-trip.mjs` renders the home page against a mocked
API at phone and desktop widths and checks that bedroom claims and plans are
written with the trip id and prefix.
