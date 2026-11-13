#!/usr/bin/env python3
"""Make QR invitations. Needs `pip install segno`. Reads `id|name` lines on stdin (people without an invite yet), writes into <out-dir>:
  invites.sql   the hashed tokens to load into family_award_guests (the plain tokens are only in the files below)
  invites.csv   name,url
  invites.html  printable sheet, one card per person with a QR code
Keep the out-dir private: anyone with a link can set that person's passcode. Pass --admin NAME to make someone the organizer.

  ssh gold@gold-server 'docker exec -i gold-platform-postgres sh -c "psql -U \\$POSTGRES_USER -d fam -At -c \\"select id,name from family_users where status<>\x27disabled\x27 and fantasy_team is not null and id not in (select user_id from family_award_guests) order by name\\""' \\
    | python3 make-invites.py ~/Documents/awards-invites --admin Carter
"""
import sys, secrets, hashlib, html, csv, argparse
from pathlib import Path
import segno
ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--admin', action='append', default=[]); ap.add_argument('--base', default='https://fam.xgold.tech/awards/')
a = ap.parse_args()
out = Path(a.out).expanduser(); out.mkdir(parents=True, exist_ok=True)
people = [l.rstrip('\n').split('|', 1) for l in sys.stdin if '|' in l]
rows, sql, cards = [], ['BEGIN;'], []
for uid, name in people:
    assert len(uid) == 36 and "'" not in uid, uid
    token = secrets.token_urlsafe(16); url = f'{a.base}?k={token}'
    admin = 'true' if name in a.admin else 'false'
    sql.append(f"INSERT INTO family_award_guests(user_id,token_hash,is_admin) VALUES ('{uid}','{hashlib.sha256(token.encode()).hexdigest()}',{admin}) ON CONFLICT DO NOTHING;")
    rows.append((name, url))
    cards.append(f'<section><h2>{html.escape(name)}</h2>{segno.make(url, error="m").svg_inline(scale=5, border=2)}<p>{html.escape(url)}</p></section>')
sql.append('COMMIT;')
(out / 'invites.sql').write_text('\n'.join(sql) + '\n')
with open(out / 'invites.csv', 'w', newline='') as f: csv.writer(f).writerows([('name', 'url'), *rows])
(out / 'invites.html').write_text('<!doctype html><meta charset=utf-8><title>Invitations</title><style>body{font:16px -apple-system,Helvetica,sans-serif;display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding:24px}section{break-inside:avoid;text-align:center;border:1px solid #ccc;padding:16px}h2{margin:0 0 8px}svg{width:180px;height:180px}p{font-size:9px;word-break:break-all;color:#555}</style>' + ''.join(cards))
print(f'{len(rows)} invitations written to {out}')
