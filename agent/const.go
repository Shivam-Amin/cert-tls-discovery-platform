package main

import "time"

const (
	// Assignment does not define “expiring”; certs that end within this window are expiring.
	expiringWindow = 30 * 24 * time.Hour

	// Skip huge files so a UI-triggered scan cannot stall on a random blob.
	maxCertFileBytes = 2 * 1024 * 1024

	// Keep at most this many messages in the report's errors list.
	maxReportedErrors = 50

	defaultTLSDuration = 30 * time.Second
	defaultTLSIface    = "any"
	pcapSnapLen        = 65535 // whole packet: lets a TLS 1.2 Certificate message fit when the kernel merges segments
	pcapReadTimeout    = time.Second

	statusCompleted = "completed"
	statusPartial   = "partial"
	statusFailed    = "failed"

	scanFilesystem = "filesystem"
	scanTLS        = "tls"

	confidenceHigh = "high"
	confidenceLow  = "low"

	parseOK     = "ok"
	parseFailed = "parse_failed"

	// Value for fields the assignment says to mark when we cannot find them.
	unavailable = "unavailable"

	// Certificate validity_status; also used as count keys.
	validityValid       = "valid"
	validityExpiring    = "expiring"
	validityExpired     = "expired"
	validityNotYetValid = "not_yet_valid"

	// TLS connection direction, seen from this host.
	directionOutbound = "outbound" // this host is the TLS client
	directionInbound  = "inbound"  // this host is the TLS server
	directionUnknown  = "unknown"
)

// Common Linux certificate locations. Missing dirs are skipped, not errors.
var defaultScanRoots = []string{
	"/etc/ssl",
	"/usr/local/share/ca-certificates",
	"/etc/pki",
}

// Linux virtual folders skipped while walking (e.g. when scanning "/").
var skipDirs = map[string]bool{
	"/proc": true,
	"/sys":  true,
	"/dev":  true,
}

var certFileExts = map[string]string{
	".pem": "pem",
	".crt": "crt",
	".cer": "cer",
	".der": "der",
	".p12": "p12",
	".pfx": "pfx",
}

var certPEMTypes = map[string]bool{
	"CERTIFICATE":         true,
	"X509 CERTIFICATE":    true,
	"TRUSTED CERTIFICATE": true,
}

var tlsVersionNames = map[int]string{
	0x0301: "TLS 1.0",
	0x0302: "TLS 1.1",
	0x0303: "TLS 1.2",
	0x0304: "TLS 1.3",
}

// Well-known suites only; unknown ids are printed as hex.
var cipherSuiteNames = map[int]string{
	0x002f: "TLS_RSA_WITH_AES_128_CBC_SHA",
	0x0035: "TLS_RSA_WITH_AES_256_CBC_SHA",
	0x009c: "TLS_RSA_WITH_AES_128_GCM_SHA256",
	0x009d: "TLS_RSA_WITH_AES_256_GCM_SHA384",
	0xc013: "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA",
	0xc014: "TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA",
	0xc02b: "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
	0xc02c: "TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384",
	0xc02f: "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
	0xc030: "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
	0xcca8: "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256",
	0xcca9: "TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256",
	0x1301: "TLS_AES_128_GCM_SHA256",
	0x1302: "TLS_AES_256_GCM_SHA384",
	0x1303: "TLS_CHACHA20_POLY1305_SHA256",
}
