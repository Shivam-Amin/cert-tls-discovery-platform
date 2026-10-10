// Discovery Runs history table. Clicking a row opens that run's report.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import DataTable from './DataTable.jsx';
import { StatusBadge } from './ui.jsx';
import { formatDateTime, formatDuration, formatNumber } from '../format.js';

const columns = [
  { key: 'id', label: 'Run ID', render: (r) => `#${r.id}` },
  { key: 'type', label: 'Type', render: (r) => (r.type === 'tls' ? 'TLS metadata' : 'Filesystem') },
  { key: 'triggered_by', label: 'Trigger', render: (r) => <span className="tag">{r.triggered_by}</span> },
  { key: 'started_at', label: 'Start', className: 'nowrap', render: (r) => formatDateTime(r.started_at ?? r.queued_at) },
  { key: 'ended_at', label: 'End', className: 'nowrap', render: (r) => formatDateTime(r.ended_at) },
  { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  { key: 'duration_ms', label: 'Duration', className: 'nowrap', render: (r) => formatDuration(r.duration_ms) },
  { key: 'record_count', label: 'Records', render: (r) => formatNumber(r.record_count) },
  {
    key: 'errors',
    label: 'Errors',
    render: (r) =>
      r.error_count === 0 ? (
        <span className="muted">0</span>
      ) : (
        <span title={r.errors.join('\n')}>
          {r.error_count} · <span className="muted small">{truncate(r.errors[0], 60)}</span>
        </span>
      ),
  },
];

function truncate(text = '', n) {
  return text.length > n ? `${text.slice(0, n)}…` : text;
}

export default function RunsTable({ runs }) {
  const navigate = useNavigate();
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');

  const rows = runs.filter((r) => (!type || r.type === type) && (!status || r.status === status));

  return (
    <div className="card">
      <div className="card-title">
        <h2>Discovery runs</h2>
        <span className="spacer" />
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
          <option value="">All types</option>
          <option value="filesystem">Filesystem</option>
          <option value="tls">TLS metadata</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {['queued', 'running', 'completed', 'partial', 'failed'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        pageSize={20}
        onRowClick={(r) => navigate(`/runs/${r.id}`)}
        emptyText={runs.length ? 'No runs match the filters' : 'No runs yet. Start a scan above.'}
      />
    </div>
  );
}
