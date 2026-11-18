"""Read-only legacy-library checks inside the offline parser container.

Policy warnings are not malware detections. MPEG/WMV are inspected as legacy media
without changing the stricter new-download allowlist. No file is executed or modified.
"""
import json
import math
from pathlib import Path
import subprocess
import time
from inspect_media import VIDEO, TEXT, run

VIDEO_TYPES = {**VIDEO, '.mpg':{'video/mpeg'}, '.mpeg':{'video/mpeg'}, '.wmv':{'video/x-ms-asf', 'video/x-ms-wmv'}}

def check(p):
    with p.open('rb') as f: head=f.read(16)
    if head.startswith((b'MZ',b'\x7fELF',b'#!',b'PK\x03\x04',b'Rar!',b'7z\xbc\xaf')):
        return ['Executable, script or archive signature'], None
    suffix=p.suffix.lower()
    mime=run(['file','--brief','--mime-type','--',str(p)]).decode().strip()
    warnings=[]
    if suffix in VIDEO_TYPES:
        if mime not in VIDEO_TYPES[suffix]:warnings.append('Video extension/signature mismatch: '+mime)
        args=['-v','error','-protocol_whitelist','file','-threads','1']
        info=json.loads(run(['ffprobe',*args,'-show_streams','-show_format','-of','json',str(p)],timeout=60))
        if not any(s.get('codec_type')=='video' for s in info.get('streams',[])):
            raise ValueError('No video stream')
        attachments=[s for s in info.get('streams',[]) if s.get('codec_type') not in {'video','audio','subtitle'}]
        if attachments:warnings.append('Contains attachment/data streams; would need review under the new policy')
        duration=float(info.get('format',{}).get('duration',0))
        if not math.isfinite(duration) or duration<=0:warnings.append('Duration could not be validated')
        run(['ffmpeg','-nostdin',*args,'-i',str(p),'-t','8','-map','0:v:0','-an','-sn','-dn','-f','null','-'],timeout=90)
        return warnings,'video signature, stream inspection and 8-second decode'
    if suffix in TEXT|{'.sfv'}:
        if p.stat().st_size>2*1024**2:return ['Text sidecar exceeds inspection limit'],None
        if mime not in {'text/plain','text/x-subrip','inode/x-empty'}:warnings.append('Non-text sidecar signature: '+mime)
        raw=p.read_bytes()
        try:text=raw.decode('utf-8-sig')
        except UnicodeDecodeError:
            text=raw.decode('cp437');warnings.append('Legacy text encoding; would require review under the new policy')
        if '\x00' in text or any(s in text.lower() for s in ['<script','<iframe','javascript:','<!doctype','<html']):
            warnings.append('Active-content marker or binary data in text')
        return warnings,'text sidecar inspection'
    if suffix in {'.jpg','.jpeg','.png'}:
        if mime not in {'image/jpeg','image/png'}:warnings.append('Artwork signature mismatch: '+mime)
        return warnings,'artwork signature inspection'
    return ['Unsupported file extension'],None

manifest=json.loads(Path('/audit-manifest').read_text())
with Path('/output/inspection.jsonl').open('w') as out:
    for item in manifest:
        p=Path('/library')/item['path']
        result={'path':item['path']}
        try:
            warnings,coverage=check(p)
            result.update(warnings=warnings,coverage=coverage,error=None)
        except Exception as e:
            result.update(warnings=[],coverage=None,error=str(e)[:300])
        out.write(json.dumps(result)+'\n');out.flush()
        print(json.dumps({'checked':item['path'],'error':result['error']}),flush=True)
