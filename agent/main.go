package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Logs go to stderr; the JSON report is the only thing on stdout,
// so a caller can do: agent-linux filesystem > report.json
func main() {
	log.SetFlags(log.LstdFlags)
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	switch os.Args[1] {
	case "filesystem":
		os.Exit(runFilesystem(os.Args[2:]))
	case "tls":
		os.Exit(runTLS(os.Args[2:]))
	case "-h", "--help", "help":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n", os.Args[1])
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprintf(os.Stderr, `Usage:
  agent-linux filesystem [--roots dir,dir]
  agent-linux tls [--iface any] [--duration 30s]

filesystem walks certificate files under common Linux dirs, or --roots.
tls observes TLS handshake metadata for --duration (needs sudo).
`)
}

func runFilesystem(args []string) int {
	flags := flag.NewFlagSet("filesystem", flag.ContinueOnError)
	rootsFlag := flags.String("roots", "", "comma-separated scan roots (default: common Linux cert dirs)")
	if err := flags.Parse(args); err != nil {
		return 2
	}

	// Default dirs that don't exist on this distro are skipped quietly.
	// Dirs the user asked for are reported as errors if missing.
	var roots []string
	if strings.TrimSpace(*rootsFlag) == "" {
		roots = existingDirs(defaultScanRoots)
	} else {
		roots = splitCSV(*rootsFlag)
		if len(roots) == 0 {
			fmt.Fprintln(os.Stderr, "--roots has no paths")
			return 2
		}
	}
	roots = cleanRoots(roots)

	started := time.Now()
	log.Printf("filesystem scan roots=%v", roots)
	certs, errs := scanCertificates(roots, started)

	host := hostname()
	rels := fsRelationships(host, certs)
	report := newReport(scanFilesystem, host, started, finishStatus(countParsed(certs), errs), errs)
	report.Counts = certificateCounts(certs)
	report.Counts["relationships"] = len(rels)
	report.Certificates = certs
	report.Relationships = rels
	return emit(report)
}

func runTLS(args []string) int {
	flags := flag.NewFlagSet("tls", flag.ContinueOnError)
	iface := flags.String("iface", defaultTLSIface, "pcap interface (Linux: any)")
	duration := flags.Duration("duration", defaultTLSDuration, "how long to capture")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if *duration <= 0 {
		fmt.Fprintln(os.Stderr, "--duration must be greater than 0, e.g. 30s")
		return 2
	}

	started := time.Now()
	obs, packets, errs := observeTLS(*iface, *duration)

	host := hostname()
	rels := tlsRelationships(host, obs)
	report := newReport(scanTLS, host, started, finishStatus(len(obs), errs), errs)
	report.Counts = tlsCounts(obs, packets)
	report.Counts["relationships"] = len(rels)
	report.TLSObservations = obs
	report.Relationships = rels
	return emit(report)
}

func emit(report Report) int {
	log.Printf("%s scan %s in %dms", report.Type, report.Status, report.DurationMS)
	if err := writeReport(os.Stdout, report); err != nil {
		log.Println(err)
		return 1
	}
	return exitCode(report.Status)
}

func existingDirs(dirs []string) []string {
	var out []string
	for _, d := range dirs {
		if info, err := os.Stat(d); err == nil && info.IsDir() {
			out = append(out, d)
		} else {
			log.Printf("default folder %s does not exist on this system, skipping it", d)
		}
	}
	return out
}

// cleanRoots makes every root absolute and drops repeats and roots that sit
// inside another root (e.g. /etc/ssl/certs when /etc/ssl is also given),
// so no file is scanned twice.
func cleanRoots(roots []string) []string {
	abs := make([]string, 0, len(roots))
	for _, r := range roots {
		if a, err := filepath.Abs(r); err == nil {
			r = a
		}
		abs = append(abs, r)
	}
	// Shorter paths first, so a parent folder is kept before its children.
	sort.SliceStable(abs, func(i, j int) bool { return len(abs[i]) < len(abs[j]) })

	var out []string
	for _, r := range abs {
		if parent := coveredBy(r, out); parent != "" {
			log.Printf("skip root %s: already covered by %s", r, parent)
			continue
		}
		out = append(out, r)
	}
	return out
}

// coveredBy returns the root in roots that contains path (or equals it), or "".
func coveredBy(path string, roots []string) string {
	for _, root := range roots {
		rel, err := filepath.Rel(root, path)
		if err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return root
		}
	}
	return ""
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func countParsed(certs []Certificate) int {
	n := 0
	for _, c := range certs {
		if c.ParseStatus == parseOK {
			n++
		}
	}
	return n
}
