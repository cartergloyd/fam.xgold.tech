-- Lake schedule access. Additive; safe to run twice. Apply after schema.sql, same psql command.
-- One schedule, stored under its owner (Chester). Anyone with lake_schedule=true sees and edits that same schedule.
BEGIN;
ALTER TABLE family_users ADD COLUMN IF NOT EXISTS lake_owner boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS family_users_one_lake_owner ON family_users(lake_owner) WHERE lake_owner;
UPDATE family_users SET lake_owner=true WHERE name='Chester';
UPDATE family_users SET lake_schedule=true WHERE name IN ('Chester','Carter');
-- Away ranges can come from a linked calendar (replaced on each sync) or be typed on the page (kept).
ALTER TABLE family_lake_away ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','calendar'));
CREATE TABLE IF NOT EXISTS family_lake_calendar (
 user_id uuid PRIMARY KEY REFERENCES family_users(id), url text NOT NULL CHECK(length(url)<=2000),
 synced_at timestamptz, error text NOT NULL DEFAULT ''
);
ALTER TABLE family_lake_calendar OWNER TO fam;
COMMIT;
