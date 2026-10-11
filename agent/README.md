# Agent

Go binary with two commands. Each run prints one JSON report to stdout and log lines to stderr.

```bash
sudo ./agent-linux filesystem [--roots /opt/certs,/srv/tls] [--include-defaults]
sudo ./agent-linux tls [--iface any] [--duration 30s]
```

| | |
|---|---|
| OS | Linux (tested on Ubuntu 26.04 arm64) |
| Size | 4,502,656 bytes (~4.5 MB) |
| Build | Go 1.22+, cgo, libpcap |
| Third-party | `github.com/google/gopacket` (packet capture); everything else is the Go standard library |

## Build

Inside Linux (on macOS: `orb -m ubuntu`, see the main README), from this folder:

```bash
sudo apt install -y golang libpcap-dev
go build -trimpath -ldflags="-s -w" -o agent-linux .
stat -c "%s bytes" agent-linux      # check size
go test ./...
```

`-s -w` strips debug info to keep the binary small. To run an already-built binary you only need `libpcap0.8` (installed with `libpcap-dev`).

## Privileges

Run with `sudo`. `tls` needs root for packet capture. `filesystem` works without root, but root-only folders such as `/etc/ssl/private` are then reported as errors and the run is `partial`. The agent only reads files; it never changes them.

## Testing by hand

```bash
sudo ./agent-linux filesystem
sudo ./agent-linux filesystem --roots /nope,/etc/ssl    # partial: error for /nope

sudo ./agent-linux tls --duration 15s
# meanwhile, in another terminal:
curl -s -o /dev/null https://example.com
curl -s -o /dev/null --tls-max 1.2 https://github.com    # TLS 1.2 shows the server certificate

# error cases
sudo ./agent-linux filesystem --roots /does/not/exist     # status "failed", exit code 1
./agent-linux tls --duration 2s                            # no sudo: status "failed"
```

To save a report: `sudo ./agent-linux filesystem > fs.json`.

### Demo certificate files (optional)

`scripts/make-fixtures.sh` creates test files in `/tmp/certfix`: expired, expiring and not-yet-valid certificates, a chain, a bundle, duplicates, key files, a PKCS#12 file, an invalid file and an unreadable file. Needs OpenSSL 3.4+.

```bash
scripts/make-fixtures.sh
./agent-linux filesystem --roots /tmp/certfix     # without sudo: partial, because of locked.pem
```

## Filesystem scan

- **Folders:** common folders are `/etc/ssl`, `/usr/local/share/ca-certificates` and `/etc/pki` (missing ones skipped). No `--roots`: only these. `--roots a,b`: only `a,b`. `--roots a,b --include-defaults`: both. Nested or repeated folders are scanned once. A missing `--roots` folder is an error.
- **Files:** `.pem .crt .cer .der .p12 .pfx`. A PEM file can hold several certificates; other files are tried as PEM, then DER.
- **Private keys:** `.key` files are not opened and `PRIVATE KEY` blocks are skipped. No key material is output.
- **Per certificate:** path, filename, format, scan root, discovered at, SHA-256 fingerprint, serial, subject, issuer, SAN, chain position, key algorithm and size, signature algorithm, validity dates, days to expiry, status (`valid`, `expiring`, `expired`, `not_yet_valid`), parse status, confidence.
- **Duplicates:** fingerprint = SHA-256 of the certificate bytes. Repeats stay as rows marked `duplicate: true` and are not counted in `unique_certificates`.
- **Chain position** is set only when the certificates in a file form a chain (like `fullchain.pem`), not for CA bundles.

## TLS scan

Passive capture with libpcap (filter `tcp`, promiscuous mode off) for `--duration`. Only handshake metadata is read; nothing is decrypted and no payload is stored.

- One row per TCP connection; both directions are merged. Source = TLS client, destination = TLS server.
- **Fields:** first/last seen, IPs and ports, direction (`outbound`, `inbound`, `unknown`), handshake outcome, SNI, TLS version, cipher suite, peer certificate (fingerprint, subject, issuer, expiry), process and PID, `event_count` (TLS records seen).
- **Handshake outcome:** `established`, `failed` (alert before data), `handshake_incomplete`, `client_hello_only`, `mid_stream` (started before the capture).
- **Process mapping:** `/proc/net/tcp` and `tcp6` give the socket inode, `/proc/<pid>/fd` gives the PID. `unavailable` when not found.
- Results are printed once at the end of `--duration`. If stopped early (Ctrl+C or SIGTERM), the agent prints what it captured, as `partial`.

## Relationships

Edges with a `count`. Filesystem: `host stores certificate`. TLS: `process communicates endpoint`, `endpoint presents certificate`, `process uses certificate`, `endpoint serves service (SNI)`; the host is used when the process is unknown. Repeated observations increase the count.

## Report shape

```json
{
  "type": "filesystem | tls",
  "host": "ubuntu",
  "started_at": "...", "ended_at": "...", "duration_ms": 8,
  "status": "completed | partial | failed",
  "counts": { ... },
  "error_count": 1,
  "errors": ["/etc/ssl/private: open /etc/ssl/private: permission denied"],
  "certificates": [ ... ],        // filesystem only
  "tls_observations": [ ... ],    // tls only
  "relationships": [ {"from_type","from_id","edge","to_type","to_id","count"} ]
}
```

`failed`: errors and no results. `partial`: results and errors. `completed`: no errors. At most 50 errors are listed; `error_count` has the total.

Exit codes: `0` completed or partial, `1` failed, `2` invalid arguments (message on stderr, no JSON).

## Edge cases

A bad path or file never stops a scan: it is added to `errors` and the scan continues. Only invalid arguments stop the agent (exit 2).

| Case | Result |
|---|---|
| `--roots /nope` | error, nothing scanned: `failed` |
| `--roots /nope,/etc/ssl` | `/etc/ssl` scanned, error for `/nope`: `partial` |
| folder or file without permission | error for that item: `partial` |
| `.p12/.pfx`, or not a certificate | `parse_failed` row, not a run error |
| file over 2 MB | skipped with an error |
| scanning `/` | works; `/proc`, `/sys`, `/dev` skipped; can be slow |
| `tls` without sudo, or unknown `--iface` | `failed` with the reason |
| no TLS traffic | `completed` with 0 connections |
| TLS on a port other than 443 | detected (by packet content) |

## Assumptions

- "Expiring" = expires within 30 days.
- TLS capture defaults to 30 s.
- Files over 2 MB are skipped so a scan cannot stall.
- PKCS#12 (`.p12/.pfx`) is identified and reported as `parse_failed`; it is normally password-protected and we do not try to open it.

## Known limitations

- No TCP reassembly: a TLS 1.2 server certificate split across packets can be missed.
- TLS 1.3 encrypts the server certificate, so it is not reported.
- Very short connections can close before the process lookup (`unavailable`).
- Owning process of certificate files is not detected.
- TCP only (no QUIC/HTTP3). Linux only.
