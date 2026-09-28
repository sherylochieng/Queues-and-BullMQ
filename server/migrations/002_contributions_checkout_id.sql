ALTER TABLE contributions ADD COLUMN IF NOT EXISTS checkout_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS contributions_checkout_id_unique
  ON contributions (checkout_request_id) WHERE checkout_request_id IS NOT NULL;