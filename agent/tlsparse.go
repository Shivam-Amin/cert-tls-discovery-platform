package main

import (
	"crypto/x509"
	"encoding/binary"
	"fmt"
)

// This file reads TLS handshake metadata out of raw TCP payload bytes.
// It only looks at plaintext handshake messages; it never decrypts anything.
//
// Every TLS message is "length-prefixed": read a length, then that many bytes.
// The reader type below does the bounds checks so the parsers stay short.

// TLS record types (first byte of every record).
const (
	recordChangeCipherSpec = 0x14
	recordAlert            = 0x15
	recordHandshake        = 0x16
	recordAppData          = 0x17
)

// Handshake message types (first byte inside a handshake record).
const (
	hsClientHello = 0x01
	hsServerHello = 0x02
	hsCertificate = 0x0b
)

// Extension types.
const (
	extServerName        = 0x0000
	extSupportedVersions = 0x002b
)

// Fixed header sizes, in bytes (layouts are in the comments below).
const (
	recordHeaderLen    = 5 // type:1 version:2 length:2
	handshakeHeaderLen = 4 // type:1 length:3
	extensionHeaderLen = 4 // type:2 length:2
	sniEntryHeaderLen  = 3 // name_type:1 name_len:2
)

// packetTLS is what one TCP segment told us about TLS.
type packetTLS struct {
	records     int
	clientHello bool
	serverHello bool
	appData     bool
	alert       bool
	sni         string
	version     string            // negotiated version, from ServerHello
	cipher      string            // negotiated cipher, from ServerHello
	peerCert    *x509.Certificate // first cert of a TLS 1.2 Certificate message
}

// looksLikeTLS is a quick check on the first bytes before parsing:
// a known record type followed by version major 3 (SSL 3.0 / TLS 1.x).
func looksLikeTLS(payload []byte) bool {
	return len(payload) >= recordHeaderLen &&
		payload[0] >= recordChangeCipherSpec && payload[0] <= recordAppData &&
		payload[1] == 0x03 && payload[2] <= 0x04
}

// parseTLSPayload walks all TLS records in one TCP payload.
//
// Record: [type:1][version:2][length:2][fragment:length]
//
// The last record may be cut off at the end of the packet; we parse what is
// there. We do not reassemble records that span several TCP segments.
func parseTLSPayload(payload []byte) packetTLS {
	var p packetTLS
	r := &reader{b: payload}
	for r.left() >= recordHeaderLen {
		typ := r.u8()
		version := r.u16() // record-layer version; not the negotiated one
		fragment := r.atMost(r.u16())
		if typ < recordChangeCipherSpec || typ > recordAppData || version>>8 != 0x03 {
			break // not TLS (or we lost track of record boundaries)
		}
		p.records++
		switch typ {
		case recordHandshake:
			parseHandshakes(fragment, &p)
		case recordAppData:
			p.appData = true
		case recordAlert:
			p.alert = true
		}
	}
	return p
}

// parseHandshakes reads handshake messages inside one handshake record.
//
// Handshake message: [type:1][length:3][body:length]
func parseHandshakes(fragment []byte, p *packetTLS) {
	r := &reader{b: fragment}
	for r.left() >= handshakeHeaderLen {
		typ := r.u8()
		body := r.atMost(r.u24())
		// Encrypted handshake messages (TLS 1.2 Finished) look like random
		// bytes. Real hellos start with version major 3, so check that.
		switch typ {
		case hsClientHello:
			if isHelloBody(body) {
				p.clientHello = true
				p.sni = clientHelloSNI(body)
			}
		case hsServerHello:
			if isHelloBody(body) {
				p.serverHello = true
				p.version, p.cipher = serverHelloInfo(body)
			}
		case hsCertificate:
			if cert := firstCertificate(body); cert != nil {
				p.peerCert = cert
			}
		}
	}
}

func isHelloBody(body []byte) bool {
	return len(body) >= 2 && body[0] == 0x03
}

// clientHelloSNI returns the server_name (SNI) the client asked for.
//
// ClientHello body:
//
//	[version:2][random:32]
//	[session_id_len:1][session_id]
//	[cipher_suites_len:2][cipher_suites]
//	[compression_len:1][compression]
//	[extensions_len:2][extensions]
func clientHelloSNI(body []byte) string {
	r := &reader{b: body}
	r.skip(2 + 32)
	r.skip(r.u8())
	r.skip(r.u16())
	r.skip(r.u8())
	exts := r.atMost(r.u16())
	if r.bad {
		return ""
	}

	// server_name extension: [list_len:2] then entries of [name_type:1][name_len:2][name]
	data := findExtension(exts, extServerName)
	s := &reader{b: data}
	s.skip(2)
	for s.left() >= sniEntryHeaderLen {
		nameType := s.u8()
		name := s.bytes(s.u16())
		if s.bad {
			return ""
		}
		if nameType == 0 { // 0 = host_name
			return string(name)
		}
	}
	return ""
}

// serverHelloInfo returns the negotiated TLS version and cipher suite.
//
// ServerHello body:
//
//	[version:2][random:32]
//	[session_id_len:1][session_id]
//	[cipher_suite:2][compression:1]
//	[extensions_len:2][extensions]
//
// TLS 1.3 always writes 0x0303 (TLS 1.2) in the version field and puts the
// real version in the supported_versions extension, so check that too.
func serverHelloInfo(body []byte) (version, cipher string) {
	r := &reader{b: body}
	legacyVersion := r.u16()
	r.skip(32)
	r.skip(r.u8())
	suite := r.u16()
	if r.bad {
		return "", ""
	}
	version = tlsVersionName(legacyVersion)
	cipher = cipherName(suite)

	r.skip(1)
	exts := r.atMost(r.u16())
	if sv := findExtension(exts, extSupportedVersions); len(sv) == 2 {
		version = tlsVersionName(int(binary.BigEndian.Uint16(sv)))
	}
	return version, cipher
}

// firstCertificate parses the first (server/leaf) certificate of a TLS 1.2
// Certificate message. In TLS 1.3 this message is encrypted, so we never see it.
//
// Certificate body: [certs_len:3] then entries of [cert_len:3][cert DER]
func firstCertificate(body []byte) *x509.Certificate {
	r := &reader{b: body}
	r.skip(3)
	der := r.bytes(r.u24())
	if r.bad {
		return nil // usually: certificate continues in the next TCP segment
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		return nil
	}
	return cert
}

// findExtension returns the data of one extension, or nil.
//
// Extension: [type:2][length:2][data:length]
func findExtension(exts []byte, want int) []byte {
	r := &reader{b: exts}
	for r.left() >= extensionHeaderLen {
		typ := r.u16()
		data := r.bytes(r.u16())
		if r.bad {
			return nil
		}
		if typ == want {
			return data
		}
	}
	return nil
}

func tlsVersionName(id int) string {
	if name, ok := tlsVersionNames[id]; ok {
		return name
	}
	return fmt.Sprintf("0x%04x", id)
}

func cipherName(id int) string {
	if name, ok := cipherSuiteNames[id]; ok {
		return name
	}
	return fmt.Sprintf("0x%04x", id)
}

// reader reads big-endian numbers and byte runs from a slice.
//
// Reading past the end does not panic: it returns zero/nil and sets bad.
// That lets a parser read a whole structure and check r.bad once at the end,
// instead of a bounds check before every field.
type reader struct {
	b   []byte
	bad bool
}

func (r *reader) left() int { return len(r.b) }

// bytes returns the next n bytes, or nil (and sets bad) if there are fewer.
func (r *reader) bytes(n int) []byte {
	if n < 0 || n > len(r.b) {
		r.bad = true
		r.b = nil
		return nil
	}
	out := r.b[:n]
	r.b = r.b[n:]
	return out
}

// atMost returns up to n bytes. Used for a message that may be cut off at the
// end of the packet: we still want the part we have.
func (r *reader) atMost(n int) []byte {
	return r.bytes(min(n, r.left()))
}

func (r *reader) skip(n int) { r.bytes(n) }

func (r *reader) u8() int {
	b := r.bytes(1)
	if b == nil {
		return 0
	}
	return int(b[0])
}

func (r *reader) u16() int {
	b := r.bytes(2)
	if b == nil {
		return 0
	}
	return int(binary.BigEndian.Uint16(b))
}

func (r *reader) u24() int {
	b := r.bytes(3)
	if b == nil {
		return 0
	}
	return int(b[0])<<16 | int(b[1])<<8 | int(b[2])
}
