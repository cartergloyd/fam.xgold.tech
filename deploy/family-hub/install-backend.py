#!/usr/bin/env python3
"""Install the family hub alongside the existing endpoint; preserve other features.
Run after applying schema.sql. Existing files are backed up outside repositories.
"""
from pathlib import Path
import datetime
import shutil
import json
source = Path(__file__).resolve().parent
roots = [Path('/home/gold/server-platform/public-apps/fam/extensions/directus-extension-family-directory'), Path('/home/gold/server-platform/homelab-dashboard-src/deploy/family-directory/directus-extension-family-directory')]
backup = Path('/home/gold/server-platform/backup-private') / ('family-hub-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
prepared = []
for root in roots:
    body = (root/'index.js').read_text()
    if "import familyHub from './family-hub.js';" not in body:
        body = "import familyHub from './family-hub.js';\nimport minecraftHub from './hub-minecraft.js';\nimport { issueSession } from './hub-session.js';\n" + body
        before = "export default { id: 'family', handler(router, { database }) {"
        assert before in body, 'Endpoint handler changed; review integration before installing.'
        body = body.replace(before, before+"\n familyHub(router, { database });\n minecraftHub(router, { database });")
        before = 'res.json({user:{id:row.id,name:row.name,email:row.email}});'
        assert before in body, 'Login handler changed; review integration.'
        body = body.replace(before, 'res.json({user:{id:row.id,name:row.name,email:row.email},session:issueSession(row,process.env.SECRET)});')
        before = 'res.status(201).json({user:row});'
        assert before in body, 'Registration handler changed; review integration.'
        body = body.replace(before, "const authenticated=await database('family_users').where({id:row.id}).first();\n   res.status(201).json({user:row,session:issueSession(authenticated,process.env.SECRET)});")
    if "import whitelistHub from './hub-whitelist.js';" not in body:
        body="import whitelistHub from './hub-whitelist.js';\n"+body
        body=body.replace("familyHub(router, { database });","familyHub(router, { database });\n whitelistHub(router, { database });")
    if "import placesHub from './hub-places.js';" not in body:
        body="import placesHub from './hub-places.js';\n"+body
        assert "whitelistHub(router, { database });" in body, 'Whitelist registration missing; review integration.'
        body=body.replace("whitelistHub(router, { database });","whitelistHub(router, { database });\n placesHub(router, { database });")
    if "import lakeHub from './hub-lake.js';" not in body:
        body="import lakeHub from './hub-lake.js';\n"+body
        assert "placesHub(router, { database });" in body, 'Places registration missing; review integration.'
        body=body.replace("placesHub(router, { database });","placesHub(router, { database });\n lakeHub(router, { database });")
    # calendar.js and lake-sync.js keep their own names because hub-lake.js and hub-notify.js import them by those names.
    if "import calendarHub from './calendar.js';" not in body:
        body="import calendarHub from './calendar.js';\n"+body
        assert "lakeHub(router, { database });" in body, 'Lake registration missing; review integration.'
        body=body.replace("lakeHub(router, { database });","lakeHub(router, { database });\n calendarHub(router, { database });")
    if "const notify = notifier(" not in body:
        # Email needs Directus's own services, so the handler asks for them; mail stays off until EMAIL_TRANSPORT is configured.
        body="import { notifier, startReminders } from './hub-notify.js';\n"+body
        before="export default { id: 'family', handler(router, { database }) {"
        assert before in body, 'Endpoint handler changed; review integration before installing.'
        body=body.replace(before,"export default { id: 'family', handler(router, { database, services, getSchema, env, logger }) {\n const notify = notifier({ database, services, getSchema, env, logger });\n startReminders(notify, logger);")
        assert " familyHub(router, { database });" in body, 'Family hub registration missing; review integration.'
        body=body.replace(" familyHub(router, { database });"," familyHub(router, { database }, { notify });")
    prepared.append((root,body))
for index,(root,body) in enumerate(prepared):
    dest=backup/str(index)
    shutil.copytree(root,dest)
    for name,target in [('endpoint.js','family-hub.js'),('hub-session.js','hub-session.js'),('minecraft.js','hub-minecraft.js'),('whitelist.js','hub-whitelist.js'),('places.js','hub-places.js'),('lake.js','hub-lake.js'),('calendar.js','calendar.js'),('lake-sync.js','lake-sync.js'),('notify.js','hub-notify.js'),('map-bubbles.js','hub-map-bubbles.js'),('map-bubbles.css','hub-map-bubbles.css')]:
        shutil.copy2(source/name,root/target)
    (root/'index.js').write_text(body)
compose=Path('/home/gold/server-platform/public-apps/compose.yml')
config=json.loads(compose.read_text())
shutil.copy2(compose,backup/'compose.json')
config['services']['directus-fam']['environment']['CORS_ALLOWED_HEADERS']='Content-Type,Authorization,X-Family-Session'
compose.write_text(json.dumps(config,indent=2)+'\n')
print(f'Backend installed. Previous extension files: {backup}')
