package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"
)

const githubLatestReleaseURL = "https://api.github.com/repos/666zhaobo666/ISSH/releases/latest"

type ReleaseAsset struct {
	Name        string `json:"name"`
	DownloadURL string `json:"downloadUrl"`
	Size        int64  `json:"size"`
}

type LatestReleaseDTO struct {
	HasRelease  bool           `json:"hasRelease"`
	Version     string         `json:"version"`
	TagName     string         `json:"tagName"`
	Notes       string         `json:"notes"`
	PublishedAt string         `json:"publishedAt"`
	HTMLURL     string         `json:"htmlUrl"`
	Assets      []ReleaseAsset `json:"assets"`
}

var (
	releaseCacheMu   sync.RWMutex
	releaseCacheData *LatestReleaseDTO
	releaseCacheAt   time.Time
)

func (s *Server) handleGetLatestRelease(w http.ResponseWriter, r *http.Request) {
	force := r.URL.Query().Get("refresh") == "1"

	releaseCacheMu.RLock()
	if !force && releaseCacheData != nil && time.Since(releaseCacheAt) < 5*time.Minute {
		cached := *releaseCacheData
		releaseCacheMu.RUnlock()
		writeJSON(w, http.StatusOK, cached)
		return
	}
	releaseCacheMu.RUnlock()

	client := &http.Client{Timeout: 8 * time.Second}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, githubLatestReleaseURL, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "REQ_ERROR", "构造请求失败")
		return
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "ISSH-Server")

	resp, err := client.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "连接 GitHub 检查更新失败")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		dto := LatestReleaseDTO{
			HasRelease: false,
			HTMLURL:    "https://github.com/666zhaobo666/ISSH/releases",
		}
		releaseCacheMu.Lock()
		releaseCacheData = &dto
		releaseCacheAt = time.Now()
		releaseCacheMu.Unlock()
		writeJSON(w, http.StatusOK, dto)
		return
	}

	if resp.StatusCode != http.StatusOK {
		writeError(w, http.StatusBadGateway, "GITHUB_ERROR", "GitHub 接口返回异常")
		return
	}

	var gh struct {
		TagName     string `json:"tag_name"`
		Body        string `json:"body"`
		PublishedAt string `json:"published_at"`
		HTMLURL     string `json:"html_url"`
		Assets      []struct {
			Name               string `json:"name"`
			BrowserDownloadURL string `json:"browser_download_url"`
			Size               int64  `json:"size"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&gh); err != nil {
		writeError(w, http.StatusBadGateway, "DECODE_ERROR", "解析发布信息失败")
		return
	}

	assets := make([]ReleaseAsset, 0, len(gh.Assets))
	for _, a := range gh.Assets {
		assets = append(assets, ReleaseAsset{
			Name:        a.Name,
			DownloadURL: a.BrowserDownloadURL,
			Size:        a.Size,
		})
	}
	dto := LatestReleaseDTO{
		HasRelease:  true,
		Version:     strings.TrimPrefix(strings.TrimSpace(gh.TagName), "v"),
		TagName:     gh.TagName,
		Notes:       gh.Body,
		PublishedAt: gh.PublishedAt,
		HTMLURL:     gh.HTMLURL,
		Assets:      assets,
	}

	releaseCacheMu.Lock()
	releaseCacheData = &dto
	releaseCacheAt = time.Now()
	releaseCacheMu.Unlock()

	writeJSON(w, http.StatusOK, dto)
}
