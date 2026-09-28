-- Chama Savings Platform: core schema
-- Rules: see server/chama/ARCHITECTURE.md

CREATE TABLE IF NOT EXISTS chamas (
  chat_id BIGINT PRIMARY KEY REFERENCES telegram_chats(id),
  name TEXT NOT NULL,
  monthly_amount_cents INTEGER NOT NULL CHECK (monthly_amount_cents > 0),
  fine_percent NUMERIC(5,2) DEFAULT 2.00,
  cycle_day INTEGER NOT NULL DEFAULT 1 CHECK (cycle_day BETWEEN 1 AND 28),
  treasurer_user_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chama_members (
  chama_id BIGINT REFERENCES chamas(chat_id),
  user_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  PRIMARY KEY (chama_id, user_id)
);

CREATE TABLE IF NOT EXISTS cycles (
  id BIGSERIAL PRIMARY KEY,
  chama_id BIGINT REFERENCES chamas(chat_id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'cancelled')),
  expected_total_cents INTEGER NOT NULL,
  UNIQUE (chama_id, period_start)
);

-- Invariant 1: only one open cycle per chama, enforced by the database
CREATE UNIQUE INDEX IF NOT EXISTS one_open_cycle_per_chama
  ON cycles (chama_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id BIGINT REFERENCES cycles(id),
  chama_id BIGINT REFERENCES chamas(chat_id),
  member_user_id BIGINT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  mpesa_reference TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);

-- The same M-Pesa receipt can never confirm two contributions
CREATE UNIQUE INDEX IF NOT EXISTS contributions_mpesa_ref_unique
  ON contributions (mpesa_reference) WHERE mpesa_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS fines (
  id BIGSERIAL PRIMARY KEY,
  cycle_id BIGINT REFERENCES cycles(id),
  member_user_id BIGINT NOT NULL,
  amount_cents INTEGER NOT NULL,
  reason TEXT NOT NULL,
  paid BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payouts (
  id BIGSERIAL PRIMARY KEY,
  chama_id BIGINT REFERENCES chamas(chat_id),
  recipient_user_id BIGINT NOT NULL,
  amount_cents INTEGER NOT NULL,
  reason TEXT NOT NULL,
  paid_at TIMESTAMPTZ,
  created_by BIGINT NOT NULL
);