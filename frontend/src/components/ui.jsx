// Small building blocks used on every page.

export function StatusBadge({ status }) {
  const label = (status ?? 'unknown').replaceAll('_', ' ');
  const active = status === 'running' || status === 'queued';
  return (
    <span className={`badge badge-${status}`}>
      {active && <span className="spinner" />}
      {label}
    </span>
  );
}

// items: [{ label, value, hint?, tone?: 'good' | 'warn' | 'bad' }]
export function Metrics({ items }) {
  return (
    <div className="metrics">
      {items.map((m) => (
        <div key={m.label} className={`metric ${m.tone ? `tone-${m.tone}` : ''}`} title={m.hint}>
          <div className="label">{m.label}</div>
          <div className="value">{m.value ?? '—'}</div>
          {m.hint && <div className="hint">{m.hint}</div>}
        </div>
      ))}
    </div>
  );
}

// tone: 'info' | 'warn' | 'error'
export function Banner({ tone = 'info', title, children }) {
  return (
    <div className={`banner banner-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {title && <h3>{title}</h3>}
      {children}
    </div>
  );
}

export function Loading({ rows = 2 }) {
  return (
    <div className="grid-2" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" />
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <Banner tone="error" title="Could not load data">
      <div>{error.message}</div>
      {onRetry && (
        <button className="small" style={{ marginTop: 8 }} onClick={onRetry}>
          Retry
        </button>
      )}
    </Banner>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}
