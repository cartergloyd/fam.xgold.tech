# Email-based profile suggestions

`profile-match.js` runs locally against the public family roster as soon as `@`
appears. It uses confirmed first/display names and optional surnames. Exact full
names and initial + surname rank above a first name alone; ties and weak/partial
matches leave selection manual. Dots, hyphens, underscores, plus tags, numeric
suffixes, case and accents are normalized. No arbitrary substring or fuzzy match
can claim a profile.

The full address is still checked with the existing exact-email lookup. A known
email takes priority, and Continue stays disabled while that lookup is pending.
Unknown addresses may suggest an invited profile, which the user must confirm
before choosing a PIN. Existing registered profiles ask for their registered email;
a guess cannot change an email, bypass a PIN or authenticate a user.

The private database and CSV have optional first/last-name fields. Only Chester
Gloyd and Rick Smith were populated from the owner's examples; other surnames
remain blank. Display names, stable IDs, PIN salts and Jellyfin links are unchanged.
See deploy/ for the migration and public serializer patch. Keep the CSV private.

Run `npm run test:profiles` for matching, suggestion/signup, exact-email precedence,
Streaming navigation and launch-fallback checks. Browser tests mock all account writes.
