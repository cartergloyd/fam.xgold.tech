-- Fantasy league history (all-time record, yearly awards) shown on /ff/ to signed-in family only. Safe to run twice.
-- The document itself is loaded by hand and never committed: see the README.
BEGIN;
CREATE TABLE IF NOT EXISTS family_ff_history (
 id text PRIMARY KEY CHECK(id='league'),
 doc jsonb NOT NULL,
 date_updated timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE family_ff_history OWNER TO fam;
COMMIT;
