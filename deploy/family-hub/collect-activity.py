#!/usr/bin/env python3
"""Record visible online-player minutes; optionally seed recent chunk-save locations.
No credentials, names, player UUIDs, or full movement trails go into family_mc_activity.
Separately, family_mc_last_seen keeps one row per account key (lowercase name, no UUID) with the spot
last seen online, so a member can see where they logged out. Only that member can read their own row.
"""
import datetime as dt
import json
import pathlib
import re
import struct
import subprocess
import sys
import urllib.request
from collections import Counter
BASE = pathlib.Path('/home/gold/Minecraft Server')
counts = Counter()
seen = {}
PSQL = ['docker', 'exec', '-i', 'gold-platform-postgres', 'sh', '-c', 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d fam']
def account_key(name):
    # Same rule as places.js: lowercase, no leading dot (Floodgate), no spaces or underscores.
    return re.sub(r'[\s_]', '', re.sub(r'^\.', '', str(name).lower()))
if '--seed-chunks' in sys.argv:
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=21)).timestamp()
    for world, directory in [('world', BASE/'world/dimensions/minecraft/overworld/region'), ('world_nether', BASE/'world/dimensions/minecraft/the_nether/region'), ('world_the_end', BASE/'world/dimensions/minecraft/the_end/region')]:
        for file in directory.glob('r.*.*.mca'):
            match = re.fullmatch(r'r\.(-?\d+)\.(-?\d+)\.mca', file.name)
            if not match:
                continue
            rx, rz = map(int, match.groups())
            with file.open('rb') as stream:
                stream.seek(4096)
                timestamps = struct.unpack('>1024I', stream.read(4096))
            for index, stamp in enumerate(timestamps):
                if cutoff <= stamp <= dt.datetime.now(dt.timezone.utc).timestamp():
                    day = dt.datetime.fromtimestamp(stamp, dt.timezone.utc).date().isoformat()
                    x = ((rx*32 + index%32)*16//256)*256+128
                    z = ((rz*32 + index//32)*16//256)*256+128
                    counts[(day,world,x,z,'chunks')] += 1
else:
    with urllib.request.urlopen('http://192.168.1.148:8123/up/world/world/0', timeout=10) as response:
        data = json.load(response)
    for p in data.get('players', []):
        if p.get('ishidden') or p.get('world') not in ('world','world_nether','world_the_end'):
            continue
        x, z = int(p['x']//256)*256+128, int(p['z']//256)*256+128
        counts[(dt.datetime.now(dt.timezone.utc).date().isoformat(),p['world'],x,z,'players')] += 1
        key = account_key(p.get('account', ''))
        if re.fullmatch(r'[a-z0-9]{1,32}', key):
            seen[key] = (p['world'], round(p['x']), round(p.get('y', 64)), round(p['z']))
sql = ['BEGIN;']
for (day,world,x,z,source), count in counts.items():
    update = 'EXCLUDED.samples' if source == 'chunks' else 'family_mc_activity.samples + EXCLUDED.samples'
    sql.append(f"INSERT INTO family_mc_activity(day,world,x,z,source,samples) VALUES('{day}','{world}',{x},{z},'{source}',{count}) ON CONFLICT(day,world,x,z,source) DO UPDATE SET samples={update};")
sql.extend(["DELETE FROM family_mc_activity WHERE day < current_date - 21;", 'COMMIT;'])
subprocess.run(PSQL, input='\n'.join(sql),text=True,check=True,stdout=subprocess.DEVNULL)
print(f'Activity collected: {len(counts)} areas.')
if seen:
    spots = ['BEGIN;']
    for key, (world, x, y, z) in seen.items():
        spots.append(f"INSERT INTO family_mc_last_seen(key,world,x,y,z,seen_at) VALUES('{key}','{world}',{x},{y},{z},now()) ON CONFLICT(key) DO UPDATE SET world=EXCLUDED.world,x=EXCLUDED.x,y=EXCLUDED.y,z=EXCLUDED.z,seen_at=EXCLUDED.seen_at;")
    spots.append('COMMIT;')
    # Its own call: the table arrives with places-schema.sql, and activity collection must not depend on it.
    result = subprocess.run(PSQL, input='\n'.join(spots),text=True,check=False,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    print(f'Last seen: {len(seen)} players' + ('.' if result.returncode == 0 else ' (table missing? apply places-schema.sql).'))
