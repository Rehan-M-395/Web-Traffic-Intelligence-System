CREATE TABLE IF NOT EXISTS user_tracking_events (
  id BIGSERIAL PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  fingerprint_hash TEXT NOT NULL,
  user_agent TEXT,
  os_platform TEXT,
  screen_resolution TEXT,
  timezone TEXT,
  language TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  city TEXT,
  country TEXT,
  ip_address TEXT NOT NULL,
  location_source TEXT NOT NULL DEFAULT 'ip',
  precise_location_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  suspicious BOOLEAN NOT NULL DEFAULT FALSE,
  suspicious_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_tracking_events_created_at
  ON user_tracking_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_tracking_events_visitor_id_created_at
  ON user_tracking_events (visitor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_tracking_events_ip_address
  ON user_tracking_events (ip_address);

CREATE INDEX IF NOT EXISTS idx_user_tracking_events_suspicious
  ON user_tracking_events (suspicious, created_at DESC);
