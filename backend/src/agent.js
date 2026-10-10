// Starts the agent binary and collects its output.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { config } from './config.js';

// Settings → agent arguments. Arguments are passed as a list (no shell),
// so nothing typed in the UI can become an extra shell command.
export function buildArgs(type, params) {
  if (type === 'filesystem') {
    const args = ['filesystem'];
    if (params.roots.length > 0) {
      args.push('--roots', params.roots.join(','));
      // Missing (schedules saved before this option existed) counts as true.
      if (params.include_defaults !== false) args.push('--include-defaults');
    }
    return args;
  }
  return ['tls', '--duration', `${params.duration_seconds}s`];
}

// Human-readable command stored with each run.
export function commandText(args) {
  return [path.basename(config.agentPath), ...args].join(' ');
}

// Runs the agent and resolves (never rejects) with what happened:
//   { exitCode, stdout, stderr, timedOut, startError }
// On timeout the agent gets SIGTERM; the TLS scan then still prints a partial report.
export function runAgent(args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(
      config.agentPath,
      args,
      { timeout: timeoutMs, killSignal: 'SIGTERM', maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          exitCode: err ? (typeof err.code === 'number' ? err.code : null) : 0,
          stdout,
          stderr,
          timedOut: Boolean(err?.killed),
          // e.g. ENOENT: the binary is missing or not executable
          startError: err && typeof err.code === 'string' ? err.message : null,
        });
      },
    );
  });
}

// Checks the agent's JSON has the shape we store. Returns a list of problems.
export function checkReport(report, type) {
  if (!report || typeof report !== 'object') return ['report is not a JSON object'];
  const problems = [];
  if (report.type !== type) problems.push(`report type is "${report.type}", expected "${type}"`);
  if (!['completed', 'partial', 'failed'].includes(report.status)) {
    problems.push(`unknown status "${report.status}"`);
  }
  if (!Array.isArray(report.errors)) problems.push('errors is not a list');
  if (!Array.isArray(report.relationships)) problems.push('relationships is not a list');
  const rows = type === 'filesystem' ? report.certificates : report.tls_observations;
  if (rows !== undefined && !Array.isArray(rows)) problems.push('findings are not a list');
  return problems;
}
