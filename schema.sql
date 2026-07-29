CREATE TABLE IF NOT EXISTS seen (
  url TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL
);

-- Everyone who has self-activated with the code word (or been added directly).
-- The daily article fans out to every row here.
CREATE TABLE IF NOT EXISTS recipients (
  chat_id  TEXT PRIMARY KEY,
  label    TEXT,
  added_at TEXT NOT NULL
);

-- One row per recipient per day: the same article can go to several people, and
-- each needs its own message_id (for feedback lookup) and idempotency record.
CREATE TABLE IF NOT EXISTS sent (
  send_date   TEXT NOT NULL,
  chat_id     TEXT NOT NULL,
  url         TEXT NOT NULL,
  message_id  INTEGER NOT NULL,
  headline    TEXT NOT NULL,
  coined_term TEXT,
  sent_at     TEXT NOT NULL,
  PRIMARY KEY (send_date, chat_id)
);

-- One reaction per recipient per day (a second tap replaces the first).
CREATE TABLE IF NOT EXISTS feedback (
  send_date TEXT NOT NULL,
  chat_id   TEXT NOT NULL,
  button    TEXT NOT NULL,
  tapped_at TEXT NOT NULL,
  PRIMARY KEY (send_date, chat_id)
);

CREATE TABLE IF NOT EXISTS backlog_used (
  slug    TEXT PRIMARY KEY,
  used_at TEXT NOT NULL
);

-- URLs delivered on demand via the «Ще новини» button. Shared across all
-- recipients (nobody gets a repeat of an on-demand pick, regardless of who
-- requested it), and kept separate from `sent` so it doesn't disturb daily
-- idempotency.
CREATE TABLE IF NOT EXISTS extra_sent (
  url     TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL
);
