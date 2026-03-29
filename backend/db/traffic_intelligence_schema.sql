CREATE TABLE IF NOT EXISTS ip_profiles (
  ip_address TEXT PRIMARY KEY,
  country_code TEXT,
  country_name TEXT,
  region_name TEXT,
  city_name TEXT,
  isp_name TEXT,
  asn TEXT,
  risk_score INTEGER NOT NULL DEFAULT 0,
  total_requests INTEGER NOT NULL DEFAULT 0,
  blocked_requests INTEGER NOT NULL DEFAULT 0,
  anomaly_count INTEGER NOT NULL DEFAULT 0,
  unique_users INTEGER NOT NULL DEFAULT 0,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS request_logs (
  id BIGSERIAL PRIMARY KEY,
  uid UUID REFERENCES users(uid) ON DELETE SET NULL,
  session_id UUID REFERENCES sessions(session_id) ON DELETE SET NULL,
  ip_address TEXT NOT NULL,
  route_path TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'POST',
  request_type TEXT NOT NULL DEFAULT 'normal',
  decision TEXT NOT NULL DEFAULT 'allowed',
  status_code INTEGER,
  user_agent TEXT,
  device_name TEXT,
  fingerprint_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS queue_entries (
  id BIGSERIAL PRIMARY KEY,
  uid UUID REFERENCES users(uid) ON DELETE SET NULL,
  ip_address TEXT NOT NULL,
  route_path TEXT NOT NULL DEFAULT '/',
  status TEXT NOT NULL DEFAULT 'queued',
  queue_position INTEGER NOT NULL DEFAULT 0,
  estimated_wait_seconds INTEGER NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 1,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS anomaly_events (
  id BIGSERIAL PRIMARY KEY,
  uid UUID REFERENCES users(uid) ON DELETE SET NULL,
  ip_address TEXT NOT NULL,
  anomaly_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  route_path TEXT,
  requests_per_second INTEGER,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_request_logs_created_at
  ON request_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_request_logs_ip_address
  ON request_logs (ip_address);

CREATE INDEX IF NOT EXISTS idx_request_logs_uid
  ON request_logs (uid);

CREATE INDEX IF NOT EXISTS idx_request_logs_route_path
  ON request_logs (route_path);

CREATE INDEX IF NOT EXISTS idx_queue_entries_uid
  ON queue_entries (uid, joined_at DESC);

CREATE INDEX IF NOT EXISTS idx_queue_entries_status
  ON queue_entries (status, joined_at DESC);

CREATE INDEX IF NOT EXISTS idx_anomaly_events_detected_at
  ON anomaly_events (detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_anomaly_events_ip_address
  ON anomaly_events (ip_address, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_anomaly_events_uid
  ON anomaly_events (uid, detected_at DESC);
