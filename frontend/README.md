# Frontend: web UI

React + Vite. Three views: **Discovery Runs**, **File System Scan Report**, **TLS Metadata Scan Report**. Talks only to the backend (`/api/...`), never to the agent.

| Library | Used for |
|---|---|
| `react`, `react-dom` | UI |
| `react-router` | pages: `/` and `/runs/:id` |
| `recharts` | charts |
| `cytoscape` | relationship map |
| `vite`, `@vitejs/plugin-react` | dev server and build |

## Run (inside Linux, e.g. `orb -m ubuntu`)

```bash
cd frontend
npm install
npm run build        # writes dist/; the backend serves it at http://localhost:8080
```

During development (live reload), with the backend running:

```bash
npm run dev          # http://localhost:5173, /api is proxied to :8080
```

## Files

| File | Job |
|---|---|
| `src/main.jsx`, `src/App.jsx` | start-up, top bar, routes, backend health indicator |
| `src/api.js` | every backend call |
| `src/usePolling.js` | load data, optionally refresh every N ms |
| `src/format.js` | dates, durations, counting helpers |
| `src/theme.js` | reads colours from CSS variables for charts/graph |
| `src/styles.css` | all styling; all colours as variables |
| `src/pages/RunsPage.jsx` | View 1: summary, scan buttons, schedules, charts, runs table |
| `src/pages/RunPage.jsx` | run header, status banners, agent log; picks the report |
| `src/pages/FilesystemReport.jsx` | View 2 |
| `src/pages/TlsReport.jsx` | View 3 |
| `src/components/*` | scan panel, schedule panel, tables, charts, relationship map, badges |

## Behaviour

- **Live updates:** the runs page refreshes every 2 s while a scan is queued/running, otherwise every 10 s (so scheduled runs appear on their own). A run page refreshes every 2 s until the run finishes, then loads its report.
- **States:** loading skeletons; empty results explained; running (spinner, TLS countdown); partial (yellow banner with errors); failed (red banner, agent log opened); backend unreachable (error with retry, red dot in the top bar).
- **Filtering/search** happens in the browser on the run's rows.
- All data shown is real agent output; there is no sample data. Each report names the command that produced it.

## Theme

Light theme only for now.

**Dark theme later:** every colour is a CSS variable at the top of `src/styles.css`, and charts and the relationship map read those variables through `src/theme.js`; no component hard-codes a colour. To add dark mode:

1. Add `:root[data-theme='dark'] { … }` (and/or `@media (prefers-color-scheme: dark)`) redefining the same variables.
2. Add a toggle that sets `document.documentElement.dataset.theme = 'dark'`.
3. Re-render charts and the graph after toggling (they read colours when they draw).
