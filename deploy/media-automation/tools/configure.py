#!/usr/bin/env python3
"""Configure Radarr, Sonarr and Prowlarr for the family site. Safe to re-run: everything is looked up by name first.

Run on the server from this folder after `docker compose up -d` (needs arr.py beside it):
    python3 configure.py
Never touches existing media, existing torrents, or qBittorrent's VPN stack. The only qBittorrent
change is two categories plus "Automatic Torrent Management" for NEW torrents (existing torrents keep their paths).
"""
import json, os, secrets, urllib.parse, urllib.request
from pathlib import Path
from arr import call, key, ROOT

MEDIA = '/home/gold/Jellyfin Server/media'
QBIT = 'http://127.0.0.1:8080'              # published by gluetun; LAN/loopback is trusted by qBittorrent's own whitelist
JELLYFIN_HOST, JELLYFIN_PORT = '172.31.88.1', 8096   # the media network's gateway = this host
JELLYFIN_KEY = json.loads(Path('/home/gold/server-platform/public-apps/fam/extensions/.family-streaming.json').read_text())['api_key']

def by_name(items, name): return next((i for i in items if i.get('name') == name), None)
def fill(schema, **values):
    for f in schema['fields']:
        if f['name'] in values: f['value'] = values[f['name']]
    return schema
def qbit(path, data):
    urllib.request.urlopen(urllib.request.Request(QBIT + '/api/v2/' + path, data=urllib.parse.urlencode(data).encode()), timeout=20).read()

# ---- qBittorrent: categories with save paths; new torrents follow them (existing torrents untouched) ----
for cat in ('radarr', 'sonarr'):
    os.makedirs(f'{MEDIA}/Downloads/{cat}', exist_ok=True)
    try: qbit('torrents/createCategory', {'category': cat, 'savePath': f'{MEDIA}/Downloads/{cat}'})
    except urllib.error.HTTPError: qbit('torrents/editCategory', {'category': cat, 'savePath': f'{MEDIA}/Downloads/{cat}'})
qbit('app/setPreferences', {'json': json.dumps({'auto_tmm_enabled': True})})

# ---- Quality: allow 720p..2160p, no remuxes/disc images; 2160p wins at grab time, cutoff WEB 1080p so a 1080p file is never swapped for 4K ----
SIZES = {  # MB per minute of runtime: (preferred, max)
    'radarr': {'720': (15, 30), '1080': (25, 45), '2160': (70, 110)},
    'sonarr': {'720': (20, 45), '1080': (30, 70), '2160': (70, 130)},
}
ALLOWED = {
    'radarr': ['WEB 720p', 'Bluray-720p', 'WEB 1080p', 'Bluray-1080p', 'WEB 2160p', 'Bluray-2160p'],
    'sonarr': ['HDTV-720p', 'WEB 720p', 'Bluray-720p', 'HDTV-1080p', 'WEB 1080p', 'Bluray-1080p', 'WEB 2160p', 'Bluray-2160p'],
}
def item_name(i): return i.get('name') or i['quality']['name']
def mark(item, on):
    item['allowed'] = on
    for sub in item.get('items') or []: sub['allowed'] = on
for app in ('radarr', 'sonarr'):
    if not by_name(call(app, 'GET', '/qualityprofile'), 'Family 4K to 1080p'):
        profile = json.loads(json.dumps(by_name(call(app, 'GET', '/qualityprofile'), 'Any')))
        profile.pop('id', None); profile['name'] = 'Family 4K to 1080p'
        for i in profile['items']: mark(i, item_name(i) in ALLOWED[app])
        cutoff = next(i for i in profile['items'] if item_name(i) == 'WEB 1080p')
        profile['cutoff'] = cutoff['id'] if cutoff.get('items') else cutoff['quality']['id']
        profile['upgradeAllowed'] = True
        call(app, 'POST', '/qualityprofile', profile)
    definitions = call(app, 'GET', '/qualitydefinition')
    for d in definitions:
        res = next((r for r in ('720', '1080', '2160') if r in d['quality']['name']), None)
        if res:
            d['preferredSize'], d['maxSize'] = SIZES[app][res]
            d['minSize'] = min(d.get('minSize') or 0, {'720': 5, '1080': 10, '2160': 30}[res])  # small efficient encodes are welcome
    call(app, 'PUT', '/qualitydefinition/update', definitions)

# ---- Radarr / Sonarr: library folder, qBittorrent, Jellyfin refresh, Jellyfin-friendly names ----
SETUP = {'radarr': ('Movies', 'movieCategory', 'radarr', 'onMovieDelete', 'onMovieFileDelete'),
         'sonarr': ('Shows', 'tvCategory', 'sonarr', 'onSeriesDelete', 'onEpisodeFileDelete')}
for app, (folder, cat_field, cat, on_delete, on_file_delete) in SETUP.items():
    if not call(app, 'GET', '/rootfolder'): call(app, 'POST', '/rootfolder', {'path': f'{MEDIA}/{folder}'})
    if not by_name(call(app, 'GET', '/downloadclient'), 'qBittorrent'):
        schema = next(s for s in call(app, 'GET', '/downloadclient/schema') if s['implementation'] == 'QBittorrent')
        fill(schema, host='qbittorrent-vpn', port=8080, useSsl=False, username='', password='', **{cat_field: cat})
        schema.update(name='qBittorrent', enable=True); call(app, 'POST', '/downloadclient', schema)
    if not by_name(call(app, 'GET', '/notification'), 'Jellyfin'):
        schema = next(s for s in call(app, 'GET', '/notification/schema') if s['implementation'] == 'MediaBrowser')
        fill(schema, host=JELLYFIN_HOST, port=JELLYFIN_PORT, useSsl=False, apiKey=JELLYFIN_KEY, notify=False, updateLibrary=True,
             mapFrom=MEDIA, mapTo='/media')  # Jellyfin sees the same folder as /media
        schema.update(name='Jellyfin', onDownload=True, onUpgrade=True, onRename=True, **{on_delete: True, on_file_delete: True})
        call(app, 'POST', '/notification', schema)
    naming = call(app, 'GET', '/config/naming')
    if app == 'radarr':
        naming.update(renameMovies=True, movieFolderFormat='{Movie Title} ({Release Year}) [tmdbid-{TmdbId}]')
    else:
        naming.update(renameEpisodes=True, seriesFolderFormat='{Series TitleYear} [tvdbid-{TvdbId}]')
    call(app, 'PUT', '/config/naming', naming)

# ---- Prowlarr: push indexers to both apps; one public-domain source so the pipeline can be proven ----
apps = call('prowlarr', 'GET', '/applications')
for name, impl, url in (('Radarr', 'Radarr', 'http://radarr:7878'), ('Sonarr', 'Sonarr', 'http://sonarr:8989')):
    if not by_name(apps, name):
        schema = next(s for s in call('prowlarr', 'GET', '/applications/schema') if s['implementation'] == impl)
        fill(schema, prowlarrUrl='http://prowlarr:9696', baseUrl=url, apiKey=key(name.lower()))
        schema.update(name=name, syncLevel='fullSync'); call('prowlarr', 'POST', '/applications', schema)
if not by_name(call('prowlarr', 'GET', '/indexer'), 'Internet Archive'):
    schema = next(s for s in call('prowlarr', 'GET', '/indexer/schema') if s['name'] == 'Internet Archive')
    schema.update(enable=True, appProfileId=1); call('prowlarr', 'POST', '/indexer', schema)

# ---- Lock the web UIs (loopback only already); telemetry off. Passwords go to a 0600 file, never the repo ----
cred_file = ROOT / 'credentials.txt'
if not cred_file.exists():
    cred_file.write_text(''.join(f'{a}: admin / {secrets.token_urlsafe(16)}\n' for a in ('radarr', 'sonarr', 'prowlarr'))); cred_file.chmod(0o600)
passwords = {l.split(':')[0]: l.split(' / ')[1].strip() for l in cred_file.read_text().splitlines()}
for app in ('radarr', 'sonarr', 'prowlarr'):
    host = call(app, 'GET', '/config/host')
    if host['authenticationMethod'] != 'forms':
        host.update(authenticationMethod='forms', authenticationRequired='enabled', username='admin',
                    password=passwords[app], passwordConfirmation=passwords[app], analyticsEnabled=False)
        call(app, 'PUT', '/config/host', host)
print('configured')
