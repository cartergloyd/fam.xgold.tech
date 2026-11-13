-- Awards ceremony: one row per invited person. Safe to run twice.
BEGIN;
CREATE TABLE IF NOT EXISTS family_award_guests (
 user_id uuid PRIMARY KEY REFERENCES family_users(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),  -- sha256 of the QR token; the token itself is never stored
 pin_hash text CHECK (pin_hash IS NULL OR pin_hash ~ '^[a-f0-9]{64}$'),  -- awards passcode, separate from the family PIN
 is_admin boolean NOT NULL DEFAULT false,                                -- sees every RSVP and ballot
 failed integer NOT NULL DEFAULT 0,
 locked_until timestamptz,
 rsvp boolean,
 rsvp_at timestamptz,
 ballot jsonb NOT NULL DEFAULT '{}'::jsonb,
 ballot_at timestamptz,
 upload bytea,                                                            -- photo or PDF of a handwritten ballot
 upload_type text,
 upload_name text,
 upload_at timestamptz
);
ALTER TABLE family_award_guests OWNER TO fam;
COMMIT;
