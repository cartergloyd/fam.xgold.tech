"""Tiny Radarr/Sonarr/Prowlarr API helper. Reads keys from the containers' config.xml; never prints them."""
import json, re, urllib.request, urllib.error
from pathlib import Path
ROOT = Path('/home/gold/server-platform/media-automation')
APPS = {'radarr': ('http://127.0.0.1:7878/api/v3', 'config/radarr'), 'sonarr': ('http://127.0.0.1:8989/api/v3', 'config/sonarr'), 'prowlarr': ('http://127.0.0.1:9696/api/v1', 'config/prowlarr')}
def key(app): return re.search(r'<ApiKey>([^<]+)', (ROOT / APPS[app][1] / 'config.xml').read_text()).group(1)
def call(app, method, path, body=None):
    req = urllib.request.Request(APPS[app][0] + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={'X-Api-Key': key(app), 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: raw = r.read(); return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e: raise SystemExit(f'{app} {method} {path} -> {e.code}: {e.read().decode()[:600]}')
