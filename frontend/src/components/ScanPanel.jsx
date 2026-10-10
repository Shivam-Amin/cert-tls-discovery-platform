// The two manual scan buttons with their settings.
import { useState } from 'react';
import { api } from '../api.js';

export function parseFolders(text) {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function ScanPanel({ onStarted }) {
  const [folders, setFolders] = useState('');
  const [includeDefaults, setIncludeDefaults] = useState(true);
  const [duration, setDuration] = useState(30);
  const [busy, setBusy] = useState(null); // which scan is being requested
  const [result, setResult] = useState(null); // { ok, text }

  async function start(type) {
    setBusy(type);
    setResult(null);
    try {
      const params =
        type === 'filesystem'
          ? { roots: parseFolders(folders), include_defaults: includeDefaults }
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

  const scansRoot = parseFolders(folders).includes('/');

  return (
    <div className="grid-2">
      <div className="card">
        <h2>Run filesystem scan</h2>
        <div className="field">
          <label htmlFor="folders">Extra folders to scan</label>
          <input
            id="folders"
            type="text"
            value={folders}
            placeholder="e.g. /opt/app/certs, /home/me/certs"
            onChange={(e) => setFolders(e.target.value)}
          />
          <div className="help">Comma-separated absolute paths. Empty = only the common certificate folders.</div>
          {scansRoot && <div className="help">Scanning “/” walks the whole disk and can take minutes.</div>}
        </div>
        <div className="field">
          <IncludeDefaults checked={includeDefaults} onChange={setIncludeDefaults} disabled={!folders.trim()} />
        </div>
        <button className="primary" disabled={busy !== null} onClick={() => start('filesystem')}>
          {busy === 'filesystem' ? 'Starting…' : 'Run filesystem scan'}
        </button>
      </div>

      <div className="card">
        <h2>Run TLS metadata scan</h2>
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
        <button className="primary" disabled={busy !== null} onClick={() => start('tls')}>
          {busy === 'tls' ? 'Starting…' : 'Run TLS metadata scan'}
        </button>
      </div>

      {result && (
        <div className={result.ok ? 'form-ok' : 'form-error'} style={{ gridColumn: '1 / -1', marginTop: -8 }}>
          {result.text}
        </div>
      )}
    </div>
  );
}

// The agent decides which folders are "common"; the UI only says yes/no.
export function IncludeDefaults({ checked, onChange, disabled }) {
  return (
    <label className="checkbox" title={disabled ? 'Always on when no extra folders are given' : undefined}>
      <input
        type="checkbox"
        checked={disabled || checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      Also scan the common certificate folders (chosen by the agent)
    </label>
  );
}
