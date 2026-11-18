# Media quarantine and import gate

Installed on gold-server on November 17, 2026 with owner approval for the qBittorrent restart and password. No additional indexer was added. The existing Internet Archive source remains approved; new sources need explicit owner approval.

## Storage boundary

```text
qBittorrent /incoming -> Jellyfin Server/security-store/raw (untrusted; outside media)
  -> private independent copy in security-store/sealed/<torrent hash>
  -> offline ClamAV and offline file/signature/short video decode checks
  -> atomic publication under media/Verified
  -> Radarr/Sonarr remote-path mapping /incoming/ -> media/Verified/
  -> library import (hardlink when supported), then Jellyfin
```

qBittorrent cannot mount the sealed or verified paths. Its only writable host mounts are its own config and raw quarantine. Existing seed paths are narrow read-only Movies/Shows mounts (including legacy `/downloads` and `/movies` aliases). Unfinished legacy downloads were moved outside the library, with resume paths updated; one legacy missing-files torrent remains stopped. The VPN container was neither restarted nor recreated. Completed existing library files were not moved or scanned.

Snapshots use separate file data, not raw hardlinks. Raw writes after a scan cannot alter published bytes. Paths are opened relative to a quarantine directory descriptor with `O_NOFOLLOW`; links and special files are rejected. A temporary output tree is renamed atomically after every file passes. Only videos and supported text subtitles are published; checked artwork/text metadata is discarded. Arr and Jellyfin cannot see raw files through their mounts.

## Checks and limits

- ClamAV 1.5 image fixed by digest in `gate.py`; persistent official signatures updated daily by a separate FreshClam container that sees no media. Signatures older than 48 hours stop publication.
- Parser image built from the pinned Python base in `Dockerfile`, with FFmpeg and `file`; its exact local content ID is fixed in private config. Update the image, run verification, then explicitly update that ID when patching.
- Scan containers have no network, read-only root/candidate, UID 1000, no capabilities, no-new-privileges, one CPU, bounded RAM/PIDs and a noexec temporary filesystem. They never receive API keys, credentials, host libraries or the Docker socket.
- File extensions and detected MIME/signatures must agree. Executables, scripts, archives, active text, unsupported extensions and embedded attachment/data streams are rejected. FFprobe requires a video stream and finite positive duration; FFmpeg decodes eight seconds with file-only protocols.
- Individual files above **1900 MiB (1.86 GiB)** are held, because this configuration does not claim complete antivirus coverage above ClamAV's supported limits. Many 4K releases will therefore remain held. There is no automatic override or chunk-scan shortcut.
- One torrent per cycle; at least 1.7 GiB available host memory before ClamAV, at most 1408 MiB scanner RAM with no scanner swap. Parser gets 512 MiB. OOM, timeout, stale signatures and tool errors keep files held. A held download is retried after ten minutes; a long scan can take up to 30 minutes.
- Rejected files remain outside the library and the torrent is stopped. For Arr-owned downloads, the matching queue item is marked failed/blocklisted with redownload requested; no raw files are deleted. Manual downloads stay quarantined. Without a working indexer, a replacement cannot be found.

## Indexers and authentication

Prowlarr applications require the `security-approved` tag. The registry in private `config.json` records each approved indexer's ID, name, provider/settings fingerprint and reason. The gate removes approval tags from unknown/changed sources each cycle. To approve a source **after owner approval**, run `approve_indexer.py ID --reason 'source, authorized use and owner approval'`. It records the decision, tags and syncs the source. Sources added without the approval tag cannot sync to Arr. An administrator manually changing tags/Arr configuration remains a trusted administrative action.

qBittorrent has a random password, localhost and subnet bypasses are off, and CSRF protection is on. Dashboard, Radarr, Sonarr and the controller have credentials. qBittorrent 5.3 uses HTTP 204 and `QBT_SID_<port>` cookies; the dashboard client was updated for both. Credentials are only in private host files; retrieve them from `/home/gold/server-platform/media-security/webui-credentials.txt` (0600). Prefer an SSH tunnel for WebUI use: the existing LAN listener uses HTTP.

Arr and qBittorrent drop all capabilities, adding back only CHOWN, DAC_OVERRIDE, FOWNER, SETUID, SETGID and KILL for LinuxServer initialization. They have no-new-privileges and bounded PIDs. LinuxServer initialization still runs as root; these are not rootless containers.

## Operations and evidence

- Private configuration, state and verification evidence: `/home/gold/server-platform/media-security/` (0700). No credentials belong in this repository.
- `media-security.timer` runs the host controller every minute after the previous invocation finishes. `media-signatures.timer` updates daily around 03:15 America/Chicago. Scan/update operations share a lock.
- Status: `/family/streaming/admin/security`, limited to streaming admins, backed by the atomic status file beside the Directus extension. The Streaming Admin tab shows counts, held/rejected reasons and indexer approval status. Status older than 45 minutes is shown as stale.
- Gate failures send deduplicated notifications through the existing dashboard bot/channel, with mentions disabled. Delivery failures are shown in the security panel.
- Unit checks: `python3 -m unittest discover -s tests -p test_media_security.py`. Streaming auth/status checks: `npm run test:streaming`.
- Real scanners: `verify_scanners.py` checks clean media, harmless EICAR, disguised executable, unavailable scanner, and container isolation. `verify_gate.py` registers trackerless private local fixture torrents through the real qBittorrent API, checks pass/reject/publication and post-scan mutation, then removes all fixture torrents/files. It deliberately triggers harmless test alerts. Run with timers stopped to avoid two controllers writing state during verification.
- Passed on installation: clean clip accepted; EICAR detected; disguised executable rejected; scanner failure held; path traversal, ancestor symlink, hardlink and FIFO bypasses rejected; original-file mutations did not alter the verified copy; anonymous qBittorrent API denied; both Arr download-client login tests passed. The live dashboard client authenticated with qBittorrent 5.3 and read the queue.
- The Arr blocklist/redownload API call has a unit check. Replacement-release acquisition has **not** been exercised with a real rejected release: there is still no suitable indexer. The gate's publication was tested end to end; a new full Radarr/Sonarr library import still needs a real authorized release.

## Recovery and residual risk

Backups are under `/home/gold/server-platform/backup-private/media-security-*`; `installed.json` identifies the applicable backup. They include old compose/config/resume data, preferences, Arr clients/mappings and the dashboard env. One private recovery copy of the legacy partial download is retained under `security-store/`.

To pause scanning safely: `systemctl --user stop media-security.timer` (then wait for any active scan or stop its disposable container). Raw downloads remain inaccessible to the importers. Fix a failed scanner or mapping while keeping that boundary. Do not point Arr at raw quarantine or restore the old broad writable qBittorrent media mount as a workaround. Restoring pre-install credentials requires changing all consumers together; restore resume data only with qBittorrent stopped and paths reviewed.

This reduces malware exposure; it is not a guarantee. ClamAV catches known threats and heuristics, not all malware. Valid media and subtitle files can exploit unknown player/parser vulnerabilities. Eight seconds of decoding is not full-file validation. A Docker sandbox shares the host kernel; it is weaker than an isolated VM. A host/Docker/administrator compromise can bypass the gate. Existing media has not been retroactively checked. Large files and unsupported sidecars may block legitimate releases. Keep the host, VPN, downloader, scanners, Arr, Jellyfin and playback clients patched.

References: [ClamAV scanning behavior and scan limits](https://docs.clamav.net/manual/Usage/Scanning.html), [ClamAV memory requirements](https://docs.clamav.net/manual/Installing/Docker.html), [Prowlarr application tags](https://wiki.servarr.com/prowlarr/settings).
