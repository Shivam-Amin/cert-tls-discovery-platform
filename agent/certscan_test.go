package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"
)

var testNow = time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)

func TestScanCertificatesFixture(t *testing.T) {
	dir := t.TempDir()

	a := newTestCert(t, "a.test", testNow.Add(90*24*time.Hour), nil)
	b := newTestCert(t, "b.test", testNow.Add(10*24*time.Hour), nil)
	ca := newTestCert(t, "Test CA", testNow.Add(365*24*time.Hour), nil)
	leaf := newTestCert(t, "leaf.test", testNow.Add(90*24*time.Hour), &ca)

	pemOf := func(typ string, der []byte) []byte { return pem.EncodeToMemory(&pem.Block{Type: typ, Bytes: der}) }
	key := pemOf("PRIVATE KEY", []byte("not-a-real-key"))

	files := map[string][]byte{
		"leaf.pem":      pemOf("CERTIFICATE", a.der),
		"leaf.der":      a.der,
		"dup.crt":       pemOf("CERTIFICATE", a.der),
		"with-key.pem":  append(pemOf("CERTIFICATE", a.der), key...),
		"bundle.pem":    append(pemOf("CERTIFICATE", a.der), pemOf("CERTIFICATE", b.der)...),
		"fullchain.pem": append(pemOf("CERTIFICATE", leaf.der), pemOf("CERTIFICATE", ca.der)...),
		"key-only.pem":  key,                    // skipped: no certificate
		"only.key":      key,                    // skipped: extension not scanned
		"notes.txt":     []byte("hello"),        // skipped: extension not scanned
		"store.p12":     []byte("pkcs12-bytes"), // parse_failed, not a run error
		"garbage.pem":   []byte("not a cert"),   // parse_failed, not a run error
	}
	for name, data := range files {
		if err := os.WriteFile(filepath.Join(dir, name), data, 0o644); err != nil {
			t.Fatal(err)
		}
	}

	certs, errs := scanCertificates([]string{dir}, testNow)

	if len(errs) != 0 {
		t.Fatalf("unexpected errors: %v", errs)
	}
	counts := certificateCounts(certs)
	want := map[string]int{
		"certificates_found":     10, // 8 parsed + 2 parse_failed
		"unique_certificates":    4,  // a, b, ca, leaf
		"duplicate_observations": 4,  // a appears 5 times
		"parse_failed":           2,
		"valid":                  3,
		"expiring":               1, // b
	}
	for k, v := range want {
		if counts[k] != v {
			t.Errorf("counts[%s]=%d want %d (all: %v)", k, counts[k], v, counts)
		}
	}

	for _, c := range certs {
		switch c.Filename {
		case "key-only.pem", "only.key", "notes.txt":
			t.Errorf("%s should not be reported", c.Filename)
		case "bundle.pem":
			if c.ChainPosition != nil {
				t.Errorf("bundle of unrelated certs should have no chain position")
			}
		case "fullchain.pem":
			if c.ChainPosition == nil {
				t.Fatalf("fullchain.pem should have chain positions")
			}
			if c.Subject == "CN=leaf.test" && *c.ChainPosition != 0 ||
				c.Subject == "CN=Test CA" && *c.ChainPosition != 1 {
				t.Errorf("%s at chain position %d", c.Subject, *c.ChainPosition)
			}
		case "leaf.der":
			if c.KeyAlgorithm != "ECDSA" || c.KeySize != 256 {
				t.Errorf("key info %s/%d", c.KeyAlgorithm, c.KeySize)
			}
		}
	}
}

func TestUnreadableFileMakesRunPartial(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root can read any file")
	}
	dir := t.TempDir()
	a := newTestCert(t, "a.test", testNow.Add(90*24*time.Hour), nil)
	os.WriteFile(filepath.Join(dir, "ok.der"), a.der, 0o644)
	locked := filepath.Join(dir, "locked.pem")
	os.WriteFile(locked, a.der, 0o000)

	certs, errs := scanCertificates([]string{dir}, testNow)
	if len(errs) != 1 {
		t.Fatalf("errors=%v want 1", errs)
	}
	if got := finishStatus(countParsed(certs), errs); got != statusPartial {
		t.Fatalf("status=%s want partial", got)
	}
}

func TestMissingRootIsError(t *testing.T) {
	certs, errs := scanCertificates([]string{"/does/not/exist"}, testNow)
	if len(errs) != 1 || finishStatus(countParsed(certs), errs) != statusFailed {
		t.Fatalf("errs=%v", errs)
	}
}

func TestValidityStatus(t *testing.T) {
	now := testNow
	cases := []struct {
		notBefore, notAfter time.Time
		want                string
	}{
		{now.Add(-time.Hour), now.Add(-time.Minute), "expired"},
		{now.Add(-time.Hour), now.Add(10 * 24 * time.Hour), "expiring"},
		{now.Add(-time.Hour), now.Add(90 * 24 * time.Hour), "valid"},
		{now.Add(time.Hour), now.Add(90 * 24 * time.Hour), "not_yet_valid"},
	}
	for _, c := range cases {
		if got := validityStatus(now, c.notBefore, c.notAfter); got != c.want {
			t.Errorf("got %s want %s", got, c.want)
		}
	}
}

type testCert struct {
	der  []byte
	cert *x509.Certificate
	key  *ecdsa.PrivateKey
}

// newTestCert makes a certificate signed by parent, or self-signed if parent is nil.
func newTestCert(t *testing.T, cn string, notAfter time.Time, parent *testCert) testCert {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	serial, _ := rand.Int(rand.Reader, big.NewInt(1<<62))
	tmpl := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: cn},
		NotBefore:             testNow.Add(-24 * time.Hour),
		NotAfter:              notAfter,
		DNSNames:              []string{cn},
		IsCA:                  parent == nil,
		BasicConstraintsValid: true,
	}
	signer, signKey := tmpl, key
	if parent != nil {
		signer, signKey = parent.cert, parent.key
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, signer, &key.PublicKey, signKey)
	if err != nil {
		t.Fatal(err)
	}
	cert, _ := x509.ParseCertificate(der)
	return testCert{der: der, cert: cert, key: key}
}

func TestCleanRoots(t *testing.T) {
	got := cleanRoots([]string{"/etc/ssl/certs", "/etc/ssl", "/etc/ssl-old", "/etc/ssl/", "/opt/certs"})
	want := []string{"/etc/ssl", "/opt/certs", "/etc/ssl-old"}
	if len(got) != len(want) {
		t.Fatalf("got %v want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v want %v", got, want)
		}
	}
	if rel := cleanRoots([]string{"certs"})[0]; !filepath.IsAbs(rel) {
		t.Fatalf("relative root not made absolute: %s", rel)
	}
}
