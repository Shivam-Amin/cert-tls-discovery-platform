package main

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// scanCertificates walks each root and returns one Certificate per
// certificate found (plus parse_failed rows for files we could not read).
// Errors are access problems (missing root, permission denied, file too big);
// they make the run "partial" but the walk continues.
// Files are only read, never changed.
func scanCertificates(roots []string, now time.Time) ([]Certificate, []string) {
	var certs []Certificate
	var errs []string

	for _, root := range roots {
		info, err := os.Stat(root)
		if err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", root, err))
			continue
		}
		if !info.IsDir() {
			errs = append(errs, fmt.Sprintf("%s: not a directory", root))
			continue
		}

		filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				// e.g. a directory we may not read; record it and keep walking.
				errs = append(errs, fmt.Sprintf("%s: %v", path, err))
				return nil
			}
			if d.IsDir() {
				if skipDirs[path] && path != root {
					return filepath.SkipDir // virtual kernel folders, never real cert files
				}
				return nil
			}
			format, ok := certFileExts[strings.ToLower(filepath.Ext(path))]
			if !ok {
				return nil // .key and everything else is ignored
			}
			found, err := certificatesFromFile(path, root, format, now)
			if err != nil {
				errs = append(errs, err.Error())
			}
			certs = append(certs, found...)
			return nil
		})
	}

	markDuplicates(certs)
	return certs, errs
}

// certificatesFromFile returns one Certificate per certificate in the file.
// The error is only for access problems. A file we can read but not parse
// becomes a parse_failed row, which is a finding, not a run error.
func certificatesFromFile(path, root, format string, now time.Time) ([]Certificate, error) {
	failed := func(msg string) []Certificate {
		return []Certificate{failedCert(path, root, format, now, msg)}
	}

	info, err := os.Stat(path)
	if err != nil {
		return failed(err.Error()), fmt.Errorf("%s: %w", path, err)
	}
	if info.Size() > maxCertFileBytes {
		msg := fmt.Sprintf("file larger than %d bytes, skipped", maxCertFileBytes)
		return failed(msg), fmt.Errorf("%s: %s", path, msg)
	}

	if format == "p12" || format == "pfx" {
		// PKCS#12 keystores are normally password-protected; identify, don't open.
		return failed("PKCS#12 keystore identified; not parsed (password-protected format)"), nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return failed(err.Error()), fmt.Errorf("%s: %w", path, err)
	}

	parsed, sawKey, parseErr := parseCertBytes(data)
	if len(parsed) == 0 {
		if sawKey && parseErr == nil {
			log.Printf("skip %s: private key only, no certificate", path)
			return nil, nil
		}
		return failed(parseErr.Error()), nil
	}
	if parseErr != nil {
		log.Printf("%s: some blocks did not parse: %v", path, parseErr)
	}

	chain := isChain(parsed)
	out := make([]Certificate, 0, len(parsed))
	for i, cert := range parsed {
		c := observationFromX509(path, root, format, now, cert)
		if chain {
			pos := i
			c.ChainPosition = &pos
		}
		out = append(out, c)
	}
	return out, nil
}

// parseCertBytes reads every certificate in PEM data, or one raw DER certificate.
// Private-key PEM blocks are skipped and never decoded; sawKey reports whether
// there were any. firstErr is the first certificate that failed to parse.
func parseCertBytes(data []byte) (certs []*x509.Certificate, sawKey bool, firstErr error) {
	rest := data
	sawPEM := false
	for {
		block, next := pem.Decode(rest)
		if block == nil {
			break
		}
		sawPEM = true
		rest = next
		if strings.Contains(block.Type, "PRIVATE KEY") {
			sawKey = true
			continue
		}
		if !certPEMTypes[block.Type] {
			continue
		}
		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		certs = append(certs, cert)
	}

	if !sawPEM {
		// No PEM blocks at all: try the whole file as binary DER.
		cert, err := x509.ParseCertificate(data)
		if err != nil {
			return nil, false, fmt.Errorf("not PEM, and not DER: %w", err)
		}
		return []*x509.Certificate{cert}, false, nil
	}
	if len(certs) == 0 && firstErr == nil && !sawKey {
		firstErr = errors.New("PEM file has no certificate blocks")
	}
	return certs, sawKey, firstErr
}

// isChain reports whether certs form an issuer chain (each one issued by the
// next), like a server's fullchain.pem. A CA bundle is a list of unrelated
// roots, so its certificates get no chain position.
func isChain(certs []*x509.Certificate) bool {
	if len(certs) < 2 {
		return false
	}
	for i := 0; i+1 < len(certs); i++ {
		if !bytes.Equal(certs[i].RawIssuer, certs[i+1].RawSubject) {
			return false
		}
	}
	return true
}

func observationFromX509(path, root, format string, now time.Time, cert *x509.Certificate) Certificate {
	days := int(cert.NotAfter.Sub(now).Hours() / 24)
	alg, size := publicKeyInfo(cert)

	return Certificate{
		Path:           path,
		Filename:       filepath.Base(path),
		Format:         format,
		ScanRoot:       root,
		DiscoveredAt:   now.UTC().Format(time.RFC3339),
		Fingerprint:    fingerprint(cert.Raw),
		Serial:         cert.SerialNumber.Text(16),
		Subject:        cert.Subject.String(),
		Issuer:         cert.Issuer.String(),
		SAN:            subjectAltNames(cert),
		KeyAlgorithm:   alg,
		KeySize:        size,
		SignatureAlg:   cert.SignatureAlgorithm.String(),
		NotBefore:      cert.NotBefore.UTC().Format(time.RFC3339),
		NotAfter:       cert.NotAfter.UTC().Format(time.RFC3339),
		DaysToExpiry:   &days,
		ValidityStatus: validityStatus(now, cert.NotBefore, cert.NotAfter),
		ParseStatus:    parseOK,
		Confidence:     confidenceHigh,
		OwningProcess:  unavailable,
	}
}

func failedCert(path, root, format string, now time.Time, msg string) Certificate {
	return Certificate{
		Path:          path,
		Filename:      filepath.Base(path),
		Format:        format,
		ScanRoot:      root,
		DiscoveredAt:  now.UTC().Format(time.RFC3339),
		ParseStatus:   parseFailed,
		Confidence:    confidenceLow,
		OwningProcess: unavailable,
		ParseError:    msg,
	}
}

// fingerprint is the SHA-256 of the certificate's DER bytes, as hex.
// Same certificate => same fingerprint, whatever file or format it is in.
func fingerprint(der []byte) string {
	sum := sha256.Sum256(der)
	return hex.EncodeToString(sum[:])
}

// markDuplicates flags every observation of a fingerprint after the first.
// All rows are kept, so every path holding the certificate stays visible.
func markDuplicates(certs []Certificate) {
	seen := map[string]bool{}
	for i := range certs {
		fp := certs[i].Fingerprint
		if fp == "" {
			continue
		}
		certs[i].Duplicate = seen[fp]
		seen[fp] = true
	}
}

func validityStatus(now, notBefore, notAfter time.Time) string {
	switch {
	case now.After(notAfter):
		return validityExpired
	case now.Before(notBefore):
		return validityNotYetValid
	case notAfter.Sub(now) <= expiringWindow:
		return validityExpiring
	default:
		return validityValid
	}
}

func publicKeyInfo(cert *x509.Certificate) (string, int) {
	switch k := cert.PublicKey.(type) {
	case *rsa.PublicKey:
		return "RSA", k.N.BitLen()
	case *ecdsa.PublicKey:
		return "ECDSA", k.Curve.Params().BitSize
	case ed25519.PublicKey:
		return "Ed25519", len(k) * 8
	default:
		return cert.PublicKeyAlgorithm.String(), 0
	}
}

func subjectAltNames(cert *x509.Certificate) []string {
	var names []string
	names = append(names, cert.DNSNames...)
	for _, ip := range cert.IPAddresses {
		names = append(names, ip.String())
	}
	names = append(names, cert.EmailAddresses...)
	for _, uri := range cert.URIs {
		names = append(names, uri.String())
	}
	return names
}

// certificateCounts gives the dashboard totals. Unique and validity counts
// use first observations only, so a cert found in 3 files counts once.
func certificateCounts(certs []Certificate) map[string]int {
	counts := map[string]int{
		"certificates_found":     len(certs),
		"unique_certificates":    0,
		"duplicate_observations": 0,
		validityValid:            0,
		validityExpiring:         0,
		validityExpired:          0,
		validityNotYetValid:      0,
		"parse_failed":           0,
	}
	for _, c := range certs {
		switch {
		case c.ParseStatus != parseOK:
			counts["parse_failed"]++
		case c.Duplicate:
			counts["duplicate_observations"]++
		default:
			counts["unique_certificates"]++
			counts[c.ValidityStatus]++
		}
	}
	return counts
}
