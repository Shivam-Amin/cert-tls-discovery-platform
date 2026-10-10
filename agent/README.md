# tls-agent — Linux certificate & TLS discovery agent

One static-ish Go binary with two commands. Each run prints **one JSON report on stdout**; logs go to stderr.

```bash
sudo ./agent-linux filesystem [--roots /etc/ssl,/opt/certs]
sudo ./agent-linux tls [--iface any] [--duration 30s]
```

| | |
|---|---|
| Supported OS | Linux (tested on Ubuntu 26.04 arm64 via OrbStack) |
| Package size | **4,436,992 bytes (~4.4 MB)**; limit is 5 MB |
| Language | Go 1.22+ with cgo (for libpcap) |
| Third-party libs | `github.com/google/gopacket` (pcap + packet decoding). Everything else is the Go standard library. |

## Setup

The agent is a Linux program. All commands below run **inside Linux**, from this `agent/` folder.

### On macOS (OrbStack)

```bash
brew install orbstack                  # once; then open OrbStack
orb create ubuntu ubuntu               # once: creates a Linux machine named "ubuntu"
orb -m ubuntu                          # open a Linux shell (your Mac folders are visible at the same path)
cd /Users/<you>/.../tls-agent/agent    # now continue with the Linux steps
```

Tip: instead of opening a shell you can prefix single commands from a Mac terminal, e.g. `orb -m ubuntu sudo ./agent-linux filesystem`. Running `./agent-linux` directly on macOS fails with "cannot execute binary file".

### On Linux (Ubuntu / Debian)

```bash
sudo apt update
sudo apt install -y golang libpcap-dev openssl   # Go compiler, libpcap headers, openssl (only for test files)
go build -trimpath -ldflags="-s -w" -o agent-linux .
stat -c "%s bytes" agent-linux                   # check size (< 5 MB)
```

`-s -w` strips debug info to keep the binary small. To run an already-built binary you only need `libpcap0.8` (installed with `libpcap-dev`).

## Privileges

Run both commands with `sudo`.

- `filesystem` works without root too, but root-only folders (e.g. `/etc/ssl/private`) are then listed in `errors` and the run is `partial`.
- `tls` needs root to capture packets. Without it the run is `failed` with a clear error.

The agent never writes, moves or changes scanned files.

## Manual testing

Inside Linux, from the `agent/` folder, after building:

```bash
# 1. unit tests (these also run on macOS: no Linux or sudo needed)
go test ./...

# 2. scan the default certificate folders
sudo ./agent-linux filesystem

# 3. scan your own folders (comma-separated)
sudo ./agent-linux filesystem --roots /etc/ssl/certs,/usr/local/share/ca-certificates

# 4. TLS: start the capture, then make some HTTPS calls in a second terminal
sudo ./agent-linux tls --duration 15s
curl -s -o /dev/null https://example.com
curl -s -o /dev/null --tls-max 1.2 https://github.com    # TLS 1.2 shows the server certificate

# 5. error cases
sudo ./agent-linux filesystem --roots /does/not/exist     # status "failed", exit code 1
./agent-linux tls --duration 2s                            # no sudo: status "failed"
```

To save a report: `sudo ./agent-linux filesystem > fs.json`.

### Demo certificate files (optional)

The default folders only hold valid CA certificates. To see every case (expired, expiring, chain, duplicates, keys, P12, broken files), create demo files once with `scripts/make-fixtures.sh`. It writes them to `/tmp/certfix` (or a folder you pass) and changes nothing else; running it again recreates them. Needs OpenSSL 3.4+.

```bash
scripts/make-fixtures.sh                          # creates /tmp/certfix
./agent-linux filesystem --roots /tmp/certfix     # without sudo, to see the "partial" case
```

Expected (without sudo): `status: partial` because of `locked.pem`; counts: 14 found, 7 unique, 4 duplicate, 3 parse_failed (garbage.cer, store.p12, locked.pem), 1 expired, 1 expiring, 1 not_yet_valid; chain positions only in `fullchain.pem`; no row for `server.key` or `key-only.pem`.

## Filesystem scan

- **Roots:** default `/etc/ssl`, `/usr/local/share/ca-certificates`, `/etc/pki` (missing defaults are skipped). `--roots` replaces the defaults; a missing `--roots` dir is an error.
- **Files:** `.pem .crt .cer .der .p12 .pfx`. PEM files may hold many certs; other files are tried as PEM, then raw DER.
- **Private keys:** `.key` files are not opened. `PRIVATE KEY` PEM blocks are skipped without decoding; key material never appears in output. A PEM with only a key produces no row.
- **Per certificate:** path, filename, format, scan root, discovered_at, SHA-256 fingerprint, serial, subject, issuer, SANs, chain position, key algorithm + size, signature algorithm, validity dates, days to expiry, `valid | expiring | expired | not_yet_valid`, parse status, confidence, owning process (`unavailable`).
- **Dedup:** fingerprint = SHA-256 of the DER bytes. Every observation is kept (so every path is visible); repeats get `duplicate: true` and are counted in `duplicate_observations`, not `unique_certificates`.
- **Chain position** is set only when the certs in a file form an issuer chain (cert *i* issued by cert *i+1*, like `fullchain.pem`). CA bundles are lists of unrelated roots and get no position.
- **Relationships:** `host --stores--> certificate` (count = files holding it).

## TLS scan

Passive capture with libpcap (BPF filter `tcp`, promiscuous mode off) for `--duration`. Only plaintext handshake bytes are read; nothing is decrypted and no payload is stored.

- One observation per TCP connection; packets in both directions are merged. **source = TLS client, destination = TLS server.**
- **Fields:** first/last seen, IPs/ports, direction (`outbound` = this host is the client, `inbound`, `unknown`), transport, handshake outcome, SNI, negotiated TLS version (incl. TLS 1.3 via `supported_versions`), cipher suite, peer certificate fingerprint/subject/issuer/expiry, process + PID, `event_count` (TLS records seen).
- **Handshake outcome:** `established` (hello + encrypted records), `failed` (alert before any application data), `handshake_incomplete`, `client_hello_only`, `mid_stream` (connection began before capture).
- **Counts:** `tls_packets` (TCP packets that carried TLS), `tls_records` (= sum of `event_count`), `connections`, `unique_endpoints`, `unique_ports`, `certificates_seen`, `process_mapped`, `relationships`.
- **Process mapping:** connection → socket inode via `/proc/net/tcp` and `/proc/net/tcp6` → PID via `/proc/<pid>/fd` → name from `/proc/<pid>/comm`. Done when the connection is first seen.
- **Relationships:** `process --communicates--> endpoint`, `endpoint --presents--> certificate`, `process --uses--> certificate`, `endpoint --serves--> service (SNI)`. If the process is unknown, the `host` node is used instead. Repeated edges increase `count`.

**When results are returned:** once, at the end of `--duration` (default 30 s), as one JSON report. Not per packet, because a connection's metadata arrives in pieces (SNI from the client, version/cipher from the server, `established` later), and totals and relationships need the whole capture. The backend shows the run as `running` meanwhile. If the agent is stopped early (Ctrl+C / SIGTERM, e.g. a backend timeout), it stops capturing and still prints what it has, with status `partial` and a "stopped early" error.

## Report shape

```json
{
  "type": "filesystem | tls",
  "host": "ubuntu",
  "started_at": "...", "ended_at": "...", "duration_ms": 8,
  "status": "completed | partial | failed",
  "counts": { ... },
  "error_count": 1,
  "errors": ["/etc/ssl/private: open /etc/ssl/private: permission denied"],   // max 50 listed
  "certificates": [ ... ],        // filesystem only
  "tls_observations": [ ... ],    // tls only
  "relationships": [ {"from_type","from_id","edge","to_type","to_id","count"} ]
}
```

Status: `failed` = errors and no results; `partial` = results and errors; `completed` = no errors. Run IDs and `queued`/`running` belong to the backend that launches the agent.

Exit codes: `0` completed or partial, `1` failed, `2` bad command or flag (no JSON; message on stderr).

## Edge cases

The rule: once a scan starts, the agent **never stops on a single bad path or file**. It records the problem in `errors`, keeps going, and always prints a report. Only a bad command line exits early (code 2).

| Case | What happens |
|---|---|
| `--roots /nope` (path does not exist) | error `"/nope: stat /nope: no such file or directory"`; nothing else to scan → `failed` |
| `--roots /nope,/etc/ssl` | `/etc/ssl` is still scanned; error for `/nope` → `partial` |
| root is a file, not a folder | error `"<path>: not a directory"` |
| `--roots ","` (no paths) | exit 2, `--roots has no paths` |
| same folder twice / nested (`/etc/ssl,/etc/ssl/certs`) | scanned once; the nested root is skipped with a log line |
| relative path (`--roots certs`) | made absolute, so report paths are absolute |
| default folder missing (e.g. `/etc/pki` on Ubuntu) | skipped silently (log line only) |
| folder or file without permission | error per item, walk continues → `partial` |
| file > 2 MB with a cert extension | `parse_failed` row + error |
| `.p12/.pfx` | `parse_failed` row ("identified; not parsed"), not a run error |
| not a certificate (`garbage.cer`) | `parse_failed` row, not a run error |
| PEM with only a private key / `.key` file | no row; key never decoded |
| symlinks | files are followed; symlinked folders are not (no loops) |
| scanning `/` | works; `/proc`, `/sys`, `/dev` skipped. Can be slow (on OrbStack it also walks the mounted Mac disk) |
| hundreds of errors | `errors` keeps 50 + "... and N more"; `error_count` has the total; full list on stderr |
| `--duration 0s` / negative / `abc` | exit 2 with a message |
| `--iface nope0` | error `"open interface nope0: No Such Device"` → `failed` |
| `tls` without sudo | error `"... Permission Denied (run with sudo)"` → `failed` |
| no TLS traffic during capture | `completed` with 0 connections |
| stopped early (Ctrl+C / SIGTERM) | prints what it captured → `partial` |
| connection started before capture | row with `handshake_outcome: mid_stream`, no SNI |
| TLS on a non-443 port | detected (by packet content, not port) |
| TLS 1.3 | version/cipher/SNI yes, peer certificate no (encrypted) |
| QUIC / HTTP3 (UDP) | not observed (TCP only) |

## Assumptions

- "Expiring" = expires within 30 days.
- TLS capture window defaults to 30 s, so a UI-triggered scan finishes.
- Files over 2 MB are skipped (reported as an error) so a scan cannot stall.
- PKCS#12 (`.p12/.pfx`) is identified and reported as `parse_failed`; it is normally password-protected and we do not try to open it.

## Known limitations

- **No TCP reassembly.** Metadata is read from single packets. SNI/version/cipher are almost always in one packet; a TLS 1.2 Certificate message often spans several, so `peer_cert_*` is best-effort (a 64 KB snap length helps when the kernel merges segments).
- **TLS 1.3 encrypts the server certificate**, so no peer certificate is reported for TLS 1.3 connections. Late TLS 1.3 alerts are encrypted too, so such failures can look `established`.
- **Process mapping can miss very short connections** that close before the lookup runs; those are `unavailable`.
- **Owning process for certificate files** is not attempted (`unavailable`).
- Only TCP (no QUIC/HTTP3). Linux only.
