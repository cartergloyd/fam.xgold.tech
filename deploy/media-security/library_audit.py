#!/usr/bin/env python3
"""Audit existing library read-only. No deletion, quarantine, playback or import changes.

Whole-file AV results and supplementary chunk checks are strictly separated. The
large-file results never become a clean verdict and never release a gated download.
"""
import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import time
import uuid
from gate import ROOT, CLAM, MAX_FILE, atomic, open_raw

LIBRARY=Path('/home/gold/Jellyfin Server/media')
SOURCE=Path(__file__).resolve().parent
CHUNK=1024**3
OVERLAP=1024**2

def fingerprint(p):
    s=p.stat(follow_symlinks=False)
    return [s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns]

def docker(image,mounts,entrypoint,args,memory):
    name='library-audit-'+uuid.uuid4().hex[:12]
    cmd=['docker','run','--rm','--name',name,'--network','none','--read-only','--user','1000:1000',
        '--cap-drop','ALL','--security-opt','no-new-privileges:true','--pids-limit','64','--cpus','1',
        '--memory',memory,'--memory-swap',memory,'--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=128m',
        '--log-driver','none']
    for source,target,writable in mounts:
        cmd+=['--mount',f'type=bind,src={source},dst={target}'+('' if writable else ',readonly')]
    return name,cmd+['--entrypoint',entrypoint,image,*args]

def main():
    config=json.loads((ROOT/'config.json').read_text())
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    audit=ROOT/('library-audit-'+stamp);audit.mkdir(mode=0o700)
    chunks=audit/'chunks';chunks.mkdir()
    status={'startedAt':time.time(),'phase':'inventory','complete':False,'directory':str(audit)}
    def update(**fields):
        status.update(fields);atomic(ROOT/'library-audit-status.json',status)
        print(json.dumps(status),flush=True)
    inventory=[];special=[]
    for base,dirs,files in os.walk(LIBRARY,followlinks=False):
        for d in list(dirs):
            if (Path(base)/d).is_symlink():
                special.append(str((Path(base)/d).relative_to(LIBRARY)));dirs.remove(d)
        for name in sorted(files):
            p=Path(base)/name
            if not stat.S_ISREG(p.lstat().st_mode):special.append(str(p.relative_to(LIBRARY)));continue
            rel=str(p.relative_to(LIBRARY))
            if any(ord(c)<32 or ord(c)==127 for c in rel):raise RuntimeError('Control character in library filename')
            inventory.append({'path':rel,'fingerprint':fingerprint(p),'size':p.stat().st_size})
    atomic(audit/'manifest.json',inventory)
    whole=[i for i in inventory if i['size']<=MAX_FILE]
    large=[i for i in inventory if i['size']>MAX_FILE]
    update(files=len(inventory),totalBytes=sum(i['size'] for i in inventory),wholeFileEligible=len(whole),largeFiles=len(large),specialFiles=special)
    chunkmap={}
    for number,item in enumerate(large):
        fd=open_raw(LIBRARY,item['path'])
        try:
            offset=0;index=0
            while offset<item['size']:
                target=chunks/f'{number}-{index}.bin'
                count=min(CHUNK,item['size']-offset)
                os.lseek(fd,offset,os.SEEK_SET)
                with target.open('xb') as out:
                    remaining=count
                    while remaining:
                        data=os.read(fd,min(4*1024**2,remaining))
                        if not data:raise RuntimeError('Large file changed while reading')
                        out.write(data);remaining-=len(data)
                chunkmap['/chunks/'+target.name]={'path':item['path'],'offset':offset,'bytes':count}
                offset+=CHUNK-OVERLAP;index+=1
        finally:os.close(fd)
    atomic(audit/'chunk-map.json',chunkmap)
    scanlist=['/library/'+i['path'] for i in whole]+list(chunkmap)
    (audit/'scan-list.txt').write_text('\n'.join(scanlist)+'\n')
    lock=(ROOT/'gate.lock').open('a')
    update(phase='waiting for scanner lock')
    fcntl.flock(lock,fcntl.LOCK_EX)
    try:
        if time.time()-json.loads((ROOT/'database.json').read_text())['updatedAt']>48*3600:
            raise RuntimeError('Signatures are stale')
        mem=int(re.search(r'MemAvailable:\s+(\d+)',Path('/proc/meminfo').read_text())[1])*1024
        if mem<1700*1024**2:raise RuntimeError('Insufficient available memory for antivirus')
        update(phase='antivirus',antivirusTotal=len(scanlist))
        name,cmd=docker(CLAM,[(LIBRARY,'/library',False),(ROOT/'clamdb','/var/lib/clamav',False),
            (chunks,'/chunks',False),(audit/'scan-list.txt','/scan-list',False)],'clamscan',
            ['--stdout','--verbose','--max-filesize=1900M','--max-scansize=2000M','--alert-exceeds-max=yes',
             '--alert-encrypted=yes','--alert-broken=yes','--follow-dir-symlinks=0','--follow-file-symlinks=0','--file-list=/scan-list'],'1408m')
        try:
            with (audit/'antivirus.log').open('w') as log:
                r=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT,timeout=3*3600)
        finally:subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        avlog=(audit/'antivirus.log').read_text()
        verdicts={}
        for line in avlog.splitlines():
            for suffix,verdict in [(': OK','no detection'),(': Empty file','empty')]:
                if line.endswith(suffix):verdicts[line[:-len(suffix)]]=verdict
            if ' FOUND' in line:
                key,_,sig=line.rpartition(': ')
                verdicts[key]='DETECTION: '+sig
        missing=[p for p in scanlist if p not in verdicts]
        detections={p:v for p,v in verdicts.items() if v.startswith('DETECTION:')}
        errors=[l for l in avlog.splitlines() if 'ERROR' in l or 'WARNING' in l]
        atomic(audit/'antivirus-results.json',{'returnCode':r.returncode,'verdicts':verdicts,'missing':missing,'detections':detections,'errors':errors})
        update(phase='file signatures and video checks',antivirusReturnCode=r.returncode,
            antivirusResults=len(verdicts),detections=len(detections),antivirusMissing=len(missing),antivirusErrors=errors)
        # The parser is separately confined; only its report directory is writable.
        output=audit/'parser-output';output.mkdir()
        name,cmd=docker(config['inspector_image'],[(LIBRARY,'/library',False),
            (SOURCE/'audit_inspect.py','/audit_inspect.py',False),(audit/'manifest.json','/audit-manifest',False),
            (output,'/output',True)],'python3',['/audit_inspect.py'],'512m')
        try:
            with (audit/'inspection.log').open('w') as log:
                pr=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT,timeout=3*3600)
        finally:subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        checks=[json.loads(l) for l in (output/'inspection.jsonl').read_text().splitlines()]
        changed=[i['path'] for i in inventory if not (LIBRARY/i['path']).exists() or fingerprint(LIBRARY/i['path'])!=i['fingerprint']]
        warnings=[i for i in checks if i['warnings'] or i['error']]
        large_results=[]
        for item in large:
            names=[p for p,v in chunkmap.items() if v['path']==item['path']]
            large_results.append({'path':item['path'],'size':item['size'],'coverage':'supplementary overlapping chunk scan; NOT whole-file antivirus clearance',
                'chunks':len(names),'chunkResults':{p:verdicts.get(p,'NOT SCANNED') for p in names}})
        report={'startedAt':status['startedAt'],'finishedAt':time.time(),'files':len(inventory),'totalBytes':status['totalBytes'],
            'wholeFileNoDetections':sum(verdicts.get('/library/'+i['path']) in {'no detection','empty'} and i['path'] not in changed for i in whole),
            'largeFileLimitedCoverage':large_results,'detections':detections,'unconfirmedAntivirus':missing,
            'antivirusErrors':errors,'antivirusReturnCode':r.returncode,'parserReturnCode':pr.returncode,
            'filesInspected':len(checks),'inspectionFindings':warnings,'changedDuringScan':changed,'specialFiles':special,
            'scope':'Existing media library only. Read-only snapshot-in-time audit; no files removed or altered. No host/process/rootkit audit.'}
        atomic(audit/'report.json',report)
        update(phase='finished',complete=True,wholeFileNoDetections=report['wholeFileNoDetections'],
            largeFileLimitedCoverage=len(large_results),inspectionFindings=len(warnings),changedDuringScan=changed,
            filesInspected=len(checks),report=str(audit/'report.json'))
        print(json.dumps(report,indent=2),flush=True)
    finally:
        fcntl.flock(lock,fcntl.LOCK_UN);lock.close()
        shutil.rmtree(chunks)

if __name__=='__main__':main()
