package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type systemUpdateStatusFile struct {
	State      string `json:"state"` // idle | queued | running | success | error
	StartedAt  int64  `json:"startedAt,omitempty"`
	FinishedAt int64  `json:"finishedAt,omitempty"`
	Message    string `json:"message,omitempty"`
}

func (s *Server) updaterPaths() (triggerPath, statusPath, logPath, heartbeatPath string) {
	dir := s.Cfg.DataDir
	return filepath.Join(dir, ".update-trigger"),
		filepath.Join(dir, ".update-status.json"),
		filepath.Join(dir, ".update.log"),
		filepath.Join(dir, ".updater-heartbeat")
}

func (s *Server) isUpdaterAgentOnline(heartbeatPath string) bool {
	info, err := os.Stat(heartbeatPath)
	if err != nil {
		return false
	}
	return time.Since(info.ModTime()) <= 90*time.Second
}

func (s *Server) readUpdateStatus(statusPath string) systemUpdateStatusFile {
	st := systemUpdateStatusFile{State: "idle"}
	raw, err := os.ReadFile(statusPath)
	if err != nil {
		return st
	}
	_ = json.Unmarshal(raw, &st)
	if st.State == "" {
		st.State = "idle"
	}
	return st
}

func readCurrentServerVersion() string {
	for _, p := range []string{"/app/VERSION", "VERSION"} {
		if raw, err := os.ReadFile(p); err == nil {
			v := strings.TrimSpace(string(raw))
			if v != "" {
				if !strings.HasPrefix(v, "v") {
					return "v" + v
				}
				return v
			}
		}
	}
	// Dev mode fallback: read version directly from apps/desktop/package.json
	for _, p := range []string{"../../apps/desktop/package.json", "apps/desktop/package.json"} {
		if raw, err := os.ReadFile(p); err == nil {
			var pkg struct {
				Version string `json:"version"`
			}
			if json.Unmarshal(raw, &pkg) == nil && strings.TrimSpace(pkg.Version) != "" {
				return "v" + strings.TrimSpace(pkg.Version)
			}
		}
	}
	return "dev"
}

func (s *Server) handleAdminSystemUpdateStatus(w http.ResponseWriter, r *http.Request) {
	_, statusPath, logPath, heartbeatPath := s.updaterPaths()
	online := s.isUpdaterAgentOnline(heartbeatPath)
	st := s.readUpdateStatus(statusPath)

	logText := ""
	if raw, err := os.ReadFile(logPath); err == nil {
		const maxTail = 16 * 1024
		if len(raw) > maxTail {
			raw = raw[len(raw)-maxTail:]
		}
		logText = string(raw)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"currentVersion": readCurrentServerVersion(),
		"agentOnline":    online,
		"state":          st.State,
		"startedAt":      st.StartedAt,
		"finishedAt":     st.FinishedAt,
		"message":        st.Message,
		"log":            logText,
	})
}

func (s *Server) handleAdminTriggerSystemUpdate(w http.ResponseWriter, r *http.Request) {
	triggerPath, statusPath, logPath, heartbeatPath := s.updaterPaths()
	if !s.isUpdaterAgentOnline(heartbeatPath) {
		writeError(w, http.StatusBadRequest, "UPDATER_OFFLINE", "宿主机更新守护进程未运行，请先在 VPS 项目目录执行一次：sudo bash deploy/install-updater.sh")
		return
	}

	cur := s.readUpdateStatus(statusPath)
	if (cur.State == "queued" || cur.State == "running") && time.Now().UnixMilli()-cur.StartedAt < 10*60*1000 {
		writeError(w, http.StatusConflict, "UPDATE_IN_PROGRESS", "当前已有更新任务正在执行，请稍候查看日志")
		return
	}

	now := time.Now().UnixMilli()
	nextStatus := systemUpdateStatusFile{
		State:     "queued",
		StartedAt: now,
		Message:   "已发送更新指令，正在等待宿主机守护进程开始拉取与构建...",
	}
	statusBytes, _ := json.Marshal(nextStatus)
	_ = os.WriteFile(statusPath, statusBytes, 0o644)
	_ = os.WriteFile(logPath, []byte("[ISSH] 已触发服务端与 Web 端一键更新...\n"), 0o644)

	triggerPayload, _ := json.Marshal(map[string]any{
		"requestedAt": now,
		"requestedBy": currentUser(r).Email,
	})
	if err := os.WriteFile(triggerPath, triggerPayload, 0o644); err != nil {
		writeError(w, http.StatusInternalServerError, "IO_ERROR", "写入更新触发文件失败: "+err.Error())
		return
	}

	s.logAudit("info", "system_update_triggered", clientIP(r), currentUser(r).Email, "管理员触发一键更新服务端与 Web 端")
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":    true,
		"state": "queued",
	})
}
