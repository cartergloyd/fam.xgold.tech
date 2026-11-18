#!/usr/bin/env python3
"""Exercise the real qBittorrent -> gate -> verified route with private local fixtures.

No trackers, no peers, no real movie requests; test torrents and output are removed.
The harmless EICAR test triggers the configured security alert.
"""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import time
import urllib.request
import uuid
from gate import ROOT, Qbit, cycle, atomic
from install import bencode

config = json.loads((ROOT/'config.json').read_text())
qbit = Qbit(config['qbit'])
raw = Path(config['raw'])/'manual'
prefix = 'family-gate-check-' + uuid.uuid4().hex[:8]
created = []
results = {}
try:
    for label, content in [('clean',None),
        ('eicar',b'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'),
        ('executable',b'MZ'+b'\0'*100)]:
        name = prefix+'-'+label+'.mp4'
        source = raw/name
        if content is not None: source.write_bytes(content)
        else:
            subprocess.run(['docker','run','--rm','--network','none','--read-only','--user','1000:1000',
                '--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','256m','--memory-swap','256m',
                '--cpus','1','--mount',f'type=bind,src={raw},dst=/out','--entrypoint','ffmpeg', config['inspector_image'],
                '-v','error','-f','lavfi','-i','color=c=black:s=160x90:r=10','-t','2','-c:v','libx264','/out/'+name],check=True,capture_output=True)
        content = source.read_bytes()
        piece_length = 16384
        info = {b'name':name.encode(),b'length':len(content),b'piece length':piece_length,b'private':1,
            b'pieces':b''.join(hashlib.sha1(content[i:i+piece_length]).digest() for i in range(0,len(content),piece_length))}
        key = hashlib.sha1(bencode(info)).hexdigest()
        created.append((key,name))
        torrent = bencode({b'info':info})
        boundary = 'gate'+uuid.uuid4().hex
        body = bytearray()
        for k,v in {'savepath':'/incoming/manual','stopped':'true','skip_checking':'true','autoTMM':'false'}.items():
            body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
        body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="torrents"; filename="test.torrent"\r\nContent-Type: application/x-bittorrent\r\n\r\n'.encode())
        body.extend(torrent);body.extend(f'\r\n--{boundary}--\r\n'.encode())
        req=urllib.request.Request(qbit.base+'/api/v2/torrents/add',data=bytes(body),headers={
            'Referer':qbit.base+'/', 'Content-Type':'multipart/form-data; boundary='+boundary})
        with qbit.opener.open(req,timeout=30) as r:
            reply=r.read().decode()
            if r.status not in {200, 204}: raise AssertionError('Fixture add failed')
        qbit.call('torrents/recheck', {'hashes':key}, raw=True)
        for _ in range(20):
            torrents = qbit.call('torrents/info?hashes='+key)
            if torrents and torrents[0]['progress']==1:break
            time.sleep(.5)
        else:raise AssertionError('Local fixture did not become complete: '+str(torrents)+'; add response '+reply)
        cycle(config)
        state=json.loads((ROOT/'state.json').read_text())['torrents'].get(key,{})
        expected='passed' if label=='clean' else 'rejected'
        assert state.get('status')==expected, state
        published = Path(config['verified'])/'manual'/name
        assert published.exists() == (label=='clean')
        if label=='clean':
            assert published.read_bytes()==content
            source.write_bytes(b'MZchanged after scan')
            assert published.read_bytes()==content
            results['post-scan-mutation']='verified bytes unchanged'
        results[label]={'status':state['status'],'reason':state['reason']}
finally:
    for key,name in created:
        qbit.call('torrents/delete',{'hashes':key,'deleteFiles':'false'},raw=True)
        (raw/name).unlink(missing_ok=True)
        (Path(config['verified'])/'manual'/name).unlink(missing_ok=True)
        shutil.rmtree(Path(config['sealed'])/key,ignore_errors=True)
    # Test results have a separate evidence file; the operational counts describe real downloads.
    if (ROOT/'state.json').exists():
        state=json.loads((ROOT/'state.json').read_text())
        keys={key for key,_ in created}
        state['torrents']={k:v for k,v in state['torrents'].items() if k not in keys}
        state['events']=[v for v in state['events'] if v['hash'] not in keys]
        atomic(ROOT/'state.json',state)
    cycle(config)
atomic(ROOT/'gate-verification.json',results)
print(json.dumps(results,indent=2))
