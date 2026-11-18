#!/usr/bin/env python3
"""Freshclam gets networking but no media, config, credentials or Docker socket."""
import json
import fcntl
import time
from gate import ROOT, CLAM, atomic, command

if __name__ == '__main__':
    lock = (ROOT / 'gate.lock').open('a')
    try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print('A media scan is running; signature update deferred')
        raise SystemExit(0)
    r = command(['docker', 'run', '--rm', '--name', 'media-signature-update', '--user', '1000:1000',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--read-only',
        '--pids-limit', '64', '--memory', '768m', '--memory-swap', '768m', '--cpus', '1',
        '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m',
        '--mount', f'type=bind,src={ROOT / "clamdb"},dst=/var/lib/clamav',
        '--mount', f'type=bind,src={ROOT / "freshclam.conf"},dst=/etc/clamav/freshclam.conf,readonly',
        '--entrypoint', 'freshclam', CLAM, '--stdout'], timeout=900)
    if r.returncode:
        print('Signature update failed; database freshness was not advanced')
        raise SystemExit(1)
    atomic(ROOT / 'database.json', {'updatedAt':time.time()})
    print('ClamAV signatures updated')
