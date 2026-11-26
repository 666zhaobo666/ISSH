package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"issh-server/internal/config"
	icrypto "issh-server/internal/crypto"
	"issh-server/internal/media"
	"issh-server/internal/store"
)

func newTestServer(t *testing.T) (*Server, *store.User, string) {
	t.Helper()
	tmp := t.TempDir()
	avatarsDir := filepath.Join(tmp, "avatars")
	_ = os.MkdirAll(avatarsDir, 0o755)
	keySum := sha256.Sum256([]byte("test-master-key"))
	jwtSum := sha256.Sum256([]byte("test-jwt-secret"))
	cfg := &config.Config{
		DataDir:    tmp,
		DBPath:     filepath.Join(tmp, "issh.db"),
		AvatarsDir: avatarsDir,
		MasterKey:  keySum[:],
		JWTSecret:  jwtSum[:],
		CORSOrigin: "*",
	}
	st, err := store.OpenSQLite(cfg.DBPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}

	c, err := icrypto.NewCipher(cfg.MasterKey)
	if err != nil {
		t.Fatalf("cipher: %v", err)
	}
	srv := NewServer(cfg, st, c)
	t.Cleanup(func() {
		if cur := srv.Store(); cur != nil {
			_ = cur.Close()
		}
	})

	hash, _ := bcrypt.GenerateFromPassword([]byte("123456"), bcrypt.DefaultCost)
	now := time.Now().UnixMilli()
	admin := &store.User{
		ID:           uuid.NewString(),
		Email:        "admin@test.com",
		PasswordHash: string(hash),
		Nickname:     "Admin",
		Role:         "admin",
		Status:       "active",
		VipExpireAt:  now + 365*24*3600*1000,
		TokenVersion: 1,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := st.CreateUser(admin); err != nil {
		t.Fatalf("create admin: %v", err)
	}
	token, _ := srv.IssueToken(admin)
	return srv, admin, token
}

func TestPasswordValidation(t *testing.T) {
	if err := ValidatePassword("123456"); err != nil {
		t.Fatalf("pure digits 6 chars should be allowed: %v", err)
	}
	if err := ValidatePassword("abc!@#123"); err != nil {
		t.Fatalf("ascii with special chars should be allowed: %v", err)
	}
	if err := ValidatePassword("12345"); err == nil {
		t.Fatal("5 chars should be rejected")
	}
	if err := ValidatePassword("123 456"); err == nil {
		t.Fatal("spaces should be rejected")
	}
}

func TestAvatarResize256(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 800, 500))
	for y := 0; y < 500; y++ {
		for x := 0; x < 800; x++ {
			img.Set(x, y, color.RGBA{R: 40, G: 120, B: 220, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	out, err := media.ProcessAvatar(&buf)
	if err != nil {
		t.Fatalf("process avatar: %v", err)
	}
	decoded, _, err := image.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("decode output: %v", err)
	}
	if decoded.Bounds().Dx() != 256 || decoded.Bounds().Dy() != 256 {
		t.Fatalf("expected 256x256, got %dx%d", decoded.Bounds().Dx(), decoded.Bounds().Dy())
	}
}

func TestVipSyncDisableAndBackupRestore(t *testing.T) {
	srv, _, adminToken := newTestServer(t)
	h := srv.Handler()

	// Create normal user directly in store
	hash, _ := bcrypt.GenerateFromPassword([]byte("999888"), bcrypt.DefaultCost)
	now := time.Now().UnixMilli()
	u := &store.User{
		ID:           uuid.NewString(),
		Email:        "user1@test.com",
		PasswordHash: string(hash),
		Nickname:     "User1",
		Role:         "user",
		Status:       "active",
		VipExpireAt:  0,
		TokenVersion: 1,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := srv.Store().CreateUser(u); err != nil {
		t.Fatal(err)
	}
	userToken, _ := srv.IssueToken(u)

	// 1. Non-VIP cannot push sync profile (403 VIP_REQUIRED)
	req := httptest.NewRequest("PUT", "/api/sync/profile", bytes.NewBufferString(`{"profile":{"schemaVersion":1,"hosts":[]}}`))
	req.Header.Set("Authorization", "Bearer "+userToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-VIP sync, got %d: %s", rec.Code, rec.Body.String())
	}

	// 2. Admin generates 1 token (7 days)
	req = httptest.NewRequest("POST", "/api/admin/tokens/batch", bytes.NewBufferString(`{"count":1,"durationDays":7,"batchNote":"test"}`))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("generate token failed: %d %s", rec.Code, rec.Body.String())
	}
	var genResp struct {
		Tokens []store.VipToken `json:"tokens"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &genResp)
	if len(genResp.Tokens) != 1 {
		t.Fatalf("expected 1 token, got %d", len(genResp.Tokens))
	}
	vipCode := genResp.Tokens[0].Code

	// 3. User redeems VIP token
	req = httptest.NewRequest("POST", "/api/vip/redeem", bytes.NewBufferString(`{"code":"`+vipCode+`"}`))
	req.Header.Set("Authorization", "Bearer "+userToken)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("redeem failed: %d %s", rec.Code, rec.Body.String())
	}

	// 4. VIP user pushes encrypted profile & pulls it back
	req = httptest.NewRequest("PUT", "/api/sync/profile", bytes.NewBufferString(`{"profile":{"schemaVersion":1,"hosts":[{"id":"h1","name":"HK"}]}}`))
	req.Header.Set("Authorization", "Bearer "+userToken)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("vip sync push failed: %d %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest("GET", "/api/sync/profile", nil)
	req.Header.Set("Authorization", "Bearer "+userToken)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(`"name":"HK"`)) {
		t.Fatalf("vip sync pull failed: %d %s", rec.Code, rec.Body.String())
	}

	// 5. Export .zip backup
	req = httptest.NewRequest("GET", "/api/admin/backup/export", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Body.Len() < 100 {
		t.Fatalf("backup export failed: %d len=%d", rec.Code, rec.Body.Len())
	}
	backupZip := append([]byte(nil), rec.Body.Bytes()...)

	// 6. Disable user -> immediate JWT rejection
	req = httptest.NewRequest("PUT", "/api/admin/users/"+u.ID+"/status", bytes.NewBufferString(`{"status":"disabled"}`))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("disable user failed: %d", rec.Code)
	}
	req = httptest.NewRequest("GET", "/api/user/me", nil)
	req.Header.Set("Authorization", "Bearer "+userToken)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected disabled user JWT to be rejected with 401, got %d", rec.Code)
	}

	// 7. Restore from .zip backup -> user1 is active again & profile is intact
	var mb bytes.Buffer
	mw := multipart.NewWriter(&mb)
	fw, _ := mw.CreateFormFile("backup", "backup.zip")
	_, _ = fw.Write(backupZip)
	_ = mw.Close()
	req = httptest.NewRequest("POST", "/api/admin/backup/restore", &mb)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("backup restore failed: %d %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest("GET", "/api/sync/profile", nil)
	req.Header.Set("Authorization", "Bearer "+userToken)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(`"name":"HK"`)) {
		t.Fatalf("expected restored profile to be intact, got %d: %s", rec.Code, rec.Body.String())
	}
}
