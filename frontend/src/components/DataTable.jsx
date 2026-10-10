import { useEffect, useState } from 'react';
import { Empty } from './ui.jsx';

// Generic table with paging.
// columns: [{ key, label, render?: (row) => node, className? }]
export default function DataTable({ columns, rows, pageSize = 50, onRowClick, emptyText = 'No rows' }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));

  // Back to page 1 when filters change the row count.
  useEffect(() => setPage(0), [rows.length]);

  if (rows.length === 0) return <Empty>{emptyText}</Empty>;

  const visible = rows.slice(page * pageSize, (page + 1) * pageSize);
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr
                key={row.id ?? i}
                className={onRowClick ? 'clickable' : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={c.className}>
                    {c.render ? c.render(row) : (row[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="pager">
          <span className="muted small">
            {page * pageSize + 1}–{Math.min((page + 1) * pageSize, rows.length)} of {rows.length}
          </span>
          <button className="small" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <button className="small" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </>
  );
}
