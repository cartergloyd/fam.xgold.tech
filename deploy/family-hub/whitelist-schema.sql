BEGIN;
CREATE TABLE IF NOT EXISTS family_mc_whitelist (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES family_users(id),
 edition text NOT NULL CHECK(edition IN ('java','bedrock')),
 username text NOT NULL CHECK(length(username) BETWEEN 1 AND 16),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','added','failed')),
 profile_uuid uuid, error text,
 date_created timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS family_mc_whitelist_active ON family_mc_whitelist(user_id,edition) WHERE status IN ('pending','processing','added');
ALTER TABLE family_mc_whitelist OWNER TO fam;
COMMIT;
