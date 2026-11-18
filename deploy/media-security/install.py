#!/usr/bin/env python3
"""One-time, owner-approved installation. Backs up private state before changes.

Requires qBittorrent restart/password approval; leaves the VPN container running.
Reads secrets on the host, never embeds them in source or subprocess arguments.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import stat
import subprocess
import time
import urllib.parse
import urllib.request
import yaml
from gate import ROOT, atomic, arr, Qbit

SOURCE = Path(__file__).resolve().parent
PLATFORM = ROOT.parent
VPN = PLATFORM / 'qbittorrent-vpn'
MEDIA = Path('/home/gold/Jellyfin Server/media')

def bdecode(data):
    i = 0
    def one():
        nonlocal i
        c = data[i:i+1]
        if c == b'i':
            end = data.index(b'e', i); value = int(data[i+1:end]); i = end+1; return value
        if c in {b'd', b'l'}:
            i += 1; value = {} if c == b'd' else []
            while data[i:i+1] != b'e':
                if c == b'd': key = one(); value[key] = one()
                else: value.append(one())
            i += 1; return value
        end = data.index(b':', i); n = int(data[i:end]); i = end+1; value = data[i:i+n]; i += n; return value
    value = one()
    assert i == len(data)
    return value

def bencode(value):
    if isinstance(value, int): return b'i'+str(value).encode()+b'e'
    if isinstance(value, bytes): return str(len(value)).encode()+b':'+value
    if isinstance(value, list): return b'l'+b''.join(map(bencode,value))+b'e'
    if isinstance(value, dict): return b'd'+b''.join(bencode(k)+bencode(v) for k,v in sorted(value.items()))+b'e'
    raise TypeError(type(value))

def oldcall(path, data=None):
    req=urllib.request.Request('http://127.0.0.1:8080/api/v2/'+path,
        data=None if data is None else urllib.parse.urlencode(data).encode())
    with urllib.request.urlopen(req,timeout=30) as r: text=r.read().decode()
    return json.loads(text) if text else None

def run(args):
    return subprocess.run(args,check=True,capture_output=True,text=True).stdout.strip()

if __name__ == '__main__':
    if (ROOT/'installed.json').exists(): raise SystemExit('Already installed; use the documented update procedure')
    config=json.loads((ROOT/'config.json').read_text())
    verification=json.loads((ROOT/'scanner-verification.json').read_text())
    assert verification['clean']['result']=='passed' and verification['eicar']['result']=='rejected'
    now=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup=PLATFORM/'backup-private'/('media-security-'+now);backup.mkdir(mode=0o700)
    for name, source in [('qbit-compose.yml',VPN/'docker-compose.yml'),('qbit-config',VPN/'config'),
                         ('dashboard.env',PLATFORM/'homelab-dashboard.env'),
                         ('arr-compose.yml',PLATFORM/'media-automation/docker-compose.yml')]:
        if source.is_dir():shutil.copytree(source,backup/name,ignore=lambda folder,names:[n for n in names if stat.S_ISSOCK((Path(folder)/n).lstat().st_mode)])
        else:shutil.copy2(source,backup/name)
    (backup/'dashboard.env').chmod(0o600)
    torrents=oldcall('torrents/info')
    atomic(backup/'torrents.json',torrents)
    atomic(backup/'preferences.json',oldcall('app/preferences'))
    for app in ['radarr','sonarr','prowlarr']:
        for route in (['/applications','/indexer','/tag'] if app=='prowlarr' else ['/downloadclient','/remotepathmapping']):
            atomic(backup/(app+'-'+route[1:]+'.json'),arr(app,'GET',route))
    # Establish the allowlist before any new indexer can be synced to an application.
    tags=arr('prowlarr','GET','/tag')
    tag=next((t['id'] for t in tags if t['label']=='security-approved'),None)
    if tag is None:tag=arr('prowlarr','POST','/tag',{'label':'security-approved'})['id']
    for app in arr('prowlarr','GET','/applications'):
        app['tags']=[tag];arr('prowlarr','PUT','/applications/'+str(app['id']),app)
    for idx in arr('prowlarr','GET','/indexer'):
        if idx['name']=='Internet Archive':
            config['indexers'].append({'id':idx['id'],'name':idx['name'],
                'fingerprint':hashlib.sha256(json.dumps([idx['implementation'],idx.get('fields',[])],sort_keys=True).encode()).hexdigest(),
                'reason':'Existing public-domain source only; all files still require the gate'})
            idx['tags']=[tag];arr('prowlarr','PUT','/indexer/'+str(idx['id']),idx)
    # Save password privately before applying it. Consumers all get credentials.
    config['qbit']['password']=secrets.token_urlsafe(27)
    atomic(ROOT/'config.json',config)
    credentials=ROOT/'webui-credentials.txt'
    credentials.write_text('qBittorrent WebUI\nUsername: admin\nPassword: '+config['qbit']['password']+'\n')
    credentials.chmod(0o600)
    envfile=PLATFORM/'homelab-dashboard.env'
    env=envfile.read_text()
    for key,value in [('QBITTORRENT_USERNAME','admin'),('QBITTORRENT_PASSWORD',config['qbit']['password'])]:
        env=re.sub(r'^'+key+r'=.*\n?', '', env, flags=re.M)
        env+='\n'+key+'='+value+'\n'
    envfile.write_text(env);envfile.chmod(0o600)
    for app in ['radarr','sonarr']:
        for client in arr(app,'GET','/downloadclient'):
            if client['implementation']!='QBittorrent':continue
            for field in client['fields']:
                if field['name']=='username':field['value']='admin'
                if field['name']=='password':field['value']=config['qbit']['password']
            arr(app,'PUT','/downloadclient/'+str(client['id']),client)
        for mapping in arr(app,'GET','/remotepathmapping'):
            if mapping['remotePath']=='/incoming/':raise RuntimeError('Unexpected existing quarantine mapping')
        client=next(c for c in arr(app,'GET','/downloadclient') if c['implementation']=='QBittorrent')
        host=next(f['value'] for f in client['fields'] if f['name']=='host')
        arr(app,'POST','/remotepathmapping',{'host':host,'remotePath':'/incoming/','localPath':str(MEDIA/'Verified')+'/'})
    # API stores its own password hash. Disable both LAN and localhost authentication bypasses.
    oldcall('app/setPreferences',{'json':json.dumps({'web_ui_username':'admin','web_ui_password':config['qbit']['password'],
        'bypass_local_auth':False,'bypass_auth_subnet_whitelist_enabled':False,
        'web_ui_csrf_protection_enabled':True,'autorun_enabled':False,'autorun_on_torrent_added_enabled':False})})
    qbit=Qbit(config['qbit'])
    # Stop unfinished legacy downloads, preserve their resume state, then move their partial data on the same filesystem.
    pending=[t for t in torrents if t['progress']<1]
    for t in pending:qbit.call('torrents/stop',{'hashes':t['hash']},raw=True)
    compose=yaml.safe_load((VPN/'docker-compose.yml').read_text())
    service=compose['services']['qbittorrent']
    service['volumes']=[{'type':'bind','source':'./config','target':'/config'},
        {'type':'bind','source':config['raw'],'target':'/incoming'},
        *[{'type':'bind','source':str(MEDIA/k),'target':target,'read_only':True}
          for k,target in [('Movies','/downloads'),('Movies','/movies'),('Movies',str(MEDIA/'Movies')),('Shows',str(MEDIA/'Shows'))]]]
    service['cap_drop']=['ALL']
    service['cap_add']=['CHOWN','DAC_OVERRIDE','FOWNER','SETUID','SETGID','KILL']
    service['security_opt']=['no-new-privileges:true']
    service['pids_limit']=128
    (VPN/'docker-compose.yml').write_text(yaml.safe_dump(compose,sort_keys=False))
    shutil.copy2(VPN/'docker-compose.yml',SOURCE/'qbit-compose.yml')
    vpn_before=run(['docker','inspect','qbittorrent-vpn','--format','{{.Id}}'])
    start=time.monotonic()
    run(['docker','stop','-t','15','qbittorrent'])
    try:
        for t in pending:
            if t.get('content_path'):
                old=t['content_path']
                source=MEDIA/'Movies'/old[len('/downloads/'):] if old.startswith('/downloads/') else Path(old)
                if source.exists():
                    assert MEDIA in source.parents and source.parent in {MEDIA/'Movies',MEDIA/'Shows'}
                    destination=Path(config['raw'])/'manual'/source.name
                    assert not destination.exists()
                    try: os.rename(source,destination)
                    except PermissionError:
                        # Legacy qbtvpn-owned directories may require owner-level rename.
                        run(['sudo','-n','python3','-c','import os,sys;os.rename(sys.argv[1],sys.argv[2])',str(source),str(destination)])
            resume=VPN/'config/qBittorrent/BT_backup'/(t['hash']+'.fastresume')
            if resume.exists():
                data=resume.read_bytes();info=bdecode(data);assert bencode(info)==data
                info[b'save_path']=b'/incoming/manual';info[b'qBt-savePath']=b'/incoming/manual'
                info[b'qBt-downloadPath']=b'';info[b'paused']=1
                resume.write_bytes(bencode(info))
        run(['docker','compose','-f',str(VPN/'docker-compose.yml'),'up','-d','--no-deps','qbittorrent'])
    except Exception:
        # Preserve all backups and bring the hardened client up even if migration requires follow-up.
        subprocess.run(['docker','compose','-f',str(VPN/'docker-compose.yml'),'up','-d','--no-deps','qbittorrent'],capture_output=True)
        raise
    for attempt in range(30):
        try:qbit=Qbit(config['qbit']);break
        except Exception:time.sleep(1)
    else:raise RuntimeError('Hardened qBittorrent did not become ready')
    assert vpn_before==run(['docker','inspect','qbittorrent-vpn','--format','{{.Id}}'])
    downtime=round(time.monotonic()-start,1)
    qbit.call('app/setPreferences',{'json':json.dumps({'save_path':'/incoming/manual','temp_path':'/incoming/incomplete',
        'temp_path_enabled':False,'auto_tmm_enabled':True})},raw=True)
    for category in ['radarr','sonarr']:
        qbit.call('torrents/editCategory',{'category':category,'savePath':'/incoming/'+category},raw=True)
    for t in pending:
        if t['state']!='missingFiles':qbit.call('torrents/start',{'hashes':t['hash']},raw=True)
    run(['systemctl','--user','restart','gold-dashboard.service'])
    atomic(ROOT/'installed.json',{'backup':str(backup),'qbitDowntimeSeconds':downtime,'vpnUnchanged':True,'at':now})
    print(f'qBittorrent hardened; interruption {downtime}s; VPN container unchanged. Backup: {backup}')
