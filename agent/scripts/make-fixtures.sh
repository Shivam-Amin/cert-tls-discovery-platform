#!/usr/bin/env bash
# Creates a folder of test certificate files covering every case the
# filesystem scan handles. Usage: scripts/make-fixtures.sh [dir]  (default /tmp/certfix)
# Needs OpenSSL 3.4+ (for -not_before / -not_after).
set -euo pipefail

DIR="${1:-/tmp/certfix}"
rm -rf "$DIR"
mkdir -p "$DIR/sub"
cd "$DIR"

# self-signed EC cert: file, CN, then validity flags
selfsigned() {
  local file="$1" cn="$2"
  shift 2
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
    -keyout "$file.key.tmp" -out "$file" -subj "/CN=$cn" "$@" 2>/dev/null
}

selfsigned valid.pem     valid.test     -days 365
selfsigned expiring.crt  expiring.test  -days 10
selfsigned expired.pem   expired.test   -not_before 20240101000000Z -not_after 20250101000000Z
selfsigned future.pem    future.test    -not_before 20300101000000Z -not_after 20310101000000Z

# RSA cert stored as binary DER
openssl req -x509 -newkey rsa:2048 -nodes -keyout rsa.key.tmp -subj "/CN=rsa.test" \
  -days 365 -outform DER -out rsa2048.der 2>/dev/null

# Real chain: CA signs leaf; fullchain.pem = leaf then CA
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout ca.key.tmp \
  -subj "/CN=Fixture CA" -days 365 -out ca.crt.tmp 2>/dev/null
openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout leaf.key.tmp \
  -subj "/CN=leaf.test" -out leaf.csr.tmp 2>/dev/null
openssl x509 -req -in leaf.csr.tmp -CA ca.crt.tmp -CAkey ca.key.tmp -days 90 -out leaf.crt.tmp 2>/dev/null
cat leaf.crt.tmp ca.crt.tmp > fullchain.pem

# Bundle of unrelated certs (no chain position expected)
cat valid.pem expiring.crt > bundle.pem

# Cert + private key in one file: cert reported, key ignored
cat valid.pem valid.pem.key.tmp > with-key.pem

# Key-only files: never reported
cp valid.pem.key.tmp server.key
cp valid.pem.key.tmp key-only.pem

# PKCS#12 keystore (password protected): identified, parse_failed
openssl pkcs12 -export -in valid.pem -inkey valid.pem.key.tmp -passout pass:secret -out store.p12

# Not a certificate: parse_failed
echo "hello, not a cert" > garbage.cer

# Same cert in another folder: duplicate observation
cp valid.pem sub/copy-of-valid.pem

# Unreadable file: access error, run becomes partial (unless run as root)
cp valid.pem locked.pem
chmod 000 locked.pem

rm -f ./*.tmp
echo "fixtures in $DIR:"
ls -la "$DIR" "$DIR/sub"
