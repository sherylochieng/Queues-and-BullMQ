CREATE TABLE IF NOT EXISTS telegram_chats (
  id BIGINT PRIMARY KEY,
  type TEXT,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);