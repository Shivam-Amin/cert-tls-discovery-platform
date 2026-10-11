# Backend

Node.js + Express. Starts agent scans, tracks run status, stores results in SQLite, runs scheduled scans, and serves the API and the built web UI.

## Run

Inside Linux, after building the agent (`agent/`) and the UI (`frontend/`):

```bash
sudo apt install -y nodejs npm             # Node 20+
cd agent && go build -trimpath -ldflags="-s -w" -o agent-linux .  # the backend runs this binary (ignore if you've built the agent)
cd backend         # basically, cd to backend folder now
npm install        # inside Linux: better-sqlite3 is compiled for the OS
sudo npm start     # sudo: the TLS scan needs root
```

Open `http://localhost:8080/api/health`. On macOS with OrbStack the same URL works from the Mac.

The database file `backend/data/discovery.db` is created on first start (schema in `src/schema.sql`). Inspect it with `sqlite3 backend/data/discovery.db` (`sudo apt install sqlite3`).

| Env var | Default |
|---|---|
| `PORT` | `8080` |
| `HOST` | `127.0.0.1` |
| `AGENT_PATH` | `../agent/agent-linux` |
| `DB_PATH` | `./data/discovery.db` |

## Files

| File | Job |
|---|---|
| `src/server.js` | Express app, routes, serves `frontend/dist`, starts the scheduler |
| `src/config.js` | settings, limits, timeouts |
| `src/schema.sql` | tables and indexes |
| `src/db.js` | all SQL queries |
| `src/validate.js` | checks input from the UI |
| `src/agent.js` | builds agent arguments, runs the binary, checks its JSON |
| `src/runner.js` | queue: one scan at a time |
| `src/scheduler.js` | every 15 s, queues scans whose schedule is due |
| `src/routes/*.js` | API endpoints |

## Run lifecycle

```
POST /api/runs or scheduler
  → run saved as queued, id returned
  → queue (one at a time) → running
  → agent-linux <args>   (no shell; timeout: filesystem 10 min, tls duration + 30 s)
  → JSON checked, rows saved in one transaction
  → completed | partial | failed, with counts, errors and the agent log
```

If the agent is missing, rejects its arguments or returns invalid JSON, the run is `failed` with the reason. Runs still `queued` or `running` when the backend stops are marked `failed` on the next start.

Each run stores its `params` and the exact `command`.

## Scheduler

One schedule per scan type (off by default), set from the UI. When enabled, the backend queues a run every `interval_minutes` with trigger `scheduled`. It runs while the backend is running, with or without a browser open. If the previous run of that type is still active, the schedule waits.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | backend up, agent found, running as root |
| GET | `/api/summary` | latest run per type, active runs, totals |
| GET | `/api/runs` | `?type=&status=&limit=` |
| POST | `/api/runs` | `{"type":"filesystem","params":{"roots":["/opt/certs"],"include_defaults":true}}` or `{"type":"tls","params":{"duration_seconds":30}}` → `202` with the queued run |
| GET | `/api/runs/:id` | one run, including its log |
| GET | `/api/runs/:id/certificates` | |
| GET | `/api/runs/:id/tls` | |
| GET | `/api/runs/:id/relationships` | |
| GET | `/api/schedules` | |
| PUT | `/api/schedules/:type` | `{"enabled":true,"interval_minutes":10,"params":{...}}` |

Limits: folders must be absolute paths (max 20), `duration_seconds` 5–300, `interval_minutes` 1–1440. Errors return `{"error": "..."}` with status 400, 404 or 500.

Examples:

```bash
curl -X POST localhost:8080/api/runs -H 'content-type: application/json' -d '{"type":"filesystem"}'
curl localhost:8080/api/runs
curl localhost:8080/api/runs/1/certificates
```

## Database

```bash
sudo apt install -y sqlite3
sudo sqlite3 data/discovery.db "SELECT id, type, status, record_count FROM runs;"
```
