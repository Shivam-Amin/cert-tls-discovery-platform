package main

import (
	"testing"
	"time"
)

// --- builders for fake TLS bytes (see the layouts in tlsparse.go) ---

func u16(n int) []byte { return []byte{byte(n >> 8), byte(n)} }
func u24(n int) []byte { return []byte{byte(n >> 16), byte(n >> 8), byte(n)} }

func cat(parts ...[]byte) []byte {
	var out []byte
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}

func record(typ int, fragment []byte) []byte {
	return cat([]byte{byte(typ), 0x03, 0x03}, u16(len(fragment)), fragment)
}

func handshake(typ int, body []byte) []byte {
	return cat([]byte{byte(typ)}, u24(len(body)), body)
}

func extension(typ int, data []byte) []byte {
	return cat(u16(typ), u16(len(data)), data)
}

func clientHello(sni string) []byte {
	name := cat([]byte{0}, u16(len(sni)), []byte(sni)) // host_name entry
	exts := extension(extServerName, cat(u16(len(name)), name))
	body := cat(
		u16(0x0303), make([]byte, 32), // version, random
		[]byte{0},           // session id length
		u16(2), u16(0x1301), // one cipher suite
		[]byte{1, 0},         // compression: null
		u16(len(exts)), exts, // extensions
	)
	return record(recordHandshake, handshake(hsClientHello, body))
}

func serverHello(suite int, exts []byte) []byte {
	body := cat(u16(0x0303), make([]byte, 32), []byte{0}, u16(suite), []byte{0}, u16(len(exts)), exts)
	return record(recordHandshake, handshake(hsServerHello, body))
}

func certificateMsg(der []byte) []byte {
	entry := cat(u24(len(der)), der)
	return record(recordHandshake, handshake(hsCertificate, cat(u24(len(entry)), entry)))
}

// --- parser tests ---

func TestClientHelloSNI(t *testing.T) {
	p := parseTLSPayload(clientHello("example.com"))
	if !p.clientHello || p.sni != "example.com" || p.records != 1 {
		t.Fatalf("got %+v", p)
	}
}

func TestServerHelloTLS13(t *testing.T) {
	p := parseTLSPayload(serverHello(0x1301, extension(extSupportedVersions, u16(0x0304))))
	if p.version != "TLS 1.3" || p.cipher != "TLS_AES_128_GCM_SHA256" {
		t.Fatalf("version=%q cipher=%q", p.version, p.cipher)
	}
}

func TestServerHelloAndCertificateInOnePacket(t *testing.T) {
	c := newTestCert(t, "server.test", testNow.Add(90*24*time.Hour), nil)
	p := parseTLSPayload(cat(serverHello(0xc02f, nil), certificateMsg(c.der)))
	if p.records != 2 || p.version != "TLS 1.2" || p.cipher != "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256" {
		t.Fatalf("got %+v", p)
	}
	if p.peerCert == nil || fingerprint(p.peerCert.Raw) != fingerprint(c.der) {
		t.Fatal("peer certificate not parsed")
	}
}

// Packets get cut anywhere; the parser must never panic.
func TestTruncatedPayloadsDoNotPanic(t *testing.T) {
	full := cat(clientHello("example.com"), serverHello(0x1301, extension(extSupportedVersions, u16(0x0304))))
	for n := 0; n <= len(full); n++ {
		parseTLSPayload(full[:n])
	}
}

// --- connection tracking tests ---

func TestBothDirectionsMergeIntoOneConnection(t *testing.T) {
	client := endpoint{"10.0.0.5", 51000}
	server := endpoint{"93.184.216.34", 443}
	local := map[string]struct{}{"10.0.0.5": {}}
	table := newFlowTable(local, func(a, b endpoint) (string, int) { return "curl", 4242 })
	ts := testNow

	table.add(client, server, ts, parseTLSPayload(clientHello("example.com")))
	table.add(server, client, ts, parseTLSPayload(serverHello(0x1301, extension(extSupportedVersions, u16(0x0304)))))
	table.add(client, server, ts, parseTLSPayload(record(recordAppData, []byte("encrypted"))))

	obs := table.observations()
	if len(obs) != 1 {
		t.Fatalf("got %d observations, want 1", len(obs))
	}
	o := obs[0]
	if o.SourceIP != client.IP || o.DestPort != 443 || o.Direction != "outbound" {
		t.Errorf("sides wrong: %+v", o)
	}
	if o.SNI != "example.com" || o.TLSVersion != "TLS 1.3" || o.CipherSuite != "TLS_AES_128_GCM_SHA256" {
		t.Errorf("metadata wrong: %+v", o)
	}
	if o.HandshakeOutcome != "established" || o.EventCount != 3 || o.Process != "curl" || o.PID != 4242 {
		t.Errorf("outcome/count/process wrong: %+v", o)
	}
}

func TestServerHelloFirstStillFindsClient(t *testing.T) {
	// Capture started late: first packet we see goes server -> client.
	client := endpoint{"10.0.0.5", 51000}
	server := endpoint{"10.0.0.9", 8443}
	table := newFlowTable(map[string]struct{}{}, func(a, b endpoint) (string, int) { return "", 0 })
	table.add(server, client, testNow, parseTLSPayload(serverHello(0xc02f, nil)))
	table.add(client, server, testNow, parseTLSPayload(record(recordAlert, []byte{2, 40})))

	o := table.observations()[0]
	if o.SourceIP != client.IP || o.DestPort != 8443 {
		t.Errorf("sides wrong: %+v", o)
	}
	if o.HandshakeOutcome != "failed" || o.Process != unavailable || o.Direction != "unknown" {
		t.Errorf("got %+v", o)
	}
}

func TestTLSRelationshipsDeduplicate(t *testing.T) {
	o := TLSObservation{
		SourceIP: "10.0.0.5", SourcePort: 51000, DestIP: "1.2.3.4", DestPort: 443,
		Direction: "outbound", SNI: "example.com", PeerCertSHA256: "abc", Process: unavailable,
	}
	second := o
	second.SourcePort = 51001 // another connection to the same server

	rels := tlsRelationships("myhost", []TLSObservation{o, second})
	want := map[string]bool{
		"host|myhost|communicates|endpoint|1.2.3.4:443":   true,
		"endpoint|1.2.3.4:443|presents|certificate|abc":   true,
		"host|myhost|uses|certificate|abc":                true,
		"endpoint|1.2.3.4:443|serves|service|example.com": true,
	}
	if len(rels) != len(want) {
		t.Fatalf("got %d edges, want %d: %+v", len(rels), len(want), rels)
	}
	for _, r := range rels {
		key := r.FromType + "|" + r.FromID + "|" + r.Edge + "|" + r.ToType + "|" + r.ToID
		if !want[key] || r.Count != 2 {
			t.Errorf("unexpected edge %s count=%d", key, r.Count)
		}
	}
}

func TestProcAddressFormats(t *testing.T) {
	if got := procAddr4(endpoint{"127.0.0.1", 443}); got != "0100007F:01BB" {
		t.Errorf("ipv4: %s", got)
	}
	if got := procAddr6(endpoint{"::1", 443}); got != "00000000000000000000000001000000:01BB" {
		t.Errorf("ipv6: %s", got)
	}
	if got := procAddr6(endpoint{"10.0.0.1", 80}); got != "0000000000000000FFFF00000100000A:0050" {
		t.Errorf("ipv4-mapped: %s", got)
	}
}
