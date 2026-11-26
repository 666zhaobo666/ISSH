package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"issh-server/internal/store"
)

func (s *Server) handleRedeemVip(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	var req struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "请求参数格式错误")
		return
	}
	code := strings.ToUpper(strings.TrimSpace(req.Code))
	if code == "" {
		writeError(w, http.StatusBadRequest, "EMPTY_CODE", "请输入 VIP 卡密")
		return
	}

	newExpire, days, err := s.Store().RedeemVipToken(code, u.ID, time.Now().UnixMilli())
	if err != nil {
		if errors.Is(err, store.ErrTokenInvalid) {
			writeError(w, http.StatusBadRequest, "INVALID_TOKEN", "卡密无效、已被使用或已作废")
			return
		}
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "兑换失败，请稍后重试")
		return
	}

	u.VipExpireAt = newExpire
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":           true,
		"durationDays": days,
		"vipExpireAt":  newExpire,
		"user":         userDTO(u),
	})
}
