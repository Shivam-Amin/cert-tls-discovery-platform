// All settings in one place. Each can be overridden with an environment variable.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  host: process.env.HOST || '127.0.0.1', // local only: the backend runs scans as root
  port: Number(process.env.PORT) || 8080,
  agentPath: process.env.AGENT_PATH || path.resolve(backendDir, '../agent/agent-linux'),
  dbPath: process.env.DB_PATH || path.resolve(backendDir, 'data/discovery.db'),
  frontendDist: path.resolve(backendDir, '../frontend/dist'),
};

export const SCAN_TYPES = ['filesystem', 'tls'];
export const TRIGGERS = ['manual', 'scheduled'];

// Allowed ranges for settings coming from the UI.
export const LIMITS = {
  minDurationSeconds: 5,
  maxDurationSeconds: 300,
  maxRoots: 20,
  minIntervalMinutes: 1,
  maxIntervalMinutes: 24 * 60,
};

// filesystem: empty roots = let the agent use its default certificate folders.
export const DEFAULT_PARAMS = {
  filesystem: { roots: [] },
  tls: { duration_seconds: 30 },
};

// How long a scan may take before the backend stops it.
export const FILESYSTEM_TIMEOUT_MS = 10 * 60 * 1000;
export const TLS_TIMEOUT_GRACE_MS = 30 * 1000; // added to the capture duration

// How often the scheduler checks whether a scheduled scan is due.
export const SCHEDULER_TICK_MS = 15 * 1000;
