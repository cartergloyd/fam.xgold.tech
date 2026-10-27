#!/usr/bin/env python3
"""Install the public trip endpoint beside the existing family endpoint.
Run after applying schema.sql. Existing files are backed up outside repositories.
Safe to re-run: the import and call are added once.
"""
from pathlib import Path
import datetime
import shutil
source = Path(__file__).resolve().parent
roots = [Path('/home/gold/server-platform/public-apps/fam/extensions/directus-extension-family-directory'), Path('/home/gold/server-platform/homelab-dashboard-src/deploy/family-directory/directus-extension-family-directory')]
backup = Path('/home/gold/server-platform/backup-private') / ('family-trips-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
prepared = []
for root in roots:
    body = (root/'index.js').read_text()
    if "import familyTrips from './family-trips.js';" not in body:
        body = "import familyTrips from './family-trips.js';\n" + body
        before = "export default { id: 'family', handler(router, { database }) {"
        assert before in body, 'Endpoint handler changed; review integration before installing.'
        body = body.replace(before, before + "\n familyTrips(router, { database });")
    prepared.append((root, body))
for index, (root, body) in enumerate(prepared):
    shutil.copytree(root, backup/str(index))
    shutil.copy2(source/'endpoint.js', root/'family-trips.js')
    (root/'index.js').write_text(body)
print(f'Trip endpoint installed. Previous extension files: {backup}')
