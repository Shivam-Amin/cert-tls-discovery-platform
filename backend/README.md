# Backend: local API, SQLite store, scheduler

Node.js + Express. Starts agent scans, tracks run status, stores results in SQLite, runs scheduled scans, and serves the report APIs (and the built web UI).

## Setup (inside Linux, e.g. `orb -m ubuntu`)

```bash
sudo apt install -y nodejs npm             # Node 20+
cd agent && go build -trimpath -ldflags="-s -w" -o agent-linux . && cd ..   # the backend runs this binary
cd backend
npm install                                # run inside Linux: better-sqlite3 is compiled for this OS
sudo npm start                             # sudo: TLS capture needs root
```

Open `http://localhost:8080/api/health`. On macOS with OrbStack the same URL works from the Mac.

The database file `backend/data/discovery.db` is created on first start (schema in `src/schema.sql`). Inspect it with `sqlite3 backend/data/discovery.db` (`sudo apt install sqlite3`).

| Env var | Default |
|---|---|
| `PORT` | `8080` |
| `HOST` | `127.0.0.1` (local only: scans run as root) |
| `AGENT_PATH` | `../agent/agent-linux` |
| `DB_PATH` | `./data/discovery.db` |

## Files

| File | Job |
|---|---|
| `src/server.js` | Express app, mounts routes, serves `frontend/dist`, starts the scheduler |
| `src/config.js` | settings, limits, timeouts |
| `src/schema.sql` | tables and indexes |
| `src/db.js` | **all SQL**: runs, saving reports, report rows, schedules |
| `src/validate.js` | checks input from the UI |
| `src/agent.js` | params → agent arguments, runs the binary, checks its JSON |
| `src/runner.js` | queue: one scan at a time |
| `src/scheduler.js` | every 15 s, queues scans whose schedule is due |
| `src/routes/*.js` | HTTP endpoints |

## Run lifecycle

```
POST /api/runs  or  scheduler
   → runs row: status queued (id returned at once)
   → queue (one at a time) → status running
   → agent-linux <args>   (no shell; timeout: filesystem 10 min, tls duration + 30 s)
   → JSON checked → certificates / tls_observations / relationships saved in one transaction
   → status completed | partial | failed, with counts, errors, agent log (stderr)
```

Failure handling: agent missing, rejected arguments (exit 2), no/invalid JSON, or timeout → run `failed` (or `partial` if the agent still reported). Runs left `queued`/`running` when the backend stops are marked `failed` at the next start.

Each run stores `params` (settings, JSON) and `command` (exact agent command), so every result can be traced to how it was produced.

## Scheduler

One schedule per scan type in the `schedules` table (off by default). When enabled, a timer in the backend queues a run every `interval_minutes` with trigger `scheduled` and the schedule's own params. It runs while the backend is running, whether or not a browser is open. If the previous run of that type hasn't finished, the tick is skipped.

## API

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/health` | | `{ok, agent_found, running_as_root}` |
| GET | `/api/summary` | | latest run per type, active runs, totals |
| GET | `/api/runs` | `?type=&status=&limit=` | runs, newest first (without log) |
| POST | `/api/runs` | `{"type":"filesystem","params":{"roots":["/etc/ssl"]}}` or `{"type":"tls","params":{"duration_seconds":30}}` | `202` + the queued run |
| GET | `/api/runs/:id` | | one run incl. `log` |
| GET | `/api/runs/:id/certificates` | | certificate rows |
| GET | `/api/runs/:id/tls` | | TLS connection rows |
| GET | `/api/runs/:id/relationships` | | edges |
| GET | `/api/schedules` | | both schedules |
| PUT | `/api/schedules/:type` | `{"enabled":true,"interval_minutes":10,"params":{...}}` (all optional) | updated schedule |

Limits: `roots` absolute paths, max 20, no commas (empty = agent defaults). `duration_seconds` 5–300. `interval_minutes` 1–1440. Errors: `{"error": "..."}` with 400 / 404 / 500.

Try it:

```bash
curl -XPOST localhost:8080/api/runs -H 'content-type: application/json' -d '{"type":"filesystem"}'
curl localhost:8080/api/runs
curl localhost:8080/api/runs/1/certificates
```
