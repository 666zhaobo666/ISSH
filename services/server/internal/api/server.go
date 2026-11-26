package api

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"issh-server/internal/config"
	icrypto "issh-server/internal/crypto"
	"issh-server/internal/store"
)

type ctxKey string

const ctxUserKey ctxKey = "auth_user"

type Server struct {
	Cfg      *config.Config
	Cipher   *icrypto.Cipher
	storeMu  sync.RWMutex
	store    store.Store
	wsRouter http.Handler // optional WebSocket SSH gateway mounted in Phase 4B
}

func NewServer(cfg *config.Config, st store.Store, c *icrypto.Cipher) *Server {
	return &Server{
		Cfg:    cfg,
		Cipher: c,
		store:  st,
	}
}

func (s *Server) SetGatewayHandler(h http.Handler) {
	s.wsRouter = h
}

func (s *Server) Store() store.Store {
	s.storeMu.RLock()
	defer s.storeMu.RUnlock()
	return s.store
}

func (s *Server) ReplaceStore(next store.Store) {
	s.storeMu.Lock()
	old := s.store
	s.store = next
	s.storeMu.Unlock()
	if old != nil {
		_ = old.Close()
	}
}

type Claims struct {
	UserID       string `json:"uid"`
	Role         string `json:"role"`
	TokenVersion int    `json:"tv"`
	jwt.RegisteredClaims
}

func (s *Server) IssueToken(u *store.User) (string, error) {
	claims := Claims{
		UserID:       u.ID,
		Role:         u.Role,
		TokenVersion: u.TokenVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(30 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return t.SignedString(s.Cfg.JWTSecret)
}

func (s *Server) AuthenticateToken(tokenStr string) (*store.User, error) {
	parsed, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (any, error) {
		return s.Cfg.JWTSecret, nil
	})
	if err != nil || !parsed.Valid {
		return nil, err
	}
	claims, ok := parsed.Claims.(*Claims)
	if !ok {
		return nil, jwt.ErrTokenInvalidClaims
	}
	u, err := s.Store().GetUserByID(claims.UserID)
	if err != nil {
		return nil, err
	}
	if u.Status != "active" || u.TokenVersion != claims.TokenVersion {
		return nil, jwt.ErrTokenExpired
	}
	return u, nil
}

func (s *Server) withAuth(next http.HandlerFunc, requireAdmin bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authz := r.Header.Get("Authorization")
		tokenStr := strings.TrimPrefix(authz, "Bearer ")
		if tokenStr == "" || tokenStr == authz {
			tokenStr = r.URL.Query().Get("token")
		}
		if tokenStr == "" {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "请先登录")
			return
		}
		u, err := s.AuthenticateToken(tokenStr)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "登录已失效或账号已被禁用，请重新登录")
			return
		}
		if requireAdmin && u.Role != "admin" {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "需要管理员权限")
			return
		}
		ctx := context.WithValue(r.Context(), ctxUserKey, u)
		next(w, r.WithContext(ctx))
	}
}

func currentUser(r *http.Request) *store.User {
	u, _ := r.Context().Value(ctxUserKey).(*store.User)
	return u
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// Public & Auth APIs
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		siteName, _, _ := s.Store().GetSetting("site_name")
		if siteName == "" {
			siteName = "ISSH"
		}
		regEnabled, _, _ := s.Store().GetSetting("registration_enabled")
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":                  true,
			"siteName":            siteName,
			"registrationEnabled": regEnabled != "false",
		})
	})
	mux.HandleFunc("POST /api/auth/send-code", s.handleSendCode)
	mux.HandleFunc("POST /api/auth/register", s.handleRegister)
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/reset-password", s.handleResetPassword)

	// Authenticated user APIs
	mux.HandleFunc("GET /api/user/me", s.withAuth(s.handleGetMe, false))
	mux.HandleFunc("PUT /api/user/profile", s.withAuth(s.handleUpdateProfile, false))
	mux.HandleFunc("POST /api/user/avatar", s.withAuth(s.handleUploadAvatar, false))
	mux.HandleFunc("POST /api/user/change-password", s.withAuth(s.handleChangePassword, false))
	mux.HandleFunc("POST /api/vip/redeem", s.withAuth(s.handleRedeemVip, false))

	// Cloud Sync APIs (VIP gated)
	mux.HandleFunc("GET /api/sync/heartbeat", s.withAuth(s.handleSyncHeartbeat, false))
	mux.HandleFunc("GET /api/sync/profile", s.withAuth(s.handleGetSyncProfile, false))
	mux.HandleFunc("PUT /api/sync/profile", s.withAuth(s.handlePutSyncProfile, false))
	mux.HandleFunc("GET /api/sync/threads", s.withAuth(s.handleGetSyncThreads, false))
	mux.HandleFunc("POST /api/sync/threads", s.withAuth(s.handlePostSyncThreads, false))

	// Admin APIs
	mux.HandleFunc("GET /api/admin/stats", s.withAuth(s.handleAdminStats, true))
	mux.HandleFunc("GET /api/admin/users", s.withAuth(s.handleAdminListUsers, true))
	mux.HandleFunc("PUT /api/admin/users/{id}/status", s.withAuth(s.handleAdminUpdateUserStatus, true))
	mux.HandleFunc("PUT /api/admin/users/{id}/vip", s.withAuth(s.handleAdminUpdateUserVip, true))
	mux.HandleFunc("PUT /api/admin/users/{id}/password", s.withAuth(s.handleAdminResetUserPassword, true))
	mux.HandleFunc("GET /api/admin/tokens", s.withAuth(s.handleAdminListTokens, true))
	mux.HandleFunc("POST /api/admin/tokens/batch", s.withAuth(s.handleAdminGenerateTokens, true))
	mux.HandleFunc("POST /api/admin/tokens/{id}/revoke", s.withAuth(s.handleAdminRevokeToken, true))
	mux.HandleFunc("GET /api/admin/settings", s.withAuth(s.handleAdminGetSettings, true))
	mux.HandleFunc("PUT /api/admin/settings", s.withAuth(s.handleAdminUpdateSettings, true))
	mux.HandleFunc("POST /api/admin/settings/test-smtp", s.withAuth(s.handleAdminTestSMTP, true))
	mux.HandleFunc("GET /api/admin/backup/export", s.withAuth(s.handleAdminExportBackup, true))
	mux.HandleFunc("POST /api/admin/backup/restore", s.withAuth(s.handleAdminRestoreBackup, true))

	// Avatar static serving
	mux.HandleFunc("GET /avatars/", func(w http.ResponseWriter, r *http.Request) {
		name := filepath.Base(strings.TrimPrefix(r.URL.Path, "/avatars/"))
		if name == "" || name == "." || name == "/" {
			http.NotFound(w, r)
			return
		}
		full := filepath.Join(s.Cfg.AvatarsDir, name)
		w.Header().Set("Cache-Control", "public, max-age=86400")
		http.ServeFile(w, r, full)
	})

	// WebSocket SSH/SFTP Gateway (mounted in Phase 4B)
	mux.HandleFunc("/ws/ssh", func(w http.ResponseWriter, r *http.Request) {
		if s.wsRouter == nil {
			writeError(w, http.StatusNotImplemented, "NOT_READY", "WebSocket SSH 网关尚未启用")
			return
		}
		s.wsRouter.ServeHTTP(w, r)
	})

	// Admin SPA static hosting (/admin)
	mux.Handle("/admin/", serveSPA("/admin", s.Cfg.AdminDistDir))
	mux.HandleFunc("GET /admin", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/admin/", http.StatusMovedPermanently)
	})

	// Web Client SPA static hosting (/)
	mux.Handle("/", serveSPA("", s.Cfg.WebDistDir))

	return s.withCORS(mux)
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := s.Cfg.CORSOrigin
		if origin == "*" {
			if reqOrigin := r.Header.Get("Origin"); reqOrigin != "" {
				w.Header().Set("Access-Control-Allow-Origin", reqOrigin)
			} else {
				w.Header().Set("Access-Control-Allow-Origin", "*")
			}
		} else {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func serveSPA(prefix, distDir string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := os.Stat(distDir); err != nil {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("ISSH Server running. Static UI bundle not built yet at: " + distDir))
			return
		}
		rel := strings.TrimPrefix(r.URL.Path, prefix)
		rel = strings.TrimPrefix(rel, "/")
		if rel == "" {
			rel = "index.html"
		}
		target := filepath.Join(distDir, filepath.FromSlash(rel))
		if info, err := os.Stat(target); err == nil && !info.IsDir() {
			http.ServeFile(w, r, target)
			return
		}
		http.ServeFile(w, r, filepath.Join(distDir, "index.html"))
	})
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{
		"error":   code,
		"message": message,
	})
}
