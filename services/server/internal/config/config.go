package config

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
)

type Config struct {
	ListenAddr    string
	DataDir       string
	DBPath        string
	AvatarsDir    string
	AdminDistDir  string
	WebDistDir    string
	MasterKey     []byte // 32 bytes for AES-256-GCM
	JWTSecret     []byte
	AdminEmail    string
	AdminPassword string
	CORSOrigin    string
}

func Load() (*Config, error) {
	dataDir := getEnv("ISSH_DATA_DIR", "./data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	avatarsDir := filepath.Join(dataDir, "avatars")
	if err := os.MkdirAll(avatarsDir, 0o755); err != nil {
		return nil, err
	}

	masterKeyRaw := os.Getenv("ISSH_MASTER_KEY")
	if masterKeyRaw == "" {
		// Persist a generated dev key in dataDir/.master_key so restarts stay consistent
		keyFile := filepath.Join(dataDir, ".master_key")
		if b, err := os.ReadFile(keyFile); err == nil && len(b) >= 32 {
			masterKeyRaw = string(b)
		} else {
			buf := make([]byte, 32)
			_, _ = rand.Read(buf)
			masterKeyRaw = hex.EncodeToString(buf)
			_ = os.WriteFile(keyFile, []byte(masterKeyRaw), 0o600)
		}
	}
	sum := sha256.Sum256([]byte(masterKeyRaw))

	jwtSecretRaw := os.Getenv("ISSH_JWT_SECRET")
	if jwtSecretRaw == "" {
		jwtSecretRaw = "jwt:" + masterKeyRaw
	}
	jwtSum := sha256.Sum256([]byte(jwtSecretRaw))

	return &Config{
		ListenAddr:    getEnv("ISSH_LISTEN_ADDR", ":8080"),
		DataDir:       dataDir,
		DBPath:        filepath.Join(dataDir, "issh.db"),
		AvatarsDir:    avatarsDir,
		AdminDistDir:  getEnv("ISSH_ADMIN_DIST", "../../apps/admin/dist"),
		WebDistDir:    getEnv("ISSH_WEB_DIST", "../../apps/desktop/dist"),
		MasterKey:     sum[:],
		JWTSecret:     jwtSum[:],
		AdminEmail:    getEnv("ISSH_ADMIN_EMAIL", "admin@issh.local"),
		AdminPassword: getEnv("ISSH_ADMIN_PASSWORD", "admin123456"),
		CORSOrigin:    getEnv("ISSH_CORS_ORIGIN", "*"),
	}, nil
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
