#!/usr/bin/env python3
"""Run only after the owner explicitly approves an indexer and its authorized use."""
import argparse
import fcntl
import hashlib
import json
from gate import ROOT, arr, atomic, indexer_policy

parser=argparse.ArgumentParser()
parser.add_argument('id',type=int)
parser.add_argument('--reason',required=True)
args=parser.parse_args()
if len(args.reason.strip())<15:parser.error('Document the source and approval in the reason')
with (ROOT/'gate.lock').open('a') as lock:
    fcntl.flock(lock,fcntl.LOCK_EX)
    idx=arr('prowlarr','GET','/indexer/'+str(args.id))
    config=json.loads((ROOT/'config.json').read_text())
    config['indexers']=[i for i in config['indexers'] if i['id']!=args.id]
    config['indexers'].append({'id':idx['id'],'name':idx['name'],
        'fingerprint':hashlib.sha256(json.dumps([idx['implementation'],idx.get('fields',[])],sort_keys=True).encode()).hexdigest(),
        'reason':args.reason.strip()})
    atomic(ROOT/'config.json',config)
    indexer_policy(config)
    arr('prowlarr','POST','/command',{'name':'ApplicationIndexerSync'})
print('Indexer approval documented and synced; downloads still require the gate')
