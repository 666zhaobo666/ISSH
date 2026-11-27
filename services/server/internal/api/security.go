package api

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"issh-server/internal/store"
)

type rateBucket struct {
	timestamps []int64
}

var (
	rateMu      sync.Mutex
	regBuckets  = map[string]*rateBucket{}
	failBuckets = map[string]*rateBucket{}
)

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		if ip := strings.TrimSpace(parts[0]); ip != "" {
			return ip
		}
	}
	if xri := strings.TrimSpace(r.Header.Get("X-Real-IP")); xri != "" {
		return xri
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	return r.RemoteAddr
}

func (s *Server) logAudit(level, action, ip, actor, detail string) {
	_ = s.Store().AddAuditLog(&store.AuditLog{
		ID:        uuid.NewString(),
		Level:     level,
		Action:    action,
		IP:        ip,
		Actor:     actor,
		Detail:    detail,
		CreatedAt: time.Now().UnixMilli(),
	})
}

// checkIPBanned returns true (and writes 403) if the caller IP is banned.
func (s *Server) checkIPBanned(w http.ResponseWriter, r *http.Request) bool {
	ip := clientIP(r)
	if ip == "" || ip == "127.0.0.1" || ip == "::1" {
		return false
	}
	b, err := s.Store().IsIPBanned(ip, time.Now().UnixMilli())
	if err == nil && b != nil {
		writeError(w, http.StatusForbidden, "IP_BANNED", "当前 IP 因异常操作已被封禁："+b.Reason)
		return true
	}
	return false
}

// recordAndCheckAbuse tracks per-IP actions within a 10-minute window; if count exceeds limit, auto-bans IP for 24h.
func (s *Server) recordAndCheckAbuse(buckets map[string]*rateBucket, ip, kind string, limit int) bool {
	if ip == "" || ip == "127.0.0.1" || ip == "::1" {
		return false
	}
	now := time.Now().UnixMilli()
	windowMs := int64(10 * 60 * 1000)

	rateMu.Lock()
	b, ok := buckets[ip]
	if !ok {
		b = &rateBucket{}
		buckets[ip] = b
	}
	kept := b.timestamps[:0]
	for _, ts := range b.timestamps {
		if now-ts <= windowMs {
			kept = append(kept, ts)
		}
	}
	kept = append(kept, now)
	b.timestamps = kept
	exceeded := len(kept) > limit
	rateMu.Unlock()

	if exceeded {
		reason := "10 分钟内触发高频" + kind + "防护（自动封禁 24 小时）"
		_ = s.Store().BanIP(&store.BannedIP{
			IP:        ip,
			Reason:    reason,
			ExpiresAt: now + 24*3600*1000,
			CreatedAt: now,
		})
		s.logAudit("security", "ip_auto_ban", ip, "system", reason)
		return true
	}
	return false
}

func clearInMemoryCaches() {
	rateMu.Lock()
	regBuckets = map[string]*rateBucket{}
	failBuckets = map[string]*rateBucket{}
	rateMu.Unlock()

	releaseCacheMu.Lock()
	releaseCacheData = nil
	releaseCacheAt = time.Time{}
	releaseCacheMu.Unlock()
}
