# Fantasy awards: invitations, RSVP and ballots

The page is `/awards/` (static; event details and categories are in `awards/event.json`). Each printed invitation carries a QR code to
`/awards/?k=<token>`. The link opens a sign-in card with that person's name already chosen: first visit they pick a four-digit
passcode (their family PIN), later visits they enter it. Then they RSVP, nominate in each category, and/or upload a photo or PDF of a handwritten ballot.
Until this server side is installed the page still shows the invitation and says RSVP is not open yet.

The passcode is the family PIN. Someone with no PIN yet types one once and it is saved to `family_users` (hash only, same scheme as
normal registration; their status and email are untouched, so they can still register with an email later, which replaces the PIN).
Someone who already has a family PIN enters it. Registered members also receive the regular family session, so signing in here signs
them in across the site. Tokens are stored only as sha256. Five wrong passcodes lock that invitation for 15 minutes. A session never
expires, but it is signed with the current PIN hash, so changing the PIN ends it. Uploads (JPEG, PNG, WebP, HEIC, PDF, up to 8 MB)
are stored in the table. The ballot is one text answer (up to 500 characters) per category in `awards/event.json`.

## Install (owner applies; nothing here runs by itself)

1. `psql ... -d fam < schema.sql` (one table, `family_award_guests`; safe to run twice).
2. `python3 install.py`, then `docker restart homelab-directus-fam` as its own command. It adds `import awardsHub` and
   `awardsHub(router, { database }, { familySession })` after the streaming requests line in both extension copies and backs them up first.
3. Make the invitations (needs `pip install segno`; keep the output folder private, each link lets its holder set that passcode):
   run the `ssh ... psql` query in the header of `make-invites.py` into it. It writes `invites.sql` (hashes only), `invites.csv`
   and a printable `invites.html` of QR cards. Load `invites.sql` with psql the same way as the schema.
   Re-running only covers people who have no invitation yet, so old QR codes keep working.
4. Open the Carter link and enter the family PIN: the organizer (`--admin NAME`) also sees RSVPs, tallies, reasons and paper ballots at the
   bottom of the page. Clear a lock with `UPDATE family_award_guests SET failed=0, locked_until=NULL WHERE user_id=...`. A forgotten PIN is reset in Directus on `family_users` like any other.

Routes (under `/family`): GET `/awards/invite?k=`, POST `/awards/claim`, GET `/awards/me`, PUT `/awards/rsvp`, PUT `/awards/ballot`,
PUT and DELETE `/awards/upload`, GET `/awards/upload/:id|me`, GET `/awards/results` (organizer). Sessions travel in the existing
`X-Family-Session` header, so no CORS change is needed. Writes require the family origin.

Tests: `AWARDS_TEST_MODULES=<folder holding node_modules with knex and pg-mem> npm run test:awards` (skipped without it).
