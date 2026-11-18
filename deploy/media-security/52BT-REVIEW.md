# 52BT source review — November 17, 2026

The owner named Internet Archive and 52BT as the desired sources. Internet Archive remains the existing approved, enabled indexer. 52BT was added to Prowlarr as ID 2, **disabled**, restricted to Film and Television, with no application approval tag. Neither Radarr nor Sonarr has a 52BT indexer entry.

The installed Prowlarr definition supports 52BT as a public indexer and does not request account credentials. Both current definition URLs returned Prowlarr's Cloudflare-protection error during connection tests. No torrent was grabbed.

## Metadata limitations

The installed and upstream `definitions/v11/52bt.yml` explicitly set `seeders: text: 1` and `leechers: text: 1`. Those values are placeholders, not live swarm measurements. The definition does not expose a verified-uploader identity or a trusted-release approval flag. A minimum-seeder rule cannot provide a meaningful health or reputation filter for this source. Category and release-format filters remain useful, and all downloaded content would still need the quarantine gate.

Reference: [Prowlarr's 52BT definition](https://github.com/Prowlarr/Indexers/blob/master/definitions/v11/52bt.yml).

## Bounded helper trial

`trial_52bt.py` uses a pinned FlareSolverr image with a temporary private Docker network shared only with Prowlarr, no published ports, no mounted host folders or credentials, non-root UID 1000, no capabilities, no-new-privileges, 512 MiB RAM with no container swap, 0.5 CPU and a PID limit. It sends one request, records a small result, and removes the helper and temporary network. It never enables an indexer or changes source approval. Subsequent trials also stop on sustained host memory stalls, an oversized response or the request deadline.

The queued trial also has an independent 150-second in-container deadline, so a controller failure cannot leave the browser running indefinitely.

The initial browser trial timed out without a response; it was not OOM-killed. During the trial the host's memory full-stall avg10 reached about 9.8%, with swap nearly full. The helper and network were removed. There is no persistent FlareSolverr service. The downloaded image remains cached on disk, consuming no running RAM/CPU.

One further bounded trial is queued as `media-52bt-after-audit.service`, ordered after the existing library audit so it does not compete with ClamAV. It also refuses to start without at least 1.5 GiB available RAM. A successful trial would establish connectivity only; 52BT remains disabled until its result is reviewed and an operational setup is completed. Private findings: `~/server-platform/media-security/52bt-review.json` and `52bt-helper-trial.json`.
