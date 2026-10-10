// View 3: TLS Metadata Scan Report: connections, charts and relationship map for one run.
import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { usePolling } from '../usePolling.js';
import DataTable from '../components/DataTable.jsx';
import RelationshipMap from '../components/RelationshipMap.jsx';
import { BarListChart, ColumnChart, DonutChart } from '../components/Charts.jsx';
import { Banner, ErrorState, Loading, Metrics, StatusBadge } from '../components/ui.jsx';
import { commonName, countBy, endpoint, formatDate, formatNumber, shortHash } from '../format.js';

const EXPIRING_DAYS = 30;

async function loadTls(id) {
  const [connections, relationships] = await Promise.all([api.tls(id), api.relationships(id)]);
  return { connections, relationships };
}

export default function TlsReport({ run }) {
  const { data, error, loading, reload } = usePolling(() => loadTls(run.id), [run.id]);

  if (loading) return <Loading rows={4} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (data.connections.length === 0) {
    return (
      <Banner tone="info" title="No TLS connections observed">
        No TLS handshakes or records were seen during the {run.params.duration_seconds} s capture. Make some HTTPS
        requests while the scan runs (e.g. <code>curl https://example.com</code>) and scan again.
      </Banner>
    );
  }
  return <Report run={run} connections={data.connections} relationships={data.relationships} />;
}

// valid / expiring / expired for a peer certificate, at the time of the scan.
function peerCertStatus(o, at) {
  if (!o.peer_cert_not_after) return 'not_visible';
  const days = (Date.parse(o.peer_cert_not_after) - at) / 86_400_000;
  if (days < 0) return 'expired';
  return days <= EXPIRING_DAYS ? 'expiring' : 'valid';
}

// Groups connection start times into about 12 buckets across the capture.
function activityOverTime(connections, run) {
  if (connections.length === 0) return [];
  const start = Date.parse(run.started_at);
  const end = Math.max(Date.parse(run.ended_at), start + 1000);
  const size = Math.max(1000, Math.ceil((end - start) / 12 / 1000) * 1000);
  const buckets = [];
  for (let t = start; t < end; t += size) {
    buckets.push({ name: `+${Math.round((t - start) / 1000)}s`, value: 0 });
  }
  for (const o of connections) {
    const i = Math.floor((Date.parse(o.first_seen) - start) / size);
    buckets[Math.min(Math.max(i, 0), buckets.length - 1)].value += o.event_count;
  }
  return buckets;
}

function Report({ run, connections, relationships }) {
  const counts = run.counts;
  const scanTime = Date.parse(run.ended_at);

  const charts = useMemo(() => {
    const postureCounts = countBy(connections, (o) => peerCertStatus(o, scanTime));
    return {
      versions: countBy(connections, (o) => o.tls_version ?? 'not seen'),
      ciphers: countBy(connections, (o) => o.cipher_suite ?? 'not seen', 10),
      endpoints: countBy(
        connections,
        (o) => (o.sni ? `${o.sni} (${o.destination_port})` : endpoint(o.destination_ip, o.destination_port)),
        10,
      ),
      outcomes: countBy(connections, (o) => o.handshake_outcome).map((d) => ({ ...d, key: d.name })),
      activity: activityOverTime(connections, run),
      posture: postureCounts.map((d) => ({
        ...d,
        key: d.name === 'not_visible' ? 'unknown' : d.name,
        name: d.name === 'not_visible' ? 'not visible (TLS 1.3 / not captured)' : d.name,
      })),
    };
  }, [connections, run, scanTime]);

  // Show certificate subjects instead of hashes on the map where we know them.
  const certLabels = useMemo(() => {
    const labels = {};
    for (const o of connections) {
      if (o.peer_cert_sha256) labels[o.peer_cert_sha256] = commonName(o.peer_cert_subject);
    }
    return labels;
  }, [connections]);

  return (
    <>
      <Metrics
        items={[
          { label: 'TLS packets', value: formatNumber(counts.tls_packets), hint: 'TCP packets that carried TLS records' },
          { label: 'TLS records (events)', value: formatNumber(counts.tls_records), hint: 'sum of event count over all connections' },
          { label: 'Connections', value: formatNumber(counts.connections), hint: 'one row per TCP connection' },
          { label: 'Unique endpoints', value: formatNumber(counts.unique_endpoints), hint: 'distinct server IP:port' },
          { label: 'Unique ports', value: formatNumber(counts.unique_ports), hint: 'distinct server ports' },
          { label: 'Certificates observed', value: formatNumber(counts.certificates_seen), hint: 'distinct peer certificate fingerprints' },
          { label: 'Process mapped', value: formatNumber(counts.process_mapped), hint: 'connections linked to a PID' },
          { label: 'Relationships', value: formatNumber(counts.relationships), hint: 'edges in the relationship map' },
        ]}
      />

      <div className="grid-3">
        <DonutChart title="TLS versions" subtitle="Connections" data={charts.versions} />
        <DonutChart title="Handshake outcome" subtitle="Connections" data={charts.outcomes} byStatus />
        <DonutChart title="Peer certificate posture" subtitle="Connections" data={charts.posture} byStatus />
      </div>
      <div className="grid-2">
        <BarListChart title="Cipher suites" subtitle="Top 10, connections" data={charts.ciphers} colorIndex={3} labelWidth={340} />
        <BarListChart title="Top endpoints" subtitle="Top 10 by connections (SNI when visible)" data={charts.endpoints} colorIndex={5} labelWidth={220} />
      </div>
      <ColumnChart
        title="Activity over time"
        subtitle="TLS records seen, by connection start, from the beginning of the capture"
        data={charts.activity}
        colorIndex={0}
        valueName="TLS records"
      />

      <div className="card">
        <h2>Relationship map</h2>
        <RelationshipMap edges={relationships} certLabels={certLabels} />
      </div>

      <ConnectionTable connections={connections} scanTime={scanTime} />
    </>
  );
}

function ConnectionTable({ connections, scanTime }) {
  const [search, setSearch] = useState('');
  const [version, setVersion] = useState('');
  const [direction, setDirection] = useState('');
  const [outcome, setOutcome] = useState('');

  const options = (key) => [...new Set(connections.map((o) => o[key]).filter(Boolean))].sort();

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return connections.filter(
      (o) =>
        (!version || o.tls_version === version) &&
        (!direction || o.direction === direction) &&
        (!outcome || o.handshake_outcome === outcome) &&
        (!q ||
          [o.source_ip, o.destination_ip, o.sni, o.process, o.cipher_suite, o.peer_cert_subject, String(o.destination_port)].some(
            (v) => v?.toLowerCase().includes(q),
          )),
    );
  }, [connections, search, version, direction, outcome]);

  const columns = [
    { key: 'first_seen', label: 'First seen', className: 'nowrap', render: (o) => new Date(o.first_seen).toLocaleTimeString() },
    { key: 'client', label: 'Client', className: 'mono nowrap', render: (o) => endpoint(o.source_ip, o.source_port) },
    {
      key: 'server',
      label: 'Server',
      render: (o) => (
        <>
          <span className="mono">{endpoint(o.destination_ip, o.destination_port)}</span>
          {o.sni && <div className="small">{o.sni}</div>}
        </>
      ),
    },
    { key: 'direction', label: 'Direction', render: (o) => <span className="tag">{o.direction}</span> },
    {
      key: 'process',
      label: 'Process',
      render: (o) =>
        o.pid ? (
          <>
            {o.process} <span className="muted small">pid {o.pid}</span>
          </>
        ) : (
          <span className="muted">unavailable</span>
        ),
    },
    {
      key: 'protocol',
      label: 'Protocol / cipher',
      render: (o) => (
        <>
          {o.tls_version ?? '—'}
          <div className="muted small">{o.cipher_suite ?? 'cipher not seen'}</div>
        </>
      ),
    },
    { key: 'outcome', label: 'Outcome', render: (o) => <StatusBadge status={o.handshake_outcome} /> },
    {
      key: 'peer',
      label: 'Peer certificate',
      render: (o) =>
        o.peer_cert_sha256 ? (
          <span title={`${o.peer_cert_subject}\nissuer: ${o.peer_cert_issuer}\nSHA-256: ${o.peer_cert_sha256}`}>
            {commonName(o.peer_cert_subject)} <StatusBadge status={peerCertStatus(o, scanTime)} />
            <div className="muted small">
              until {formatDate(o.peer_cert_not_after)} · <span className="mono">{shortHash(o.peer_cert_sha256, 10)}</span>
            </div>
          </span>
        ) : (
          <span className="muted small">{o.tls_version === 'TLS 1.3' ? 'encrypted (TLS 1.3)' : 'not captured'}</span>
        ),
    },
    { key: 'event_count', label: 'Events', render: (o) => formatNumber(o.event_count) },
  ];

  return (
    <div className="card">
      <div className="card-title">
        <h2>TLS observations</h2>
        <span className="muted small">
          {rows.length} of {connections.length} connections
        </span>
      </div>
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search IP, SNI, process, cipher, certificate, port…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={version} onChange={(e) => setVersion(e.target.value)} aria-label="TLS version">
          <option value="">Any version</option>
          {options('tls_version').map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select value={direction} onChange={(e) => setDirection(e.target.value)} aria-label="Direction">
          <option value="">Any direction</option>
          {options('direction').map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Outcome">
          <option value="">Any outcome</option>
          {options('handshake_outcome').map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </div>
      <DataTable columns={columns} rows={rows} emptyText="No TLS connections were observed during this capture" />
    </div>
  );
}
