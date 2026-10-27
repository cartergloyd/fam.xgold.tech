BEGIN;
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE family_users ADD COLUMN IF NOT EXISTS condo_manager boolean NOT NULL DEFAULT false;
ALTER TABLE family_users ADD COLUMN IF NOT EXISTS maintenance_manager boolean NOT NULL DEFAULT false;
ALTER TABLE family_users ADD COLUMN IF NOT EXISTS instant_booking boolean NOT NULL DEFAULT false;
UPDATE family_users SET condo_manager=true, instant_booking=true WHERE name IN ('Carter','Chester');
UPDATE family_users SET maintenance_manager=true WHERE name='Jaime';
CREATE TABLE IF NOT EXISTS family_properties (
 id text PRIMARY KEY, title text NOT NULL, description text NOT NULL DEFAULT '', house_rules text NOT NULL DEFAULT '',
 check_in time NOT NULL DEFAULT '16:00', check_out time NOT NULL DEFAULT '10:00', max_guests integer CHECK(max_guests BETWEEN 1 AND 100),
 max_nights integer CHECK(max_nights BETWEEN 1 AND 365), advance_days integer NOT NULL DEFAULT 0 CHECK(advance_days BETWEEN 0 AND 365),
 timezone text NOT NULL DEFAULT 'America/Chicago', revision integer NOT NULL DEFAULT 1
);
INSERT INTO family_properties(id,title) VALUES('6108','6108') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS family_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), property_id text NOT NULL REFERENCES family_properties(id),
 user_id uuid NOT NULL REFERENCES family_users(id), start_date date NOT NULL, end_date date NOT NULL,
 guests integer NOT NULL CHECK(guests BETWEEN 1 AND 100), note text NOT NULL DEFAULT '' CHECK(length(note)<=2000),
 status text NOT NULL CHECK(status IN ('pending','confirmed','blocked','cancelled','declined')),
 date_created timestamptz NOT NULL DEFAULT now(), revision integer NOT NULL DEFAULT 1,
 CHECK(end_date>start_date), CHECK(end_date-start_date<=365),
 EXCLUDE USING gist (property_id WITH =, daterange(start_date,end_date,'[)') WITH &&) WHERE(status IN ('pending','confirmed','blocked'))
);
ALTER TABLE family_reservations ADD COLUMN IF NOT EXISTS suites jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE family_reservations ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE family_reservations ADD COLUMN IF NOT EXISTS guest_name text CHECK(length(guest_name) BETWEEN 1 AND 60);
CREATE TABLE IF NOT EXISTS family_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK(kind IN ('maintenance','build')),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 160), description text NOT NULL DEFAULT '' CHECK(length(description)<=4000),
 status text NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','done')),
 user_id uuid NOT NULL REFERENCES family_users(id), assigned_to uuid REFERENCES family_users(id),
 world text NOT NULL DEFAULT 'world' CHECK(world IN ('world','world_nether','world_the_end')),
 x integer, y integer, z integer, revision integer NOT NULL DEFAULT 1, date_created timestamptz NOT NULL DEFAULT now(),
 CHECK(num_nonnulls(x,y,z) IN (0,3)),
 CHECK((x IS NULL AND y IS NULL AND z IS NULL) OR (x BETWEEN -30000000 AND 30000000 AND y BETWEEN -64 AND 320 AND z BETWEEN -30000000 AND 30000000))
);
CREATE TABLE IF NOT EXISTS family_mc_activity (
 day date NOT NULL, world text NOT NULL, x integer NOT NULL, z integer NOT NULL, samples integer NOT NULL DEFAULT 1, source text NOT NULL DEFAULT 'players' CHECK(source IN ('players','chunks')),
 PRIMARY KEY(day,world,x,z,source)
);
-- Lake schedule (Chester's view on the 6108 page). One owner for now; keyed by user so another could follow.
ALTER TABLE family_users ADD COLUMN IF NOT EXISTS lake_schedule boolean NOT NULL DEFAULT false;
UPDATE family_users SET lake_schedule=true WHERE name='Chester';
ALTER TABLE family_reservations ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '' CHECK(length(title)<=80);
CREATE TABLE IF NOT EXISTS family_lake_days (
 user_id uuid NOT NULL REFERENCES family_users(id), day date NOT NULL, presence text NOT NULL CHECK(presence IN ('yes','no')),
 PRIMARY KEY(user_id,day)
);
CREATE TABLE IF NOT EXISTS family_lake_away (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES family_users(id),
 start_date date NOT NULL, end_date date NOT NULL, reason text NOT NULL DEFAULT '' CHECK(length(reason)<=120), CHECK(end_date>=start_date)
);
CREATE TABLE IF NOT EXISTS family_lake_weekends (
 user_id uuid NOT NULL REFERENCES family_users(id), friday date NOT NULL CHECK(extract(dow FROM friday)=5),
 title text NOT NULL DEFAULT '' CHECK(length(title)<=80), queen jsonb NOT NULL DEFAULT '[]'::jsonb, bunks jsonb NOT NULL DEFAULT '[]'::jsonb,
 notes_9112 text NOT NULL DEFAULT '' CHECK(length(notes_9112)<=2000), notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 revision integer NOT NULL DEFAULT 1, PRIMARY KEY(user_id,friday)
);
CREATE TABLE IF NOT EXISTS family_lake_invites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES family_users(id),
 group_no integer CHECK(group_no BETWEEN 1 AND 9), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=400), weekends jsonb NOT NULL DEFAULT '[]'::jsonb, position integer NOT NULL DEFAULT 0
);
ALTER TABLE family_lake_days OWNER TO fam;
ALTER TABLE family_lake_away OWNER TO fam;
ALTER TABLE family_lake_weekends OWNER TO fam;
ALTER TABLE family_lake_invites OWNER TO fam;
ALTER TABLE family_properties OWNER TO fam;
ALTER TABLE family_reservations OWNER TO fam;
ALTER TABLE family_tasks OWNER TO fam;
ALTER TABLE family_mc_activity OWNER TO fam;
INSERT INTO directus_collections(collection,icon,note) VALUES
 ('family_properties','home','Condo configuration. Managed by Carter and Chester.'),
 ('family_reservations','event','Pending reservations hold dates. Checkout dates are exclusive.'),
 ('family_tasks','task','Maintenance assigned to Jaime; Minecraft builds shared by family.'),
 ('family_lake_days','wb_sunny','Days the lake schedule owner is at the lake (yes) or not (no). Confirmed 6108 nights count as yes unless a row says no.'),
 ('family_lake_away','flight_takeoff','Date ranges the owner is away, with the reason. end_date is inclusive.'),
 ('family_lake_weekends','weekend','Weekend title, 9112 rooms (queen, bunks) and notes, keyed by the Friday.'),
 ('family_lake_invites','group','The invite list with the weekends each person is available.') ON CONFLICT DO NOTHING;
COMMIT;
