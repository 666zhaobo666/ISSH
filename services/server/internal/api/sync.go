package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"issh-server/internal/store"
)

func (s *Server) handleSyncHeartbeat(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	var profileVer int64
	var hasCloudProfile bool
	if p, err := s.Store().GetSyncProfile(u.ID); err == nil {
		profileVer = p.Version
		hasCloudProfile = true
	}
	threadsVer, _ := s.Store().GetThreadsMaxVersion(u.ID)

	writeJSON(w, http.StatusOK, map[string]any{
		"vipActive":         u.IsVipActive(),
		"vipExpireAt":       u.VipExpireAt,
		"hasCloudProfile":   hasCloudProfile,
		"profileVersion":    profileVer,
		"threadsMaxVersion": threadsVer,
	})
}

func (s *Server) handleGetSyncProfile(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	if !u.IsVipActive() {
		writeError(w, http.StatusForbidden, "VIP_REQUIRED", "VIP 已过期或未开通，云端数据已安全保留，激活 VIP 后即可恢复同步")
		return
	}
	p, err := s.Store().GetSyncProfile(u.ID)
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusOK, map[string]any{
			"exists":  false,
			"version": 0,
			"profile": nil,
		})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "读取云端配置失败")
		return
	}
	plain, err := s.Cipher.Decrypt(p.EncryptedPayload)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DECRYPT_ERROR", "解密云端配置失败（请检查服务端 MASTER_KEY）")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"exists":    true,
		"version":   p.Version,
		"updatedAt": p.UpdatedAt,
		"checksum":  p.Checksum,
		"profile":   json.RawMessage(plain),
	})
}

func (s *Server) handlePutSyncProfile(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	if !u.IsVipActive() {
		writeError(w, http.StatusForbidden, "VIP_REQUIRED", "仅 VIP 用户可使用云端同步功能")
		return
	}
	var req struct {
		Profile json.RawMessage `json:"profile"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Profile) == 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "无效的配置数据")
		return
	}
	// Limit profile payload to 10MB
	if len(req.Profile) > 10*1024*1024 {
		writeError(w, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "配置数据超过 10MB 限制")
		return
	}
	enc, err := s.Cipher.Encrypt(req.Profile)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "ENCRYPT_ERROR", "加密失败")
		return
	}
	sum := sha256.Sum256(req.Profile)
	now := time.Now().UnixMilli()
	nextVer, err := s.Store().UpsertSyncProfile(&store.SyncProfile{
		UserID:           u.ID,
		EncryptedPayload: enc,
		Checksum:         hex.EncodeToString(sum[:]),
		UpdatedAt:        now,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "保存云端配置失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"version":   nextVer,
		"updatedAt": now,
	})
}

func (s *Server) handleGetSyncThreads(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	if !u.IsVipActive() {
		writeError(w, http.StatusForbidden, "VIP_REQUIRED", "VIP 已过期或未开通，云端对话已保留，激活 VIP 后即可恢复")
		return
	}
	since, _ := strconv.ParseInt(r.URL.Query().Get("sinceVersion"), 10, 64)
	rows, err := s.Store().ListSyncThreadsSince(u.ID, since)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "拉取 AI 对话失败")
		return
	}
	type threadOut struct {
		ThreadID  string          `json:"threadId"`
		Version   int64           `json:"version"`
		Deleted   bool            `json:"deleted"`
		UpdatedAt int64           `json:"updatedAt"`
		Data      json.RawMessage `json:"data,omitempty"`
	}
	items := make([]threadOut, 0, len(rows))
	var maxVer int64 = since
	for _, row := range rows {
		if row.Version > maxVer {
			maxVer = row.Version
		}
		out := threadOut{
			ThreadID:  row.ThreadID,
			Version:   row.Version,
			Deleted:   row.Deleted,
			UpdatedAt: row.UpdatedAt,
		}
		if !row.Deleted && len(row.EncryptedPayload) > 0 {
			if plain, err := s.Cipher.Decrypt(row.EncryptedPayload); err == nil {
				out.Data = json.RawMessage(plain)
			}
		}
		items = append(items, out)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"maxVersion": maxVer,
		"threads":    items,
	})
}

func (s *Server) handlePostSyncThreads(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	if !u.IsVipActive() {
		writeError(w, http.StatusForbidden, "VIP_REQUIRED", "仅 VIP 用户可使用云端同步功能")
		return
	}
	var req struct {
		Threads []struct {
			ThreadID  string          `json:"threadId"`
			Deleted   bool            `json:"deleted"`
			UpdatedAt int64           `json:"updatedAt"`
			Data      json.RawMessage `json:"data"`
		} `json:"threads"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "请求参数格式错误")
		return
	}
	if len(req.Threads) == 0 {
		maxVer, _ := s.Store().GetThreadsMaxVersion(u.ID)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "maxVersion": maxVer})
		return
	}
	items := make([]*store.SyncThread, 0, len(req.Threads))
	for _, t := range req.Threads {
		if t.ThreadID == "" {
			continue
		}
		var enc []byte
		if !t.Deleted && len(t.Data) > 0 {
			var err error
			enc, err = s.Cipher.Encrypt(t.Data)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "ENCRYPT_ERROR", "加密对话失败")
				return
			}
		}
		ts := t.UpdatedAt
		if ts == 0 {
			ts = time.Now().UnixMilli()
		}
		items = append(items, &store.SyncThread{
			UserID:           u.ID,
			ThreadID:         t.ThreadID,
			EncryptedPayload: enc,
			Deleted:          t.Deleted,
			UpdatedAt:        ts,
		})
	}
	maxVer, err := s.Store().UpsertSyncThreads(u.ID, items)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "保存 AI 对话失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"maxVersion": maxVer,
	})
}
