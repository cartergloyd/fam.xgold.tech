"""Untrusted media parsers run only in an offline, read-only disposable container."""
import json
import math
from pathlib import Path
import subprocess
import sys

VIDEO = {'.mkv': {'video/x-matroska'}, '.webm': {'video/webm', 'video/x-matroska'},
         '.mp4': {'video/mp4'}, '.m4v': {'video/mp4'}, '.mov': {'video/quicktime'},
         '.avi': {'video/x-msvideo'}}
TEXT = {'.srt', '.vtt', '.txt', '.nfo'}

def run(args, timeout=45):
    r = subprocess.run(args, capture_output=True, timeout=timeout)
    if r.returncode:
        raise ValueError('Media parser rejected the file')
    return r.stdout

def inspect(root):
    publish = []
    videos = 0
    for p in sorted(root.rglob('*')):
        if p.is_dir():
            continue
        suffix = p.suffix.lower()
        with p.open('rb') as f:
            head = f.read(16)
        if head.startswith((b'MZ', b'\x7fELF', b'#!', b'PK\x03\x04', b'Rar!', b'7z\xbc\xaf')):
            raise ValueError('Executable, script or archive signature')
        mime = run(['file', '--brief', '--mime-type', '--', str(p)]).decode().strip()
        if suffix in VIDEO:
            if mime not in VIDEO[suffix]:
                raise ValueError('Video extension does not match its signature')
            args = ['-v', 'error', '-protocol_whitelist', 'file', '-threads', '1']
            info = json.loads(run(['ffprobe', *args, '-show_streams', '-show_format', '-of', 'json', str(p)]))
            if not any(s.get('codec_type') == 'video' for s in info.get('streams', [])):
                raise ValueError('No video stream')
            if any(s.get('codec_type') not in {'video', 'audio', 'subtitle'} for s in info.get('streams', [])):
                raise ValueError('Embedded attachment or data stream')
            duration = float(info.get('format', {}).get('duration', 0))
            if not math.isfinite(duration) or duration <= 0:
                raise ValueError('No finite positive duration')
            # Only a short decode: this is a playability check, not a proof that every frame is safe.
            run(['ffmpeg', '-nostdin', *args, '-i', str(p), '-t', '8', '-map', '0:v:0',
                 '-an', '-sn', '-dn', '-f', 'null', '-'])
            videos += 1
            publish.append(str(p.relative_to(root)))
        elif suffix in TEXT:
            if p.stat().st_size > 2 * 1024 * 1024 or mime not in {'text/plain', 'text/x-subrip'}:
                raise ValueError('Unsupported text sidecar')
            text = p.read_text(encoding='utf-8-sig').lower()
            if '\x00' in text or any(x in text for x in ['<script', '<iframe', 'javascript:', '<!doctype', '<html']):
                raise ValueError('Active content in a text sidecar')
            if suffix in {'.srt', '.vtt'}:
                publish.append(str(p.relative_to(root)))
        elif suffix in {'.jpg', '.jpeg', '.png'}:
            if mime not in {'image/jpeg', 'image/png'} or p.stat().st_size > 10 * 1024 * 1024:
                raise ValueError('Unsupported artwork')
        else:
            raise ValueError('File extension is not allowed')
    if not videos:
        raise ValueError('No playable video')
    return publish

if __name__ == '__main__':
    try:
        print(json.dumps({'publish': inspect(Path('/candidate'))}))
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
