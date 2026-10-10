package main

import (
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/google/gopacket"
	"github.com/google/gopacket/layers"
	"github.com/google/gopacket/pcap"
)

// endpoint is one side of a TCP connection.
type endpoint struct {
	IP   string
	Port int
}

func (e endpoint) String() string { return net.JoinHostPort(e.IP, strconv.Itoa(e.Port)) }

// observeTLS captures TCP packets for the given duration and groups TLS
// metadata per connection. It returns the observations, how many packets
// carried TLS, and any errors.
func observeTLS(iface string, duration time.Duration) ([]TLSObservation, int, []string) {
	handle, err := openCapture(iface)
	if err != nil {
		msg := fmt.Sprintf("open interface %s: %v", iface, err)
		if strings.Contains(strings.ToLower(err.Error()), "permission") {
			msg += " (run with sudo)"
		}
		return nil, 0, []string{msg}
	}
	defer handle.Close()

	if err := handle.SetBPFFilter("tcp"); err != nil {
		return nil, 0, []string{fmt.Sprintf("bpf filter: %v", err)}
	}

	// If we are stopped early (Ctrl+C, or the backend kills a run), finish the
	// loop and still print what we captured instead of exiting with nothing.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(stop)

	log.Printf("capturing TLS metadata on %s for %s", iface, duration)
	table := newFlowTable(localIPSet(), resolveProcess)
	var errs []string
	deadline := time.Now().Add(duration)
	for time.Now().Before(deadline) {
		if sig := receivedSignal(stop); sig != nil {
			errs = append(errs, fmt.Sprintf("capture stopped early by %s; results cover only the time captured", sig))
			break
		}
		data, ci, err := handle.ReadPacketData()
		if err == pcap.NextErrorTimeoutExpired {
			continue // no packet this second; check the deadline again
		}
		if err != nil {
			errs = append(errs, fmt.Sprintf("read packet: %v", err))
			break
		}
		packet := gopacket.NewPacket(data, handle.LinkType(), gopacket.DecodeOptions{Lazy: true, NoCopy: true})
		src, dst, payload, ok := tcpPayload(packet)
		if !ok || !looksLikeTLS(payload) {
			continue
		}
		table.add(src, dst, ci.Timestamp, parseTLSPayload(payload))
	}
	return table.observations(), table.packets, errs
}

// receivedSignal returns a pending stop signal, or nil without waiting.
func receivedSignal(stop chan os.Signal) os.Signal {
	select {
	case sig := <-stop:
		return sig
	default:
		return nil
	}
}

// openCapture opens a live capture.
//   - promisc off: we only want this host's own traffic.
//   - immediate mode: by default libpcap hands packets over in batches, up to
//     a second late. A short connection (e.g. curl) is closed by then and the
//     /proc process lookup misses it.
func openCapture(iface string) (*pcap.Handle, error) {
	inactive, err := pcap.NewInactiveHandle(iface)
	if err != nil {
		return nil, err
	}
	defer inactive.CleanUp()
	if err := inactive.SetSnapLen(pcapSnapLen); err != nil {
		return nil, err
	}
	if err := inactive.SetPromisc(false); err != nil {
		return nil, err
	}
	if err := inactive.SetTimeout(pcapReadTimeout); err != nil {
		return nil, err
	}
	if err := inactive.SetImmediateMode(true); err != nil {
		return nil, err
	}
	return inactive.Activate()
}

func tcpPayload(packet gopacket.Packet) (src, dst endpoint, payload []byte, ok bool) {
	tcp, _ := packet.Layer(layers.LayerTypeTCP).(*layers.TCP)
	if tcp == nil {
		return src, dst, nil, false
	}
	var srcIP, dstIP net.IP
	switch ip := packet.NetworkLayer().(type) {
	case *layers.IPv4:
		srcIP, dstIP = ip.SrcIP, ip.DstIP
	case *layers.IPv6:
		srcIP, dstIP = ip.SrcIP, ip.DstIP
	default:
		return src, dst, nil, false
	}
	src = endpoint{IP: srcIP.String(), Port: int(tcp.SrcPort)}
	dst = endpoint{IP: dstIP.String(), Port: int(tcp.DstPort)}
	return src, dst, tcp.Payload, true
}

// flowTable merges packets of the same TCP connection into one observation.
// Packets in both directions (client->server and server->client) share one
// entry, so SNI (from the client) and cipher (from the server) end up together.
type flowTable struct {
	localIPs map[string]struct{}
	resolve  func(a, b endpoint) (string, int) // process lookup; swapped out in tests
	flows    map[string]*flow
	order    []string // keys in first-seen order, so output is stable
	packets  int
}

type flow struct {
	obs TLSObservation
	// sure is true once a hello message told us which side is the client.
	sure bool
	// What we saw on this connection; turned into HandshakeOutcome at the end.
	clientHello, serverHello, appData, alertBeforeData bool
}

func newFlowTable(localIPs map[string]struct{}, resolve func(a, b endpoint) (string, int)) *flowTable {
	return &flowTable{localIPs: localIPs, resolve: resolve, flows: map[string]*flow{}}
}

func (t *flowTable) add(src, dst endpoint, ts time.Time, p packetTLS) {
	t.packets++
	client, server, sure := orient(src, dst, p)
	key := connKey(src, dst)

	f, ok := t.flows[key]
	if !ok {
		f = &flow{obs: TLSObservation{Timestamp: ts.UTC().Format(time.RFC3339Nano), Transport: "tcp"}}
		t.setSides(f, client, server)
		// Look the process up now, while the connection is still open.
		f.obs.Process, f.obs.PID = t.lookupProcess(client, server)
		t.flows[key] = f
		t.order = append(t.order, key)
	} else if sure && !f.sure {
		t.setSides(f, client, server) // first packet was a guess; now we know
	}
	f.sure = f.sure || sure

	f.obs.LastSeen = ts.UTC().Format(time.RFC3339Nano)
	f.obs.EventCount += p.records
	f.clientHello = f.clientHello || p.clientHello
	f.serverHello = f.serverHello || p.serverHello
	if p.alert && !f.appData {
		f.alertBeforeData = true
	}
	f.appData = f.appData || p.appData
	if p.sni != "" {
		f.obs.SNI = p.sni
	}
	if p.serverHello {
		f.obs.TLSVersion = p.version
		f.obs.CipherSuite = p.cipher
	}
	if c := p.peerCert; c != nil {
		f.obs.PeerCertSHA256 = fingerprint(c.Raw)
		f.obs.PeerCertSubject = c.Subject.String()
		f.obs.PeerCertIssuer = c.Issuer.String()
		f.obs.PeerCertNotAfter = c.NotAfter.UTC().Format(time.RFC3339)
	}
}

func (t *flowTable) observations() []TLSObservation {
	out := make([]TLSObservation, 0, len(t.order))
	for _, key := range t.order {
		f := t.flows[key]
		f.obs.HandshakeOutcome = f.outcome()
		out = append(out, f.obs)
	}
	return out
}

func (t *flowTable) setSides(f *flow, client, server endpoint) {
	f.obs.SourceIP, f.obs.SourcePort = client.IP, client.Port
	f.obs.DestIP, f.obs.DestPort = server.IP, server.Port
	f.obs.Direction = direction(client, server, t.localIPs)
}

func (t *flowTable) lookupProcess(client, server endpoint) (string, int) {
	name, pid := t.resolve(client, server)
	if pid == 0 {
		return unavailable, 0
	}
	return name, pid
}

// outcome summarises how far the handshake got in what we captured.
// Limitation: TLS 1.3 encrypts alerts after ServerHello, so a late handshake
// failure there looks like "established".
func (f *flow) outcome() string {
	switch {
	case f.alertBeforeData:
		return "failed"
	case f.appData && (f.clientHello || f.serverHello):
		return "established"
	case f.serverHello:
		return "handshake_incomplete"
	case f.clientHello:
		return "client_hello_only"
	default:
		return "mid_stream" // connection started before the capture
	}
}

// orient decides which side is the TLS client. Hello messages tell us for
// sure; otherwise guess that the lower port is the server (443, 8443, ...).
func orient(src, dst endpoint, p packetTLS) (client, server endpoint, sure bool) {
	switch {
	case p.clientHello:
		return src, dst, true
	case p.serverHello || p.peerCert != nil:
		return dst, src, true
	case src.Port < dst.Port:
		return dst, src, false
	default:
		return src, dst, false
	}
}

// connKey is the same for both directions of a connection.
func connKey(a, b endpoint) string {
	x, y := a.String(), b.String()
	if x > y {
		x, y = y, x
	}
	return x + "|" + y
}

func direction(client, server endpoint, local map[string]struct{}) string {
	if _, ok := local[client.IP]; ok {
		return directionOutbound
	}
	if _, ok := local[server.IP]; ok {
		return directionInbound
	}
	return directionUnknown
}

func localIPSet() map[string]struct{} {
	out := map[string]struct{}{}
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return out
	}
	for _, a := range addrs {
		if ipnet, ok := a.(*net.IPNet); ok {
			out[ipnet.IP.String()] = struct{}{}
		}
	}
	return out
}

func tlsCounts(obs []TLSObservation, packets int) map[string]int {
	endpoints := map[string]bool{}
	ports := map[int]bool{}
	certs := map[string]bool{}
	records, mapped := 0, 0
	for _, o := range obs {
		records += o.EventCount
		endpoints[endpoint{o.DestIP, o.DestPort}.String()] = true
		ports[o.DestPort] = true
		if o.PeerCertSHA256 != "" {
			certs[o.PeerCertSHA256] = true
		}
		if o.PID != 0 {
			mapped++
		}
	}
	return map[string]int{
		"tls_packets":       packets,
		"tls_records":       records,
		"connections":       len(obs),
		"unique_endpoints":  len(endpoints),
		"unique_ports":      len(ports),
		"certificates_seen": len(certs),
		"process_mapped":    mapped,
	}
}
