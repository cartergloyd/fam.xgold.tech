-- Guest links and reminders for 6108 stays. Additive; safe to run twice. Apply before installing the new endpoint.
-- manage_token_hash: sha256 of the private link given to a visitor who requested a stay without an account.
-- guest_email: optional, where that visitor wants confirmations. reminded_at: set once the week-before reminder is sent.
BEGIN;
ALTER TABLE family_reservations ADD COLUMN IF NOT EXISTS manage_token_hash text;
ALTER TABLE family_reservations ADD COLUMN IF NOT EXISTS guest_email text CHECK(length(guest_email)<=254);
ALTER TABLE family_reservations ADD COLUMN IF NOT EXISTS reminded_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS family_reservations_manage_token ON family_reservations(manage_token_hash) WHERE manage_token_hash IS NOT NULL;
COMMIT;
