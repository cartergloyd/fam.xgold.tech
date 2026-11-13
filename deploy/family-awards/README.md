# Fantasy awards: invitations, RSVP and ballots

The page is `/awards/` (static; event details and categories are in `awards/event.json`). Each printed invitation carries a QR code to
`/awards/?k=<token>`. The link opens a sign-in card with that person's name already chosen: first visit they create a four-digit
passcode, later visits they enter it. Then they RSVP, nominate in each category, and/or upload a photo or PDF of a handwritten ballot.
Until this server side is installed the page still shows the invitation and says RSVP is not open yet.

The awards passcode is separate from the family PIN and email: it never touches `family_users`, so nobody's status, email or normal
registration changes. Tokens are stored only as sha256. Five wrong passcodes lock that invitation for 15 minutes. A session lasts 30
days and stops working if the passcode changes. Uploads (JPEG, PNG, WebP, HEIC, PDF, up to 8 MB) are stored in the table.

## Install (owner applies; nothing here runs by itself)

1. `psql ... -d fam < schema.sql` (one table, `family_award_guests`; safe to run twice).
2. `python3 install.py`, then `docker restart homelab-directus-fam` as its own command. It adds `import awardsHub` and
   `awardsHub(router, { database })` after the streaming requests line in both extension copies and backs them up first.
3. Make the invitations (needs `pip install segno`; keep the output folder private, each link lets its holder set that passcode):
   run the `ssh ... psql` query in the header of `make-invites.py` into it. It writes `invites.sql` (hashes only), `invites.csv`
   and a printable `invites.html` of QR cards. Load `invites.sql` with psql the same way as the schema.
   Re-running only covers people who have no invitation yet, so old QR codes keep working.
4. Open the Carter link, create a passcode: the organizer (`--admin NAME`) also sees RSVPs, tallies, reasons and paper ballots at the
   bottom of the page. Reset someone's passcode with `UPDATE family_award_guests SET pin_hash=NULL, failed=0, locked_until=NULL WHERE user_id=...`.

Routes (under `/family`): GET `/awards/invite?k=`, POST `/awards/claim`, GET `/awards/me`, PUT `/awards/rsvp`, PUT `/awards/ballot`,
PUT and DELETE `/awards/upload`, GET `/awards/upload/:id|me`, GET `/awards/results` (organizer). Sessions travel in the existing
`X-Family-Session` header, so no CORS change is needed. Writes require the family origin.

Tests: `AWARDS_TEST_MODULES=<folder holding node_modules with knex and pg-mem> npm run test:awards` (skipped without it).
