BEGIN;
CREATE TABLE IF NOT EXISTS family_streaming_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 media_type text NOT NULL CHECK(media_type IN ('movie','tv')),
 tmdb_id text NOT NULL CHECK(tmdb_id ~ '^[0-9]{1,12}$'),
 title text NOT NULL,
 year integer,
 poster_url text,
 requested_by text NOT NULL DEFAULT 'Guest',
 requester_key text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','added','declined')),
 date_created timestamptz NOT NULL DEFAULT now(),
 UNIQUE(media_type,tmdb_id,requester_key)
);
ALTER TABLE family_streaming_requests OWNER TO fam;
INSERT INTO directus_collections(collection,icon,note,display_template)
VALUES ('family_streaming_requests','movie','Movie and TV requests from the Streaming page. Guest and profile names are self-reported, not verified identities.','{{title}} — {{requested_by}}')
ON CONFLICT(collection) DO NOTHING;
INSERT INTO directus_fields(collection,field,interface,hidden,readonly)
SELECT 'family_streaming_requests',field,interface,hidden,readonly FROM (VALUES
 ('requester_key','input',true,true),('id','input',true,true),
 ('title','input',false,true),('requested_by','input',false,true),
 ('status','select-dropdown',false,false)
) AS fields(field,interface,hidden,readonly)
WHERE NOT EXISTS (SELECT 1 FROM directus_fields f WHERE f.collection='family_streaming_requests' AND f.field=fields.field);
UPDATE directus_fields SET options='{"choices":[{"text":"Pending","value":"pending"},{"text":"Added","value":"added"},{"text":"Declined","value":"declined"}]}'::json WHERE collection='family_streaming_requests' AND field='status';
COMMIT;
