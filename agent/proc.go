package main

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// resolveProcess finds the local process that owns a TCP connection:
//  1. find the connection in /proc/net/tcp or tcp6 and read its socket inode
//  2. find which /proc/<pid>/fd/* links to "socket:[inode]"
//
// Needs root to see other users' processes. Returns pid 0 when not found.
func resolveProcess(a, b endpoint) (string, int) {
	// /proc/net/tcp lists local -> remote, and either side could be local.
	inode := findSocketInode(a, b)
	if inode == "" {
		inode = findSocketInode(b, a)
	}
	if inode == "" || inode == "0" {
		return "", 0
	}
	pid := findPIDByInode(inode)
	if pid == 0 {
		return "", 0
	}
	return readProcessName(pid), pid
}

// The kernel lists IPv4 sockets in /proc/net/tcp and IPv6 ones in
// /proc/net/tcp6. A dual-stack socket talking IPv4 shows up in tcp6 as
// ::ffff:a.b.c.d, which procAddr6 also produces, so try both tables.
var procTCPTables = []struct {
	path   string
	format func(endpoint) string
}{
	{"/proc/net/tcp", procAddr4},
	{"/proc/net/tcp6", procAddr6},
}

func findSocketInode(local, remote endpoint) string {
	for _, table := range procTCPTables {
		if inode := findInodeIn(table.path, table.format(local), table.format(remote)); inode != "" {
			return inode
		}
	}
	return ""
}

// findInodeIn looks for an ESTABLISHED connection in one /proc/net table.
// Line fields: sl local_address rem_address st ... inode (index 9)
func findInodeIn(path, localHex, remoteHex string) string {
	if localHex == "" || remoteHex == "" {
		return ""
	}

	file, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	scanner.Scan() // header
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 10 {
			continue
		}
		if fields[3] != "01" { // TCP_ESTABLISHED
			continue
		}
		if fields[1] == localHex && fields[2] == remoteHex {
			return fields[9]
		}
	}
	return ""
}

// procAddr4 formats like /proc/net/tcp: the 4 IPv4 bytes reversed
// (little-endian) in hex, then the port in hex. 127.0.0.1:443 -> "0100007F:01BB".
func procAddr4(e endpoint) string {
	ip := net.ParseIP(e.IP).To4()
	if ip == nil {
		return ""
	}
	return fmt.Sprintf("%02X%02X%02X%02X:%04X", ip[3], ip[2], ip[1], ip[0], e.Port)
}

// procAddr6 formats like /proc/net/tcp6: the 16 address bytes as four
// 4-byte words, each word reversed the same way as IPv4.
func procAddr6(e endpoint) string {
	ip := net.ParseIP(e.IP).To16()
	if ip == nil {
		return ""
	}
	var sb strings.Builder
	for i := 0; i < 16; i += 4 {
		fmt.Fprintf(&sb, "%02X%02X%02X%02X", ip[i+3], ip[i+2], ip[i+1], ip[i])
	}
	fmt.Fprintf(&sb, ":%04X", e.Port)
	return sb.String()
}

func findPIDByInode(inode string) int {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return 0
	}
	target := "socket:[" + inode + "]"
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue // not a process directory
		}
		fdDir := filepath.Join("/proc", entry.Name(), "fd")
		fds, err := os.ReadDir(fdDir)
		if err != nil {
			continue // process exited or we lack permission
		}
		for _, fd := range fds {
			link, err := os.Readlink(filepath.Join(fdDir, fd.Name()))
			if err == nil && link == target {
				return pid
			}
		}
	}
	return 0
}

func readProcessName(pid int) string {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/comm", pid))
	if err != nil {
		return fmt.Sprintf("pid-%d", pid)
	}
	return strings.TrimSpace(string(data))
}
