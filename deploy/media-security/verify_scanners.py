#!/usr/bin/env python3
"""Explicit integration check with harmless fixtures; does not register real torrents."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
from gate import ROOT, scan, isolated, Rejected, Held, CLAM

config = json.loads((ROOT / 'config.json').read_text())
results = {}
with tempfile.TemporaryDirectory(prefix='media-gate-check-', dir=ROOT) as base:
    base = Path(base)
    clean = base / 'clean'; clean.mkdir()
    r = subprocess.run(['docker','run','--rm','--network','none','--user','1000:1000','--cap-drop','ALL',
        '--security-opt','no-new-privileges:true','--memory','256m','--memory-swap','256m','--cpus','1',
        '--mount',f'type=bind,src={clean},dst=/out','--entrypoint','ffmpeg', config['inspector_image'],
        '-v','error','-f','lavfi','-i','color=c=black:s=160x90:r=10','-t','2','-c:v','libx264','/out/clean.mp4'],capture_output=True)
    if r.returncode: raise RuntimeError(r.stderr.decode()[-300:])
    for label, content in [
        ('eicar',b'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'),
        ('disguised-executable',b'MZ'+b'\x00'*100)]:
        p=base/label;p.mkdir();(p/'movie.mp4').write_bytes(content)
    for label in ['clean','eicar','disguised-executable']:
        try:
            selected = scan(base/label, config)
            if label!='clean': raise AssertionError(label+' was accepted')
            results[label]={'result':'passed', 'publishedFiles':selected}
        except Rejected as e:
            if label=='clean': raise
            results[label]={'result':'rejected','reason':str(e)}
    # Deliberately wrong image simulates a scanner that cannot start, with a fresh clean clip.
    try:
        scan(clean, {**config, 'inspector_image':'sha256:'+'0'*64})
        raise AssertionError('Unavailable scanner accepted media')
    except Held:
        results['unavailable-scanner']={'result':'held'}
    # Read-only root, no caps, no outbound interface; no credentials or Docker socket mounted.
    r=isolated(config['inspector_image'],[(clean,'/candidate')],'python3',['-c',
        'import os,socket; assert not os.path.exists("/var/run/docker.sock"); '
        'assert os.listdir("/sys/class/net")==["lo"]; '
        'assert "CapEff:\\t0000000000000000" in open("/proc/self/status").read(); '
        'assert os.getuid()==1000; print("isolated")'])
    if r.returncode:raise RuntimeError(r.stderr)
    results['container-isolation']={'result':'passed'}
(ROOT/'scanner-verification.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
