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

// proxy opens the Docker-over-SSH transport only for this request. The SSH
// identity is materialized in a private temporary directory and removed once
// the response has been streamed back to Vessel.
func (engine remoteEngine) proxy(w http.ResponseWriter, r *http.Request, prefix string) {
	client, cleanup, err := newRemoteDockerClient(engine)
	if err != nil {
		http.Error(w, "remote Docker Engine connection failed", http.StatusBadGateway)
		return
	}
	defer cleanup()
	client.proxy(w, r, prefix)
}

type remoteEngineManager struct {
	mu      sync.RWMutex
	engines map[string]remoteEngine
}

var remoteEngines = remoteEngineManager{engines: make(map[string]remoteEngine)}

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
		remoteEngines.engines[engine.ID] = engine
		remoteEngines.mu.Unlock()
		jsonResponse(w, http.StatusOK, map[string]bool{"ok": true})
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
		remoteEngines.mu.Unlock()
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
	command := exec.CommandContext(ctx, "ssh-keyscan", "-T", "5", "-p", strconv.Itoa(port), host)
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

func newRemoteDockerClient(engine remoteEngine) (*dockerClient, func(), error) {
	directory, err := os.MkdirTemp("", "vessel-ssh-engine-")
	if err != nil {
		return nil, func() {}, err
	}
	cleanup := func() { _ = os.RemoveAll(directory) }
	keyPath := filepath.Join(directory, "identity")
	if err := os.WriteFile(keyPath, []byte(engine.PrivateKey+"\n"), 0600); err != nil {
		cleanup()
		return nil, func() {}, err
	}
	keyCheck := exec.Command("ssh-keygen", "-y", "-P", "", "-f", keyPath)
	if err := keyCheck.Run(); err != nil {
		cleanup()
		return nil, func() {}, fmt.Errorf("SSH_PRIVATE_KEY_INVALID")
	}
	knownHostsPath := filepath.Join(directory, "known_hosts")
	if err := os.WriteFile(knownHostsPath, []byte(engine.KnownHost+"\n"), 0600); err != nil {
		cleanup()
		return nil, func() {}, err
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return dialDockerSSH(ctx, engine, keyPath, knownHostsPath)
	}}
	return &dockerClient{client: &http.Client{Transport: transport, Timeout: 45 * time.Second}, baseURL: "http://docker" + apiVersionPath}, cleanup, nil
}

func dialDockerSSH(ctx context.Context, engine remoteEngine, keyPath, knownHostsPath string) (net.Conn, error) {
	target := engine.Username + "@" + engine.Host
	if net.ParseIP(engine.Host) != nil && strings.Contains(engine.Host, ":") {
		target = engine.Username + "@[" + engine.Host + "]"
	}
	command := exec.CommandContext(ctx, "ssh", "-F", "/dev/null", "-p", strconv.Itoa(engine.Port), "-i", keyPath,
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
