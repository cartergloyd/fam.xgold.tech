BEGIN;
ALTER TABLE family_users ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE family_users ADD COLUMN IF NOT EXISTS last_name text;
UPDATE family_users SET first_name = split_part(name, ' ', 1) WHERE first_name IS NULL;
-- Only surnames explicitly supplied by the owner are populated.
UPDATE family_users SET last_name = 'Gloyd' WHERE name = 'Chester' AND last_name IS NULL;
UPDATE family_users SET last_name = 'Smith' WHERE name = 'Rick' AND last_name IS NULL;
INSERT INTO directus_fields(collection,field,interface,hidden,readonly,note,sort)
SELECT 'family_users', v.field, 'input', false, false, v.note, v.sort
FROM (VALUES ('first_name','First name used to suggest a profile from an email address.',14),
             ('last_name','Optional confirmed surname; do not infer it from an email address.',15)) v(field,note,sort)
WHERE NOT EXISTS (SELECT 1 FROM directus_fields d WHERE d.collection='family_users' AND d.field=v.field);
COMMIT;
