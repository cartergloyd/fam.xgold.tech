#!/usr/bin/env python3
"""Install the streaming hub beside the family extension (same pattern as family-awards/install.py).
Run on the server, in this order: apply schema.sql, python3 install.py, then `docker restart homelab-directus-fam`.
Also writes extensions/.family-media.json (mode 0600) with the Radarr/Sonarr/Prowlarr addresses and keys read from their config.xml.
"""
from pathlib import Path
import datetime, json, re, shutil
source = Path(__file__).resolve().parent
roots = [Path('/home/gold/server-platform/public-apps/fam/extensions/directus-extension-family-directory'), Path('/home/gold/server-platform/homelab-dashboard-src/deploy/family-directory/directus-extension-family-directory')]
backup = Path('/home/gold/server-platform/backup-private') / ('streaming-hub-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
prepared = []
for root in roots:
    body = (root / 'index.js').read_text()
    if "import streamingHub from './streaming-hub.js';" not in body:
        anchor = ' streamingRequests(router, { database });'
        assert anchor in body, 'Streaming registration missing; review integration before installing.'
        # The anonymous request form is retired (its replacement needs a family sign-in); its table and rows are kept.
        body = "import streamingHub from './streaming-hub.js';\n" + body.replace(anchor, ' // streamingRequests retired: the Streaming hub replaced the anonymous request form\n streamingHub(router, { database }, { logger });')
    prepared.append((root, body))
for index, (root, body) in enumerate(prepared):
    shutil.copytree(root, backup / str(index))
    shutil.copy2(source / 'endpoint.js', root / 'streaming-hub.js')
    (root / 'index.js').write_text(body)
media = Path('/home/gold/server-platform/media-automation')
config = {}
for name, port in (('radarr', 7878), ('sonarr', 8989), ('prowlarr', 9696)):
    key = re.search(r'<ApiKey>([^<]+)', (media / 'config' / name / 'config.xml').read_text()).group(1)
    config[name] = {'url': f'http://{name}:{port}/api/v' + ('1' if name == 'prowlarr' else '3'), 'api_key': key}
target = roots[0].parent / '.family-media.json'
target.write_text(json.dumps(config, indent=1)); target.chmod(0o600)
print(f'Streaming hub installed. Previous extension files: {backup}')
