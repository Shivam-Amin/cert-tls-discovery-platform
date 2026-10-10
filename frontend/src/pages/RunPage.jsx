// /runs/:id: run header + state banners, then the report for that run type.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api.js';
import { usePolling } from '../usePolling.js';
import { Banner, ErrorState, Loading, StatusBadge } from '../components/ui.jsx';
import { formatDateTime, formatDuration, formatNumber } from '../format.js';
import FilesystemReport from './FilesystemReport.jsx';
import TlsReport from './TlsReport.jsx';

const isActive = (run) => run.status === 'queued' || run.status === 'running';

export default function RunPage() {
  const { id } = useParams();
  const [poll, setPoll] = useState(true);
  const { data: run, error, loading, reload } = usePolling(() => api.run(id), [id], poll ? 2000 : 0);

  // Poll only while the run is still queued/running.
  useEffect(() => {
    if (run) setPoll(isActive(run));
  }, [run]);

  if (loading) return <Loading rows={4} />;
  if (!run) return <ErrorState error={error} onRetry={reload} />;

  const title = run.type === 'tls' ? 'TLS Metadata Scan Report' : 'File System Scan Report';
  return (
    <>
      <div className="page-header">
        <Link to="/">← Discovery Runs</Link>
      </div>
      <div className="page-header">
        <h1>
          {title} <span className="muted">· Run #{run.id}</span>
        </h1>
        <StatusBadge status={run.status} />
      </div>

      <StateBanner run={run} />
      <RunDetails run={run} />

      {/* key: reload the report rows once the run finishes */}
      {!isActive(run) &&
        run.status !== 'failed' &&
        (run.type === 'tls' ? (
          <TlsReport key={run.status} run={run} />
        ) : (
          <FilesystemReport key={run.status} run={run} />
        ))}
    </>
  );
}

function RunDetails({ run }) {
  const settings =
    run.type === 'tls'
      ? `${run.params.duration_seconds} s capture`
      : !run.params.roots?.length
        ? 'common certificate folders'
        : run.params.include_defaults !== false
          ? `${run.params.roots.join(', ')} + common folders`
          : run.params.roots.join(', ');
  const fields = [
    ['Type', run.type === 'tls' ? 'TLS metadata' : 'Filesystem'],
    ['Trigger', run.triggered_by],
    ['Queued', formatDateTime(run.queued_at)],
    ['Started', formatDateTime(run.started_at)],
    ['Ended', formatDateTime(run.ended_at)],
    ['Duration', formatDuration(run.duration_ms)],
    ['Records', formatNumber(run.record_count)],
    ['Errors', formatNumber(run.error_count)],
    ['Settings', settings],
    ['Host', run.host ?? '—'],
  ];
  return (
    <div className="card">
      <div className="details-grid">
        {fields.map(([label, value]) => (
          <div key={label}>
            <div className="label">{label}</div>
            <div>{value}</div>
          </div>
        ))}
      </div>
      <div className="small muted" style={{ marginTop: 12 }}>
        Evidence collected by the agent on this machine with <code>{run.command}</code>
      </div>
      {run.log && (
        <details style={{ marginTop: 10 }} open={run.status === 'failed'}>
          <summary className="small">Agent log</summary>
          <pre className="log">{run.log}</pre>
        </details>
      )}
    </div>
  );
}

function StateBanner({ run }) {
  if (run.status === 'queued') {
    return <Banner tone="info" title="Queued">Waiting for the scan before it to finish. This page updates automatically.</Banner>;
  }
  if (run.status === 'running') {
    return (
      <Banner tone="info" title="Scan running…">
        {run.type === 'tls' ? <CaptureProgress run={run} /> : 'Walking the configured folders.'}
      </Banner>
    );
  }
  if (run.status === 'failed') {
    return (
      <Banner tone="error" title="Scan failed">
        <ErrorList run={run} />
      </Banner>
    );
  }
  if (run.status === 'partial') {
    return (
      <Banner tone="warn" title="Partial results">
        Results below are real but incomplete because of these errors:
        <ErrorList run={run} />
      </Banner>
    );
  }
  return null;
}

function ErrorList({ run }) {
  return (
    <ul>
      {run.errors.map((e, i) => (
        <li key={i} className="small">
          {e}
        </li>
      ))}
      {run.error_count > run.errors.length && (
        <li className="small muted">{run.error_count} errors in total (full list in the agent log)</li>
      )}
    </ul>
  );
}

// Countdown bar for a TLS capture, from started_at and the configured duration.
function CaptureProgress({ run }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const total = run.params.duration_seconds * 1000;
  const elapsed = Math.min(total, now - Date.parse(run.started_at));
  const left = Math.max(0, Math.ceil((total - elapsed) / 1000));
  return (
    <>
      Capturing TLS handshakes… {left > 0 ? `${left} s left` : 'finishing'}
      <div className="progress">
        <div style={{ width: `${(elapsed / total) * 100}%` }} />
      </div>
    </>
  );
}
