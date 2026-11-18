#!/usr/bin/env python3
"""Local report finalizer, ordered after the long-running audit service.

Never sends messages or changes library files. Also records failed/interrupted
audits so a stale in-progress status cannot be mistaken for completion.
"""
import datetime
import json
from pathlib import Path
import time
from gate import ROOT, atomic

statusfile=ROOT/'library-audit-status.json'
status=json.loads(statusfile.read_text())
directory=Path(status['directory'])
reportfile=directory/'report.json'
if reportfile.exists():
    r=json.loads(reportfile.read_text())
    date=datetime.datetime.fromtimestamp(r['finishedAt'],datetime.timezone.utc).isoformat()
    lines=['# Existing media library scan', '', 'Finished: '+date, '',
        f"Inventoried {r['files']} files ({r['totalBytes']/1024**3:.2f} GiB).",
        f"Whole-file antivirus returned no detections for {r['wholeFileNoDetections']} unchanged files.",
        f"Antivirus detections: {len(r['detections'])}. Unconfirmed AV entries: {len(r['unconfirmedAntivirus'])}.",
        f"File/signature/media inspections completed: {r['filesInspected']}. Findings needing review: {len(r['inspectionFindings'])}.",
        f"Files changed during scanning: {len(r['changedDuringScan'])}.", '',
        'Media-format/policy findings are not malware verdicts. No files were deleted or moved.', '',
        '## Oversized files: limited coverage', '',
        'These received overlapping chunk scans and media checks. They did not receive whole-file antivirus clearance.', '']
    lines += ['- '+i['path']+f" ({i['size']/1024**3:.2f} GiB)" for i in r['largeFileLimitedCoverage']]
    if r['detections']:
        lines+=['','## Antivirus detections','']
        lines += ['- '+path+': '+verdict for path,verdict in r['detections'].items()]
    if r['inspectionFindings']:
        lines+=['','## File and media findings','']
        lines += ['- '+i['path']+': '+('; '.join(i['warnings']) or i['error']) for i in r['inspectionFindings']]
    if r['antivirusErrors'] or r['unconfirmedAntivirus'] or r['changedDuringScan']:
        lines+=['','## Incomplete coverage','']
        lines += ['- '+v for v in r['antivirusErrors']+r['unconfirmedAntivirus']+r['changedDuringScan']]
    lines+=['','This is a snapshot-in-time media audit. It does not establish that the host has never been compromised, inspect processes/rootkits, or rule out unknown malware/player exploits.',
        '', 'Detailed evidence: '+str(reportfile)]
else:
    status.update(complete=False, phase='failed or interrupted', finishedAt=time.time(),
        error='Audit exited before producing a complete report. Inspect service journal and per-file logs.')
    atomic(statusfile,status)
    lines=['# Existing media library scan incomplete', '', status['error'], '', 'Evidence directory: '+str(directory),
        '', 'No clean-library verdict is available. No library files were deleted or moved.']
target=ROOT/'library-audit-latest.md'
target.write_text('\n'.join(lines)+'\n');target.chmod(0o600)
print('Library audit summary written to '+str(target))
