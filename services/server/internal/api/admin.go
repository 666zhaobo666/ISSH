package api

import (
	"archive/zip"
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	imail "issh-server/internal/mail"
	"issh-server/internal/store"
)

const tokenAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func generateVipCode() string {
	seg := func(n int) string {
		b := make([]byte, n)
		for i := range b {
			idx, _ := rand.Int(rand.Reader, big.NewInt(int64(len(tokenAlphabet))))
			b[i] = tokenAlphabet[idx.Int64()]
		}
		return string(b)
	}
	return fmt.Sprintf("ISSH-%s-%s-%s", seg(4), seg(4), seg(4))
}

func (s *Server) handleAdminStats(w http.ResponseWriter, r *http.Request) {
	stats, err := s.Store().GetAdminStats()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "读取统计信息失败")
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func (s *Server) handleAdminListUsers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	users, total, err := s.Store().ListUsers(q, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "查询用户列表失败")
		return
	}
	items := make([]map[string]any, 0, len(users))
	for _, u := range users {
		items = append(items, userDTO(u))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"total": total,
		"users": items,
	})
}

func (s *Server) handleAdminUpdateUserStatus(w http.ResponseWriter, r *http.Request) {
	admin := currentUser(r)
	targetID := r.PathValue("id")
	if targetID == admin.ID {
		writeError(w, http.StatusBadRequest, "SELF_ACTION", "不能禁用当前登录的管理员账号")
		return
	}
	var req struct {
		Status string `json:"status"` // "active" | "disabled"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "请求参数错误")
		return
	}
	if req.Status != "active" && req.Status != "disabled" {
		writeError(w, http.StatusBadRequest, "INVALID_STATUS", "状态仅支持 active 或 disabled")
		return
	}
	if err := s.Store().UpdateUserStatus(targetID, req.Status); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "更新用户状态失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAdminUpdateUserVip(w http.ResponseWriter, r *http.Request) {
	targetID := r.PathValue("id")
	var req struct {
		AddDays  *int   `json:"addDays"`
		ExpireAt *int64 `json:"expireAt"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "请求参数错误")
		return
	}
	u, err := s.Store().GetUserByID(targetID)
	if err != nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "用户不存在")
		return
	}
	var nextExpire int64
	if req.ExpireAt != nil {
		nextExpire = *req.ExpireAt
	} else if req.AddDays != nil {
		now := time.Now().UnixMilli()
		base := now
		if u.VipExpireAt > now {
			base = u.VipExpireAt
		}
		nextExpire = base + int64(*req.AddDays)*24*3600*1000
		if nextExpire < 0 {
			nextExpire = 0
		}
	} else {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "请提供 addDays 或 expireAt")
		return
	}
	if err := s.Store().UpdateUserVip(targetID, nextExpire); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "更新 VIP 失败")
		return
	}
	u.VipExpireAt = nextExpire
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "user": userDTO(u)})
}

func (s *Server) handleAdminResetUserPassword(w http.ResponseWriter, r *http.Request) {
	targetID := r.PathValue("id")
	var req struct {
		NewPassword string `json:"newPassword"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "请求参数错误")
		return
	}
	if err := ValidatePassword(req.NewPassword); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PASSWORD", err.Error())
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "HASH_ERROR", "加密失败")
		return
	}
	if err := s.Store().UpdateUserPassword(targetID, string(hash)); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "重置密码失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAdminListTokens(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	tokens, total, err := s.Store().ListVipTokens(status, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "查询卡密列表失败")
		return
	}
	if tokens == nil {
		tokens = []*store.VipToken{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"total":  total,
		"tokens": tokens,
	})
}

func (s *Server) handleAdminGenerateTokens(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Count        int    `json:"count"`
		DurationDays int    `json:"durationDays"`
		BatchNote    string `json:"batchNote"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "请求参数错误")
		return
	}
	if req.Count <= 0 || req.Count > 200 {
		writeError(w, http.StatusBadRequest, "INVALID_COUNT", "单次生成数量需在 1~200 之间")
		return
	}
	if req.DurationDays <= 0 || req.DurationDays > 3650 {
		writeError(w, http.StatusBadRequest, "INVALID_DAYS", "有效天数需在 1~3650 之间")
		return
	}
	now := time.Now().UnixMilli()
	tokens := make([]*store.VipToken, 0, req.Count)
	for i := 0; i < req.Count; i++ {
		tokens = append(tokens, &store.VipToken{
			ID:           uuid.NewString(),
			Code:         generateVipCode(),
			DurationDays: req.DurationDays,
			Status:       "unused",
			BatchNote:    strings.TrimSpace(req.BatchNote),
			CreatedAt:    now,
		})
	}
	if err := s.Store().CreateVipTokens(tokens); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "批量生成卡密失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"tokens": tokens,
	})
}

func (s *Server) handleAdminRevokeToken(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.Store().RevokeVipToken(id); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "作废卡密失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

type SystemSettingsPayload struct {
	SiteName            string           `json:"siteName"`
	RegistrationEnabled bool             `json:"registrationEnabled"`
	WebMaxSshConns      int              `json:"webMaxSshConns"`
	WebIdleTimeoutMins  int              `json:"webIdleTimeoutMins"`
	SMTP                imail.SMTPConfig `json:"smtp"`
}

func (s *Server) loadSystemSettings() SystemSettingsPayload {
	all, _ := s.Store().GetAllSettings()
	siteName := all["site_name"]
	if siteName == "" {
		siteName = "ISSH"
	}
	regEnabled := all["registration_enabled"] != "false"
	maxConns, _ := strconv.Atoi(all["web_max_ssh_conns"])
	if maxConns <= 0 {
		maxConns = 10
	}
	idleMins, _ := strconv.Atoi(all["web_idle_timeout_mins"])
	if idleMins <= 0 {
		idleMins = 30
	}
	smtpCfg := imail.ParseSMTPConfig(all["smtp_config"])
	return SystemSettingsPayload{
		SiteName:            siteName,
		RegistrationEnabled: regEnabled,
		WebMaxSshConns:      maxConns,
		WebIdleTimeoutMins:  idleMins,
		SMTP:                smtpCfg,
	}
}

func (s *Server) handleAdminGetSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.loadSystemSettings())
}

func (s *Server) handleAdminUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var req SystemSettingsPayload
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "请求参数格式错误")
		return
	}
	if strings.TrimSpace(req.SiteName) == "" {
		req.SiteName = "ISSH"
	}
	if req.WebMaxSshConns <= 0 {
		req.WebMaxSshConns = 10
	}
	if req.WebIdleTimeoutMins <= 0 {
		req.WebIdleTimeoutMins = 30
	}

	_ = s.Store().SetSetting("site_name", strings.TrimSpace(req.SiteName))
	if req.RegistrationEnabled {
		_ = s.Store().SetSetting("registration_enabled", "true")
	} else {
		_ = s.Store().SetSetting("registration_enabled", "false")
	}
	_ = s.Store().SetSetting("web_max_ssh_conns", strconv.Itoa(req.WebMaxSshConns))
	_ = s.Store().SetSetting("web_idle_timeout_mins", strconv.Itoa(req.WebIdleTimeoutMins))
	smtpBytes, _ := json.Marshal(req.SMTP)
	_ = s.Store().SetSetting("smtp_config", string(smtpBytes))

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "settings": s.loadSystemSettings()})
}

func (s *Server) handleAdminTestSMTP(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ToEmail string            `json:"toEmail"`
		SMTP    *imail.SMTPConfig `json:"smtp,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "请求参数错误")
		return
	}
	toEmail, err := ValidateEmail(req.ToEmail)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_EMAIL", err.Error())
		return
	}
	settings := s.loadSystemSettings()
	cfg := settings.SMTP
	if req.SMTP != nil {
		cfg = *req.SMTP
	}
	subject := fmt.Sprintf("[%s] SMTP 发信测试成功", settings.SiteName)
	body := fmt.Sprintf("您好，这是来自 %s 管理后台的测试邮件。\n如果您收到此邮件，说明 SMTP 发信配置已生效！", settings.SiteName)
	if err := imail.SendEmail(cfg, toEmail, subject, body); err != nil {
		writeError(w, http.StatusBadGateway, "SMTP_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

type backupManifest struct {
	SchemaVersion int    `json:"schemaVersion"`
	ExportedAt    int64  `json:"exportedAt"`
	DBSha256      string `json:"dbSha256"`
	AvatarCount   int    `json:"avatarCount"`
}

// handleAdminExportBackup creates a consistent SQLite snapshot (VACUUM INTO) + avatars/ + manifest.json as a .zip archive.
func (s *Server) handleAdminExportBackup(w http.ResponseWriter, r *http.Request) {
	tmpDir, err := os.MkdirTemp("", "issh-backup-*")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "IO_ERROR", "创建临时目录失败")
		return
	}
	defer os.RemoveAll(tmpDir)

	snapPath := filepath.Join(tmpDir, "issh.db")
	if err := s.Store().VacuumInto(snapPath); err != nil {
		writeError(w, http.StatusInternalServerError, "BACKUP_ERROR", "SQLite 热备份失败: "+err.Error())
		return
	}
	dbBytes, err := os.ReadFile(snapPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "IO_ERROR", "读取备份数据库失败")
		return
	}
	dbHash := sha256.Sum256(dbBytes)

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	// 1. Add issh.db
	if fw, err := zw.Create("issh.db"); err == nil {
		_, _ = fw.Write(dbBytes)
	}

	// 2. Add avatars/*
	avatarCount := 0
	if entries, err := os.ReadDir(s.Cfg.AvatarsDir); err == nil {
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			b, err := os.ReadFile(filepath.Join(s.Cfg.AvatarsDir, entry.Name()))
			if err != nil {
				continue
			}
			if fw, err := zw.Create("avatars/" + entry.Name()); err == nil {
				_, _ = fw.Write(b)
				avatarCount++
			}
		}
	}

	// 3. Add manifest.json
	manifest := backupManifest{
		SchemaVersion: 1,
		ExportedAt:    time.Now().UnixMilli(),
		DBSha256:      hex.EncodeToString(dbHash[:]),
		AvatarCount:   avatarCount,
	}
	manifestBytes, _ := json.MarshalIndent(manifest, "", "  ")
	if fw, err := zw.Create("manifest.json"); err == nil {
		_, _ = fw.Write(manifestBytes)
	}

	if err := zw.Close(); err != nil {
		writeError(w, http.StatusInternalServerError, "ZIP_ERROR", "打包备份失败")
		return
	}

	filename := fmt.Sprintf("issh-server-backup-%s.zip", time.Now().Format("20060102-150405"))
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(buf.Bytes())
}

// handleAdminRestoreBackup validates an uploaded .zip backup, replaces SQLite DB & avatars atomically, and reopens the store.
func (s *Server) handleAdminRestoreBackup(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(256 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "请通过 multipart/form-data 上传 .zip 备份包")
		return
	}
	file, _, err := r.FormFile("backup")
	if err != nil {
		writeError(w, http.StatusBadRequest, "MISSING_FILE", "未找到备份文件字段 backup")
		return
	}
	defer file.Close()

	rawZip, err := io.ReadAll(io.LimitReader(file, 256<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "READ_ERROR", "读取上传文件失败")
		return
	}
	zr, err := zip.NewReader(bytes.NewReader(rawZip), int64(len(rawZip)))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ZIP", "无效的 .zip 压缩包")
		return
	}

	var manifest *backupManifest
	var dbData []byte
	avatars := map[string][]byte{}

	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			continue
		}
		data, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			continue
		}
		switch {
		case f.Name == "manifest.json":
			var m backupManifest
			if json.Unmarshal(data, &m) == nil {
				manifest = &m
			}
		case f.Name == "issh.db":
			dbData = data
		case strings.HasPrefix(f.Name, "avatars/") && !f.FileInfo().IsDir():
			base := filepath.Base(f.Name)
			if base != "" && base != "." {
				avatars[base] = data
			}
		}
	}

	if manifest == nil || manifest.SchemaVersion != 1 || len(dbData) == 0 {
		writeError(w, http.StatusBadRequest, "INVALID_BACKUP", "备份包缺少 manifest.json 或 issh.db")
		return
	}
	sum := sha256.Sum256(dbData)
	if hex.EncodeToString(sum[:]) != manifest.DBSha256 {
		writeError(w, http.StatusBadRequest, "CHECKSUM_MISMATCH", "数据库校验和不匹配，备份文件可能已损坏")
		return
	}

	// Validate DB opens cleanly in a temp file before touching production DB
	tmpDB := s.Cfg.DBPath + ".restore_tmp"
	if err := os.WriteFile(tmpDB, dbData, 0o644); err != nil {
		writeError(w, http.StatusInternalServerError, "IO_ERROR", "写入临时数据库失败")
		return
	}
	testStore, err := store.OpenSQLite(tmpDB)
	if err != nil {
		_ = os.Remove(tmpDB)
		writeError(w, http.StatusBadRequest, "INVALID_DB", "备份中的 SQLite 文件无法打开: "+err.Error())
		return
	}
	_ = testStore.Close()
	_ = os.Remove(tmpDB + "-wal")
	_ = os.Remove(tmpDB + "-shm")

	// Close current DB, swap file, reopen
	s.ReplaceStore(nil)
	_ = os.Remove(s.Cfg.DBPath + "-wal")
	_ = os.Remove(s.Cfg.DBPath + "-shm")
	if err := os.Rename(tmpDB, s.Cfg.DBPath); err != nil {
		// Fallback copy if cross-device
		_ = os.WriteFile(s.Cfg.DBPath, dbData, 0o644)
		_ = os.Remove(tmpDB)
	}

	reopened, err := store.OpenSQLite(s.Cfg.DBPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "REOPEN_ERROR", "恢复后重新打开数据库失败: "+err.Error())
		return
	}
	s.ReplaceStore(reopened)

	// Replace avatars directory contents
	if entries, err := os.ReadDir(s.Cfg.AvatarsDir); err == nil {
		for _, e := range entries {
			if !e.IsDir() {
				_ = os.Remove(filepath.Join(s.Cfg.AvatarsDir, e.Name()))
			}
		}
	}
	for name, b := range avatars {
		_ = os.WriteFile(filepath.Join(s.Cfg.AvatarsDir, name), b, 0o644)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":          true,
		"avatarCount": len(avatars),
		"exportedAt":  manifest.ExportedAt,
	})
}
