// The two manual scan buttons with their settings.
import { useState } from 'react';
import { api } from '../api.js';

// Common Linux certificate locations
const DEFAULT_CERT_PATHS = [
  '/etc/ssl',
  '/usr/local/share/ca-certificates',
  '/etc/pki',
];

export function parseFolders(text) {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function ScanPanel({ onStarted }) {
  const [folders, setFolders] = useState('');
  const [selectedDefaults, setSelectedDefaults] = useState(new Set(DEFAULT_CERT_PATHS));
  const [duration, setDuration] = useState(30);
  const [busy, setBusy] = useState(null); // which scan is being requested
  const [result, setResult] = useState(null); // { ok, text }

  function toggleDefaultPath(path) {
    setSelectedDefaults((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  async function start(type) {
    setBusy(type);
    setResult(null);
    try {
      const params =
        type === 'filesystem'
          ? { roots: [...parseFolders(folders), ...selectedDefaults] }
          : { duration_seconds: Number(duration) };
      const run = await api.startRun(type, params);
      setResult({ ok: true, text: `Run #${run.id} ${run.status}` });
      onStarted?.(run);
    } catch (err) {
      setResult({ ok: false, text: err.message });
    } finally {
      setBusy(null);
    }
  }

  const scansRoot = parseFolders(folders).includes('/') || selectedDefaults.has('/');

  return (
    <section>
      <div className="section-header">
        <h2>Run a scan</h2>
        <span className="muted small">Starts now; the run appears in Discovery runs below.</span>
      </div>
      <div className="grid-2">
        <div className="card form-col">
          <h2>Filesystem scan</h2>
          <div className="field">
            <label htmlFor="folders">Additional folders to scan</label>
            <input
              id="folders"
              type="text"
              value={folders}
              placeholder="e.g. /opt/app/certs, /home/me/certs"
              onChange={(e) => setFolders(e.target.value)}
            />
            <div className="help">Comma-separated absolute paths.</div>
            {scansRoot && <div className="help">Scanning "/" walks the whole disk and can take minutes.</div>}
          </div>
          <div className="field">
            <label>Common certificate folders</label>
            {DEFAULT_CERT_PATHS.map((path) => (
              <label key={path} className="checkbox">
                <input
                  type="checkbox"
                  checked={selectedDefaults.has(path)}
                  onChange={() => toggleDefaultPath(path)}
                />
                {path}
              </label>
            ))}
          </div>
          <div className="actions">
            <button className="primary" disabled={busy !== null} onClick={() => start('filesystem')}>
              {busy === 'filesystem' ? 'Starting…' : 'Run filesystem scan'}
            </button>
          </div>
        </div>

        <div className="card form-col">
          <h2>TLS metadata scan</h2>
          <div className="field">
            <label htmlFor="duration">Capture duration (seconds)</label>
            <input
              id="duration"
              type="number"
              min={5}
              max={300}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
            <div className="help">
              Passively observes TLS handshakes on this machine (metadata only, no payloads). 5–300 s.
            </div>
          </div>
          <div className="actions">
            <button className="primary" disabled={busy !== null} onClick={() => start('tls')}>
              {busy === 'tls' ? 'Starting…' : 'Run TLS metadata scan'}
            </button>
          </div>
        </div>
      </div>
      {result &&<div className={result.ok ? 'form-ok' : 'form-error'}>{result.text}</div>}
    </section>
  );
}
