CREATE TABLE IF NOT EXISTS ai_daily_usage (
  usage_day TEXT PRIMARY KEY,
  used_units INTEGER NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
