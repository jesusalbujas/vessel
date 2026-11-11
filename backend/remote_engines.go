package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type remoteEngine struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Username    string `json:"username"`
	PrivateKey  string `json:"privateKey"`
	Fingerprint string `json:"fingerprint"`
	KnownHost   string `json:"knownHost"`
}

// proxy uses a short-lived pooled Docker-over-SSH client for this Engine. Its
// identity stays in a private temporary directory only while the cache entry
// is active and is removed when the entry expires or the Engine is removed.
func (engine remoteEngine) proxy(w http.ResponseWriter, r *http.Request, prefix string) {
	select {
	case remoteDockerRequests <- struct{}{}:
		defer func() { <-remoteDockerRequests }()
	case <-r.Context().Done():
		http.Error(w, "remote Docker request cancelled while waiting for an SSH connection", http.StatusServiceUnavailable)
		return
	}
	client, err := remoteDockerClientFor(engine)
	if err != nil {
		http.Error(w, "remote Docker-over-SSH setup failed", http.StatusBadGateway)
		return
	}
	client.proxy(w, r, prefix)
}

func (engine remoteEngine) overview(w http.ResponseWriter, r *http.Request) {
	select {
	case remoteDockerRequests <- struct{}{}:
		defer func() { <-remoteDockerRequests }()
	case <-r.Context().Done():
		http.Error(w, "remote Docker request cancelled while waiting for an SSH connection", http.StatusServiceUnavailable)
		return
	}
	client, err := remoteDockerClientFor(engine)
	if err != nil {
		jsonResponse(w, http.StatusBadGateway, map[string]string{"error": "remote Docker-over-SSH setup failed"})
		return
	}
	client.overview(w, r)
}

type remoteDockerClientEntry struct {
	client   *dockerClient
	cleanup  func()
	lastUsed time.Time
}

type remoteEngineManager struct {
	mu      sync.RWMutex
	engines map[string]remoteEngine
	clients map[string]*remoteDockerClientEntry
}

var remoteEngines = remoteEngineManager{engines: make(map[string]remoteEngine), clients: make(map[string]*remoteDockerClientEntry)}
var remoteDockerRequests = make(chan struct{}, 4)
var remoteDockerClientJanitor sync.Once

func remoteDockerClientFor(engine remoteEngine) (*dockerClient, error) {
	remoteEngines.mu.Lock()
	defer remoteEngines.mu.Unlock()
	registered, ok := remoteEngines.engines[engine.ID]
	if !ok || registered != engine {
		return nil, fmt.Errorf("remote Engine registration changed")
	}
	if entry := remoteEngines.clients[engine.ID]; entry != nil {
		entry.lastUsed = time.Now()
		return entry.client, nil
	}
	client, cleanup, err := newRemoteDockerClient(engine)
	if err != nil {
		return nil, err
	}
	remoteEngines.clients[engine.ID] = &remoteDockerClientEntry{client: client, cleanup: cleanup, lastUsed: time.Now()}
	return client, nil
}

func closeRemoteDockerClient(entry *remoteDockerClientEntry) {
	if entry == nil {
		return
	}
	entry.client.client.CloseIdleConnections()
	entry.cleanup()
}

func expireIdleRemoteDockerClients(now time.Time) {
	const idleLimit = 5 * time.Minute
	var expired []*remoteDockerClientEntry
	remoteEngines.mu.Lock()
	for id, entry := range remoteEngines.clients {
		if now.Sub(entry.lastUsed) >= idleLimit {
			delete(remoteEngines.clients, id)
			expired = append(expired, entry)
		}
	}
	remoteEngines.mu.Unlock()
	for _, entry := range expired {
		closeRemoteDockerClient(entry)
	}
}

func startRemoteDockerClientJanitor() {
	remoteDockerClientJanitor.Do(func() {
		go func() {
			ticker := time.NewTicker(time.Minute)
			defer ticker.Stop()
			for now := range ticker.C {
				expireIdleRemoteDockerClients(now)
			}
		}()
	})
}

var engineHostPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$`)
var engineUserPattern = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$`)
var engineIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{8,64}$`)

func validEngineTarget(host string, port int, username string) bool {
	return (net.ParseIP(host) != nil || engineHostPattern.MatchString(host)) && port > 0 && port <= 65535 && engineUserPattern.MatchString(username)
}

func remoteEngineByID(id string) (remoteEngine, bool) {
	remoteEngines.mu.RLock()
	defer remoteEngines.mu.RUnlock()
	engine, ok := remoteEngines.engines[id]
	return engine, ok
}

func registerRemoteEngineHandlers(mux *http.ServeMux) {
	startRemoteDockerClientJanitor()
	mux.HandleFunc("/api/v1/engines/fingerprint", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonResponse(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var input struct {
			Host string `json:"host"`
			Port int    `json:"port"`
		}
		if !decodeLimitedJSON(w, r, &input, 2048) || (net.ParseIP(input.Host) == nil && !engineHostPattern.MatchString(input.Host)) || input.Port < 1 || input.Port > 65535 {
			jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "invalid host or port"})
			return
		}
		fingerprint, knownHost, err := scanSSHHostKey(r.Context(), input.Host, input.Port)
		if err != nil {
			jsonResponse(w, http.StatusBadGateway, map[string]string{"error": "could not read SSH host key"})
			return
		}
		jsonResponse(w, http.StatusOK, map[string]string{"fingerprint": fingerprint, "knownHost": knownHost})
	})
	mux.HandleFunc("/api/v1/engines/test", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonResponse(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var engine remoteEngine
		if !decodeLimitedJSON(w, r, &engine, 96*1024) || !validRemoteEngine(engine) {
			jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "invalid remote Engine configuration"})
			return
		}
		if err := testRemoteEngine(r.Context(), engine); err != nil {
			jsonResponse(w, http.StatusBadGateway, map[string]string{"error": remoteEngineErrorMessage(err)})
			return
		}
		info, err := readRemoteEngineInfo(r.Context(), engine)
		if err != nil {
			jsonResponse(w, http.StatusBadGateway, map[string]string{"error": "remote Docker Engine did not return valid information"})
			return
		}
		jsonResponse(w, http.StatusOK, map[string]any{"ok": true, "data": map[string]any{"name": info.Name, "serverVersion": info.ServerVersion, "operatingSystem": info.OperatingSystem, "architecture": info.Architecture, "nCPU": info.NCPU, "memTotal": info.MemTotal}})
	})
	mux.HandleFunc("/api/v1/engines/register", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonResponse(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var engine remoteEngine
		if !decodeLimitedJSON(w, r, &engine, 96*1024) || !validRemoteEngine(engine) {
			jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "invalid remote Engine configuration"})
			return
		}
		remoteEngines.mu.Lock()
		oldEngine, existed := remoteEngines.engines[engine.ID]
		var oldClient *remoteDockerClientEntry
		if existed && oldEngine != engine {
			oldClient = remoteEngines.clients[engine.ID]
			delete(remoteEngines.clients, engine.ID)
		}
		remoteEngines.engines[engine.ID] = engine
		remoteEngines.mu.Unlock()
		closeRemoteDockerClient(oldClient)
		jsonResponse(w, http.StatusOK, map[string]bool{"ok": true})
	})
	mux.HandleFunc("/api/v1/engines/metrics/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			jsonResponse(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		id := strings.TrimPrefix(r.URL.Path, "/api/v1/engines/metrics/")
		if !engineIDPattern.MatchString(id) {
			jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "invalid Engine ID"})
			return
		}
		engine, ok := remoteEngineByID(id)
		if !ok {
			jsonResponse(w, http.StatusNotFound, map[string]string{"error": "Docker Engine not registered"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
		defer cancel()
		metrics, err := readRemoteHostMetrics(ctx, engine)
		if err != nil {
			jsonResponse(w, http.StatusBadGateway, map[string]string{"error": "could not read remote host metrics"})
			return
		}
		jsonResponse(w, http.StatusOK, metrics)
	})
	mux.HandleFunc("/api/v1/engines/remove/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			jsonResponse(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		id := strings.TrimPrefix(r.URL.Path, "/api/v1/engines/remove/")
		if !engineIDPattern.MatchString(id) {
			jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "invalid Engine ID"})
			return
		}
		remoteEngines.mu.Lock()
		delete(remoteEngines.engines, id)
		client := remoteEngines.clients[id]
		delete(remoteEngines.clients, id)
		remoteEngines.mu.Unlock()
		closeRemoteDockerClient(client)
		jsonResponse(w, http.StatusOK, map[string]bool{"ok": true})
	})
}

func decodeLimitedJSON(w http.ResponseWriter, r *http.Request, target any, limit int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	return json.NewDecoder(r.Body).Decode(target) == nil
}

func validRemoteEngine(engine remoteEngine) bool {
	return engineIDPattern.MatchString(engine.ID) && strings.TrimSpace(engine.Name) != "" && len(engine.Name) <= 80 && validEngineTarget(engine.Host, engine.Port, engine.Username) &&
		len(engine.PrivateKey) > 0 && len(engine.PrivateKey) <= 64*1024 && strings.Contains(engine.PrivateKey, "PRIVATE KEY") &&
		engine.Fingerprint != "" && len(engine.Fingerprint) <= 128 && engine.KnownHost != "" && len(engine.KnownHost) <= 4096
}

func scanSSHHostKey(ctx context.Context, host string, port int) (string, string, error) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "ssh-keyscan", "-T", "5", "-t", "ed25519", "-p", strconv.Itoa(port), host)
	output, err := command.Output()
	if err != nil {
		return "", "", err
	}
	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		fields := strings.Fields(line)
		if len(fields) < 3 || strings.HasPrefix(line, "#") {
			continue
		}
		keyBytes, decodeErr := base64.StdEncoding.DecodeString(fields[2])
		if decodeErr != nil {
			continue
		}
		sum := sha256.Sum256(keyBytes)
		fingerprint := "SHA256:" + base64.RawStdEncoding.EncodeToString(sum[:])
		return fingerprint, line, nil
	}
	return "", "", fmt.Errorf("no usable SSH key found")
}

func testRemoteEngine(ctx context.Context, engine remoteEngine) error {
	fingerprint, knownHost, err := scanSSHHostKey(ctx, engine.Host, engine.Port)
	if err != nil {
		return fmt.Errorf("SSH_SCAN: %w", err)
	}
	if fingerprint != engine.Fingerprint || knownHost != engine.KnownHost {
		return fmt.Errorf("SSH_FINGERPRINT_CHANGED")
	}
	client, cleanup, err := newRemoteDockerClient(engine)
	if err != nil {
		return err
	}
	defer cleanup()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, client.baseURL+"/info", nil)
	if err != nil {
		return err
	}
	response, err := client.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("remote Docker returned status %d", response.StatusCode)
	}
	_, err = io.Copy(io.Discard, io.LimitReader(response.Body, 2*1024*1024))
	return err
}

type dockerInfoSummary struct {
	Name             string `json:"Name"`
	ServerVersion    string `json:"ServerVersion"`
	OperatingSystem  string `json:"OperatingSystem"`
	Architecture     string `json:"Architecture"`
	NCPU             int    `json:"NCPU"`
	MemTotal         int64  `json:"MemTotal"`
}

type remoteHostMetrics struct {
	CPU struct {
		Percent float64 `json:"percent"`
	} `json:"cpu"`
	Memory struct {
		Used  int64 `json:"used"`
		Total int64 `json:"total"`
	} `json:"memory"`
	Disk struct {
		Used  int64  `json:"used"`
		Total int64  `json:"total"`
		Source string `json:"source"`
		Type   string `json:"type"`
	} `json:"disk"`
	UptimeSeconds float64 `json:"uptimeSeconds"`
	SampledAt time.Time `json:"sampledAt"`
}

func cpuTickTotals(line string) (uint64, uint64, error) {
	fields := strings.Fields(line)
	if len(fields) < 5 || fields[0] != "cpu" {
		return 0, 0, fmt.Errorf("invalid CPU counters")
	}
	var total uint64
	var idle uint64
	for index, field := range fields[1:] {
		value, err := strconv.ParseUint(field, 10, 64)
		if err != nil {
			return 0, 0, err
		}
		total += value
		if index == 3 || index == 4 {
			idle += value
		}
	}
	return total, idle, nil
}

func readRemoteHostMetrics(ctx context.Context, engine remoteEngine) (remoteHostMetrics, error) {
	_, keyPath, knownHostsPath, cleanup, err := prepareRemoteSSH(engine)
	if err != nil {
		return remoteHostMetrics{}, err
	}
	defer cleanup()
	target := engine.Username + "@" + engine.Host
	if net.ParseIP(engine.Host) != nil && strings.Contains(engine.Host, ":") {
		target = engine.Username + "@[" + engine.Host + "]"
	}
	remoteCommand := "LC_ALL=C; printf '__VESSEL_CPU_FIRST__\\n'; head -n 1 /proc/stat; sleep 1; printf '__VESSEL_CPU_SECOND__\\n'; head -n 1 /proc/stat; printf '__VESSEL_MEMORY__\\n'; cat /proc/meminfo; printf '__VESSEL_DISK__\\n'; df -Pk /; printf '__VESSEL_DISK_TYPE__\\n'; ROOT=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || printf /var/lib/docker); DEV=$(findmnt -n -o SOURCE -T \"$ROOT\" 2>/dev/null); if [ -n \"$DEV\" ] && command -v lsblk >/dev/null 2>&1; then lsblk -s -n -o ROTA,TYPE \"$DEV\" | awk '$2 == \"disk\" { if ($1 == 1) h=1; else if ($1 == 0) s=1 } END { if (h && s) print \"mixed\"; else if (h) print \"mechanical\"; else if (s) print \"solid_state\"; else print \"unknown\" }'; else printf 'unknown\\n'; fi; printf '__VESSEL_UPTIME__\\n'; awk '{print $1}' /proc/uptime"
	command := exec.CommandContext(ctx, "ssh", "-F", "/dev/null", "-p", strconv.Itoa(engine.Port), "-i", keyPath,
		"-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "GlobalKnownHostsFile=/dev/null", "-o", "UserKnownHostsFile="+knownHostsPath,
		target, remoteCommand)
	output, err := command.Output()
	if err != nil {
		return remoteHostMetrics{}, err
	}
	metrics, err := parseRemoteHostMetrics(string(output))
	if err != nil {
		return remoteHostMetrics{}, err
	}
	metrics.SampledAt = time.Now().UTC()
	return metrics, nil
}

func parseRemoteHostMetrics(output string) (remoteHostMetrics, error) {
	const (
		cpuFirstMarker  = "__VESSEL_CPU_FIRST__"
		cpuSecondMarker = "__VESSEL_CPU_SECOND__"
		memoryMarker    = "__VESSEL_MEMORY__"
		diskMarker      = "__VESSEL_DISK__"
		diskTypeMarker  = "__VESSEL_DISK_TYPE__"
		uptimeMarker    = "__VESSEL_UPTIME__"
	)
	var metrics remoteHostMetrics
	var firstCPU string
	var secondCPU string
	var availableMemory int64 = -1
	var fallbackAvailableMemory int64
	section := ""
	diskRowRead := false
	diskTypeRead := false
	for _, line := range strings.Split(output, "\n") {
		switch strings.TrimSpace(line) {
		case cpuFirstMarker:
			section = "cpu-first"
			continue
		case cpuSecondMarker:
			section = "cpu-second"
			continue
		case memoryMarker:
			section = "memory"
			continue
		case diskMarker:
			section = "disk"
			continue
		case diskTypeMarker:
			section = "disk-type"
			continue
		case uptimeMarker:
			section = "uptime"
			continue
		}
		switch section {
		case "cpu-first":
			if firstCPU == "" && strings.HasPrefix(strings.TrimSpace(line), "cpu ") {
				firstCPU = line
			}
		case "cpu-second":
			if secondCPU == "" && strings.HasPrefix(strings.TrimSpace(line), "cpu ") {
				secondCPU = line
			}
		case "memory":
			key, value, ok := strings.Cut(line, ":")
			if !ok {
				continue
			}
			fields := strings.Fields(value)
			if len(fields) == 0 {
				continue
			}
			kilobytes, err := strconv.ParseInt(fields[0], 10, 64)
			if err != nil {
				continue
			}
			switch key {
			case "MemTotal":
				metrics.Memory.Total = kilobytes * 1024
			case "MemAvailable":
				availableMemory = kilobytes * 1024
			case "MemFree", "Buffers", "Cached", "SReclaimable":
				fallbackAvailableMemory += kilobytes * 1024
			case "Shmem":
				fallbackAvailableMemory -= kilobytes * 1024
			}
		case "disk":
			if !diskRowRead && strings.HasPrefix(strings.TrimSpace(line), "Filesystem") {
				continue
			}
			fields := strings.Fields(line)
			if len(fields) < 6 {
				continue
			}
			total, totalErr := strconv.ParseInt(fields[1], 10, 64)
			used, usedErr := strconv.ParseInt(fields[2], 10, 64)
			if totalErr == nil && usedErr == nil {
				metrics.Disk.Total = total * 1024
				metrics.Disk.Used = used * 1024
				metrics.Disk.Source = "/"
				diskRowRead = true
			}
		case "disk-type":
			if !diskTypeRead {
				switch strings.TrimSpace(line) {
				case "mechanical", "solid_state", "mixed":
					metrics.Disk.Type = strings.TrimSpace(line)
				default:
					metrics.Disk.Type = "unknown"
				}
				diskTypeRead = true
			}
		case "uptime":
			if seconds, err := strconv.ParseFloat(strings.TrimSpace(line), 64); err == nil && seconds >= 0 {
				metrics.UptimeSeconds = seconds
				section = ""
			}
		}
	}
	firstTotal, firstIdle, firstErr := cpuTickTotals(firstCPU)
	secondTotal, secondIdle, secondErr := cpuTickTotals(secondCPU)
	if firstErr != nil || secondErr != nil || secondTotal <= firstTotal || metrics.Memory.Total <= 0 || metrics.Disk.Total <= 0 || !diskRowRead {
		return remoteHostMetrics{}, fmt.Errorf("incomplete remote host metrics")
	}
	if availableMemory < 0 {
		availableMemory = fallbackAvailableMemory
	}
	metrics.Memory.Used = max(0, min(metrics.Memory.Total, metrics.Memory.Total-max(0, availableMemory)))
	totalTicks := secondTotal - firstTotal
	if totalTicks > 0 {
		idleTicks := secondIdle - firstIdle
		metrics.CPU.Percent = max(0, min(100, 100*float64(totalTicks-idleTicks)/float64(totalTicks)))
	}
	return metrics, nil
}

func readRemoteEngineInfo(ctx context.Context, engine remoteEngine) (dockerInfoSummary, error) {
	client, cleanup, err := newRemoteDockerClient(engine)
	if err != nil {
		return dockerInfoSummary{}, err
	}
	defer cleanup()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, client.baseURL+"/info", nil)
	if err != nil {
		return dockerInfoSummary{}, err
	}
	response, err := client.client.Do(request)
	if err != nil {
		return dockerInfoSummary{}, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return dockerInfoSummary{}, fmt.Errorf("remote Docker returned status %d", response.StatusCode)
	}
	var info dockerInfoSummary
	if err := json.NewDecoder(io.LimitReader(response.Body, 2*1024*1024)).Decode(&info); err != nil {
		return dockerInfoSummary{}, err
	}
	return info, nil
}

func prepareRemoteSSH(engine remoteEngine) (string, string, string, func(), error) {
	directory, err := os.MkdirTemp("", "vessel-ssh-engine-")
	if err != nil {
		return "", "", "", func() {}, err
	}
	cleanup := func() { _ = os.RemoveAll(directory) }
	keyPath := filepath.Join(directory, "identity")
	if err := os.WriteFile(keyPath, []byte(engine.PrivateKey+"\n"), 0600); err != nil {
		cleanup()
		return "", "", "", func() {}, err
	}
	keyCheck := exec.Command("ssh-keygen", "-y", "-P", "", "-f", keyPath)
	if err := keyCheck.Run(); err != nil {
		cleanup()
		return "", "", "", func() {}, fmt.Errorf("SSH_PRIVATE_KEY_INVALID")
	}
	knownHostsPath := filepath.Join(directory, "known_hosts")
	if err := os.WriteFile(knownHostsPath, []byte(engine.KnownHost+"\n"), 0600); err != nil {
		cleanup()
		return "", "", "", func() {}, err
	}
	return directory, keyPath, knownHostsPath, cleanup, nil
}

func newRemoteDockerClient(engine remoteEngine) (*dockerClient, func(), error) {
	_, keyPath, knownHostsPath, cleanup, err := prepareRemoteSSH(engine)
	if err != nil {
		return nil, func() {}, err
	}
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return dialDockerSSH(ctx, engine, keyPath, knownHostsPath)
		},
		MaxIdleConns:        8,
		MaxIdleConnsPerHost: 4,
		MaxConnsPerHost:     4,
		IdleConnTimeout:     90 * time.Second,
	}
	return &dockerClient{client: &http.Client{Transport: transport}, baseURL: "http://docker" + apiVersionPath}, cleanup, nil
}

func dialDockerSSH(ctx context.Context, engine remoteEngine, keyPath, knownHostsPath string) (net.Conn, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	target := engine.Username + "@" + engine.Host
	if net.ParseIP(engine.Host) != nil && strings.Contains(engine.Host, ":") {
		target = engine.Username + "@[" + engine.Host + "]"
	}
	// The SSH process backs a pooled HTTP connection and must outlive the first
	// Docker request that caused the dial. The transport closes the managed
	// connection when idle or when its Engine entry expires.
	command := exec.Command("ssh", "-F", "/dev/null", "-p", strconv.Itoa(engine.Port), "-i", keyPath,
		"-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "GlobalKnownHostsFile=/dev/null", "-o", "UserKnownHostsFile="+knownHostsPath,
		target, "docker", "system", "dial-stdio")
	stdin, err := command.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, err
	}
	command.Stderr = io.Discard
	clientConn, bridgeConn := net.Pipe()
	if err := command.Start(); err != nil {
		_ = clientConn.Close()
		_ = bridgeConn.Close()
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		_ = command.Process.Kill()
		_ = command.Wait()
		_ = clientConn.Close()
		_ = bridgeConn.Close()
		return nil, err
	}
	go func() { _, _ = io.Copy(stdin, bridgeConn); _ = stdin.Close() }()
	go func() { _, _ = io.Copy(bridgeConn, stdout); _ = bridgeConn.Close() }()
	return &managedSSHConn{Conn: clientConn, process: command.Process, stdin: stdin, bridge: bridgeConn, wait: command.Wait}, nil
}

type managedSSHConn struct {
	net.Conn
	process *os.Process
	stdin   io.Closer
	bridge  io.Closer
	wait    func() error
	once    sync.Once
}

func (c *managedSSHConn) Close() error {
	var err error
	c.once.Do(func() {
		err = c.Conn.Close()
		_ = c.stdin.Close()
		_ = c.bridge.Close()
		if c.process != nil {
			_ = c.process.Kill()
		}
		if c.wait != nil {
			_ = c.wait()
		}
	})
	return err
}

func remoteEngineErrorMessage(err error) string {
	message := err.Error()
	switch {
	case strings.Contains(message, "SSH_FINGERPRINT_CHANGED"):
		return "SSH host fingerprint changed or does not match the verified fingerprint"
	case strings.Contains(message, "SSH_PRIVATE_KEY_INVALID"):
		return "SSH private key is invalid, encrypted, or unsupported; use an unencrypted OpenSSH private key"
	case strings.Contains(message, "SSH_SCAN:"):
		return "SSH host is unreachable or no SSH host key was returned"
	default:
		return "SSH login failed or the user cannot access the remote Docker Engine"
	}
}
