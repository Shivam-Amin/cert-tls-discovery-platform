// All database access lives here. Routes and the runner call these functions;
// no other file writes SQL. Queries use ? / @name placeholders, never string
// concatenation of user input, so they are safe from SQL injection.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, SCAN_TYPES } from './config.js';

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL'); // reads don't block while a scan is being saved
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(schemaPath, 'utf8'));

const now = () => new Date().toISOString();

// ---------- runs ----------

// Everything except the log, which can be long; the list view doesn't need it.
const RUN_COLUMNS = `id, type, triggered_by, status, params, command, queued_at, started_at,
  ended_at, duration_ms, host, record_count, counts, error_count, errors`;

// JSON columns are stored as text; turn them back into objects for the API.
function decodeRun(row) {
  if (!row) return null;
  return {
    ...row,
    params: JSON.parse(row.params),
    counts: JSON.parse(row.counts),
    errors: JSON.parse(row.errors),
  };
}

export function createRun({ type, triggeredBy, params, command }) {
  const result = db
    .prepare(
      `INSERT INTO runs (type, triggered_by, status, params, command, queued_at)
       VALUES (?, ?, 'queued', ?, ?, ?)`,
    )
    .run(type, triggeredBy, JSON.stringify(params), command, now());
  return Number(result.lastInsertRowid); // the new run ID
}

export function markRunning(id) {
  db.prepare(`UPDATE runs SET status = 'running', started_at = ? WHERE id = ?`).run(now(), id);
}

// Time since the run started (or was queued, if it never started).
function elapsedMs(id) {
  const row = db.prepare(`SELECT started_at, queued_at FROM runs WHERE id = ?`).get(id);
  return Date.now() - Date.parse(row.started_at ?? row.queued_at);
}

export function failRun(id, message, log = '') {
  db.prepare(
    `UPDATE runs SET status = 'failed', ended_at = ?, duration_ms = ?,
       error_count = 1, errors = ?, log = ? WHERE id = ?`,
  ).run(now(), elapsedMs(id), JSON.stringify([message]), log, id);
}

// Runs left queued/running by a previous backend process can never finish.
export function failInterruptedRuns() {
  return db
    .prepare(
      `UPDATE runs SET status = 'failed', ended_at = ?, error_count = 1, errors = ?
       WHERE status IN ('queued', 'running')`,
    )
    .run(now(), JSON.stringify(['backend restarted before this run finished'])).changes;
}

export function listRuns({ type, status, limit = 200 } = {}) {
  const where = [];
  const args = [];
  if (type) {
    where.push('type = ?');
    args.push(type);
  }
  if (status) {
    where.push('status = ?');
    args.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db
    .prepare(`SELECT ${RUN_COLUMNS} FROM runs ${whereSql} ORDER BY id DESC LIMIT ?`)
    .all(...args, limit)
    .map(decodeRun);
}

export function getRun(id) {
  return decodeRun(db.prepare(`SELECT ${RUN_COLUMNS}, log FROM runs WHERE id = ?`).get(id));
}

export function hasActiveRun(type) {
  return !!db
    .prepare(`SELECT 1 FROM runs WHERE type = ? AND status IN ('queued', 'running') LIMIT 1`)
    .get(type);
}

export function getSummary() {
  const latest = {};
  for (const type of SCAN_TYPES) {
    latest[type] = decodeRun(
      db
        .prepare(
          `SELECT ${RUN_COLUMNS} FROM runs
           WHERE type = ? AND status IN ('completed', 'partial', 'failed')
           ORDER BY id DESC LIMIT 1`,
        )
        .get(type),
    );
  }
  const byStatus = {};
  for (const row of db.prepare(`SELECT status, COUNT(*) AS n FROM runs GROUP BY status`).all()) {
    byStatus[row.status] = row.n;
  }
  const active = db
    .prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE status IN ('queued', 'running') ORDER BY id`)
    .all()
    .map(decodeRun);
  const totalRuns = Object.values(byStatus).reduce((a, b) => a + b, 0);
  return { latest, active, total_runs: totalRuns, runs_by_status: byStatus };
}

// ---------- saving an agent report ----------

// better-sqlite3 needs every named parameter present and only accepts
// numbers, strings, null: so map each agent row to a complete flat object.
const val = (v) => (v === undefined ? null : v);

function certificateRow(runId, c) {
  return {
    run_id: runId,
    path: c.path,
    filename: val(c.filename),
    format: val(c.format),
    scan_root: val(c.scan_root),
    discovered_at: val(c.discovered_at),
    fingerprint: val(c.fingerprint_sha256),
    duplicate: c.duplicate ? 1 : 0,
    serial: val(c.serial),
    subject: val(c.subject),
    issuer: val(c.issuer),
    san: JSON.stringify(c.san ?? []),
    chain_position: val(c.chain_position),
    key_algorithm: val(c.key_algorithm),
    key_size: val(c.key_size),
    signature_algorithm: val(c.signature_algorithm),
    not_before: val(c.not_before),
    not_after: val(c.not_after),
    days_to_expiry: val(c.days_to_expiry),
    validity_status: val(c.validity_status),
    parse_status: c.parse_status,
    parse_error: val(c.parse_error),
    confidence: val(c.confidence),
    owning_process: val(c.owning_process),
  };
}

function tlsRow(runId, o) {
  return {
    run_id: runId,
    first_seen: val(o.timestamp),
    last_seen: val(o.last_seen),
    source_ip: val(o.source_ip),
    source_port: val(o.source_port),
    destination_ip: val(o.destination_ip),
    destination_port: val(o.destination_port),
    direction: val(o.direction),
    transport: val(o.transport),
    handshake_outcome: val(o.handshake_outcome),
    sni: val(o.sni),
    tls_version: val(o.tls_version),
    cipher_suite: val(o.cipher_suite),
    peer_cert_sha256: val(o.peer_cert_sha256),
    peer_cert_subject: val(o.peer_cert_subject),
    peer_cert_issuer: val(o.peer_cert_issuer),
    peer_cert_not_after: val(o.peer_cert_not_after),
    process: val(o.process),
    pid: val(o.pid),
    event_count: o.event_count ?? 0,
  };
}

// Builds "INSERT INTO table (a, b) VALUES (@a, @b)" from a sample row's keys.
function insertStatement(table, sampleRow) {
  const cols = Object.keys(sampleRow);
  return db.prepare(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})`,
  );
}
const insertCertificate = insertStatement('certificates', certificateRow(0, {}));
const insertTls = insertStatement('tls_observations', tlsRow(0, {}));
const insertRelationship = db.prepare(
  `INSERT INTO relationships (run_id, from_type, from_id, edge, to_type, to_id, count)
   VALUES (@run_id, @from_type, @from_id, @edge, @to_type, @to_id, @count)`,
);

// Saves all rows of a report and closes the run, in one transaction:
// either everything is stored or nothing is.
export const saveReport = db.transaction((id, report, log, extraErrors = []) => {
  const certs = report.certificates ?? [];
  const tls = report.tls_observations ?? [];
  for (const c of certs) insertCertificate.run(certificateRow(id, c));
  for (const o of tls) insertTls.run(tlsRow(id, o));
  for (const r of report.relationships ?? []) {
    insertRelationship.run({
      run_id: id,
      from_type: r.from_type,
      from_id: r.from_id,
      edge: r.edge,
      to_type: r.to_type,
      to_id: r.to_id,
      count: r.count ?? 1,
    });
  }

  const errors = [...extraErrors, ...report.errors];
  let status = report.status;
  if (extraErrors.length && status === 'completed') status = 'partial';

  db.prepare(
    `UPDATE runs SET status = ?, ended_at = ?, duration_ms = ?, host = ?, record_count = ?,
       counts = ?, error_count = ?, errors = ?, log = ? WHERE id = ?`,
  ).run(
    status,
    now(),
    elapsedMs(id),
    val(report.host),
    certs.length + tls.length,
    JSON.stringify(report.counts ?? {}),
    (report.error_count ?? report.errors.length) + extraErrors.length,
    JSON.stringify(errors),
    log,
    id,
  );
});

// ---------- report rows ----------

export function getCertificates(runId) {
  return db
    .prepare(`SELECT * FROM certificates WHERE run_id = ? ORDER BY id`)
    .all(runId)
    .map((r) => ({ ...r, duplicate: r.duplicate === 1, san: JSON.parse(r.san) }));
}

export function getTlsObservations(runId) {
  return db.prepare(`SELECT * FROM tls_observations WHERE run_id = ? ORDER BY id`).all(runId);
}

export function getRelationships(runId) {
  return db
    .prepare(
      `SELECT from_type, from_id, edge, to_type, to_id, count
       FROM relationships WHERE run_id = ? ORDER BY id`,
    )
    .all(runId);
}

// ---------- schedules ----------

function decodeSchedule(row) {
  return row && { ...row, enabled: row.enabled === 1, params: JSON.parse(row.params) };
}

export function getSchedules() {
  return db.prepare(`SELECT * FROM schedules ORDER BY type`).all().map(decodeSchedule);
}

export function getSchedule(type) {
  return decodeSchedule(db.prepare(`SELECT * FROM schedules WHERE type = ?`).get(type));
}

// Turning a schedule on (or changing its interval) sets the next run one
// interval from now; turning it off clears it.
export function updateSchedule(type, { enabled, interval_minutes, params }) {
  const next = enabled ? new Date(Date.now() + interval_minutes * 60_000).toISOString() : null;
  db.prepare(
    `UPDATE schedules SET enabled = ?, interval_minutes = ?, params = ?, next_run_at = ?, updated_at = ?
     WHERE type = ?`,
  ).run(enabled ? 1 : 0, interval_minutes, JSON.stringify(params), next, now(), type);
  return getSchedule(type);
}

export function markScheduleStarted(type, lastRunAt, nextRunAt) {
  db.prepare(`UPDATE schedules SET last_run_at = ?, next_run_at = ? WHERE type = ?`).run(
    lastRunAt,
    nextRunAt,
    type,
  );
}
