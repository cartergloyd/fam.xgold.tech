#!/usr/bin/env python3
"""One bounded, disposable Cloudflare-helper test. Never enables an indexer.

No ports, credentials, host folders or Docker socket are exposed to the helper.
Only a temporary Docker network is shared with Prowlarr for the test request.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.parse
from gate import ROOT, atomic, command

IMAGE='ghcr.io/flaresolverr/flaresolverr@sha256:c80ae007ce2ccdcd217a12426e4f039ef763ff90738c808d38810c3e59323767'
NAME='media-52bt-trial'
LABEL='media.security.owner=52bt-trial'
URL='https://b66htcsm.529075.xyz/search-2026-1-2-1.html?lang=en'

def trial():
    mem=int(re.search(r'MemAvailable:\s+(\d+)',Path('/proc/meminfo').read_text())[1])*1024
    if mem<1536*1024**2:raise RuntimeError('Deferred: insufficient memory headroom')
    network_created=False;connected=False
    result={'image':IMAGE,'success':False}
    try:
        if command(['docker','inspect',NAME]).returncode==0:raise RuntimeError('Trial container name is already in use')
        r=command(['docker','network','create',NAME]);assert r.returncode==0,r.stderr;network_created=True
        r=command(['docker','network','connect',NAME,'prowlarr']);assert r.returncode==0,r.stderr;connected=True
        r=command(['docker','run','-d','--name',NAME,'--label',LABEL,'--network',NAME,'--user','1000:1000',
            '--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','512m','--memory-swap','512m',
            '--cpus','0.5','--pids-limit','128','--tmpfs','/tmp:rw,nosuid,nodev,size=128m',
            '--log-opt','max-size=1m','--log-opt','max-file=2','-e','LOG_LEVEL=warning','-e','LOG_HTML=false',
            '-e','DISABLE_MEDIA=true','-e','TEST_URL=about:blank',IMAGE,
            '/usr/bin/timeout','--signal=TERM','--kill-after=5s','150s','/usr/local/bin/python','-u','/app/flaresolverr.py'])
        if r.returncode:raise RuntimeError(r.stderr[:600])
        for _ in range(20):
            r=command(['docker','exec','prowlarr','curl','-sS','--max-time','3','http://'+NAME+':8191/'],timeout=5)
            if r.returncode==0:break
            time.sleep(1)
        else:raise RuntimeError('Helper did not become ready')
        print('Helper ready; sending one request with a 45-second challenge limit',flush=True)
        payload=json.dumps({'cmd':'request.get','url':URL,'maxTimeout':45000})
        request=['docker','exec','prowlarr','curl','-sS','--max-time','55','-H','Content-Type: application/json',
            '--data',payload,'http://'+NAME+':8191/v1']
        # File output avoids blocking curl on a full stdout pipe while monitoring resources.
        with tempfile.TemporaryFile(mode='w+t') as out, tempfile.TemporaryFile(mode='w+t') as err:
            with subprocess.Popen(request,stdout=out,stderr=err,text=True) as proc:
                started=time.monotonic();pressure_samples=0
                while proc.poll() is None:
                    full=re.search(r'^full avg10=([\d.]+)',Path('/proc/pressure/memory').read_text(),re.M)
                    pressure_samples=pressure_samples+1 if full and float(full[1])>5 else 0
                    if pressure_samples>=3 or time.monotonic()-started>60 or os.fstat(out.fileno()).st_size>2*1024**2:
                        command(['docker','stop','-t','2',NAME],timeout=10)
                        proc.kill();proc.wait()
                        raise RuntimeError('Trial stopped: resource budget or response-size limit exceeded')
                    time.sleep(1)
                out.seek(0);err.seek(0)
                stdout=out.read(2*1024**2+1);stderr=err.read(2000)
                if len(stdout)>2*1024**2:raise RuntimeError('Helper response exceeds size limit')
                r=subprocess.CompletedProcess(request,proc.returncode,stdout,stderr)
        if r.returncode:raise RuntimeError('Helper request failed: '+r.stderr[:200])
        data=json.loads(r.stdout);solution=data.get('solution',{});html=solution.get('response','')
        result.update(status=data.get('status'),message=data.get('message'),httpStatus=solution.get('status'),
            finalUrl=solution.get('url'),htmlBytes=len(html),releaseRows=('resource-card' in html))
        result['success']=data.get('status')=='ok' and solution.get('status')==200 and 'resource-card' in html and urllib.parse.urlparse(solution.get('url','')).hostname==urllib.parse.urlparse(URL).hostname
    except Exception as e:result['error']=str(e)[:600]
    finally:
        inspect=command(['docker','inspect',NAME])
        if inspect.returncode==0:
            item=json.loads(inspect.stdout)[0]
            if item['Config'].get('Labels',{}).get('media.security.owner')=='52bt-trial':
                state=item['State'];result.update(oomKilled=state.get('OOMKilled'),exitCode=state.get('ExitCode'))
                log=command(['docker','logs','--tail','12',NAME]);result['helperLog']=log.stdout[-1800:]+log.stderr[-300:]
                command(['docker','rm','-f',NAME])
        if connected:command(['docker','network','disconnect',NAME,'prowlarr'])
        if network_created:command(['docker','network','rm',NAME])
        atomic(ROOT/'52bt-helper-trial.json',result)
    return result

if __name__=='__main__':print(json.dumps(trial(),indent=2))
