// View 1: Discovery Runs. Latest summary, scan buttons, schedules, charts, run history.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { usePolling } from '../usePolling.js';
import LatestSummary from '../components/LatestSummary.jsx';
import ScanPanel from '../components/ScanPanel.jsx';
import SchedulePanel from '../components/SchedulePanel.jsx';
import RunsCharts from '../components/RunsCharts.jsx';
import RunsTable from '../components/RunsTable.jsx';
import { Banner, ErrorState, Loading } from '../components/ui.jsx';

async function loadAll() {
  const [runs, summary, schedules] = await Promise.all([api.runs(), api.summary(), api.schedules()]);
  return { runs, summary, schedules };
}

export default function RunsPage() {
  // Refresh every 2 s while a scan is queued/running, otherwise every 10 s
  // (so scheduled runs also show up without reloading).
  const [fast, setFast] = useState(false);
  const { data, error, loading, reload } = usePolling(loadAll, [], fast ? 2000 : 10000);
  const active = data?.summary.active.length ?? 0;
  useEffect(() => setFast(active > 0), [active]);

  if (loading) return <Loading rows={4} />;
  if (!data) return <ErrorState error={error} onRetry={reload} />;

  return (
    <>
      <div className="page-header">
        <h1>Discovery Runs</h1>
        <span className="spacer" />
        <span className="muted small">
          {data.summary.total_runs} runs · results from the agent on this machine
        </span>
      </div>

      {error && <Banner tone="error" title="Lost connection to the backend">{error.message}</Banner>}
      {active > 0 && (
        <Banner tone="info">
          {active} scan{active > 1 ? 's' : ''} in progress. This page updates automatically.
        </Banner>
      )}

      <LatestSummary summary={data.summary} />
      <ScanPanel onStarted={reload} />
      <SchedulePanel schedules={data.schedules} onSaved={reload} />
      <RunsCharts runs={data.runs} />
      <RunsTable runs={data.runs} />
    </>
  );
}
