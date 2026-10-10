// Small display helpers shared by all pages.

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

export function formatNumber(n) {
  return n == null ? '—' : n.toLocaleString();
}

export function shortHash(hash, length = 12) {
  return hash ? `${hash.slice(0, length)}…` : '—';
}

// "1.2.3.4:443" or "[2606:4700::1]:443"
export function endpoint(ip, port) {
  if (!ip) return '—';
  return ip.includes(':') ? `[${ip}]:${port}` : `${ip}:${port}`;
}

// Counts rows per key: [{ name, value }] sorted by value, largest first.
export function countBy(rows, keyFn, limit = Infinity) {
  const counts = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (key == null || key === '') continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

// "CN=example.com,O=Example" -> "example.com" (falls back to the full name)
export function commonName(dn) {
  if (!dn) return '—';
  const match = /(?:^|,)CN=([^,]+)/.exec(dn);
  return match ? match[1] : dn;
}
