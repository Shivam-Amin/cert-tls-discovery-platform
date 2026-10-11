# Frontend

React + Vite. Three views: Discovery Runs, File System Scan Report and TLS Metadata Scan Report. It talks only to the backend API.

| Library | Used for |
|---|---|
| `react`, `react-dom` | UI |
| `react-router` | pages `/` and `/runs/:id` |
| `recharts` | charts |
| `cytoscape` | relationship map |
| `vite` | dev server and build |

## Run

Inside Linux:

```bash
cd frontend
npm install
npm run build      # writes dist/, served by the backend on :8080
```

For development with live reload (backend running):

```bash
npm run dev        # http://localhost:5173, /api is forwarded to :8080
```

## Files

| File | Job |
|---|---|
| `src/App.jsx` | top bar, routes, backend status |
| `src/api.js` | backend calls |
| `src/usePolling.js` | load data and refresh it on an interval |
| `src/format.js` | date, duration and counting helpers |
| `src/styles.css`, `src/theme.js` | styling; colours are CSS variables, also used by the charts |
| `src/pages/RunsPage.jsx` | Discovery Runs: latest results, scan buttons, schedules, charts, run history |
| `src/pages/RunPage.jsx` | run details, status and errors, agent log |
| `src/pages/FilesystemReport.jsx` | File System Scan Report |
| `src/pages/TlsReport.jsx` | TLS Metadata Scan Report |
| `src/components/` | scan and schedule forms, tables, charts, relationship map |

## Notes

- The runs page refreshes every 2 s while a scan is active and every 10 s otherwise, so scheduled runs appear without reloading.
- Search and filters work on the loaded rows in the browser.
- Each page shows loading, empty, running, partial and failed states.
