// View 2: File System Scan Report: certificate inventory for one run.
import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { usePolling } from '../usePolling.js';
import DataTable from '../components/DataTable.jsx';
import { BarListChart, DonutChart } from '../components/Charts.jsx';
import { Banner, ErrorState, Loading, Metrics, StatusBadge } from '../components/ui.jsx';
import { commonName, countBy, formatDate, formatNumber, shortHash } from '../format.js';

const VALIDITY = ['valid', 'expiring', 'expired', 'not_yet_valid'];

const columns = [
  {
    key: 'path',
    label: 'Path',
    className: 'wrap',
    render: (c) => (
      <>
        <span className="mono">{c.path}</span>
        {c.duplicate && (
          <>
            {' '}
            <span className="tag" title="Same fingerprint already seen earlier in this scan">duplicate</span>
          </>
        )}
        {c.chain_position != null && (
          <>
            {' '}
            <span className="tag" title="Position in the certificate chain in this file (0 = leaf)">
              chain #{c.chain_position}
            </span>
          </>
        )}
      </>
    ),
  },
  { key: 'subject', label: 'Subject', render: (c) => <span title={c.subject}>{commonName(c.subject)}</span> },
  { key: 'issuer', label: 'Issuer', render: (c) => <span title={c.issuer}>{commonName(c.issuer)}</span> },
  {
    key: 'validity',
    label: 'Validity',
    className: 'nowrap',
    render: (c) =>
      c.validity_status ? (
        <>
          <StatusBadge status={c.validity_status} />
          <div className="muted small">
            until {formatDate(c.not_after)} ({c.days_to_expiry} d)
          </div>
        </>
      ) : (
        '—'
      ),
  },
  {
    key: 'algorithm',
    label: 'Key / signature',
    className: 'nowrap',
    render: (c) =>
      c.key_algorithm ? (
        <>
          {c.key_algorithm} {c.key_size || ''}
          <div className="muted small">{c.signature_algorithm}</div>
        </>
      ) : (
        '—'
      ),
  },
  {
    key: 'fingerprint',
    label: 'SHA-256',
    render: (c) => <span className="mono" title={c.fingerprint}>{shortHash(c.fingerprint)}</span>,
  },
  {
    key: 'parse_status',
    label: 'Parsing',
    render: (c) =>
      c.parse_status === 'ok' ? (
        <span className="muted">ok · {c.format}</span>
      ) : (
        <span title={c.parse_error}>
          <StatusBadge status="parse_failed" />
          <div className="muted small">{c.parse_error}</div>
        </span>
      ),
  },
];

export default function FilesystemReport({ run }) {
  const { data: certs, error, loading, reload } = usePolling(() => api.certificates(run.id), [run.id]);

  if (loading) return <Loading rows={4} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (certs.length === 0) {
    return (
      <Banner tone="info" title="No certificate files found">
        No .pem, .crt, .cer, .der, .p12 or .pfx files were found in the scanned folders.
      </Banner>
    );
  }
  return <Report run={run} certs={certs} />;
}

function Report({ run, certs }) {
  const counts = run.counts;

  // Posture charts count each certificate once (first observation, parsed).
  const charts = useMemo(() => {
    const unique = certs.filter((c) => c.parse_status === 'ok' && !c.duplicate);
    return {
      validity: [
        ...VALIDITY.map((s) => ({ key: s, name: s.replaceAll('_', ' '), value: counts[s] ?? 0 })),
        { key: 'parse_failed', name: 'parse failed', value: counts.parse_failed ?? 0 },
      ],
      keys: countBy(unique, (c) => `${c.key_algorithm} ${c.key_size || ''}`.trim()),
      signatures: countBy(unique, (c) => c.signature_algorithm),
      issuers: countBy(unique, (c) => commonName(c.issuer), 10),
      // Locations count every observation: where certificate files live.
      locations: countBy(certs, (c) => c.path.slice(0, c.path.lastIndexOf('/')) || '/', 10),
    };
  }, [certs, counts]);

  return (
    <>
      <Metrics
        items={[
          { label: 'Certificates found', value: formatNumber(counts.certificates_found), hint: 'every observation, incl. duplicates and failures' },
          { label: 'Unique certificates', value: formatNumber(counts.unique_certificates), hint: 'distinct SHA-256 fingerprints' },
          { label: 'Duplicate observations', value: formatNumber(counts.duplicate_observations), hint: 'same cert in another file/position' },
          { label: 'Valid', value: formatNumber(counts.valid), tone: 'good' },
          { label: 'Expiring (≤ 30 d)', value: formatNumber(counts.expiring), tone: counts.expiring ? 'warn' : undefined },
          { label: 'Expired', value: formatNumber(counts.expired), tone: counts.expired ? 'bad' : undefined },
          { label: 'Not yet valid', value: formatNumber(counts.not_yet_valid) },
          { label: 'Parse failed', value: formatNumber(counts.parse_failed), tone: counts.parse_failed ? 'warn' : undefined },
        ]}
      />

      <div className="grid-2">
        <DonutChart title="Validity posture" subtitle="Unique certificates" data={charts.validity} byStatus />
        <BarListChart title="Key algorithms and sizes" subtitle="Unique certificates" data={charts.keys} colorIndex={0} labelWidth={110} />
        <BarListChart title="Signature algorithms" subtitle="Unique certificates" data={charts.signatures} colorIndex={3} labelWidth={150} />
        <BarListChart title="Leading issuers" subtitle="Top 10, unique certificates" data={charts.issuers} colorIndex={1} labelWidth={200} />
      </div>
      <BarListChart
        title="Certificates by filesystem location"
        subtitle="Top 10 folders, every observation"
        data={charts.locations}
        colorIndex={5}
        labelWidth={280}
      />

      <CertificateTable certs={certs} />
    </>
  );
}

function CertificateTable({ certs }) {
  const [search, setSearch] = useState('');
  const [validity, setValidity] = useState('');
  const [algorithm, setAlgorithm] = useState('');
  const [parse, setParse] = useState('');
  const [hideDuplicates, setHideDuplicates] = useState(false);

  const algorithms = useMemo(() => [...new Set(certs.map((c) => c.key_algorithm).filter(Boolean))].sort(), [certs]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return certs.filter(
      (c) =>
        (!validity || c.validity_status === validity) &&
        (!algorithm || c.key_algorithm === algorithm) &&
        (!parse || c.parse_status === parse) &&
        (!hideDuplicates || !c.duplicate) &&
        (!q ||
          [c.path, c.subject, c.issuer, c.fingerprint, c.serial, ...c.san].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [certs, search, validity, algorithm, parse, hideDuplicates]);

  return (
    <div className="card">
      <div className="card-title">
        <h2>Certificate inventory</h2>
        <span className="muted small">
          {rows.length} of {certs.length} rows
        </span>
      </div>
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search path, subject, issuer, SAN, fingerprint, serial…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={validity} onChange={(e) => setValidity(e.target.value)} aria-label="Validity">
          <option value="">Any validity</option>
          {VALIDITY.map((v) => (
            <option key={v} value={v}>
              {v.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
        <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value)} aria-label="Key algorithm">
          <option value="">Any algorithm</option>
          {algorithms.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <select value={parse} onChange={(e) => setParse(e.target.value)} aria-label="Parse status">
          <option value="">Any parse status</option>
          <option value="ok">parsed</option>
          <option value="parse_failed">parse failed</option>
        </select>
        <label className="checkbox">
          <input type="checkbox" checked={hideDuplicates} onChange={(e) => setHideDuplicates(e.target.checked)} />
          Hide duplicates
        </label>
      </div>
      <DataTable columns={columns} rows={rows} emptyText="No certificates match the filters" />
    </div>
  );
}
