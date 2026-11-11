package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type terminalTicket struct {
	Subject   string `json:"sub"`
	Container string `json:"container"`
	Engine    string `json:"engine"`
	Shell     string `json:"shell"`
	Expires   int64  `json:"exp"`
	Nonce     string `json:"nonce"`
}

const terminalSubprotocol = "vessel.container-terminal"

var terminalUpgrade = websocket.Upgrader{ReadBufferSize: 4096, WriteBufferSize: 4096, Subprotocols: []string{terminalSubprotocol}, CheckOrigin: func(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
		return false
	}
	return strings.EqualFold(u.Host, r.Host) && u.Scheme == requestScheme(r)
}}

func requestScheme(r *http.Request) string {
	if r.TLS != nil {
		return "https"
	}
	if strings.EqualFold(os.Getenv("VESSEL_TRUST_PROXY"), "true") {
		forwarded := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0]))
		if forwarded == "http" || forwarded == "https" {
			return forwarded
		}
	}
	return "http"
}

var usedTerminalTickets = struct {
	sync.Mutex
	values map[string]int64
}{values: make(map[string]int64)}

func parseTerminalTicket(raw string) (terminalTicket, error) {
	var ticket terminalTicket
	parts := strings.Split(raw, ".")
	secret := os.Getenv("VESSEL_SECRET_KEY")
	if len(parts) != 2 || len(secret) < 32 {
		return ticket, errors.New("invalid ticket")
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ticket, errors.New("invalid ticket")
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(parts[0]))
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return ticket, errors.New("invalid ticket")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || json.Unmarshal(payload, &ticket) != nil || ticket.Subject == "" || ticket.Nonce == "" || ticket.Container == "" || (ticket.Shell != "bash" && ticket.Shell != "sh") || ticket.Expires < time.Now().Unix() || ticket.Expires > time.Now().Add(2*time.Minute).Unix() {
		return ticket, errors.New("expired ticket")
	}
	usedTerminalTickets.Lock()
	defer usedTerminalTickets.Unlock()
	for key, expiry := range usedTerminalTickets.values {
		if expiry < time.Now().Unix() {
			delete(usedTerminalTickets.values, key)
		}
	}
	if _, exists := usedTerminalTickets.values[ticket.Nonce]; exists {
		return ticket, errors.New("ticket already used")
	}
	usedTerminalTickets.values[ticket.Nonce] = ticket.Expires
	return ticket, nil
}

func terminalHandler(local *dockerClient) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/container-terminal", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		ticket, err := parseTerminalTicket(terminalTicketFromProtocols(r.Header.Get("Sec-WebSocket-Protocol")))
		if err != nil {
			log.Printf("terminal ticket rejected: %v", err)
			http.Error(w, "unauthorized terminal session", http.StatusUnauthorized)
			return
		}
		var docker *dockerClient
		var selectedRemote *remoteEngine
		if ticket.Engine == "" || ticket.Engine == "local" {
			docker = local
		} else {
			engine, ok := remoteEngineByID(ticket.Engine)
			if !ok {
				http.Error(w, "Engine unavailable", http.StatusNotFound)
				return
			}
			selectedRemote = &engine
			select {
			case remoteDockerRequests <- struct{}{}:
				defer func() { <-remoteDockerRequests }()
			case <-r.Context().Done():
				return
			}
			docker, err = remoteDockerClientFor(engine)
			if err != nil {
				http.Error(w, "remote Engine unavailable", http.StatusBadGateway)
				return
			}
		}
		ws, err := terminalUpgrade.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("terminal websocket upgrade denied: %v", err)
			return
		}
		defer ws.Close()
		ws.SetReadLimit(64 * 1024)
		log.Printf("terminal websocket connected for %s", ticket.Container[:12])
		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()
		if selectedRemote != nil {
			go func(engine remoteEngine) {
				ticker := time.NewTicker(time.Minute)
				defer ticker.Stop()
				for {
					select {
					case <-ctx.Done():
						return
					case <-ticker.C:
						_, _ = remoteDockerClientFor(engine)
					}
				}
			}(*selectedRemote)
		}
		stream, shell, execID, err := openInteractiveShell(ctx, docker, ticket.Container, ticket.Shell)
		if err != nil {
			log.Printf("terminal shell could not be opened for %s: %v", ticket.Container[:12], err)
			_ = ws.WriteMessage(websocket.TextMessage, []byte(err.Error()))
			return
		}
		defer stream.Close()
		log.Printf("terminal exec session opened for %s using %s", ticket.Container[:12], shell)
		_ = ws.WriteMessage(websocket.TextMessage, []byte("VESSEL_SHELL:"+shell))
		var writeMu sync.Mutex
		go func() {
			defer cancel()
			for {
				kind, data, readErr := ws.ReadMessage()
				if readErr != nil {
					return
				}
				if kind == websocket.BinaryMessage {
					if _, writeErr := stream.Write(data); writeErr != nil {
						return
					}
					continue
				}
				var msg struct {
					Type    string `json:"type"`
					Columns uint   `json:"columns"`
					Rows    uint   `json:"rows"`
				}
				if json.Unmarshal(data, &msg) == nil && msg.Type == "resize" && msg.Columns > 0 && msg.Rows > 0 && msg.Columns <= 500 && msg.Rows <= 300 {
					resizeReq, reqErr := http.NewRequestWithContext(ctx, http.MethodPost, docker.baseURL+"/exec/"+url.PathEscape(execID)+"/resize?h="+strconv.Itoa(int(msg.Rows))+"&w="+strconv.Itoa(int(msg.Columns)), nil)
					if reqErr == nil {
						if resized, resizeErr := docker.client.Do(resizeReq); resizeErr == nil {
							_ = resized.Body.Close()
						}
					}
				}
			}
		}()
		buffer := make([]byte, 32*1024)
		for {
			n, readErr := stream.Read(buffer)
			if n > 0 {
				writeMu.Lock()
				err = ws.WriteMessage(websocket.BinaryMessage, buffer[:n])
				writeMu.Unlock()
				if err != nil {
					return
				}
			}
			if readErr != nil {
				return
			}
			select {
			case <-ctx.Done():
				return
			default:
			}
		}
	})
	return mux
}

func terminalTicketFromProtocols(header string) string {
	hasTerminalProtocol := false
	ticket := ""
	for _, protocol := range strings.Split(header, ",") {
		protocol = strings.TrimSpace(protocol)
		if protocol == terminalSubprotocol {
			hasTerminalProtocol = true
		}
		if strings.HasPrefix(protocol, "ticket.") {
			if ticket != "" {
				return ""
			}
			ticket = strings.TrimPrefix(protocol, "ticket.")
		}
	}
	if !hasTerminalProtocol {
		return ""
	}
	return ticket
}

func openInteractiveShell(ctx context.Context, docker *dockerClient, containerID, preferred string) (io.ReadWriteCloser, string, string, error) {
	var failures []string
	for _, shell := range shellCandidates(preferred) {
		createBody, _ := json.Marshal(map[string]any{
			"AttachStdin": true, "AttachStdout": true, "AttachStderr": true,
			"Tty": true, "Cmd": []string{shell}, "User": "",
		})
		createReq, err := http.NewRequestWithContext(ctx, http.MethodPost, docker.baseURL+"/containers/"+url.PathEscape(containerID)+"/exec", strings.NewReader(string(createBody)))
		if err != nil {
			return nil, "", "", err
		}
		createReq.Header.Set("Content-Type", "application/json")
		created, err := docker.client.Do(createReq)
		if err != nil {
			failures = append(failures, shell+": "+err.Error())
			continue
		}
		if created.StatusCode < 200 || created.StatusCode >= 300 {
			body, _ := io.ReadAll(io.LimitReader(created.Body, 2048))
			_ = created.Body.Close()
			failures = append(failures, fmt.Sprintf("%s: Docker returned HTTP %d: %s", shell, created.StatusCode, strings.TrimSpace(string(body))))
			continue
		}
		var execInfo struct {
			ID string `json:"Id"`
		}
		err = json.NewDecoder(created.Body).Decode(&execInfo)
		_ = created.Body.Close()
		if err != nil || execInfo.ID == "" {
			failures = append(failures, shell+": Docker did not return an exec session ID")
			continue
		}
		startReq, err := http.NewRequestWithContext(ctx, http.MethodPost, docker.baseURL+"/exec/"+url.PathEscape(execInfo.ID)+"/start", strings.NewReader(`{"Detach":false,"Tty":true}`))
		if err != nil {
			return nil, "", "", err
		}
		startReq.Header.Set("Content-Type", "application/json")
		startReq.Header.Set("Connection", "Upgrade")
		startReq.Header.Set("Upgrade", "tcp")
		attached, err := docker.client.Do(startReq)
		if err != nil {
			failures = append(failures, shell+": "+err.Error())
			continue
		}
		stream, ok := attached.Body.(io.ReadWriteCloser)
		if !ok {
			body, _ := io.ReadAll(io.LimitReader(attached.Body, 2048))
			_ = attached.Body.Close()
			failures = append(failures, fmt.Sprintf("%s: non-interactive response HTTP %d %s", shell, attached.StatusCode, strings.TrimSpace(string(body))))
			continue
		}
		if attached.StatusCode != http.StatusSwitchingProtocols && (attached.StatusCode < 200 || attached.StatusCode >= 300) {
			_ = stream.Close()
			failures = append(failures, fmt.Sprintf("%s: Docker returned HTTP %d", shell, attached.StatusCode))
			continue
		}
		return stream, shell, execInfo.ID, nil
	}
	return nil, "", "", fmt.Errorf("No se pudo abrir una consola interactiva. Vessel probó Bash y sh. %s", strings.Join(failures, " · "))
}

func shellCandidates(preferred string) []string {
	if preferred == "bash" {
		return []string{"/bin/bash", "bash", "/bin/sh", "sh"}
	}
	return []string{"/bin/sh", "sh", "/bin/bash", "bash"}
}
