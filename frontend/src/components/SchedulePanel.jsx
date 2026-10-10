// Periodic scan settings: one row per scan type.
// The backend runs due scans on its own; this only edits the settings.
import { useState } from 'react';
import { api } from '../api.js';
import { formatDateTime } from '../format.js';
import { IncludeDefaults, parseFolders } from './ScanPanel.jsx';

export default function SchedulePanel({ schedules, onSaved }) {
  return (
    <div className="card">
      <div className="card-title">
        <h2>Scheduled scans</h2>
        <span className="muted small">Runs automatically while the backend is running (browser can be closed).</span>
      </div>
      <div className="grid-2">
        {schedules.map((s) => (
          // key: after a save the row resets to the saved values
          <ScheduleRow key={`${s.type}-${s.updated_at}`} schedule={s} onSaved={onSaved} />
        ))}
      </div>
    </div>
  );
}

function ScheduleRow({ schedule, onSaved }) {
  const [enabled, setEnabled] = useState(schedule.enabled);
  const [intervalMinutes, setIntervalMinutes] = useState(schedule.interval_minutes);
  const [folders, setFolders] = useState((schedule.params.roots ?? []).join(', '));
  const [includeDefaults, setIncludeDefaults] = useState(schedule.params.include_defaults !== false);
  const [duration, setDuration] = useState(schedule.params.duration_seconds ?? 30);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const isFs = schedule.type === 'filesystem';

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.saveSchedule(schedule.type, {
        enabled,
        interval_minutes: Number(intervalMinutes),
        params: isFs
          ? { roots: parseFolders(folders), include_defaults: includeDefaults }
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
    <div>
      <h3>{isFs ? 'Filesystem scan' : 'TLS metadata scan'}</h3>
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
              placeholder="Extra folders (optional), e.g. /opt/app/certs"
              onChange={(e) => setFolders(e.target.value)}
              aria-label="Extra folders to scan"
            />
            <div style={{ marginTop: 8 }}>
              <IncludeDefaults checked={includeDefaults} onChange={setIncludeDefaults} disabled={!folders.trim()} />
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
      <div className="row">
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
