// Periodic scan settings: one card per scan type.
// The backend runs due scans on its own; this only edits the settings.
import { useState } from 'react';
import { api } from '../api.js';
import { formatDateTime } from '../format.js';
import { parseFolders } from './ScanPanel.jsx';

// Common Linux certificate locations (same as ScanPanel)
const DEFAULT_CERT_PATHS = [
  '/etc/ssl',
  '/usr/local/share/ca-certificates',
  '/etc/pki',
];

export default function SchedulePanel({ schedules, onSaved }) {
  return (
    <section>
      <div className="section-header">
        <h2>Scheduled scans</h2>
        <span className="muted small">Run automatically while the backend is running (the browser can be closed).</span>
      </div>
      <div className="grid-2">
        {schedules.map((s) => (
          // key: after a save the card resets to the saved values
          <ScheduleRow key={`${s.type}-${s.updated_at}`} schedule={s} onSaved={onSaved} />
        ))}
      </div>
    </section>
  );
}

function ScheduleRow({ schedule, onSaved }) {
  const [enabled, setEnabled] = useState(schedule.enabled);
  const [intervalMinutes, setIntervalMinutes] = useState(schedule.interval_minutes);
  
  // Parse roots into custom folders + default selections
  const initialRoots = schedule.params.roots ?? [];
  const initialCustom = initialRoots.filter(r => !DEFAULT_CERT_PATHS.includes(r));
  const initialDefaults = initialRoots.filter(r => DEFAULT_CERT_PATHS.includes(r));
  
  const [folders, setFolders] = useState(initialCustom.join(', '));
  const [selectedDefaults, setSelectedDefaults] = useState(new Set(initialDefaults));
  const [duration, setDuration] = useState(schedule.params.duration_seconds ?? 30);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const isFs = schedule.type === 'filesystem';

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

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.saveSchedule(schedule.type, {
        enabled,
        interval_minutes: Number(intervalMinutes),
        params: isFs
          ? { roots: [...parseFolders(folders), ...selectedDefaults] }
          : { duration_seconds: Number(duration) },
      });
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card form-col">
      <h2>{isFs ? 'Filesystem scan' : 'TLS metadata scan'}</h2>
      <div className="row field">
        <label className="checkbox">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
        <span>every</span>
        <input
          type="number"
          min={1}
          max={1440}
          value={intervalMinutes}
          onChange={(e) => setIntervalMinutes(e.target.value)}
          aria-label="Interval in minutes"
        />
        <span>minutes</span>
      </div>
      <div className="field">
        {isFs ? (
          <>
            <input
              type="text"
              value={folders}
              placeholder="Additional folders (optional), e.g. /opt/app/certs"
              onChange={(e) => setFolders(e.target.value)}
              aria-label="Additional folders to scan"
            />
            <div style={{ marginTop: 8 }}>
              <label className="small">Common certificate folders</label>
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
          </>
        ) : (
          <div className="row">
            <span>Capture</span>
            <input
              type="number"
              min={5}
              max={300}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              aria-label="Capture duration in seconds"
            />
            <span>seconds per run</span>
          </div>
        )}
      </div>
      <div className="row actions">
        <button className="small primary" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <span className="muted small">
          {schedule.enabled
            ? `Next run: ${formatDateTime(schedule.next_run_at)}`
            : 'Off'}
          {schedule.last_run_at && ` · Last: ${formatDateTime(schedule.last_run_at)}`}
        </span>
      </div>
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}
