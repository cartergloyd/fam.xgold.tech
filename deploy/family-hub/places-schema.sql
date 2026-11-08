BEGIN;
-- Per-account map extras. Stars are a member's own picks among Dynmap markers (pin_id is world:set:marker).
CREATE TABLE IF NOT EXISTS family_mc_pin_stars (
 user_id uuid NOT NULL REFERENCES family_users(id) ON DELETE CASCADE,
 pin_id text NOT NULL CHECK(length(pin_id) BETWEEN 1 AND 200),
 date_created timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,pin_id)
);
-- One row per Minecraft account, overwritten every minute while that player is online, so after a logout it holds
-- the last spot seen. key is the lowercase name without a leading dot, spaces or underscores (no UUIDs, no trail).
CREATE TABLE IF NOT EXISTS family_mc_last_seen (
 key text PRIMARY KEY CHECK(key ~ '^[a-z0-9]{1,32}$'),
 world text NOT NULL CHECK(world IN ('world','world_nether','world_the_end')),
 x integer NOT NULL, y integer NOT NULL, z integer NOT NULL,
 seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE family_mc_pin_stars OWNER TO fam;
ALTER TABLE family_mc_last_seen OWNER TO fam;
COMMIT;
