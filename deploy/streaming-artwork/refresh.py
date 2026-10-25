"""Publish a bounded, credential-free poster feed from recent Jellyfin additions."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.parse
import urllib.request


def candidates(items):
    seen = set()
    for item in items:
        episode = item.get('Type') == 'Episode'
        ident = item.get('SeriesId') if episode else item.get('Id')
        tag = item.get('SeriesPrimaryImageTag') if episode else item.get('ImageTags', {}).get('Primary')
        if not ident or not tag or not re.fullmatch(r'[a-f0-9-]{32,36}', ident) or ident in seen:
            continue
        seen.add(ident)
        yield ident, tag


def refresh(config_path, output):
    config = json.loads(Path(config_path).read_text())
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)

    def get(route):
        request = urllib.request.Request(config['url'].rstrip('/') + route,
                                        headers={'X-Emby-Token': config['api_key']})
        return urllib.request.urlopen(request, timeout=25)

    params = urllib.parse.urlencode(dict(Recursive='true', IncludeItemTypes='Movie,Series,Episode',
        SortBy='DateCreated', SortOrder='Descending', Limit=240, EnableUserData='false',
        Fields='DateCreated', EnableTotalRecordCount='false'))
    with get('/Items?' + params) as response:
        items = json.load(response)['Items']
    posters = []
    for ident, tag in candidates(items):
        name = hashlib.sha256((ident + ':' + tag).encode()).hexdigest()[:32] + '.jpg'
        dest = output / name
        if not dest.exists():
            try:
                query = urllib.parse.urlencode(dict(tag=tag, maxWidth=360, quality=80, format='jpg'))
                with get(f'/Items/{ident}/Images/Primary?{query}') as response:
                    image = response.read(2_000_001)
                    if not response.headers.get('Content-Type', '').startswith('image/') or len(image) > 2_000_000 or not image.startswith(b'\xff\xd8'):
                        continue
                temporary = dest.with_suffix('.tmp')
                temporary.write_bytes(image)
                os.replace(temporary, dest)
            except Exception:
                # A missing poster must not prevent the remaining artwork from updating.
                continue
        posters.append({'image': '/family/streaming-artwork/' + name})
        if len(posters) == 24:
            break
    if not posters:
        raise RuntimeError('No recent artwork available; keeping the previous feed')
    manifest = output / 'recent.json.tmp'
    manifest.write_text(json.dumps({'updated_at': int(time.time()), 'posters': posters}))
    os.replace(manifest, output / 'recent.json')
    # Retain old versions for a week, so open pages and cached feeds still work.
    keep = {Path(p['image']).name for p in posters}
    for image in output.glob('*.jpg'):
        if image.name not in keep and image.stat().st_mtime < time.time() - 7 * 86400:
            image.unlink()
    print(f'Published {len(posters)} recent posters')


if __name__ == '__main__':
    try:
        refresh(*sys.argv[1:])
    except Exception:
        # Never print URLs, tokens, or configuration in public logs.
        sys.exit('Artwork refresh failed; previous artwork retained')
