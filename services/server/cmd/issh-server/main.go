package main

import (
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"issh-server/internal/api"
	"issh-server/internal/config"
	icrypto "issh-server/internal/crypto"
	"issh-server/internal/gateway"
	"issh-server/internal/store"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	st, err := store.OpenSQLite(cfg.DBPath)
	if err != nil {
		log.Fatalf("open sqlite: %v", err)
	}
	defer st.Close()

	cipher, err := icrypto.NewCipher(cfg.MasterKey)
	if err != nil {
		log.Fatalf("init cipher: %v", err)
	}

	// Bootstrap initial super admin if no admin exists yet
	if count, err := st.CountAdmins(); err == nil && count == 0 {
		hash, err := bcrypt.GenerateFromPassword([]byte(cfg.AdminPassword), bcrypt.DefaultCost)
		if err == nil {
			now := time.Now().UnixMilli()
			admin := &store.User{
				ID:           uuid.NewString(),
				Email:        cfg.AdminEmail,
				PasswordHash: string(hash),
				Nickname:     "管理员",
				Role:         "admin",
				Status:       "active",
				VipExpireAt:  now + 3650*24*3600*1000, // 10 years for admin
				TokenVersion: 1,
				CreatedAt:    now,
				UpdatedAt:    now,
			}
			if err := st.CreateUser(admin); err == nil {
				log.Printf("[ISSH] Initial admin created: email=%s password=%s (请尽快在后台修改密码)", cfg.AdminEmail, cfg.AdminPassword)
			}
		}
	}

	srv := api.NewServer(cfg, st, cipher)
	srv.SetGatewayHandler(gateway.NewGateway(srv))
	log.Printf("[ISSH] Server listening on %s (data: %s)", cfg.ListenAddr, cfg.DataDir)
	if err := http.ListenAndServe(cfg.ListenAddr, srv.Handler()); err != nil {
		log.Fatalf("http server: %v", err)
	}
}
