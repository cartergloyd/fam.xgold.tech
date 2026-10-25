#!/usr/bin/env python3
"""Authenticated account-add queue -> loopback Minecraft Management Protocol.
Only fixed allowlist query/add methods are used. No console commands or shell
interpolation of player input. The browser/API never receives management secrets.
"""
import asyncio
import datetime
import json
import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import websockets

PROPERTIES = pathlib.Path('/home/gold/Minecraft Server/server.properties')
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
        return {'id':str(uuid.UUID(int=int(xuid))),'name':'.'+name.replace(' ','_')}
    raise AccountError('Invalid account name.')

async def rpc(method,params=None):
    if method not in ('rpc.discover','minecraft:allowlist','minecraft:allowlist/add'):
        raise ValueError('Unsupported management method')
    settings=dict(line.split('=',1) for line in PROPERTIES.read_text().splitlines() if '=' in line and not line.startswith('#'))
    address='ws://127.0.0.1:'+settings['management-server-port']
    async with websockets.connect(address,subprotocols=['minecraft-v1'],additional_headers={'Authorization':'Bearer '+settings['management-server-secret']},open_timeout=5,close_timeout=2,proxy=None) as ws:
        message={'jsonrpc':'2.0','id':1,'method':method}
        if params is not None:message['params']=params
        await ws.send(json.dumps(message))
        while True:
            data=json.loads(await asyncio.wait_for(ws.recv(),timeout=15))
            if data.get('id')==1:
                if 'error' in data:raise RuntimeError('Management request failed')
                return data['result']

async def add_verified_profile(profile,call=rpc):
    before=await call('minecraft:allowlist')
    if not any(p.get('id')==profile['id'] for p in before):
        await call('minecraft:allowlist/add',[[profile]])
    after=await call('minecraft:allowlist')
    if not any(p.get('id')==profile['id'] for p in after):
        raise RuntimeError('Server did not confirm whitelist addition')

def run_once():
    # Recover interrupted, idempotent additions. Disabled users cannot claim jobs.
    sql("UPDATE family_mc_whitelist SET status='pending',updated_at=now() WHERE status='processing' AND updated_at < now()-interval '2 minutes';")
    raw=sql("WITH candidate AS (SELECT q.id FROM family_mc_whitelist q JOIN family_users u ON u.id=q.user_id WHERE q.status='pending' AND u.status='ready' ORDER BY q.date_created LIMIT 1 FOR UPDATE OF q SKIP LOCKED), claimed AS (UPDATE family_mc_whitelist q SET status='processing',updated_at=now() FROM candidate c WHERE q.id=c.id RETURNING q.*) SELECT row_to_json(claimed) FROM claimed;")
    if not raw:return False
    job=json.loads(raw);profile=None
    try:
        profile=resolve_account(job['edition'],job['username'])
        asyncio.run(add_verified_profile(profile))
        sql("UPDATE family_mc_whitelist SET status='added',profile_uuid="+literal(profile['id'])+"::uuid,error=NULL,updated_at=now() WHERE id="+literal(job['id'])+"::uuid;")
        print('Whitelist request completed.',flush=True)
    except Exception as e:
        error=str(e) if isinstance(e,AccountError) else 'The server could not confirm your whitelist addition. Please try again.'
        sql("UPDATE family_mc_whitelist SET status='failed',error="+literal(error)+",updated_at=now() WHERE id="+literal(job['id'])+"::uuid;")
        print('Whitelist request failed; member can retry.',flush=True)
    return True

if __name__=='__main__':
    if '--check' in sys.argv:
        current=asyncio.run(rpc('minecraft:allowlist'))
        print(f'Loopback management connected; {len(current)} whitelist entries. No changes made.')
    else:
        while True:
            try:
                work=run_once()
            except Exception:
                print('Whitelist queue temporarily unavailable; retrying.',flush=True);work=False
            if not work:time.sleep(2)
