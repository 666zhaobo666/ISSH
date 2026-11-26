package api

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/mail"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	imail "issh-server/internal/mail"
	"issh-server/internal/media"
	"issh-server/internal/store"
)

// Password allows any printable ASCII letters, digits, and special characters (no whitespace), length 6..128.
var passwordRegex = regexp.MustCompile(`^[\x21-\x7E]{6,128}$`)

func ValidatePassword(pwd string) error {
	if !passwordRegex.MatchString(pwd) {
		return errors.New("密码长度需为 6~128 位，仅支持英文字母、数字和常见特殊字符（不含空格）")
	}
	return nil
}

func ValidateEmail(raw string) (string, error) {
	e := strings.ToLower(strings.TrimSpace(raw))
	if e == "" {
		return "", errors.New("请输入邮箱地址")
	}
	addr, err := mail.ParseAddress(e)
	if err != nil || addr.Address != e {
		return "", errors.New("邮箱格式不正确")
	}
	return e, nil
}

func generateNumericCode(digits int) string {
	var b strings.Builder
	for i := 0; i < digits; i++ {
		n, _ := rand.Int(rand.Reader, big.NewInt(10))
		b.WriteByte(byte('0' + n.Int64()))
	}
	return b.String()
}

func userDTO(u *store.User) map[string]any {
	return map[string]any{
		"id":          u.ID,
		"email":       u.Email,
		"nickname":    u.Nickname,
		"avatarUrl":   u.AvatarPath,
		"role":        u.Role,
		"status":      u.Status,
		"vipExpireAt": u.VipExpireAt,
		"vipActive":   u.IsVipActive(),
		"createdAt":   u.CreatedAt,
	}
}

func (s *Server) handleSendCode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email   string `json:"email"`
		Purpose string `json:"purpose"` // "register" | "reset_pwd"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "请求参数格式错误")
		return
	}
	email, err := ValidateEmail(req.Email)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_EMAIL", err.Error())
		return
	}
	if req.Purpose != "register" && req.Purpose != "reset_pwd" {
		writeError(w, http.StatusBadRequest, "INVALID_PURPOSE", "无效的验证码用途")
		return
	}

	if req.Purpose == "register" {
		if regEnabled, _, _ := s.Store().GetSetting("registration_enabled"); regEnabled == "false" {
			writeError(w, http.StatusForbidden, "REGISTRATION_DISABLED", "管理员已关闭新用户注册")
			return
		}
		if _, err := s.Store().GetUserByEmail(email); err == nil {
			writeError(w, http.StatusConflict, "EMAIL_EXISTS", "该邮箱已注册，请直接登录")
			return
		}
	} else {
		if _, err := s.Store().GetUserByEmail(email); err != nil {
			writeError(w, http.StatusNotFound, "EMAIL_NOT_FOUND", "该邮箱尚未注册")
			return
		}
	}

	now := time.Now().UnixMilli()
	if latest, err := s.Store().GetLatestEmailCode(email, req.Purpose); err == nil {
		if now-latest.CreatedAt < 60_000 {
			writeError(w, http.StatusTooManyRequests, "COOLDOWN", "发送过于频繁，请 60 秒后再试")
			return
		}
	}

	code := generateNumericCode(6)
	expireMinutes := 10
	ec := &store.EmailCode{
		ID:        uuid.NewString(),
		Email:     email,
		Purpose:   req.Purpose,
		Code:      code,
		ExpiresAt: now + int64(expireMinutes)*60_000,
		CreatedAt: now,
	}
	if err := s.Store().SaveEmailCode(ec); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "保存验证码失败")
		return
	}

	smtpRaw, _, _ := s.Store().GetSetting("smtp_config")
	smtpCfg := imail.ParseSMTPConfig(smtpRaw)
	siteName, _, _ := s.Store().GetSetting("site_name")
	if siteName == "" {
		siteName = "ISSH"
	}

	subjectTpl := smtpCfg.RegisterSubject
	bodyTpl := smtpCfg.RegisterBody
	if req.Purpose == "reset_pwd" {
		subjectTpl = smtpCfg.ResetSubject
		bodyTpl = smtpCfg.ResetBody
	}
	subject := imail.RenderTemplate(subjectTpl, siteName, code, expireMinutes)
	body := imail.RenderTemplate(bodyTpl, siteName, code, expireMinutes)

	if err := imail.SendEmail(smtpCfg, email, subject, body); err != nil {
		writeError(w, http.StatusBadGateway, "SMTP_ERROR", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":            true,
		"expireMinutes": expireMinutes,
	})
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	if regEnabled, _, _ := s.Store().GetSetting("registration_enabled"); regEnabled == "false" {
		writeError(w, http.StatusForbidden, "REGISTRATION_DISABLED", "管理员已关闭新用户注册")
		return
	}

	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Code     string `json:"code"`
		Nickname string `json:"nickname"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "请求参数格式错误")
		return
	}
	email, err := ValidateEmail(req.Email)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_EMAIL", err.Error())
		return
	}
	if err := ValidatePassword(req.Password); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PASSWORD", err.Error())
		return
	}

	// Verify email code
	latest, err := s.Store().GetLatestEmailCode(email, "register")
	if err != nil || latest.Used || latest.ExpiresAt < time.Now().UnixMilli() || latest.Code != strings.TrimSpace(req.Code) {
		writeError(w, http.StatusBadRequest, "INVALID_CODE", "邮箱验证码无效或已过期")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "HASH_ERROR", "密码加密失败")
		return
	}

	nickname := strings.TrimSpace(req.Nickname)
	if nickname == "" {
		nickname = strings.Split(email, "@")[0]
	}

	now := time.Now().UnixMilli()
	u := &store.User{
		ID:           uuid.NewString(),
		Email:        email,
		PasswordHash: string(hash),
		Nickname:     nickname,
		Role:         "user",
		Status:       "active",
		VipExpireAt:  0,
		TokenVersion: 1,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := s.Store().CreateUser(u); err != nil {
		if errors.Is(err, store.ErrEmailExists) {
			writeError(w, http.StatusConflict, "EMAIL_EXISTS", "该邮箱已被注册")
			return
		}
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "创建用户失败")
		return
	}
	_ = s.Store().ConsumeEmailCode(latest.ID)

	token, err := s.IssueToken(u)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "JWT_ERROR", "签发登录令牌失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"token": token,
		"user":  userDTO(u),
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "请求参数格式错误")
		return
	}
	email, err := ValidateEmail(req.Email)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_EMAIL", err.Error())
		return
	}
	u, err := s.Store().GetUserByEmail(email)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "邮箱或密码错误")
		return
	}
	if u.Status != "active" {
		writeError(w, http.StatusForbidden, "USER_DISABLED", "该账号已被管理员禁用")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.Password)); err != nil {
		writeError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "邮箱或密码错误")
		return
	}
	token, err := s.IssueToken(u)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "JWT_ERROR", "签发登录令牌失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"token": token,
		"user":  userDTO(u),
	})
}

func (s *Server) handleResetPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email       string `json:"email"`
		Code        string `json:"code"`
		NewPassword string `json:"newPassword"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "请求参数格式错误")
		return
	}
	email, err := ValidateEmail(req.Email)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_EMAIL", err.Error())
		return
	}
	if err := ValidatePassword(req.NewPassword); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PASSWORD", err.Error())
		return
	}
	u, err := s.Store().GetUserByEmail(email)
	if err != nil {
		writeError(w, http.StatusNotFound, "EMAIL_NOT_FOUND", "该邮箱尚未注册")
		return
	}
	latest, err := s.Store().GetLatestEmailCode(email, "reset_pwd")
	if err != nil || latest.Used || latest.ExpiresAt < time.Now().UnixMilli() || latest.Code != strings.TrimSpace(req.Code) {
		writeError(w, http.StatusBadRequest, "INVALID_CODE", "邮箱验证码无效或已过期")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "HASH_ERROR", "密码加密失败")
		return
	}
	if err := s.Store().UpdateUserPassword(u.ID, string(hash)); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "重置密码失败")
		return
	}
	_ = s.Store().ConsumeEmailCode(latest.ID)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleGetMe(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	writeJSON(w, http.StatusOK, map[string]any{"user": userDTO(u)})
}

func (s *Server) handleUpdateProfile(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	var req struct {
		Nickname string `json:"nickname"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "请求参数格式错误")
		return
	}
	nick := strings.TrimSpace(req.Nickname)
	if len([]rune(nick)) == 0 || len([]rune(nick)) > 32 {
		writeError(w, http.StatusBadRequest, "INVALID_NICKNAME", "昵称长度需在 1~32 个字符之间")
		return
	}
	if err := s.Store().UpdateUserProfile(u.ID, nick, u.AvatarPath); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "更新昵称失败")
		return
	}
	u.Nickname = nick
	writeJSON(w, http.StatusOK, map[string]any{"user": userDTO(u)})
}

func (s *Server) handleUploadAvatar(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	if err := r.ParseMultipartForm(media.MaxAvatarUploadBytes + 1024); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "请使用 multipart/form-data 上传头像文件")
		return
	}
	file, _, err := r.FormFile("avatar")
	if err != nil {
		writeError(w, http.StatusBadRequest, "MISSING_FILE", "未找到头像文件字段 avatar")
		return
	}
	defer file.Close()

	resized, err := media.ProcessAvatar(file)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_IMAGE", err.Error())
		return
	}

	filename := fmt.Sprintf("%s_%d.jpg", u.ID, time.Now().Unix())
	fullPath := filepath.Join(s.Cfg.AvatarsDir, filename)
	if err := os.WriteFile(fullPath, resized, 0o644); err != nil {
		writeError(w, http.StatusInternalServerError, "IO_ERROR", "保存头像失败")
		return
	}

	// Clean up previous avatar file if any
	if u.AvatarPath != "" {
		oldName := filepath.Base(u.AvatarPath)
		if oldName != filename {
			_ = os.Remove(filepath.Join(s.Cfg.AvatarsDir, oldName))
		}
	}

	avatarURL := "/avatars/" + filename
	if err := s.Store().UpdateUserProfile(u.ID, u.Nickname, avatarURL); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "更新头像记录失败")
		return
	}
	u.AvatarPath = avatarURL
	writeJSON(w, http.StatusOK, map[string]any{"user": userDTO(u)})
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	var req struct {
		OldPassword string `json:"oldPassword"`
		NewPassword string `json:"newPassword"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "请求参数格式错误")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.OldPassword)); err != nil {
		writeError(w, http.StatusBadRequest, "WRONG_PASSWORD", "原密码不正确")
		return
	}
	if err := ValidatePassword(req.NewPassword); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PASSWORD", err.Error())
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "HASH_ERROR", "密码加密失败")
		return
	}
	if err := s.Store().UpdateUserPassword(u.ID, string(hash)); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "修改密码失败")
		return
	}
	updated, err := s.Store().GetUserByID(u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "刷新用户信息失败")
		return
	}
	newToken, _ := s.IssueToken(updated)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":    true,
		"token": newToken,
		"user":  userDTO(updated),
	})
}
