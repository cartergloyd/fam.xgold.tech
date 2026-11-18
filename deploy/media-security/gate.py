#!/usr/bin/env python3
"""Host controller. Never parses media on the host; no Docker socket in scan containers.

An inaccessible raw path is the primary gate. Only a private, fully scanned snapshot
is linked into the path Arr sees. Errors never publish. State is durable and atomic.
"""
import argparse
import datetime
import fcntl
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import time
import urllib.parse
import urllib.request
import uuid

ROOT = Path('/home/gold/server-platform/media-security')
CLAM = 'clamav/clamav@sha256:7054e3f34308c384ea43cd786ea17abf899bd44af40af9f1b099853d7a5c214e'
MAX_FILE = 1900 * 1024 * 1024  # Stay below libclamav's 2 GiB limit. Oversize is HELD, never silently skipped.

class Rejected(Exception):
    pass

class Held(Exception):
    pass

def atomic(path, obj, mode=0o600):
    path = Path(path)
    temp = path.with_name(path.name + '.tmp')
    temp.write_text(json.dumps(obj, indent=2) + '\n')
    temp.chmod(mode)
    os.replace(temp, path)

def command(args, timeout=60):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)

def isolated(image, mounts, entrypoint, args, memory='512m', timeout=180):
    name = 'media-scan-' + uuid.uuid4().hex[:12]
    argv = ['docker', 'run', '--rm', '--name', name, '--network', 'none', '--read-only',
            '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
            '--pids-limit', '64', '--cpus', '1', '--memory', memory, '--memory-swap', memory,
            '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=128m', '--log-driver', 'none']
    for source, target in mounts:
        argv += ['--mount', f'type=bind,src={source},dst={target},readonly']
    argv += ['--entrypoint', entrypoint, image, *args]
    try:
        return command(argv, timeout)
    except subprocess.TimeoutExpired as e:
        raise Held('Scanner timed out; nothing released') from e
    finally:
        command(['docker', 'rm', '-f', name], 20)

class Qbit:
    def __init__(self, config):
        self.base = config['url']
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        response = self.call('auth/login', {k: config[k] for k in ['username', 'password']}, raw=True).strip()
        # qBittorrent 5.3 uses HTTP 204 + SID; older versions return "Ok.".
        if response not in {'Ok.', ''}:
            raise Held('qBittorrent login failed')
        self.call('app/version', raw=True)  # An empty error reply is never sufficient to authenticate.

    def call(self, path, data=None, raw=False):
        req = urllib.request.Request(self.base + '/api/v2/' + path,
            data=None if data is None else urllib.parse.urlencode(data).encode(), headers={'Referer': self.base + '/'})
        with self.opener.open(req, timeout=30) as r:
            body = r.read().decode()
        return body if raw or not body else json.loads(body)

def arr(app, method, path, body=None):
    key = re.search(r'<ApiKey>([^<]+)', (ROOT.parent / 'media-automation/config' / app / 'config.xml').read_text())[1]
    port = {'radarr':7878, 'sonarr':8989, 'prowlarr':9696}[app]
    req = urllib.request.Request(f'http://127.0.0.1:{port}/api/v' + ('1' if app == 'prowlarr' else '3') + path,
        method=method, data=None if body is None else json.dumps(body).encode(),
        headers={'X-Api-Key':key, 'Content-Type':'application/json'})
    with urllib.request.urlopen(req, timeout=45) as r:
        data = r.read()
    return json.loads(data) if data else None

def safe_relative(value):
    p = PurePosixPath(value)
    if p.is_absolute() or not p.parts or '..' in p.parts or any(any(ord(c) < 32 or ord(c) == 127 for c in part) for part in p.parts):
        raise Rejected('Unsafe download path')
    return p

def open_raw(base, relative):
    """Resolve every component under the raw mount without following symlinks."""
    parts = safe_relative(str(relative)).parts
    fd = os.open(base, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for i, part in enumerate(parts):
            flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
            if i < len(parts) - 1: flags |= os.O_DIRECTORY
            nxt = os.open(part, flags, dir_fd=fd)
            os.close(fd)
            fd = nxt
        return fd
    except Exception:
        os.close(fd)
        raise

def copy_regular(fd, target):
    st = os.fstat(fd)
    if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
        raise Rejected('Special or hardlinked raw file')
    if st.st_size > MAX_FILE:
        raise Held('Scan size limit exceeded; operator review required')
    if st.st_size == 0: raise Rejected('Empty download')
    with os.fdopen(os.dup(fd), 'rb') as inp, target.open('xb') as out:
        remaining = st.st_size
        while remaining:
            chunk = inp.read(min(4*1024*1024, remaining))
            if not chunk: raise Rejected('Download changed during snapshot')
            out.write(chunk)
            remaining -= len(chunk)
        if inp.read(1) or os.fstat(fd).st_mtime_ns != st.st_mtime_ns:
            raise Rejected('Download changed during snapshot')
    target.chmod(0o400)

def snapshot(source, destination, max_total=100 * 1024**3):
    """Walk with dirfds/O_NOFOLLOW: symlink swaps cannot escape raw storage.

    A copy, never a raw hardlink. A concurrent writer may alter raw bytes, but the
    scanner sees only the completed private copy and qBittorrent cannot access it.
    """
    count = 0
    total = 0
    destination.mkdir(mode=0o700)
    def walk(srcfd, dest):
        nonlocal count, total
        for name in sorted(os.listdir(srcfd)):
            safe_relative(name)
            st = os.stat(name, dir_fd=srcfd, follow_symlinks=False)
            if stat.S_ISDIR(st.st_mode):
                fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=srcfd)
                try:
                    child = dest / name
                    child.mkdir(mode=0o700)
                    walk(fd, child)
                finally:
                    os.close(fd)
            elif stat.S_ISREG(st.st_mode):
                count += 1
                total += st.st_size
                if count > 5000 or total > max_total or st.st_size > MAX_FILE:
                    raise Held('Scan size limit exceeded; operator review required')
                if st.st_size == 0:
                    raise Rejected('Empty file')
                if st.st_nlink != 1:
                    raise Rejected('Hardlinked raw file')
                fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=srcfd)
                with os.fdopen(fd, 'rb') as inp, (dest / name).open('xb') as out:
                    current = os.fstat(inp.fileno())
                    if not stat.S_ISREG(current.st_mode) or current.st_ino != st.st_ino or current.st_nlink != 1:
                        raise Rejected('Download changed during snapshot')
                    remaining = st.st_size
                    while remaining:
                        chunk = inp.read(min(4 * 1024 * 1024, remaining))
                        if not chunk:
                            raise Rejected('Download changed during snapshot')
                        out.write(chunk)
                        remaining -= len(chunk)
                    if inp.read(1) or os.fstat(inp.fileno()).st_mtime_ns != st.st_mtime_ns:
                        raise Rejected('Download changed during snapshot')
                (dest / name).chmod(0o400)
            else:
                raise Rejected('Symlink or special file in download')
    rootfd = os.dup(source) if isinstance(source, int) else os.open(source, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        walk(rootfd, destination)
    finally:
        os.close(rootfd)
    if not count:
        raise Rejected('Empty download')

def scan(candidate, config):
    updated = json.loads((ROOT / 'database.json').read_text())['updatedAt']
    if time.time() - updated > 48 * 3600:
        raise Held('ClamAV signatures are older than 48 hours')
    mem = int(re.search(r'MemAvailable:\s+(\d+)', Path('/proc/meminfo').read_text())[1]) * 1024
    if mem < 1700 * 1024**2:
        raise Held('Waiting for 1.7 GiB available memory for antivirus')
    r = isolated(CLAM, [(candidate, '/candidate'), (ROOT / 'clamdb', '/var/lib/clamav')], 'clamscan',
        ['--recursive', '--stdout', '--infected', '--max-filesize=1900M', '--max-scansize=2000M',
         '--alert-exceeds-max=yes', '--alert-encrypted=yes', '--alert-broken=yes',
         '--follow-dir-symlinks=0', '--follow-file-symlinks=0', '/candidate'], memory='1408m', timeout=1800)
    if r.returncode == 1:
        raise Rejected('ClamAV detection: ' + next((s.rsplit(': ', 1)[-1] for s in r.stdout.splitlines() if ' FOUND' in s), 'malware or scan limit'))
    if r.returncode or 'ERROR' in r.stdout + r.stderr or 'WARNING' in r.stdout + r.stderr:
        raise Held('ClamAV failed or could not finish; nothing released')
    r = isolated(config['inspector_image'], [(candidate, '/candidate')], 'python3', ['/inspect_media.py'], timeout=900)
    if r.returncode == 1:
        raise Rejected('File checks failed: ' + r.stderr.strip()[-200:])
    if r.returncode:
        raise Held('Playability checker failed; nothing released')
    return json.loads(r.stdout)['publish']

def publish(candidate, files, target):
    """Build a hidden tree then one atomic rename; Arr never sees partial output."""
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() or target.is_symlink():
        raise Held('Verified destination already exists; no overwrite')
    temp = target.parent / ('.gate-' + uuid.uuid4().hex)
    temp.mkdir(mode=0o700)
    try:
        for name in files:
            rel = safe_relative(name)
            src = candidate.joinpath(*rel.parts)
            dst = temp.joinpath(*rel.parts)
            dst.parent.mkdir(parents=True, exist_ok=True)
            os.link(src, dst, follow_symlinks=False)
            dst.chmod(0o444)
        for d in temp.rglob('*'):
            if d.is_dir(): d.chmod(0o755)
        temp.chmod(0o755)
        os.rename(temp, target)
    finally:
        if temp.exists(): shutil.rmtree(temp)

def indexer_policy(config):
    tags = arr('prowlarr', 'GET', '/tag')
    tag = next(t['id'] for t in tags if t['label'] == 'security-approved')
    approved = {int(x['id']):x for x in config['indexers']}
    out = []
    for app in arr('prowlarr', 'GET', '/applications'):
        if app['tags'] != [tag]:
            app['tags'] = [tag]
            arr('prowlarr', 'PUT', '/applications/' + str(app['id']), app)
    for idx in arr('prowlarr', 'GET', '/indexer'):
        decision = approved.get(idx['id'])
        identity = hashlib.sha256(json.dumps([idx['implementation'], idx.get('fields', [])], sort_keys=True).encode()).hexdigest()
        ok = bool(decision and idx['name'] == decision['name'] and identity == decision['fingerprint'])
        wanted = [tag] if ok else []
        if (tag in idx['tags']) != ok:
            idx['tags'] = list((set(idx['tags']) - {tag}) | set(wanted))
            arr('prowlarr', 'PUT', '/indexer/' + str(idx['id']), idx)
        out.append({'id':idx['id'], 'name':idx['name'], 'approved':ok, 'reason':decision.get('reason') if ok else 'Awaiting documented approval'})
    return out

def enforce(config, qbit):
    """Refuse release if a configuration change reopens a path into quarantine."""
    raw = str(Path(config['raw']).resolve())
    containers = json.loads(command(['docker', 'inspect', 'qbittorrent', 'radarr', 'sonarr', 'jellyfin']).stdout)
    for c in containers:
        name = c['Name'].lstrip('/')
        for m in c['Mounts']:
            source = str(Path(m['Source']).resolve())
            if name != 'qbittorrent' and (raw == source or raw.startswith(source + '/') or source.startswith(raw + '/')):
                raise Held(name + ' has access to raw quarantine')
            if name == 'qbittorrent' and m['RW'] and source not in {raw, config['qbit_config']}:
                raise Held('qBittorrent has an unexpected writable mount')
    p = qbit.call('app/preferences')
    if p.get('bypass_local_auth') or p.get('bypass_auth_subnet_whitelist_enabled'):
        raise Held('qBittorrent authentication bypass is enabled')

def retry_rejected(t, qbit):
    # Arr owns the release history and its blocklist. Do not delete raw data.
    app = t.get('category')
    if app not in {'radarr', 'sonarr'}:
        return 'Manual download remains quarantined'
    rows = arr(app, 'GET', '/queue?page=1&pageSize=1000&includeUnknownMovieItems=true&includeUnknownSeriesItems=true')['records']
    rows = [r for r in rows if (r.get('downloadId') or '').lower() == t['hash'].lower()]
    if not rows:
        raise Held('Waiting for Arr queue entry to blocklist rejected release')
    for row in rows:
        arr(app, 'DELETE', f"/queue/{row['id']}?removeFromClient=false&blocklist=true&skipRedownload=false")
    return 'Release blocklisted; Arr requested a replacement'

def notify(message):
    # Same bot and owner channel as the existing dashboard; disable mentions.
    def env(path):
        return dict((k, v.strip().strip('\"').strip("'")) for l in Path(path).read_text().splitlines()
                    if l and not l.startswith('#') and '=' in l for k,v in [l.split('=',1)])
    settings = env('/home/gold/server-platform/homelab-dashboard.env')
    token = env(settings.get('OWNER_DISCORD_TOKEN_FILE') or settings['DISCORD_SUPPORT_TOKEN_FILE'])['DISCORD_BOT_TOKEN']
    req = urllib.request.Request('https://discord.com/api/v10/channels/' + settings['OWNER_DISCORD_CHANNEL_ID'] + '/messages',
        data=json.dumps({'content':message[:1800], 'allowed_mentions':{'parse':[]}}).encode(),
        headers={'Authorization':'Bot ' + token, 'Content-Type':'application/json', 'User-Agent':'FamilyMediaGate/1.0'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status

def cycle(config):
    statefile = ROOT / 'state.json'
    state = json.loads(statefile.read_text()) if statefile.exists() else {'torrents':{}, 'events':[]}
    issue = None
    indexers = []
    def event(key, status, reason):
        old = state['torrents'].get(key, {})
        state['torrents'][key] = {'status':status, 'reason':reason, 'at':time.time()}
        if old.get('status') != status or old.get('reason') != reason:
            state['events'].insert(0, {'hash':key, 'status':status, 'reason':reason, 'at':time.time()})
            state['events'] = state['events'][:40]
            atomic(statefile, state)
            if status in {'rejected', 'held'}:
                try: notify(f'Media security: {status}. {reason}\nhttps://fam.xgold.tech/streaming/')
                except Exception: state['alertError'] = 'Discord delivery failed'
    try:
        qbit = Qbit(config['qbit'])
        enforce(config, qbit)
        indexers = indexer_policy(config)
        for t in qbit.call('torrents/info'):
            key = t['hash'].lower()
            if not re.fullmatch(r'[a-f0-9]{40,64}', key): raise Held('Invalid torrent hash')
            previous = state['torrents'].get(key, {})
            if not str(t.get('save_path', '')).startswith('/incoming'):
                continue  # Existing seeded library is mounted read-only and outside this gate's scope.
            if previous.get('status') == 'passed': continue
            if previous.get('status') == 'held' and time.time() - previous['at'] < 600: continue
            if previous.get('status') == 'rejected':
                qbit.call('torrents/stop', {'hashes':key}, raw=True)
                try:
                    if not previous.get('retryDone'):
                        retry_rejected(t, qbit)
                        state['torrents'][key]['retryDone'] = True
                except Exception: pass
                continue
            if t['progress'] < 1 or t['state'] in {'moving', 'checkingUP', 'checkingDL', 'checkingResumeData'}:
                continue
            candidate = Path(config['sealed']) / key
            try:
                save = PurePosixPath(t['save_path'])
                if save != PurePosixPath('/incoming') and PurePosixPath('/incoming') not in save.parents:
                    raise Rejected('Torrent path escaped quarantine')
                files = qbit.call('torrents/files?hash=' + key)
                names = [safe_relative(f['name']) for f in files]
                if not names or any(f.get('progress',0) < 1 for f in files): raise Held('Torrent files are incomplete')
                # Snapshot all files in the release root, including unwanted extras.
                roots = {n.parts[0] for n in names}
                if len(roots) != 1: raise Rejected('Torrent must have one file or one release folder')
                top = next(iter(roots))
                relsave = save.relative_to('/incoming')
                qbit.call('torrents/stop', {'hashes':key}, raw=True)
                if candidate.exists(): shutil.rmtree(candidate)
                fd = open_raw(config['raw'], relsave / top)
                try:
                    directory = stat.S_ISDIR(os.fstat(fd).st_mode)
                    if directory: snapshot(fd, candidate)
                    else:
                        candidate.mkdir(mode=0o700)
                        copy_regular(fd, candidate / top)
                finally:
                    os.close(fd)
                selected = scan(candidate, config)
                target = Path(config['verified']).joinpath(*relsave.parts, top)
                if directory: publish(candidate, selected, target)
                else:
                    # Atomic single-file publication without nesting its name twice.
                    target.parent.mkdir(parents=True, exist_ok=True)
                    os.link(candidate / top, target)
                    target.chmod(0o444)
                event(key, 'passed', 'Antivirus, file signatures and playability passed')
                qbit.call('torrents/start', {'hashes':key}, raw=True)
            except Rejected as e:
                qbit.call('torrents/stop', {'hashes':key}, raw=True)
                event(key, 'rejected', str(e))
                try:
                    retry_rejected(t, qbit)
                    state['torrents'][key]['retryDone'] = True
                except Exception as e: state['torrents'][key]['retry'] = 'Pending Arr blocklist confirmation'
            except (Held, OSError, ValueError) as e:
                event(key, 'held', str(e)[:250])
            atomic(statefile, state)
            break  # One candidate per minute; no persistent antivirus RAM use.
    except Exception as e:
        issue = str(e)[:250]
    if issue and state.get('lastIssue') != issue:
        try: notify('Media security gate needs attention: ' + issue)
        except Exception: state['alertError'] = 'Discord delivery failed'
    state['lastIssue'] = issue
    summary = {'updatedAt':time.time(), 'ok':issue is None, 'issue':issue, 'indexers':indexers,
               'counts':{s:sum(t['status']==s for t in state['torrents'].values()) for s in ['passed','rejected','held']},
               'events':state['events'][:12], 'alertError':state.get('alertError'), 'maxFileGiB':round(MAX_FILE / 1024**3, 2)}
    atomic(statefile, state)
    atomic(config['status_file'], summary, 0o644)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', default=str(ROOT / 'config.json'))
    args = parser.parse_args()
    with (ROOT / 'gate.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            config = json.loads(Path(args.config).read_text())
            status_path = Path(config['status_file'])
            if status_path.exists():
                status = json.loads(status_path.read_text())
                status.update(updatedAt=time.time(), ok=False,
                    issue='The scanner is busy with another scan or signature update; new downloads remain quarantined.')
                atomic(status_path, status, 0o644)
            print('Another scan or signature update is running; downloads remain quarantined')
            raise SystemExit(0)
        cycle(json.loads(Path(args.config).read_text()))
