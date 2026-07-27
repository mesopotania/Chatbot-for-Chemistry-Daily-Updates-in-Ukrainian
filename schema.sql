CREATE TABLE seen (
  url TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL
);

CREATE TABLE sent (
  send_date   TEXT PRIMARY KEY,
  url         TEXT NOT NULL,
  message_id  INTEGER NOT NULL,
  headline    TEXT NOT NULL,
  coined_term TEXT,
  sent_at     TEXT NOT NULL
);

CREATE TABLE feedback (
  send_date TEXT PRIMARY KEY REFERENCES sent(send_date),
  button    TEXT NOT NULL,
  tapped_at TEXT NOT NULL
);

CREATE TABLE backlog_used (
  slug    TEXT PRIMARY KEY,
  used_at TEXT NOT NULL
);
