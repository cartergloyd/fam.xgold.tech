-- Streaming hub: roles and request workflow. Additive and re-runnable; existing rows, columns and the old endpoints keep working.
BEGIN;

-- Everyone is Standard until an admin says otherwise (Admin and Trusted are set on the Streaming page or in Directus).
ALTER TABLE family_users ADD COLUMN IF NOT EXISTS streaming_role text NOT NULL DEFAULT 'standard';
DO $$ BEGIN
  ALTER TABLE family_users ADD CONSTRAINT family_users_streaming_role_check CHECK (streaming_role IN ('standard','trusted','admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE family_streaming_requests
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES family_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS tvdb_id text,
  ADD COLUMN IF NOT EXISTS seasons jsonb,
  ADD COLUMN IF NOT EXISTS arr_id integer,
  ADD COLUMN IF NOT EXISTS progress real,
  ADD COLUMN IF NOT EXISTS detail text,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES family_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS available_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DO $$ BEGIN
  ALTER TABLE family_streaming_requests ADD CONSTRAINT family_streaming_requests_state_check
    CHECK (state IN ('pending','approved','searching','downloading','importing','available','declined','failed','cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Older rows were typed by name; link them to the matching profile so they show in that person's history.
UPDATE family_streaming_requests r SET user_id = u.id FROM family_users u WHERE r.user_id IS NULL AND r.requested_by = u.name;

-- One open request per title for the whole family: a second person asking for the same title joins the first.
CREATE UNIQUE INDEX IF NOT EXISTS family_streaming_one_open_request ON family_streaming_requests (media_type, tmdb_id)
  WHERE state IN ('pending','approved','searching','downloading','importing');

INSERT INTO directus_fields(collection,field,interface,options)
SELECT 'family_users','streaming_role','select-dropdown','{"choices":[{"text":"Standard (needs approval)","value":"standard"},{"text":"Trusted (auto-approved)","value":"trusted"},{"text":"Admin","value":"admin"}]}'::json
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection='family_users' AND field='streaming_role');
INSERT INTO directus_fields(collection,field,interface,hidden,readonly)
SELECT 'family_streaming_requests',f,'input',true,true FROM unnest(ARRAY['arr_id','attempts','progress','tvdb_id','seasons']) AS f
WHERE NOT EXISTS (SELECT 1 FROM directus_fields d WHERE d.collection='family_streaming_requests' AND d.field=f);

COMMIT;
