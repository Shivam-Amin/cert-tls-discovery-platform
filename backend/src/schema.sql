-- Database schema. Runs on every backend start; IF NOT EXISTS makes that safe.
-- Dates are ISO-8601 text (UTC). Lists/objects are JSON text. Booleans are 0/1.

-- One row per scan. id is the run ID shown in the UI.
CREATE TABLE IF NOT EXISTS runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT    NOT NULL CHECK (type IN ('filesystem', 'tls')),
  triggered_by  TEXT    NOT NULL CHECK (triggered_by IN ('manual', 'scheduled')),
  status        TEXT    NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed')),
  params        TEXT    NOT NULL DEFAULT '{}',  -- settings used, e.g. {"roots":["/etc/ssl"]}
  command       TEXT,                           -- exact agent command, e.g. agent-linux tls --duration 30s
  queued_at     TEXT    NOT NULL,
  started_at    TEXT,
  ended_at      TEXT,
  duration_ms   INTEGER,
  host          TEXT,
  record_count  INTEGER NOT NULL DEFAULT 0,     -- certificate or TLS rows saved
  counts        TEXT    NOT NULL DEFAULT '{}',  -- totals reported by the agent
  error_count   INTEGER NOT NULL DEFAULT 0,
  errors        TEXT    NOT NULL DEFAULT '[]',
  log           TEXT    NOT NULL DEFAULT ''     -- agent stderr
);

-- Filesystem findings: one row per certificate observation.
CREATE TABLE IF NOT EXISTS certificates (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id              INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  path                TEXT NOT NULL,
  filename            TEXT,
  format              TEXT,
  scan_root           TEXT,
  discovered_at       TEXT,
  fingerprint         TEXT,
  duplicate           INTEGER NOT NULL DEFAULT 0,
  serial              TEXT,
  subject             TEXT,
  issuer              TEXT,
  san                 TEXT NOT NULL DEFAULT '[]',
  chain_position      INTEGER,
  key_algorithm       TEXT,
  key_size            INTEGER,
  signature_algorithm TEXT,
  not_before          TEXT,
  not_after           TEXT,
  days_to_expiry      INTEGER,
  validity_status     TEXT,
  parse_status        TEXT NOT NULL,
  parse_error         TEXT,
  confidence          TEXT,
  owning_process      TEXT
);

-- TLS findings: one row per observed connection.
CREATE TABLE IF NOT EXISTS tls_observations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id              INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  first_seen          TEXT,
  last_seen           TEXT,
  source_ip           TEXT,
  source_port         INTEGER,
  destination_ip      TEXT,
  destination_port    INTEGER,
  direction           TEXT,
  transport           TEXT,
  handshake_outcome   TEXT,
  sni                 TEXT,
  tls_version         TEXT,
  cipher_suite        TEXT,
  peer_cert_sha256    TEXT,
  peer_cert_subject   TEXT,
  peer_cert_issuer    TEXT,
  peer_cert_not_after TEXT,
  process             TEXT,
  pid                 INTEGER,
  event_count         INTEGER NOT NULL DEFAULT 0
);

-- Relationship map edges. Repeats inside a run are already merged by the agent (count).
CREATE TABLE IF NOT EXISTS relationships (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id    INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  from_type TEXT NOT NULL,
  from_id   TEXT NOT NULL,
  edge      TEXT NOT NULL,
  to_type   TEXT NOT NULL,
  to_id     TEXT NOT NULL,
  count     INTEGER NOT NULL DEFAULT 1
);

-- Periodic scans: exactly one row per scan type.
CREATE TABLE IF NOT EXISTS schedules (
  type             TEXT PRIMARY KEY CHECK (type IN ('filesystem', 'tls')),
  enabled          INTEGER NOT NULL DEFAULT 0,
  interval_minutes INTEGER NOT NULL,
  params           TEXT    NOT NULL DEFAULT '{}',
  last_run_at      TEXT,
  next_run_at      TEXT,
  updated_at       TEXT
);

-- Schedules start switched off; the UI turns them on.
INSERT OR IGNORE INTO schedules (type, interval_minutes, params) VALUES
  ('filesystem', 60, '{"roots":[]}'),
  ('tls',        30, '{"duration_seconds":30}');

-- Every report query filters by run_id.
CREATE INDEX IF NOT EXISTS idx_runs_type_status     ON runs(type, status);
CREATE INDEX IF NOT EXISTS idx_certificates_run     ON certificates(run_id);
CREATE INDEX IF NOT EXISTS idx_certificates_fp      ON certificates(fingerprint);
CREATE INDEX IF NOT EXISTS idx_tls_run              ON tls_observations(run_id);
CREATE INDEX IF NOT EXISTS idx_relationships_run    ON relationships(run_id);
