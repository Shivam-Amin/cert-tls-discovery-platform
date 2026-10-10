// Charts for the Discovery Runs view: runs by type and status, and trends.
import { useMemo } from 'react';
import { StackedChart, TrendChart } from './Charts.jsx';
import { chartPalette, statusColor } from '../theme.js';

const STATUSES = ['completed', 'partial', 'failed', 'running', 'queued'];
const TREND_RUNS = 30; // last N runs in the trend charts

export default function RunsCharts({ runs }) {
  const byTypeStatus = useMemo(
    () =>
      ['filesystem', 'tls'].map((type) => {
        const row = { name: type };
        for (const status of STATUSES) {
          row[status] = runs.filter((r) => r.type === type && r.status === status).length;
        }
        return row;
      }),
    [runs],
  );

  // Oldest → newest; each point is one finished run.
  const trend = useMemo(
    () =>
      runs
        .filter((r) => r.ended_at)
        .slice(0, TREND_RUNS)
        .reverse()
        .map((r) => ({
          name: `#${r.id}`,
          [`${r.type}_records`]: r.record_count,
          [`${r.type}_seconds`]: Math.round((r.duration_ms ?? 0) / 100) / 10,
        })),
    [runs],
  );

  const [blue, green] = chartPalette();
  return (
    <div className="grid-3">
      <StackedChart
        title="Runs by type and status"
        data={runs.length ? byTypeStatus : []}
        series={STATUSES.map((s) => ({ key: s, label: s, color: statusColor(s) }))}
      />
      <TrendChart
        title="Findings per run"
        subtitle="Certificates (filesystem) or connections (TLS)"
        data={trend}
        series={[
          { key: 'filesystem_records', label: 'filesystem', color: blue },
          { key: 'tls_records', label: 'tls', color: green },
        ]}
      />
      <TrendChart
        title="Duration per run"
        subtitle="Seconds"
        data={trend}
        series={[
          { key: 'filesystem_seconds', label: 'filesystem', color: blue },
          { key: 'tls_seconds', label: 'tls', color: green },
        ]}
      />
    </div>
  );
}
