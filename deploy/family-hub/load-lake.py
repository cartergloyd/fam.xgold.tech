#!/usr/bin/env python3
"""Print the SQL that loads lake-schedule-2026.json into the fam DB. Safe to run twice: rows that already exist
(including ones edited on the site since) are left alone. Apply lake-schema.sql first.

  python3 load-lake.py | docker exec -i gold-platform-postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d fam'
"""
import json
from pathlib import Path

data = json.loads((Path(__file__).resolve().parent / 'lake-schedule-2026.json').read_text())
q = lambda s: "'" + str(s).replace("'", "''") + "'"
owner = q(data['owner'])
out = ['BEGIN;', f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM family_users WHERE name={owner}) THEN RAISE EXCEPTION 'No family user named {data['owner']}'; END IF; END $$;"]
sel = f"(SELECT id FROM family_users WHERE name={owner})"

out += [f"INSERT INTO family_lake_days(user_id,day,presence) VALUES ({sel},{q(d)},{q(p)}) ON CONFLICT DO NOTHING;" for d, p in sorted(data['days'].items())]
out += [f"INSERT INTO family_lake_away(user_id,start_date,end_date,reason) SELECT {sel},{q(a['start_date'])},{q(a['end_date'])},{q(a['reason'])} "
        f"WHERE NOT EXISTS (SELECT 1 FROM family_lake_away WHERE user_id={sel} AND start_date={q(a['start_date'])} AND end_date={q(a['end_date'])});" for a in data['away']]
out += [f"INSERT INTO family_lake_weekends(user_id,friday,title,queen,bunks,notes_9112,notes) VALUES ({sel},{q(w['friday'])},{q(w['title'])},{q(json.dumps(w['queen']))},{q(json.dumps(w['bunks']))},{q(w['notes_9112'])},{q(w['notes'])}) ON CONFLICT DO NOTHING;" for w in data['weekends']]
out += [f"INSERT INTO family_lake_invites(user_id,group_no,name,note,weekends,position) SELECT {sel},{i['group'] if i['group'] else 'NULL'},{q(i['name'])},{q(i['note'])},{q(json.dumps(i['weekends']))},{n} "
        f"WHERE NOT EXISTS (SELECT 1 FROM family_lake_invites WHERE user_id={sel} AND name={q(i['name'])});" for n, i in enumerate(data['invites'])]
# The sheet has no head count; guests is required to be 1 or more, so past stays carry 1 and the page never shows it.
out += [f"INSERT INTO family_reservations(property_id,user_id,start_date,end_date,guests,status,guest_name,title) VALUES ('6108',NULL,{q(b['start_date'])},{q(b['end_date'])},1,{q(b['status'])},{q(b['guest_name'])},{q(b['title'])}) ON CONFLICT DO NOTHING;" for b in data['bookings']]
out.append('COMMIT;')
print('\n'.join(out))
