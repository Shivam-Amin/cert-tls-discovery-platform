package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"time"
)

// Report is the one JSON object a scan prints to stdout.
type Report struct {
	Type            string           `json:"type"`
	Host            string           `json:"host"`
	StartedAt       string           `json:"started_at"`
	EndedAt         string           `json:"ended_at"`
	Status          string           `json:"status"`
	DurationMS      int64            `json:"duration_ms"`
	Counts          map[string]int   `json:"counts"`
	ErrorCount      int              `json:"error_count"` // all errors, even if the list below is cut
	Errors          []string         `json:"errors"`      // at most maxReportedErrors + 1 summary line
	Certificates    []Certificate    `json:"certificates,omitempty"`
	TLSObservations []TLSObservation `json:"tls_observations,omitempty"`
	Relationships   []Relationship   `json:"relationships"`
}

type Certificate struct {
	Path           string   `json:"path"`
	Filename       string   `json:"filename"`
	Format         string   `json:"format"`
	ScanRoot       string   `json:"scan_root"`
	DiscoveredAt   string   `json:"discovered_at"`
	Fingerprint    string   `json:"fingerprint_sha256,omitempty"`
	Duplicate      bool     `json:"duplicate"` // same fingerprint already seen earlier in this scan
	Serial         string   `json:"serial,omitempty"`
	Subject        string   `json:"subject,omitempty"`
	Issuer         string   `json:"issuer,omitempty"`
	SAN            []string `json:"san,omitempty"`
	ChainPosition  *int     `json:"chain_position,omitempty"` // pointer: 0 is a real position, nil means "no chain"
	KeyAlgorithm   string   `json:"key_algorithm,omitempty"`
	KeySize        int      `json:"key_size,omitempty"`
	SignatureAlg   string   `json:"signature_algorithm,omitempty"`
	NotBefore      string   `json:"not_before,omitempty"`
	NotAfter       string   `json:"not_after,omitempty"`
	DaysToExpiry   *int     `json:"days_to_expiry,omitempty"`
	ValidityStatus string   `json:"validity_status,omitempty"`
	ParseStatus    string   `json:"parse_status"`
	Confidence     string   `json:"confidence"`
	OwningProcess  string   `json:"owning_process"`
	ParseError     string   `json:"parse_error,omitempty"`
}

// TLSObservation is one TCP connection. Source is the TLS client,
// destination is the TLS server.
type TLSObservation struct {
	Timestamp        string `json:"timestamp"` // first TLS packet seen
	LastSeen         string `json:"last_seen"`
	SourceIP         string `json:"source_ip"`
	SourcePort       int    `json:"source_port"`
	DestIP           string `json:"destination_ip"`
	DestPort         int    `json:"destination_port"`
	Direction        string `json:"direction"` // outbound: this host is the client
	Transport        string `json:"transport"`
	HandshakeOutcome string `json:"handshake_outcome"`
	SNI              string `json:"sni,omitempty"`
	TLSVersion       string `json:"tls_version,omitempty"`
	CipherSuite      string `json:"cipher_suite,omitempty"`
	PeerCertSHA256   string `json:"peer_cert_sha256,omitempty"`
	PeerCertSubject  string `json:"peer_cert_subject,omitempty"`
	PeerCertIssuer   string `json:"peer_cert_issuer,omitempty"`
	PeerCertNotAfter string `json:"peer_cert_not_after,omitempty"`
	Process          string `json:"process"`
	PID              int    `json:"pid,omitempty"`
	EventCount       int    `json:"event_count"` // TLS records seen on this connection
}

// Relationship is a directed edge between two nodes. A node is (type, id),
// e.g. ("certificate", fingerprint) or ("endpoint", "1.2.3.4:443").
type Relationship struct {
	FromType string `json:"from_type"`
	FromID   string `json:"from_id"`
	ToType   string `json:"to_type"`
	ToID     string `json:"to_id"`
	Edge     string `json:"edge"`
	Count    int    `json:"count"`
}

func newReport(kind, host string, started time.Time, status string, errs []string) Report {
	ended := time.Now()
	if errs == nil {
		errs = []string{} // print [] rather than null
	}
	errorCount := len(errs)
	for _, e := range errs {
		log.Printf("error: %s", e) // full list in the log; the report keeps the first few
	}
	if len(errs) > maxReportedErrors {
		// e.g. scanning "/" can hit thousands of permission errors; keep the report readable.
		more := len(errs) - maxReportedErrors
		errs = append(errs[:maxReportedErrors:maxReportedErrors], fmt.Sprintf("... and %d more errors (see stderr log)", more))
	}
	return Report{
		Type:       kind,
		Host:       host,
		StartedAt:  started.UTC().Format(time.RFC3339),
		EndedAt:    ended.UTC().Format(time.RFC3339),
		Status:     status,
		DurationMS: ended.Sub(started).Milliseconds(),
		ErrorCount: errorCount,
		Errors:     errs,
	}
}

func writeReport(w io.Writer, r Report) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(r)
}

// finishStatus: no results and errors = failed; results and errors = partial.
func finishStatus(found int, errs []string) string {
	switch {
	case found == 0 && len(errs) > 0:
		return statusFailed
	case len(errs) > 0:
		return statusPartial
	default:
		return statusCompleted
	}
}

func exitCode(status string) int {
	if status == statusFailed {
		return 1
	}
	return 0
}

func hostname() string {
	h, err := os.Hostname()
	if err != nil || h == "" {
		return "localhost"
	}
	return h
}

// edgeSet deduplicates edges: adding the same edge again bumps its Count
// instead of creating a copy.
type edgeSet struct {
	byKey map[string]*Relationship
	order []string
}

func newEdgeSet() *edgeSet { return &edgeSet{byKey: map[string]*Relationship{}} }

func (s *edgeSet) add(fromType, fromID, edge, toType, toID string) {
	if fromID == "" || toID == "" {
		return
	}
	key := fromType + "|" + fromID + "|" + edge + "|" + toType + "|" + toID
	if existing, ok := s.byKey[key]; ok {
		existing.Count++
		return
	}
	s.byKey[key] = &Relationship{FromType: fromType, FromID: fromID, ToType: toType, ToID: toID, Edge: edge, Count: 1}
	s.order = append(s.order, key)
}

func (s *edgeSet) list() []Relationship {
	out := make([]Relationship, 0, len(s.order))
	for _, key := range s.order {
		out = append(out, *s.byKey[key])
	}
	return out
}

// fsRelationships: host --stores--> certificate (Count = files holding it).
func fsRelationships(host string, certs []Certificate) []Relationship {
	edges := newEdgeSet()
	for _, c := range certs {
		edges.add("host", host, "stores", "certificate", c.Fingerprint)
	}
	return edges.list()
}

// tlsRelationships builds, per connection:
//
//	process --communicates--> remote endpoint
//	server endpoint --presents--> certificate
//	process --uses--> certificate             (client side)
//	server endpoint --serves--> service (SNI)
//
// When the process is unavailable the local host node stands in for it.
// Count = number of connections that produced the edge.
func tlsRelationships(host string, obs []TLSObservation) []Relationship {
	edges := newEdgeSet()
	for _, o := range obs {
		localType, localID := "process", o.Process
		if o.Process == unavailable {
			localType, localID = "host", host
		}
		client := endpoint{o.SourceIP, o.SourcePort}.String()
		server := endpoint{o.DestIP, o.DestPort}.String()
		cert := o.PeerCertSHA256

		if o.Direction == directionInbound {
			// This host is the server: it talks to a remote client and presents the cert.
			edges.add(localType, localID, "communicates", "endpoint", client)
			edges.add(localType, localID, "presents", "certificate", cert)
		} else {
			edges.add(localType, localID, "communicates", "endpoint", server)
			edges.add("endpoint", server, "presents", "certificate", cert)
			edges.add(localType, localID, "uses", "certificate", cert)
		}
		edges.add("endpoint", server, "serves", "service", o.SNI)
	}
	return edges.list()
}
