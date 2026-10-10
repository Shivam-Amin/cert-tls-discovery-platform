// Checks input from the UI before anything is stored or run.
// Each function returns { value } when valid or { error: "message" }.
import { DEFAULT_PARAMS, LIMITS, SCAN_TYPES } from './config.js';

export function checkType(type) {
  return SCAN_TYPES.includes(type)
    ? { value: type }
    : { error: `type must be one of: ${SCAN_TYPES.join(', ')}` };
}

// filesystem: { roots: ["/etc/ssl", ...] }   (empty = agent's default folders)
// tls:        { duration_seconds: 30 }
export function checkParams(type, params = {}) {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return { error: 'params must be an object' };
  }
  return type === 'filesystem' ? checkFilesystemParams(params) : checkTlsParams(params);
}

function checkFilesystemParams({ roots = DEFAULT_PARAMS.filesystem.roots }) {
  // Accept a list, or one comma-separated string from a text box.
  const list = typeof roots === 'string' ? roots.split(',') : roots;
  if (!Array.isArray(list) || list.some((r) => typeof r !== 'string')) {
    return { error: 'roots must be a list of folder paths' };
  }
  const cleaned = [...new Set(list.map((r) => r.trim()).filter(Boolean))];
  if (cleaned.length > LIMITS.maxRoots) {
    return { error: `at most ${LIMITS.maxRoots} folders` };
  }
  for (const root of cleaned) {
    if (!root.startsWith('/')) return { error: `"${root}" must be an absolute path (start with /)` };
    if (root.includes(',')) return { error: `"${root}" must not contain a comma` };
  }
  return { value: { roots: cleaned } };
}

function checkTlsParams({ duration_seconds = DEFAULT_PARAMS.tls.duration_seconds }) {
  const seconds = Number(duration_seconds);
  const { minDurationSeconds: min, maxDurationSeconds: max } = LIMITS;
  if (!Number.isInteger(seconds) || seconds < min || seconds > max) {
    return { error: `duration_seconds must be a whole number from ${min} to ${max}` };
  }
  return { value: { duration_seconds: seconds } };
}

// Body of PUT /api/schedules/:type. Missing fields keep their current value.
export function checkSchedule(type, body, current) {
  const enabled = body.enabled ?? current.enabled;
  if (typeof enabled !== 'boolean') return { error: 'enabled must be true or false' };

  const interval = Number(body.interval_minutes ?? current.interval_minutes);
  const { minIntervalMinutes: min, maxIntervalMinutes: max } = LIMITS;
  if (!Number.isInteger(interval) || interval < min || interval > max) {
    return { error: `interval_minutes must be a whole number from ${min} to ${max}` };
  }

  const params = checkParams(type, body.params ?? current.params);
  if (params.error) return params;

  return { value: { enabled, interval_minutes: interval, params: params.value } };
}
