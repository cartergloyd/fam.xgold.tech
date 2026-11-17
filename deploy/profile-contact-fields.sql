BEGIN;
ALTER TABLE family_users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE family_users ADD COLUMN IF NOT EXISTS address text;
-- 'YYYY-MM-DD', or '--MM-DD' when the year is unknown (vCard style).
ALTER TABLE family_users ADD COLUMN IF NOT EXISTS birthday text;
ALTER TABLE family_users ADD COLUMN IF NOT EXISTS contact_notes text;
ALTER TABLE family_users DROP CONSTRAINT IF EXISTS family_users_birthday_check;
ALTER TABLE family_users ADD CONSTRAINT family_users_birthday_check
  CHECK (birthday IS NULL OR birthday ~ '^([0-9]{4}|-)-[0-9]{2}-[0-9]{2}$');
INSERT INTO directus_fields(collection,field,interface,hidden,readonly,note,sort)
SELECT 'family_users', v.field, v.iface, false, false, v.note, v.sort
FROM (VALUES ('phone','input','Primary phone number.',16),
             ('address','input-multiline','Home mailing address.',17),
             ('birthday','input','YYYY-MM-DD, or --MM-DD when the year is unknown.',18),
             ('contact_notes','input-multiline','Extra phone numbers and emails that do not fit the single email column.',19)) v(field,iface,note,sort)
WHERE NOT EXISTS (SELECT 1 FROM directus_fields d WHERE d.collection='family_users' AND d.field=v.field);

-- Contact details supplied by the owner from Contacts on 2026-11-17.
-- Match by first name; `name` is never changed because the PIN hash is salted with it.
UPDATE family_users SET last_name='Skinner', phone='(314) 378-9394',
  address=E'211 Churchill Downs Ct\nFenton MO 63026', birthday='--10-15',
  email=coalesce(email,'timskinner@sbcglobal.net') WHERE name='Tim';
UPDATE family_users SET last_name='Freeman', phone='(314) 223-1999',
  address=E'16 Clara Ave\nWebster MO 63119\nUnited States',
  contact_notes=E'Also phone (314) 544-3700. Emails: afree@economycontrols.com (other), eccservice@yahoo.com (other), andyf@economycontrols.com (work), meafreeman@yahoo.com (home).'
  WHERE name='Andrew';
UPDATE family_users SET last_name='Rodenbaugh', phone='(816) 797-6855',
  address=E'3623 S 47th Road\nHumansville MO 65674', birthday='--11-17' WHERE name='Dan';
UPDATE family_users SET last_name='Fearn', phone='(314) 623-9119',
  address=E'16 Clara Ave\nWebster Missouri' WHERE name='Sam';
UPDATE family_users SET last_name='Gloyd', phone='(314) 401-6486',
  address=E'1003 Tompkins St.\nSt. Charles\nUnited States', birthday='1999-03-30',
  contact_notes=E'Emails: gloyd.chandler@ace.aaa.com (work), w0lfgangster@yahoo.com (iCloud), chandlergloyd@sbcglobal.net (Yahoo! Messenger).'
  WHERE name='Chandler';
UPDATE family_users SET phone='(515) 782-5462',
  address=E'1620 38th St\nDes Moines IA 50310-4541', birthday='--05-02' WHERE name='Rick';
-- Added later the same day: "Big Kat" is Kevin; Scott's address came from the owner in chat.
-- Kevin's surname is not set: it must not be inferred from his email address.
UPDATE family_users SET phone='(314) 277-9833',
  address=E'2727 Brandenberg ave.\nOakville MO 63129\nUnited States', birthday='--09-07' WHERE name='Kevin';
UPDATE family_users SET address=E'1306 Anthony St Apt. 11\nColumbia Missouri' WHERE name='Scott';
COMMIT;
