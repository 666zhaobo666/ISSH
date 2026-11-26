package gateway

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"strconv"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
	"issh-server/internal/api"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type sshSession struct {
	id             string
	userID         string
	client         *ssh.Client
	ptySession     *ssh.Session
	ptyStdin       io.WriteCloser
	sftpMu         sync.Mutex
	sftpClient     *sftp.Client
	metricsMu      sync.Mutex
	metricsTracker *metricsTracker
	lastActive     time.Time
	mu             sync.Mutex
}

func (s *sshSession) touch() {
	s.mu.Lock()
	s.lastActive = time.Now()
	s.mu.Unlock()
}

func (s *sshSession) getSftp() (*sftp.Client, error) {
	s.sftpMu.Lock()
	defer s.sftpMu.Unlock()
	if s.sftpClient != nil {
		return s.sftpClient, nil
	}
	sc, err := sftp.NewClient(s.client)
	if err != nil {
		return nil, err
	}
	s.sftpClient = sc
	return sc, nil
}

func (s *sshSession) close() {
	s.sftpMu.Lock()
	if s.sftpClient != nil {
		_ = s.sftpClient.Close()
		s.sftpClient = nil
	}
	s.sftpMu.Unlock()
	if s.ptyStdin != nil {
		_ = s.ptyStdin.Close()
	}
	if s.ptySession != nil {
		_ = s.ptySession.Close()
	}
	if s.client != nil {
		_ = s.client.Close()
	}
}

type Gateway struct {
	srv      *api.Server
	mu       sync.RWMutex
	sessions map[string]*sshSession
}

func NewGateway(srv *api.Server) *Gateway {
	g := &Gateway{
		srv:      srv,
		sessions: map[string]*sshSession{},
	}
	go g.reaperLoop()
	return g
}

func (g *Gateway) reaperLoop() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		idleMins := 30
		if v, ok, _ := g.srv.Store().GetSetting("web_idle_timeout_mins"); ok {
			if n, err := strconv.Atoi(v); n > 0 && err == nil {
				idleMins = n
			}
		}
		cutoff := time.Now().Add(-time.Duration(idleMins) * time.Minute)
		g.mu.Lock()
		for id, sess := range g.sessions {
			sess.mu.Lock()
			expired := sess.lastActive.Before(cutoff)
			sess.mu.Unlock()
			if expired {
				sess.close()
				delete(g.sessions, id)
			}
		}
		g.mu.Unlock()
	}
}

func (g *Gateway) countUserSessions(userID string) int {
	g.mu.RLock()
	defer g.mu.RUnlock()
	n := 0
	for _, s := range g.sessions {
		if s.userID == userID {
			n++
		}
	}
	return n
}

func (g *Gateway) getUserSession(userID, sessionID string) (*sshSession, error) {
	g.mu.RLock()
	defer g.mu.RUnlock()
	s, ok := g.sessions[sessionID]
	if !ok || s.userID != userID {
		return nil, errors.New("SSH 会话不存在或已断开")
	}
	s.touch()
	return s, nil
}

type wsRequest struct {
	ReqID     string          `json:"reqId"`
	Action    string          `json:"action"`
	SessionID string          `json:"sessionId,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}

type wsMessage struct {
	Type      string `json:"type"` // "response" | "pty_data" | "status"
	ReqID     string `json:"reqId,omitempty"`
	SessionID string `json:"sessionId,omitempty"`
	OK        bool   `json:"ok,omitempty"`
	Data      any    `json:"data,omitempty"`
	Error     string `json:"error,omitempty"`
}

func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}
	user, err := g.srv.AuthenticateToken(token)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	var writeMu sync.Mutex
	send := func(msg wsMessage) {
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = conn.WriteJSON(msg)
	}

	// Track sessions created by this WebSocket connection so we clean up on disconnect
	var ownedMu sync.Mutex
	ownedIDs := map[string]struct{}{}
	defer func() {
		ownedMu.Lock()
		ids := make([]string, 0, len(ownedIDs))
		for id := range ownedIDs {
			ids = append(ids, id)
		}
		ownedMu.Unlock()
		g.mu.Lock()
		for _, id := range ids {
			if s, ok := g.sessions[id]; ok {
				s.close()
				delete(g.sessions, id)
			}
		}
		g.mu.Unlock()
	}()

	for {
		var req wsRequest
		if err := conn.ReadJSON(&req); err != nil {
			return
		}
		go func(req wsRequest) {
			data, err := g.dispatch(user.ID, req, send, func(sid string) {
				ownedMu.Lock()
				ownedIDs[sid] = struct{}{}
				ownedMu.Unlock()
			})
			if err != nil {
				send(wsMessage{Type: "response", ReqID: req.ReqID, OK: false, Error: err.Error()})
			} else {
				send(wsMessage{Type: "response", ReqID: req.ReqID, OK: true, Data: data})
			}
		}(req)
	}
}

func (g *Gateway) dispatch(
	userID string,
	req wsRequest,
	send func(wsMessage),
	onOwned func(string),
) (any, error) {
	switch req.Action {
	case "connect":
		maxConns := 10
		if v, ok, _ := g.srv.Store().GetSetting("web_max_ssh_conns"); ok {
			if n, err := strconv.Atoi(v); n > 0 && err == nil {
				maxConns = n
			}
		}
		if g.countUserSessions(userID) >= maxConns {
			return nil, fmt.Errorf("已达到单用户最大并发 SSH 连接数限制 (%d)", maxConns)
		}

		var p struct {
			Host     string `json:"host"`
			Port     int    `json:"port"`
			Username string `json:"username"`
			Auth     struct {
				Type       string `json:"type"`
				Password   string `json:"password"`
				PrivateKey string `json:"privateKey"`
				Passphrase string `json:"passphrase"`
			} `json:"auth"`
			Cols int `json:"cols"`
			Rows int `json:"rows"`
		}
		if err := json.Unmarshal(req.Payload, &p); err != nil {
			return nil, err
		}
		if p.Port <= 0 {
			p.Port = 22
		}
		if p.Cols <= 0 {
			p.Cols = 100
		}
		if p.Rows <= 0 {
			p.Rows = 30
		}

		var authMethods []ssh.AuthMethod
		switch p.Auth.Type {
		case "privateKey":
			var signer ssh.Signer
			var err error
			if p.Auth.Passphrase != "" {
				signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(p.Auth.PrivateKey), []byte(p.Auth.Passphrase))
			} else {
				signer, err = ssh.ParsePrivateKey([]byte(p.Auth.PrivateKey))
			}
			if err != nil {
				return nil, fmt.Errorf("私钥解析失败: %w", err)
			}
			authMethods = append(authMethods, ssh.PublicKeys(signer))
		default:
			authMethods = append(authMethods, ssh.Password(p.Auth.Password))
		}

		clientCfg := &ssh.ClientConfig{
			User:            p.Username,
			Auth:            authMethods,
			HostKeyCallback: ssh.InsecureIgnoreHostKey(),
			Timeout:         12 * time.Second,
		}
		addr := fmt.Sprintf("%s:%d", p.Host, p.Port)
		client, err := ssh.Dial("tcp", addr, clientCfg)
		if err != nil {
			return nil, fmt.Errorf("SSH 连接失败: %w", err)
		}

		ptySess, err := client.NewSession()
		if err != nil {
			_ = client.Close()
			return nil, err
		}
		modes := ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 14400, ssh.TTY_OP_OSPEED: 14400}
		if err := ptySess.RequestPty("xterm-256color", p.Rows, p.Cols, modes); err != nil {
			_ = ptySess.Close()
			_ = client.Close()
			return nil, err
		}
		stdin, err := ptySess.StdinPipe()
		if err != nil {
			_ = ptySess.Close()
			_ = client.Close()
			return nil, err
		}
		stdout, err := ptySess.StdoutPipe()
		if err != nil {
			_ = ptySess.Close()
			_ = client.Close()
			return nil, err
		}
		if err := ptySess.Shell(); err != nil {
			_ = ptySess.Close()
			_ = client.Close()
			return nil, err
		}

		sid := uuid.NewString()
		sess := &sshSession{
			id:             sid,
			userID:         userID,
			client:         client,
			ptySession:     ptySess,
			ptyStdin:       stdin,
			metricsTracker: newMetricsTracker(),
			lastActive:     time.Now(),
		}
		g.mu.Lock()
		g.sessions[sid] = sess
		g.mu.Unlock()
		onOwned(sid)

		go func() {
			buf := make([]byte, 8192)
			for {
				n, err := stdout.Read(buf)
				if n > 0 {
					sess.touch()
					send(wsMessage{
						Type:      "pty_data",
						SessionID: sid,
						Data:      base64.StdEncoding.EncodeToString(buf[:n]),
					})
				}
				if err != nil {
					send(wsMessage{
						Type:      "status",
						SessionID: sid,
						Data:      map[string]any{"status": "disconnected"},
					})
					return
				}
			}
		}()

		return map[string]string{"sessionId": sid}, nil

	case "write_pty":
		sess, err := g.getUserSession(userID, req.SessionID)
		if err != nil {
			return nil, err
		}
		var p struct {
			DataB64 string `json:"dataB64"`
		}
		if err := json.Unmarshal(req.Payload, &p); err != nil {
			return nil, err
		}
		raw, err := base64.StdEncoding.DecodeString(p.DataB64)
		if err != nil {
			return nil, err
		}
		_, err = sess.ptyStdin.Write(raw)
		return map[string]bool{"ok": true}, err

	case "resize_pty":
		sess, err := g.getUserSession(userID, req.SessionID)
		if err != nil {
			return nil, err
		}
		var p struct {
			Cols int `json:"cols"`
			Rows int `json:"rows"`
		}
		_ = json.Unmarshal(req.Payload, &p)
		return map[string]bool{"ok": true}, sess.ptySession.WindowChange(p.Rows, p.Cols)

	case "disconnect":
		g.mu.Lock()
		if s, ok := g.sessions[req.SessionID]; ok && s.userID == userID {
			s.close()
			delete(g.sessions, req.SessionID)
		}
		g.mu.Unlock()
		return map[string]bool{"ok": true}, nil

	case "exec":
		sess, err := g.getUserSession(userID, req.SessionID)
		if err != nil {
			return nil, err
		}
		var p struct {
			Command string `json:"command"`
		}
		if err := json.Unmarshal(req.Payload, &p); err != nil {
			return nil, err
		}
		ch, err := sess.client.NewSession()
		if err != nil {
			return nil, err
		}
		defer ch.Close()
		var outBuf, errBuf bytes.Buffer
		ch.Stdout = &outBuf
		ch.Stderr = &errBuf
		runErr := ch.Run(p.Command)
		exitCode := 0
		if runErr != nil {
			if ee, ok := runErr.(*ssh.ExitError); ok {
				exitCode = ee.ExitStatus()
			}
		}
		return map[string]any{
			"stdout":   outBuf.String(),
			"stderr":   errBuf.String(),
			"exitCode": exitCode,
			"timedOut": false,
		}, nil

	case "fetch_metrics":
		sess, err := g.getUserSession(userID, req.SessionID)
		if err != nil {
			return nil, err
		}
		ch, err := sess.client.NewSession()
		if err != nil {
			return nil, err
		}
		defer ch.Close()
		var outBuf bytes.Buffer
		ch.Stdout = &outBuf
		_ = ch.Run(metricsProbeCmd)
		sess.metricsMu.Lock()
		parsed := sess.metricsTracker.parse(outBuf.String())
		sess.metricsMu.Unlock()
		return parsed, nil

	case "sftp_realpath":
		sess, err := g.getUserSession(userID, req.SessionID)
		if err != nil {
			return nil, err
		}
		sc, err := sess.getSftp()
		if err != nil {
			return nil, err
		}
		var p struct {
			Path string `json:"path"`
		}
		_ = json.Unmarshal(req.Payload, &p)
		target := p.Path
		if target == "" || target == "~" {
			target = "."
		} else if len(target) > 2 && target[:2] == "~/" {
			if home, err := sc.RealPath("."); err == nil {
				target = path.Join(home, target[2:])
			}
		}
		real, err := sc.RealPath(target)
		return map[string]string{"path": real}, err

	case "sftp_list":
		sess, err := g.getUserSession(userID, req.SessionID)
		if err != nil {
			return nil, err
		}
		sc, err := sess.getSftp()
		if err != nil {
			return nil, err
		}
		var p struct {
			Path string `json:"path"`
		}
		_ = json.Unmarshal(req.Payload, &p)
		dir := p.Path
		if dir == "" || dir == "~" {
			if rp, err := sc.RealPath("."); err == nil {
				dir = rp
			} else {
				dir = "/"
			}
		}
		infos, err := sc.ReadDir(dir)
		if err != nil {
			return nil, err
		}
		entries := make([]map[string]any, 0, len(infos))
		for _, info := range infos {
			ft := "file"
			if info.IsDir() {
				ft = "directory"
			} else if info.Mode()&os.ModeSymlink != 0 {
				ft = "symlink"
			}
			entries = append(entries, map[string]any{
				"name":       info.Name(),
				"path":       path.Join(dir, info.Name()),
				"type":       ft,
				"size":       info.Size(),
				"permissions": uint32(info.Mode().Perm()),
				"modifiedAt": info.ModTime().UnixMilli(),
			})
		}
		return entries, nil

	case "sftp_read":
		sess, err := g.getUserSession(userID, req.SessionID)
		if err != nil {
			return nil, err
		}
		sc, err := sess.getSftp()
		if err != nil {
			return nil, err
		}
		var p struct {
			Path string `json:"path"`
		}
		_ = json.Unmarshal(req.Payload, &p)
		f, err := sc.Open(p.Path)
		if err != nil {
			return nil, err
		}
		defer f.Close()
		b, err := io.ReadAll(io.LimitReader(f, 8*1024*1024))
		if err != nil {
			return nil, err
		}
		info, _ := f.Stat()
		perm := uint32(0o644)
		if info != nil {
			perm = uint32(info.Mode().Perm())
		}
		return map[string]any{
			"path":        p.Path,
			"text":        string(b),
			"bytesB64":    base64.StdEncoding.EncodeToString(b),
			"permissions": perm,
			"encoding":    "utf-8",
		}, nil

	case "sftp_write":
		sess, err := g.getUserSession(userID, req.SessionID)
		if err != nil {
			return nil, err
		}
		sc, err := sess.getSftp()
		if err != nil {
			return nil, err
		}
		var p struct {
			Path        string  `json:"path"`
			BytesB64    string  `json:"bytesB64"`
			Permissions *uint32 `json:"permissions"`
		}
		_ = json.Unmarshal(req.Payload, &p)
		raw, err := base64.StdEncoding.DecodeString(p.BytesB64)
		if err != nil {
			return nil, err
		}
		f, err := sc.Create(p.Path)
		if err != nil {
			return nil, err
		}
		_, wErr := f.Write(raw)
		_ = f.Close()
		if wErr != nil {
			return nil, wErr
		}
		if p.Permissions != nil {
			_ = sc.Chmod(p.Path, os.FileMode(*p.Permissions))
		}
		return map[string]bool{"ok": true}, nil

	case "sftp_mkdir":
		sess, err := g.getUserSession(userID, req.SessionID)
		if err != nil {
			return nil, err
		}
		sc, err := sess.getSftp()
		if err != nil {
			return nil, err
		}
		var p struct {
			Path string `json:"path"`
		}
		_ = json.Unmarshal(req.Payload, &p)
		return map[string]bool{"ok": true}, sc.Mkdir(p.Path)

	case "sftp_remove":
		sess, err := g.getUserSession(userID, req.SessionID)
		if err != nil {
			return nil, err
		}
		sc, err := sess.getSftp()
		if err != nil {
			return nil, err
		}
		var p struct {
			Path  string `json:"path"`
			IsDir bool   `json:"isDir"`
		}
		_ = json.Unmarshal(req.Payload, &p)
		if p.IsDir {
			return map[string]bool{"ok": true}, sc.RemoveDirectory(p.Path)
		}
		return map[string]bool{"ok": true}, sc.Remove(p.Path)

	case "sftp_rename":
		sess, err := g.getUserSession(userID, req.SessionID)
		if err != nil {
			return nil, err
		}
		sc, err := sess.getSftp()
		if err != nil {
			return nil, err
		}
		var p struct {
			OldPath string `json:"oldPath"`
			NewPath string `json:"newPath"`
		}
		_ = json.Unmarshal(req.Payload, &p)
		return map[string]bool{"ok": true}, sc.Rename(p.OldPath, p.NewPath)
	}

	return nil, fmt.Errorf("unknown action: %s", req.Action)
}
