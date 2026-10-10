// "Latest summary" cards at the top of the home page.
import { Link } from 'react-router';
import { StatusBadge } from './ui.jsx';
import { formatDateTime, formatNumber } from '../format.js';

export default function LatestSummary({ summary }) {
  const fs = summary.latest.filesystem;
  const tls = summary.latest.tls;
  return (
    <div className="grid-2">
      <LatestCard
        title="Latest filesystem scan"
        run={fs}
        stats={
          fs && [
            ['Certificates', fs.counts.certificates_found],
            ['Unique', fs.counts.unique_certificates],
            ['Expiring', fs.counts.expiring],
            ['Expired', fs.counts.expired],
            ['Parse failed', fs.counts.parse_failed],
          ]
        }
      />
      <LatestCard
        title="Latest TLS metadata scan"
        run={tls}
        stats={
          tls && [
            ['Connections', tls.counts.connections],
            ['Endpoints', tls.counts.unique_endpoints],
            ['TLS records', tls.counts.tls_records],
            ['Certificates', tls.counts.certificates_seen],
            ['Relationships', tls.counts.relationships],
          ]
        }
      />
    </div>
  );
}

function LatestCard({ title, run, stats }) {
  return (
    <div className="card">
      <div className="card-title">
        <h2>{title}</h2>
        <span className="spacer" />
        {run && <StatusBadge status={run.status} />}
      </div>
      {!run ? (
        <div className="muted">No finished scan yet. Start one below.</div>
      ) : (
        <>
          <div className="row" style={{ gap: 24 }}>
            {stats.map(([label, value]) => (
              <div key={label}>
                <div className="muted small">{label}</div>
                <div style={{ fontSize: 23, fontWeight: 650 }}>{formatNumber(value ?? 0)}</div>
              </div>
            ))}
          </div>
          <div className="row muted small" style={{ marginTop: 10 }}>
            Run #{run.id} · {run.triggered_by} · {formatDateTime(run.ended_at)}
            <span className="spacer" />
            <Link to={`/runs/${run.id}`}>Open report →</Link>
          </div>
        </>
      )}
    </div>
  );
}
