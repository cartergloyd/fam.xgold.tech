# Media automation (Radarr, Sonarr, Prowlarr)

Installed 2026-11-17 on gold-server. The family site (`/streaming/`) is the only interface people use; these services are private.

```
fam.xgold.tech/streaming  ->  fam-api (Directus extension streaming-hub.js)  ->  Radarr / Sonarr  ->  qBittorrent (behind gluetun VPN)  ->  Jellyfin
                                                                                    ^ Prowlarr pushes indexers to both
```

- Compose project: `/home/gold/server-platform/media-automation/` (copy of `docker-compose.yml` here). Pinned images: Radarr 7.0.3, Sonarr 4.0.20, Prowlarr 3.0.2 (linuxserver). Config volumes: `config/{radarr,sonarr,prowlarr}` there. Restart policy `unless-stopped`; Docker is enabled at boot.
- **Private**: web UIs bind `127.0.0.1` only (7878, 8989, 9696) and require the login in `credentials.txt` (mode 0600, server only). To open one: `ssh -L 7878:127.0.0.1:7878 gold@gold-server`, then http://localhost:7878. Nothing is on the public tunnel.
- **Networks**: `media-net` (172.31.88.0/24: Radarr, Sonarr, Prowlarr, and `homelab-directus-fam`) and `qbittorrent-vpn_default` (Radarr and Sonarr only, to reach `qbittorrent-vpn:8080`). qBittorrent already trusts the Docker range through its own subnet whitelist. `homelab-directus-fam` joins `media-net` through `public-apps/compose.yml` (`networks: media`).
- **Storage**: the media folder is mounted at the *same path* in every container (`/home/gold/Jellyfin Server/media`), so qBittorrent's paths need no remapping, imports hardlink (same filesystem, verified), and nothing existing moves. Library folders: `Movies/` (Radarr) and `Shows/` (Sonarr). Downloads: `Downloads/radarr/` and `Downloads/sonarr/`. Jellyfin's libraries do not include `Downloads/`.
- **qBittorrent changes** (VPN stack untouched, gluetun and the kill switch were not restarted): categories `radarr` and `sonarr` with those save paths, and "Automatic Torrent Management" on for NEW torrents only (`auto_tmm_enabled`). Existing torrents keep their paths. To undo: set `auto_tmm_enabled` false (Tools > Options > Downloads) and delete the two categories.
- **Quality** ("Family 4K to 1080p", both apps): allows 720p to 2160p WEB/Blu-ray (no remuxes or disc images). Radarr and Sonarr grab the best allowed quality they find, so 2160p wins when it exists and 1080p is the fallback. The cutoff is WEB 1080p, so a 1080p file is never swapped for 4K later (no surprise replacements, no duplicate copies) while 720p can still be upgraded to 1080p. Size caps (MB per minute of runtime, preferred/max): Radarr 1080p 25/45, 2160p 70/110; Sonarr 1080p 30/70, 2160p 70/130.
- **Naming** for Jellyfin: movie folders `Title (Year) [tmdbid-N]`, series folders `Title (Year) [tvdbid-N]`, so matching is exact. Radarr and Sonarr call Jellyfin after imports with a path mapping (`.../media` to `/media`).
- **Indexers**: only the public-domain **Internet Archive** indexer is installed (it is slow and has no TV categories, so it only serves movies). Add your own authorized indexers in Prowlarr (Indexers > Add); Prowlarr syncs them to Radarr and Sonarr automatically. Until a TV-capable indexer exists, TV requests are accepted and tracked but nothing is found. Prowlarr's own traffic is not routed through the VPN; move it behind gluetun (`network_mode: container:qbittorrent-vpn`) if you want that.
- **No Seerr.** The brief allowed Seerr "where practical". Request, approval and role state already lives in the site's PostgreSQL, so Seerr would be a second source of truth plus an identity-mapping layer, and the server is short on memory (swap was already ~4 GB used before this). Radarr and Sonarr are called directly instead.

## Re-run or rebuild
`tools/configure.py` (this folder, with `arr.py`) is idempotent: it creates the root folders, qBittorrent client, Jellyfin notification, quality profile and size limits, Prowlarr apps and the Internet Archive indexer, and locks the web UIs. Running it again changes nothing.
```
cd /home/gold/server-platform/media-automation && docker compose up -d && cd tools && python3 configure.py
```

## Backups and rollback
- Before changes: `/home/gold/server-platform/backup-private/media-automation-<timestamp>/` (extension files, both compose files, qBittorrent config, database dump of `family_users` and `family_streaming_requests`) and `streaming-hub-<timestamp>/`, `streaming-hub-retire-<timestamp>/` (previous extension files). The nightly PostgreSQL dump also covers the fam database.
- Back up the three `config/*` folders with `docker compose stop` first (they hold SQLite databases and API keys).
- Remove everything: `docker compose down` (config folders and media stay), restore `public-apps/compose.yml` from the backup, restore the extension folder from the backup and `docker restart homelab-directus-fam`. The Postgres columns are additive and harmless to leave.

## Tested 2026-11-17 (evidence, and what was simulated)
- Real: Radarr search through Prowlarr and the Internet Archive, grab, and qBittorrent download into the `radarr` category path (the torrent stalled at 99.3% with no peers, so it was removed). Real: roles, approval and duplicate rules through the live site API, TV season selection in Sonarr, VPN exit IP unchanged (qBittorrent 187.x vs host 99.x) before and after, restart of the whole stack with configuration intact.
- **Simulated**: the completed download. A synthetic 150 s clip was placed in `Downloads/radarr/` and imported with Radarr's Manual Import. That proved rename, library placement, Jellyfin detection with the right TMDB id, and the site flipping to Available with a watch link. Radarr's own "tell Jellyfin" push was not seen firing for a manual import, so the site also asks Jellyfin to refresh about a minute after an import. All test movies, files and requests were removed afterward; libraries were verified identical.
- **Not done**: no real end-to-end download of a mainstream title (needs your indexers), no TV download, and no reboot of the server.
