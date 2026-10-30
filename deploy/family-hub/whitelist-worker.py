#!/usr/bin/env python3
"""Family directory -> Minecraft whitelist and in-game first names.

A signed-in family member types a Java username or Xbox gamertag on the website. The hub
endpoint stores it on their family_users row and queues a request. This worker then:
 1. verifies each queued account (Mojang's profile lookup for Java, Geyser's Xbox lookup
    for Bedrock) and stores the account UUID on the member's family_users row;
 2. keeps whitelist.json in step with family_users, adding or renaming entries by UUID and
    never removing one, then asks the server to re-read it over LAN-only RCON; and
 3. writes plugins/FamilyNames/names.json (account UUID -> first name) for the FamilyNames
    plugin, which shows family members by first name in chat, the tab list and name tags.
Only the fixed commands 'whitelist reload' and 'whitelist list' are ever sent over RCON.
Player-typed names never become commands or shell arguments.
"""
import datetime
import json
import os
import pathlib
import re
import socket
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

PROPERTIES = pathlib.Path('/home/gold/Minecraft Server/server.properties')
SERVER_DIR = PROPERTIES.parent
WHITELIST = SERVER_DIR / 'whitelist.json'
NAMES = SERVER_DIR / 'plugins' / 'FamilyNames' / 'names.json'
RCON_COMMANDS = ('whitelist reload', 'whitelist list')
SYNC_INTERVAL = 60
LOOKUP_RETRY = 600
LAST_SYNC = 0.0
_lookup_backoff = {}

class AccountError(Exception):
    pass

def sql(text):
    result = subprocess.run(['docker','exec','-i','gold-platform-postgres','sh','-c','psql -v ON_ERROR_STOP=1 -Atq -U "$POSTGRES_USER" -d fam'],input=text,text=True,capture_output=True,check=True,timeout=15)
    return result.stdout.strip()

def literal(value):
    # Values remain UTF-8 data even if a provider returns unexpected characters.
    return "convert_from(decode('" + str(value).encode().hex() + "','hex'),'UTF8')"

def request_json(url):
    req=urllib.request.Request(url,headers={'User-Agent':'GoldFamilyWhitelist/1.0','Accept':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=12) as response:
            return json.load(response)
    except urllib.error.HTTPError as e:
        if e.code in (204,400,404):
            raise AccountError('Account not found. Check your username or Xbox gamertag.') from None
        raise AccountError('Account verification is unavailable. Please try again later.') from None
    except (TimeoutError,urllib.error.URLError,json.JSONDecodeError):
        raise AccountError('Account verification is unavailable. Please try again later.') from None

def resolve_account(edition,name,fetch=request_json):
    if edition=='java' and re.fullmatch(r'[A-Za-z0-9_]{3,16}',name):
        data=fetch('https://api.minecraftservices.com/minecraft/profile/lookup/name/'+name)
        if not isinstance(data,dict) or not re.fullmatch(r'[a-fA-F0-9]{32}',str(data.get('id',''))) or not re.fullmatch(r'[A-Za-z0-9_]{3,16}',str(data.get('name',''))):
            raise AccountError('Account not found. Check your Java username.')
        return {'id':str(uuid.UUID(data['id'])),'name':data['name']}
    if edition=='bedrock' and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9 _]{0,15}',name):
        data=fetch('https://api.geysermc.org/v2/xbox/xuid/'+urllib.parse.quote(name,safe=''))
        xuid=str(data.get('xuid','')) if isinstance(data,dict) else ''
        if not re.fullmatch(r'[0-9]{1,20}',xuid) or not 0<int(xuid)<2**64:
            raise AccountError('Account not found. Check your Xbox gamertag.')
        # Floodgate's configured prefix is '.', with spaces replaced by '_'.
        return {'id':str(uuid.UUID(int=int(xuid))),'name':floodgate_name(name)}
    raise AccountError('Invalid account name.')

def floodgate_name(gamertag):
    return '.'+gamertag.replace(' ','_')

def properties():
    return dict(line.split('=',1) for line in PROPERTIES.read_text().splitlines() if '=' in line and not line.startswith('#'))

def rcon_packet(packet_id,kind,body):
    payload=struct.pack('<ii',packet_id,kind)+body.encode()+b'\x00\x00'
    return struct.pack('<i',len(payload))+payload

def rcon_parse(data):
    packet_id,kind=struct.unpack('<ii',data[:8])
    return packet_id,kind,data[8:-2].decode('utf-8','replace')

def _read_exact(sock,size):
    chunks=b''
    while len(chunks)<size:
        chunk=sock.recv(size-len(chunks))
        if not chunk:raise RuntimeError('RCON connection closed')
        chunks+=chunk
    return chunks

def rcon(command):
    """Source RCON to the server's own listener. Minecraft binds RCON to server-ip, so it stays on the LAN."""
    if command not in RCON_COMMANDS:
        raise ValueError('Unsupported RCON command')
    settings=properties()
    if settings.get('enable-rcon')!='true' or not settings.get('rcon.password'):
        raise RuntimeError('RCON is not enabled in server.properties')
    host=settings.get('server-ip') or '127.0.0.1'
    with socket.create_connection((host,int(settings.get('rcon.port') or 25575)),timeout=10) as sock:
        def receive():
            (length,)=struct.unpack('<i',_read_exact(sock,4))
            return rcon_parse(_read_exact(sock,length))
        sock.sendall(rcon_packet(1,3,settings['rcon.password']))
        while True:
            packet_id,kind,_=receive()
            if kind==2:break
        if packet_id!=1:
            raise RuntimeError('RCON authentication failed')
        sock.sendall(rcon_packet(2,2,command))
        return receive()[2]

def read_json(path,default):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return default

def write_json(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(path.name+'.tmp')
    tmp.write_text(json.dumps(data,indent=2)+'\n')
    os.replace(tmp,path)

def merge_whitelist(entries,desired):
    """Add or rename whitelist entries by UUID. Existing entries, including ones the family
    database knows nothing about, are never removed. Returns (entries, changed)."""
    result=[dict(e) for e in entries if isinstance(e,dict) and e.get('uuid')]
    by_uuid={str(e['uuid']).lower():e for e in result}
    changed=False
    for account in desired:
        key=str(account['uuid']).lower()
        if key in by_uuid:
            if by_uuid[key].get('name')!=account['name']:
                by_uuid[key]['name']=account['name'];changed=True
        else:
            entry={'uuid':key,'name':account['name']};result.append(entry);by_uuid[key]=entry;changed=True
    return result,changed

def directory():
    raw=sql("SELECT coalesce(json_agg(row_to_json(u)),'[]') FROM (SELECT id,name,first_name,status,mc_java_username,mc_java_uuid,mc_bedrock_username,mc_bedrock_uuid FROM family_users WHERE mc_java_username IS NOT NULL OR mc_bedrock_username IS NOT NULL OR mc_java_uuid IS NOT NULL OR mc_bedrock_uuid IS NOT NULL ORDER BY name) u;")
    return json.loads(raw or '[]')

def desired_entries(rows):
    """Whitelist entries the directory asks for. Disabled members are not added (nor removed)."""
    desired=[]
    for row in rows:
        if row.get('status')=='disabled':continue
        if row.get('mc_java_uuid') and row.get('mc_java_username'):
            desired.append({'uuid':row['mc_java_uuid'],'name':row['mc_java_username']})
        if row.get('mc_bedrock_uuid') and row.get('mc_bedrock_username'):
            desired.append({'uuid':row['mc_bedrock_uuid'],'name':floodgate_name(row['mc_bedrock_username'])})
    return desired

def names_payload(rows):
    """Account UUID -> first name, for every linked account of a member who is not disabled."""
    names={}
    for row in rows:
        if row.get('status')=='disabled':continue
        first=(row.get('first_name') or str(row.get('name') or '').split(' ')[0]).strip()
        if not first:continue
        for key in ('mc_java_uuid','mc_bedrock_uuid'):
            if row.get(key):names[str(row[key]).lower()]=first
    return dict(sorted(names.items()))

def store_account(user_id,edition,profile,typed):
    """Write the verified account onto the member's row. Java keeps Mojang's casing; Bedrock keeps the
    gamertag as typed (no prefix, spaces intact). A UUID already linked elsewhere is a 23505."""
    column='mc_'+edition+'_'
    username=profile['name'] if edition=='java' else typed.strip()
    try:
        sql("UPDATE family_users SET "+column+"username="+literal(username)+", "+column+"uuid="+literal(profile['id'])+"::uuid WHERE id="+literal(user_id)+"::uuid;")
    except subprocess.CalledProcessError as e:
        if 'family_users_mc_' in (e.stderr or ''):
            raise AccountError('This Minecraft account is already linked to another family member. Ask Carter for help.') from None
        raise

def resolve_missing(rows):
    """Usernames typed straight into the database get their UUID here, with a backoff per name."""
    updated=False
    for row in rows:
        for edition in ('java','bedrock'):
            username=row.get('mc_'+edition+'_username')
            if not username or row.get('mc_'+edition+'_uuid'):continue
            key=(edition,username.lower())
            if _lookup_backoff.get(key,0)>time.time():continue
            try:
                store_account(row['id'],edition,resolve_account(edition,username),username);updated=True
                _lookup_backoff.pop(key,None)
                print(f'Linked a {edition} account typed into the directory.',flush=True)
            except AccountError as e:
                _lookup_backoff[key]=time.time()+LOOKUP_RETRY
                print(f'Directory {edition} account could not be verified yet: {e}',flush=True)
    return updated

def sync():
    """Reconcile family_users -> whitelist.json (+ reload) and names.json. Returns the whitelist UUIDs."""
    global LAST_SYNC
    rows=directory()
    if resolve_missing(rows):rows=directory()
    current=read_json(WHITELIST,[])
    if not isinstance(current,list):raise RuntimeError('whitelist.json is not a list; leaving it alone')
    entries,changed=merge_whitelist(current,desired_entries(rows))
    if changed:
        write_json(WHITELIST,entries)
        print(rcon('whitelist reload') or 'Whitelist reloaded.',flush=True)
    names=names_payload(rows)
    if read_json(NAMES,None)!=names:
        write_json(NAMES,names)
        print(f'Wrote {len(names)} family names for the FamilyNames plugin.',flush=True)
    LAST_SYNC=time.time()
    return {str(e['uuid']).lower() for e in entries}

def run_once():
    # Recover interrupted, idempotent additions. Disabled users cannot claim jobs.
    sql("UPDATE family_mc_whitelist SET status='pending',updated_at=now() WHERE status='processing' AND updated_at < now()-interval '2 minutes';")
    raw=sql("WITH candidate AS (SELECT q.id FROM family_mc_whitelist q JOIN family_users u ON u.id=q.user_id WHERE q.status='pending' AND u.status='ready' ORDER BY q.date_created LIMIT 1 FOR UPDATE OF q SKIP LOCKED), claimed AS (UPDATE family_mc_whitelist q SET status='processing',updated_at=now() FROM candidate c WHERE q.id=c.id RETURNING q.*) SELECT row_to_json(claimed) FROM claimed;")
    if not raw:return False
    job=json.loads(raw)
    try:
        profile=resolve_account(job['edition'],job['username'])
        store_account(job['user_id'],job['edition'],profile,job['username'])
        if profile['id'].lower() not in sync():
            raise RuntimeError('Server did not confirm whitelist addition')
        sql("UPDATE family_mc_whitelist SET status='added',profile_uuid="+literal(profile['id'])+"::uuid,error=NULL,updated_at=now() WHERE id="+literal(job['id'])+"::uuid;")
        print('Whitelist request completed.',flush=True)
    except Exception as e:
        error=str(e) if isinstance(e,AccountError) else 'The server could not confirm your whitelist addition. Please try again.'
        sql("UPDATE family_mc_whitelist SET status='failed',error="+literal(error)+",updated_at=now() WHERE id="+literal(job['id'])+"::uuid;")
        print('Whitelist request failed; member can retry.'+('' if isinstance(e,AccountError) else f' ({type(e).__name__})'),flush=True)
    return True

if __name__=='__main__':
    if '--check' in sys.argv:
        listed=rcon('whitelist list')
        print(f'RCON connected: {listed[:200]}')
        print(f'{len(read_json(WHITELIST,[]))} entries in whitelist.json; {len(directory())} directory rows with Minecraft accounts. No changes made.')
    elif '--sync' in sys.argv:
        print(f'{len(sync())} whitelist entries after sync at {datetime.datetime.now().isoformat(timespec="seconds")}.')
    else:
        while True:
            try:
                work=run_once()
            except Exception as e:
                print(f'Whitelist queue temporarily unavailable; retrying. ({type(e).__name__})',flush=True);work=False
            if time.time()-LAST_SYNC>=SYNC_INTERVAL:
                try:
                    sync()
                except Exception as e:
                    print(f'Whitelist sync failed; retrying. ({type(e).__name__})',flush=True);LAST_SYNC=time.time()
            if not work:time.sleep(2)
