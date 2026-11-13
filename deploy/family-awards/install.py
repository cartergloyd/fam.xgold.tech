#!/usr/bin/env python3
"""Install the awards endpoint beside the family extension (same pattern as family-hub/install-backend.py).
Run after applying schema.sql, then restart homelab-directus-fam. Existing files are backed up first.
"""
from pathlib import Path
import datetime, shutil
source = Path(__file__).resolve().parent
roots = [Path('/home/gold/server-platform/public-apps/fam/extensions/directus-extension-family-directory'), Path('/home/gold/server-platform/homelab-dashboard-src/deploy/family-directory/directus-extension-family-directory')]
backup = Path('/home/gold/server-platform/backup-private') / ('family-awards-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
prepared = []
for root in roots:
    body = (root / 'index.js').read_text()
    if "import awardsHub from './awards.js';" not in body:
        anchor = ' streamingRequests(router, { database });'
        assert anchor in body, 'Streaming registration missing; review integration before installing.'
        body = "import awardsHub from './awards.js';\n" + body.replace(anchor, anchor + '\n awardsHub(router, { database });')
    prepared.append((root, body))
for index, (root, body) in enumerate(prepared):
    shutil.copytree(root, backup / str(index))
    shutil.copy2(source / 'endpoint.js', root / 'awards.js')
    (root / 'index.js').write_text(body)
print(f'Awards installed. Previous extension files: {backup}')
