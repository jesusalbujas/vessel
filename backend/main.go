package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

const (
	defaultAddr    = "127.0.0.1:9100"
	defaultSocket  = "/var/run/docker.sock"
	// v1.41 is supported by Docker Engine 20.10+ and keeps Vessel compatible
	// with older production hosts as well as current engines.
	apiVersionPath = "/v1.41"
)

type dockerClient struct {
	client  *http.Client
	baseURL string
}

func newDockerClient() (*dockerClient, error) {
	socket := os.Getenv("DOCKER_SOCKET")
	if socket == "" {
		socket = defaultSocket
	}
	if _, err := os.Stat(socket); err != nil {
		return nil, fmt.Errorf("docker socket is not available at %s: %w", socket, err)
	}
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "unix", socket)
		},
	}
	return &dockerClient{client: &http.Client{Transport: transport, Timeout: 30 * time.Second}, baseURL: "http://docker" + apiVersionPath}, nil
}

func (d *dockerClient) request(w http.ResponseWriter, method, path string, body io.Reader) {
	req, err := http.NewRequestWithContext(context.Background(), method, d.baseURL+path, body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	response, err := d.client.Do(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer response.Body.Close()
	for key, values := range response.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, response.Body)
}

func (d *dockerClient) proxy(w http.ResponseWriter, r *http.Request, prefix string) {
	path := strings.TrimPrefix(r.URL.RequestURI(), prefix)
	if path == "" {
		path = "/"
	}
	d.request(w, r.Method, path, r.Body)
}

func jsonResponse(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func health(w http.ResponseWriter, _ *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]any{"name": "Vessel", "status": "ok", "backend": "go", "docker": true})
}

func dockerHandler(d *dockerClient) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", health)
	// The route is intentionally internal for now. Next.js remains the public
	// UI/API while this Go service becomes the Docker control plane incrementally.
	mux.HandleFunc("/api/v1/", func(w http.ResponseWriter, r *http.Request) {
		d.proxy(w, r, "/api/v1")
	})
	return mux
}

func startFrontend() (*exec.Cmd, error) {
	server := os.Getenv("VESSEL_FRONTEND_SERVER")
	if server == "" {
		server = "/app/server.js"
	}
	if _, err := os.Stat(server); err != nil {
		return nil, fmt.Errorf("frontend server is not available at %s: %w", server, err)
	}
	cmd := exec.Command("node", server)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = os.Environ()
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return cmd, nil
}

func main() {
	docker, err := newDockerClient()
	if err != nil {
		log.Fatal(err)
	}
	addr := os.Getenv("VESSEL_BACKEND_ADDR")
	if addr == "" {
		addr = defaultAddr
	}
	server := &http.Server{Addr: addr, Handler: dockerHandler(docker), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		log.Printf("Vessel Go backend listening on %s", addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("backend stopped: %v", err)
		}
	}()

	frontend, err := startFrontend()
	if err != nil {
		log.Fatal(err)
	}

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	select {
	case <-signals:
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
		_ = frontend.Process.Signal(syscall.SIGTERM)
	case err := <-waitCommand(frontend):
		if err != nil {
			log.Printf("frontend stopped: %v", err)
		}
		_ = server.Shutdown(context.Background())
	}
}

func waitCommand(cmd *exec.Cmd) <-chan error {
	result := make(chan error, 1)
	go func() {
		result <- cmd.Wait()
	}()
	return result
}
