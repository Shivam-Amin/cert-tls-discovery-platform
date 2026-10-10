# Cert & TLS Discovery

A local cryptographic discovery product: a small **Linux agent** finds certificate files and observes TLS connection metadata, a **local backend** runs scans and stores every run in **SQLite**, and a **web UI** shows run history, inventories, charts and a relationship map.

| | |
|---|---|
| Supported OS | **Linux** (tested on Ubuntu 26.04, arm64). On macOS it runs inside a Linux VM (OrbStack). |
| Agent package size | **4,502,656 bytes (~4.5 MB)** (limit 5 MB) |
| Start command | `cd backend && sudo npm start`, then open **http://localhost:8080** |
| Port | `8080` (backend API + UI, bound to `127.0.0.1`). Dev UI: `5173` |
| Privileges | `sudo` for the backend: TLS packet capture needs root; root also lets the filesystem scan read root-only folders |

## Architecture

```
Browser (React UI) ──HTTP /api──▶ Backend (Node.js + Express, :8080)
                                   ├─ routes      REST API
                                   ├─ runner      queue: one scan at a time
                                   ├─ scheduler   checks schedules every 15 s
                                   ├─ SQLite      backend/data/discovery.db
                                   └─ runs ──▶ agent/agent-linux filesystem | tls
                                                prints one JSON report (stdout) + log (stderr)
```

| Component | Folder | Responsibility |
|---|---|---|
| Discovery agent | [`agent/`](agent/README.md) | Go binary with two commands: `filesystem` (certificate files) and `tls` (passive capture). Prints one JSON report per run. No network server, no database. |
| Local backend API | [`backend/`](backend/README.md) | Creates runs (IDs, `queued → running → completed / partial / failed`), runs the agent, validates its JSON, stores results, runs scheduled scans, serves report APIs and the built UI. |
| Data store | [`backend/src/schema.sql`](backend/src/schema.sql) | SQLite tables: `runs`, `certificates`, `tls_observations`, `relationships`, `schedules`. |
| Web interface | [`frontend/`](frontend/README.md) | Discovery Runs, File System Scan Report, TLS Metadata Scan Report. |

### Flow

1. The user clicks **Run filesystem scan** or **Run TLS metadata scan** (or a schedule becomes due).
2. The backend inserts a run (`queued`, trigger `manual` or `scheduled`) and returns its ID at once; the run appears in the table.
3. When it's the run's turn: status `running`, and the backend starts the agent with arguments built from the settings (no shell), e.g. `agent-linux tls --duration 30s`.
4. The agent prints one JSON report. The backend validates it and saves all rows in one transaction, then sets the status, counts, errors and the agent's log.
5. The UI polls while a run is active and opens the finished run's report.

Every run stores its `params` (settings) and the exact `command`, so each result can be traced to how it was produced.

## Setup and start

### macOS (via OrbStack)

```bash
brew install orbstack            # then open OrbStack once
orb create ubuntu ubuntu         # creates a Linux machine named "ubuntu"
orb -m ubuntu                    # Linux shell; your Mac folders are visible at the same paths
cd /Users/<you>/.../tls-agent    # continue with the Linux steps below
```

OrbStack forwards the VM's ports, so the app opens at `http://localhost:8080` in the Mac browser.

### Linux (Ubuntu / Debian)

```bash
sudo apt update
sudo apt install -y golang libpcap-dev nodejs npm openssl   # Go, libpcap, Node.js 20+, openssl (demo files only)

# 1. agent
cd agent
go build -trimpath -ldflags="-s -w" -o agent-linux .
stat -c "%s bytes" agent-linux       # agent package size
cd ..

# 2. web UI (built once; served by the backend)
cd frontend
npm install
npm run build
cd ..

# 3. backend (creates backend/data/discovery.db on first start)
cd backend
npm install
sudo npm start
```

Open **http://localhost:8080**. The dot in the top-right corner shows whether the backend is up, the agent was found, and the backend runs as root.

Run all `npm install` commands inside Linux: `better-sqlite3` is compiled for the OS it is installed on.

### Optional: demo certificate files

The common folders only hold valid CA certificates. To see expired, expiring, not-yet-valid, chain, duplicate, key-only, PKCS#12 and broken files:

```bash
agent/scripts/make-fixtures.sh      # creates /tmp/certfix (changes nothing else)
```

Then run a filesystem scan with extra folder `/tmp/certfix`.

### Generating TLS traffic for a TLS scan

Start a TLS scan, then within the capture window run HTTPS requests on the same machine:

```bash
curl -s -o /dev/null https://example.com
curl -s -o /dev/null --tls-max 1.2 https://github.com    # TLS 1.2: the server certificate is visible
```

Use `https://`: plain `curl example.com` is unencrypted HTTP and produces no TLS.

### Tests

```bash
cd agent && go test ./...      # works on macOS too (no root, no Linux needed)
```

## Using the app

- **Discovery Runs:** latest results, the two scan buttons (extra folders + "also scan the common certificate folders"; capture duration 5–300 s), schedule settings per scan type (on/off, every N minutes, its own settings), charts (runs by type and status, findings per run, duration per run) and the run history. Click a run to open its report.
- **File System Scan Report:** totals (found, unique, duplicates, valid, expiring, expired, not yet valid, parse failed), charts (validity posture, key algorithms and sizes, signature algorithms, leading issuers, certificates by folder) and a searchable, filterable certificate inventory.
- **TLS Metadata Scan Report:** totals (TLS packets, TLS records, connections, unique endpoints and ports, certificates, process-mapped connections, relationships), charts (TLS versions, handshake outcome, peer-certificate posture, cipher suites, top endpoints, activity over time), the **relationship map** and a searchable connection table.
- **Scheduling:** schedules run inside the backend while it is running, even with no browser open; their runs are marked `scheduled`. They are off until enabled.

All data shown comes from the agent on this machine. **No sample or mock data** is included; each report names the agent command that produced it.

## Data model (SQLite)

| Table | One row per |
|---|---|
| `runs` | scan: type, trigger, status, params, command, queued/started/ended time, duration, record and error counts, errors, agent log |
| `certificates` | certificate observation: path, format, scan root, fingerprint, duplicate flag, serial, subject, issuer, SAN, chain position, key algorithm/size, signature algorithm, validity dates, days to expiry, status, parse status/error, confidence |
| `tls_observations` | TCP connection: first/last seen, client and server IP:port, direction, transport, handshake outcome, SNI, TLS version, cipher, peer certificate fingerprint/subject/issuer/expiry, process, PID, event count |
| `relationships` | edge: `from_type/from_id —edge→ to_type/to_id` with a `count` |
| `schedules` | scan type: enabled, interval, params, last/next run |

Relationship model: nodes are host/process, endpoint (IP:port), certificate (SHA-256) and service (SNI). Edges: `host —stores→ certificate`, `process —communicates→ endpoint`, `endpoint —presents→ certificate`, `process —uses→ certificate`, `endpoint —serves→ service`. Repeated observations increase an edge's `count` instead of adding copies.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | backend up, agent found, running as root |
| GET | `/api/summary` | latest run per type, active runs, totals |
| GET | `/api/runs` | run history (`?type=&status=&limit=`) |
| POST | `/api/runs` | start a scan: `{"type":"filesystem","params":{"roots":["/opt/certs"],"include_defaults":true}}` or `{"type":"tls","params":{"duration_seconds":30}}` |
| GET | `/api/runs/:id` | one run, including its log |
| GET | `/api/runs/:id/certificates` · `/tls` · `/relationships` | report rows |
| GET / PUT | `/api/schedules` · `/api/schedules/:type` | read / change periodic scans |

Details: [backend/README.md](backend/README.md).

## Assumptions

- **One supported OS: Linux.** macOS is supported only by running the stack in a Linux VM.
- **Run privileges:** the backend runs with `sudo` so the agent can capture packets. It listens on `127.0.0.1` only.
- **"Expiring"** means it expires within **30 days**.
- **Common certificate folders** (owned by the agent): `/etc/ssl`, `/usr/local/share/ca-certificates`, `/etc/pki` (missing ones skipped). Extra folders are added to them unless the checkbox is cleared.
- **TLS capture** is passive, on all interfaces, for a set window (default 30 s, 5–300 s); results are reported once at the end of the window.
- **One scan at a time:** later requests wait as `queued`. A scheduled scan is skipped while a scan of the same type is still queued or running.
- **Files over 2 MB** with a certificate extension are skipped and reported, so a scan can't stall.
- **PKCS#12 (`.p12/.pfx`)** files are identified but not opened (normally password-protected).
- **Timeouts:** a filesystem scan is stopped after 10 min; a TLS scan after its duration + 30 s (it then still reports what it captured, as `partial`).

## Known limitations

- **No TCP reassembly:** metadata is read from single packets. SNI, version and cipher are almost always visible; a TLS 1.2 server certificate that spans several packets may be missed.
- **TLS 1.3 encrypts the server certificate**, so no peer certificate is reported for TLS 1.3 connections. Late TLS 1.3 alerts are also encrypted, so such failures may show as `established`.
- **Process mapping** (`/proc/net/tcp` and `tcp6`) can miss very short connections that close before the lookup; those show `unavailable`. Owning process for certificate files is not attempted.
- **TCP only:** QUIC / HTTP3 (UDP) is not observed.
- **Scheduled scans need the backend running;** there is no system service. If the backend stops during a scan, that run is marked `failed` at the next start.
- **No authentication** (out of scope): the API is only reachable from this machine.

## Safety

- **Read-only:** the agent never changes, moves or copies scanned files. `.key` files are not opened and `PRIVATE KEY` PEM blocks are skipped without decoding; no key material is stored.
- **Metadata only:** TLS observation reads handshake headers; no payloads are captured, nothing is decrypted, and no credentials are collected.
- **Input checks:** UI input is validated (absolute paths, limits). The agent is started without a shell, and SQL uses placeholders.

## Third-party software

| Where | Package | Purpose |
|---|---|---|
| agent | `github.com/google/gopacket` 1.1.19 (+ system `libpcap`) | packet capture and decoding |
| backend | `express` 5, `better-sqlite3` 13 | HTTP API, SQLite |
| frontend | `react` 19, `react-dom` 19, `react-router` 8 | UI and pages |
| frontend | `recharts` 3, `cytoscape` 3 | charts, relationship map |
| frontend (build) | `vite` 8, `@vitejs/plugin-react` 6 | dev server and build |

Everything else in the agent is the Go standard library.

## AI tools used

Developed with AI assistance: **Claude Code** (Anthropic) and **Cursor** were used for planning, code generation, review and testing. All code was reviewed, run and tested on the target system.

## Repository layout

```
agent/      Go agent (+ scripts/make-fixtures.sh, unit tests, README)
backend/    Node.js API, SQLite schema, runner, scheduler (README)
frontend/   React UI (README)
```
