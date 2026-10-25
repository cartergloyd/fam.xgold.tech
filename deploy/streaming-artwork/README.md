# Recent Jellyfin artwork

`refresh.py` reads the existing private Jellyfin sync config and publishes up to
24 JPEG posters and `recent.json` into the family Directus uploads directory.
Movies and series are ordered by Jellyfin DateCreated; new episodes use their
series poster, deduplicated. No account data, titles, tokens or Jellyfin URLs are
published. Failed refreshes retain the last good feed. Old artwork expires after
a week; the public manifest caches for five minutes and images for a day.

Install refresh.py under `/home/gold/server-platform/fam-streaming-artwork/`, and
the service/timer in `~/.config/systemd/user/`. Enable the timer with
`systemctl --user enable --now fam-streaming-artwork.timer` and run the service
once. The existing private config remains outside this repository.

Copy endpoint.js as streaming-artwork.js alongside the family Directus extension
index.js, import `streamingArtwork from './streaming-artwork.js'`, and invoke
`streamingArtwork(router)` at the start of its handler. Keep the canonical
homelab-dashboard deploy source in sync. Restart homelab-directus-fam.
Only the generated manifest and strictly named JPEGs are served, under
`/family/streaming-artwork/`; no authenticated Jellyfin API is exposed.

Check `systemctl --user status fam-streaming-artwork.timer` and
`journalctl --user -u fam-streaming-artwork.service`. To stop refreshes, disable
the timer. To remove the feed, remove the two extension integration lines.
The frontend keeps its readable gradient and launch icon if artwork is missing.

API reference: https://typescript-sdk.jellyfin.org/interfaces/generated-client.LibraryApiGetItemsRequest.html
