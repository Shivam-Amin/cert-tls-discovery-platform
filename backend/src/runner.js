// The run queue: scans run one at a time, in the order they were requested.
//
//   startRun()  → run row created as "queued", returned to the caller at once
//   worker      → "running" → agent → save report → completed / partial / failed
import * as store from './db.js';
import { buildArgs, checkReport, commandText, runAgent } from './agent.js';
import { FILESYSTEM_TIMEOUT_MS, TLS_TIMEOUT_GRACE_MS } from './config.js';

const queue = []; // runs waiting for their turn
let working = false;

// params must already be validated.
export function startRun(type, triggeredBy, params) {
  const args = buildArgs(type, params);
  const id = store.createRun({ type, triggeredBy, params, command: commandText(args) });
  queue.push({ id, type, params, args });
  console.log(`run #${id} queued: ${type} (${triggeredBy})`);
  processQueue(); // not awaited: the HTTP request returns immediately
  return store.getRun(id);
}

async function processQueue() {
  if (working) return; // the loop already running will pick up the new run
  working = true;
  while (queue.length > 0) {
    const job = queue.shift();
    try {
      await execute(job);
    } catch (err) {
      // Never let one bad run stop the queue.
      console.error(`run #${job.id} crashed:`, err);
      store.failRun(job.id, `internal error: ${err.message}`);
    }
  }
  working = false;
}

async function execute({ id, type, params, args }) {
  store.markRunning(id);
  console.log(`run #${id} running: ${commandText(args)}`);

  const timeoutMs =
    type === 'tls' ? params.duration_seconds * 1000 + TLS_TIMEOUT_GRACE_MS : FILESYSTEM_TIMEOUT_MS;
  const result = await runAgent(args, timeoutMs);
  const timeoutNote = `stopped after timeout of ${Math.round(timeoutMs / 1000)} s`;

  if (result.startError) {
    return fail(id, `could not start agent: ${result.startError}`, result.stderr);
  }
  if (result.exitCode === 2) {
    // Agent rejected its arguments: the reason is the last stderr line.
    return fail(id, `agent rejected the command: ${lastLine(result.stderr)}`, result.stderr);
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    const why = result.timedOut ? timeoutNote : `exit code ${result.exitCode}`;
    return fail(id, `agent did not return a JSON report (${why}): ${lastLine(result.stderr)}`, result.stderr);
  }

  const problems = checkReport(report, type);
  if (problems.length > 0) {
    return fail(id, `invalid agent report: ${problems.join('; ')}`, result.stderr);
  }

  store.saveReport(id, report, result.stderr, result.timedOut ? [timeoutNote] : []);
  const saved = store.getRun(id);
  console.log(`run #${id} ${saved.status}: ${saved.record_count} records, ${saved.error_count} errors`);
}

function fail(id, message, log) {
  console.log(`run #${id} failed: ${message}`);
  store.failRun(id, message, log);
}

function lastLine(text = '') {
  const lines = text.trim().split('\n');
  return lines[lines.length - 1] || 'no output';
}
