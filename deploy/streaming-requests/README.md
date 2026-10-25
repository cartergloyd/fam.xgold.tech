# Streaming title requests

The family Directus endpoint uses Jellyfin's configured TheMovieDb remote-search
provider for movie and series metadata. Search queries are bounded, debounced in
the UI, rate limited, cached for ten minutes, and never access a download API.
https://typescript-sdk.jellyfin.org/classes/generated-client.ItemLookupApi.html

Apply schema.sql to the fam PostgreSQL database. Requests appear in the private
Directus `family_streaming_requests` collection with Pending/Added/Declined status.
No public read endpoint or public Directus collection permissions are granted.
Requests do not automatically download anything. Each browser/profile can request
a title once; repeated POSTs are idempotent. Names are optional and self-reported,
not authenticated identities, and confer no privileges. No emails or PINs stored.

Install endpoint.js as streaming-requests.js beside the family extension index.js
in both active and canonical backend directories. Import its default export as
streamingRequests and call `streamingRequests(router, { database })` in handler.
Create extensions/.family-streaming.json, outside the extension package, mode 0600,
containing `url` (Jellyfin reachable from the Directus container, no trailing slash)
and `api_key` from the existing private Jellyfin config. Never add it to Git.
Restart homelab-directus-fam after installation. No container mounts change.

Only sanitized search results and expiring HMAC-signed selections go to the browser.
Submissions must carry an unexpired selection returned by the server. Private
Jellyfin credentials never reach the browser or repository. Client identity is a
random browser UUID, HMAC-hashed for deduplication; no IP addresses are persisted.
The form is public, with origin validation and rate limits; it is not an account
session or a delivery guarantee. To remove it, remove its integration lines and
frontend includes; retain the table to preserve requests.
