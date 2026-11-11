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
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

const (
	defaultAddr   = "127.0.0.1:9100"
	defaultSocket = "/var/run/docker.sock"
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
	return &dockerClient{client: &http.Client{Transport: transport}, baseURL: "http://docker" + apiVersionPath}, nil
}

func (d *dockerClient) request(ctx context.Context, w http.ResponseWriter, method, path string, body io.Reader) {
	req, err := http.NewRequestWithContext(ctx, method, d.baseURL+path, body)
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
	d.request(r.Context(), w, r.Method, path, r.Body)
}

// overview retrieves the small set of Docker inventories used by the home
// dashboard through one client. For SSH-backed Engines this keeps the same
// authenticated SSH tunnel alive across all five Docker API reads.
func (d *dockerClient) overview(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		jsonResponse(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	paths := []string{"/containers/json?all=1", "/images/json", "/volumes", "/networks", "/info"}
	data := make([]json.RawMessage, 0, len(paths))
	for _, path := range paths {
		request, err := http.NewRequestWithContext(r.Context(), http.MethodGet, d.baseURL+path, nil)
		if err != nil {
			jsonResponse(w, http.StatusInternalServerError, map[string]string{"error": "could not prepare Docker overview request"})
			return
		}
		response, err := d.client.Do(request)
		if err != nil {
			jsonResponse(w, http.StatusBadGateway, map[string]string{"error": "Docker overview request failed"})
			return
		}
		body, readErr := io.ReadAll(io.LimitReader(response.Body, 32*1024*1024))
		_ = response.Body.Close()
		if readErr != nil || response.StatusCode < 200 || response.StatusCode >= 300 {
			jsonResponse(w, http.StatusBadGateway, map[string]string{"error": "Docker returned incomplete overview data"})
			return
		}
		data = append(data, json.RawMessage(body))
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]json.RawMessage{
		"containers": data[0], "images": data[1], "volumes": data[2], "networks": data[3], "engine": data[4],
	})
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
	registerRemoteEngineHandlers(mux)
	// The route is intentionally internal for now. Next.js remains the public
	// UI/API while this Go service becomes the Docker control plane incrementally.
	mux.HandleFunc("/api/v1/", func(w http.ResponseWriter, r *http.Request) {
		engineID := r.Header.Get("X-Vessel-Engine-ID")
		if engineID == "" || engineID == "local" {
			d.proxy(w, r, "/api/v1")
			return
		}
		remote, ok := remoteEngineByID(engineID)
		if !ok {
			jsonResponse(w, http.StatusNotFound, map[string]string{"error": "Docker Engine not registered"})
			return
		}
		remote.proxy(w, r, "/api/v1")
	})
	mux.HandleFunc("/api/v1/overview", func(w http.ResponseWriter, r *http.Request) {
		engineID := r.Header.Get("X-Vessel-Engine-ID")
		if engineID == "" || engineID == "local" {
			d.overview(w, r)
			return
		}
		remote, ok := remoteEngineByID(engineID)
		if !ok {
			jsonResponse(w, http.StatusNotFound, map[string]string{"error": "Docker Engine not registered"})
			return
		}
		remote.overview(w, r)
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
	frontendPort := os.Getenv("VESSEL_FRONTEND_PORT")
	if frontendPort == "" {
		frontendPort = "3001"
	}
	cmd.Env = append(cmd.Env, "PORT="+frontendPort, "HOSTNAME=127.0.0.1")
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return cmd, nil
}

func publicHandler(docker *dockerClient) (http.Handler, error) {
	frontendPort := os.Getenv("VESSEL_FRONTEND_PORT")
	if frontendPort == "" {
		frontendPort = "3001"
	}
	target, err := url.Parse("http://127.0.0.1:" + frontendPort)
	if err != nil {
		return nil, err
	}
	frontend := httputil.NewSingleHostReverseProxy(target)
	originalDirector := frontend.Director
	frontend.Director = func(request *http.Request) {
		host := request.Host
		scheme := requestScheme(request)
		originalDirector(request)
		request.Host = host
		request.Header.Set("X-Forwarded-Proto", scheme)
	}
	frontend.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, err error) {
		log.Printf("Vessel frontend proxy failed: %v", err)
		http.Error(w, "Vessel frontend is starting", http.StatusBadGateway)
	}
	mux := http.NewServeMux()
	mux.Handle("/api/container-terminal", terminalHandler(docker))
	mux.Handle("/", frontend)
	return mux, nil
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
	publicAddr := os.Getenv("VESSEL_PUBLIC_ADDR")
	if publicAddr == "" {
		publicAddr = ":3000"
	}
	publicMux, err := publicHandler(docker)
	if err != nil {
		log.Fatal(err)
	}
	publicServer := &http.Server{Addr: publicAddr, Handler: publicMux, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		log.Printf("Vessel Go backend listening on %s", addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("backend stopped: %v", err)
		}
	}()
	go func() {
		log.Printf("Vessel public gateway listening on %s (frontend port %s)", publicAddr, func() string {
			if p := os.Getenv("VESSEL_FRONTEND_PORT"); p != "" {
				return p
			}
			return "3001"
		}())
		if err := publicServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("public gateway stopped: %v", err)
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
		_ = publicServer.Shutdown(ctx)
		_ = frontend.Process.Signal(syscall.SIGTERM)
	case err := <-waitCommand(frontend):
		if err != nil {
			log.Printf("frontend stopped: %v", err)
		}
		_ = server.Shutdown(context.Background())
		_ = publicServer.Shutdown(context.Background())
	}
}

func waitCommand(cmd *exec.Cmd) <-chan error {
	result := make(chan error, 1)
	go func() {
		result <- cmd.Wait()
	}()
	return result
}
