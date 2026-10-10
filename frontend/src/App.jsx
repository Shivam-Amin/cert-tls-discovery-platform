import { Link, Route, Routes } from 'react-router';
import { api } from './api.js';
import { usePolling } from './usePolling.js';
import RunsPage from './pages/RunsPage.jsx';
import RunPage from './pages/RunPage.jsx';
import { Empty } from './components/ui.jsx';

export default function App() {
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand" title="Back to Discovery Runs">
          Cert &amp; TLS Discovery
        </Link>
        <span className="spacer" />
        <HealthStatus />
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<RunsPage />} />
          <Route path="/runs/:id" element={<RunPage />} />
          <Route path="*" element={<Empty>Page not found. <Link to="/">Back to Discovery Runs</Link></Empty>} />
        </Routes>
      </main>
    </>
  );
}

// Top-right indicator: is the backend up, is the agent there, can it capture?
function HealthStatus() {
  const { data, error } = usePolling(api.health, [], 15000);
  let color = 'var(--status-completed)';
  let text = 'Backend connected';
  if (error) {
    color = 'var(--status-failed)';
    text = 'Backend unreachable';
  } else if (!data) {
    return null;
  } else if (!data.agent_found) {
    color = 'var(--status-failed)';
    text = 'Agent binary not found';
  } else if (!data.running_as_root) {
    color = 'var(--status-partial)';
    text = 'Backend not root: TLS scans will fail';
  }
  return (
    <span className="health">
      <i style={{ background: color }} />
      {text}
    </span>
  );
}
