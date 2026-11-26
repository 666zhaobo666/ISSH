package store

import "time"

type User struct {
	ID           string `json:"id"`
	Email        string `json:"email"`
	PasswordHash string `json:"-"`
	Nickname     string `json:"nickname"`
	AvatarPath   string `json:"avatarPath"`
	Role         string `json:"role"`   // "user" | "admin"
	Status       string `json:"status"` // "active" | "disabled"
	VipExpireAt  int64  `json:"vipExpireAt"`
	TokenVersion int    `json:"tokenVersion"`
	CreatedAt    int64  `json:"createdAt"`
	UpdatedAt    int64  `json:"updatedAt"`
}

func (u *User) IsVipActive() bool {
	return u.VipExpireAt > time.Now().UnixMilli()
}

type EmailCode struct {
	ID        string
	Email     string
	Purpose   string // "register" | "reset_pwd"
	Code      string
	ExpiresAt int64
	Used      bool
	CreatedAt int64
}

type VipToken struct {
	ID           string `json:"id"`
	Code         string `json:"code"`
	DurationDays int    `json:"durationDays"`
	Status       string `json:"status"` // "unused" | "redeemed" | "revoked"
	BatchNote    string `json:"batchNote"`
	RedeemedBy   string `json:"redeemedBy"`
	RedeemedEmail string `json:"redeemedEmail,omitempty"`
	RedeemedAt   int64  `json:"redeemedAt"`
	CreatedAt    int64  `json:"createdAt"`
}

type SyncProfile struct {
	UserID           string
	Version          int64
	EncryptedPayload []byte
	Checksum         string
	UpdatedAt        int64
}

type SyncThread struct {
	UserID           string
	ThreadID         string
	Version          int64
	EncryptedPayload []byte
	Deleted          bool
	UpdatedAt        int64
}

type AdminStats struct {
	TotalUsers      int64 `json:"totalUsers"`
	ActiveVipUsers  int64 `json:"activeVipUsers"`
	DisabledUsers   int64 `json:"disabledUsers"`
	UnusedTokens    int64 `json:"unusedTokens"`
	RedeemedTokens  int64 `json:"redeemedTokens"`
	SyncedProfiles  int64 `json:"syncedProfiles"`
	SyncedThreads   int64 `json:"syncedThreads"`
}

// Store abstracts persistence so SQLite can be swapped for PostgreSQL/MySQL later.
type Store interface {
	Close() error
	VacuumInto(destPath string) error

	// Users
	CreateUser(u *User) error
	GetUserByID(id string) (*User, error)
	GetUserByEmail(email string) (*User, error)
	ListUsers(query string, limit, offset int) ([]*User, int64, error)
	UpdateUserProfile(id, nickname, avatarPath string) error
	UpdateUserPassword(id, passwordHash string) error
	UpdateUserStatus(id, status string) error
	UpdateUserVip(id string, vipExpireAt int64) error
	CountAdmins() (int64, error)

	// Email verification codes
	SaveEmailCode(c *EmailCode) error
	GetLatestEmailCode(email, purpose string) (*EmailCode, error)
	ConsumeEmailCode(id string) error

	// VIP tokens
	CreateVipTokens(tokens []*VipToken) error
	ListVipTokens(status string, limit, offset int) ([]*VipToken, int64, error)
	RedeemVipToken(code, userID string, nowMs int64) (newExpireAt int64, durationDays int, err error)
	RevokeVipToken(id string) error

	// Sync profiles & AI threads
	GetSyncProfile(userID string) (*SyncProfile, error)
	UpsertSyncProfile(p *SyncProfile) (int64, error)
	GetThreadsMaxVersion(userID string) (int64, error)
	ListSyncThreadsSince(userID string, sinceVersion int64) ([]*SyncThread, error)
	UpsertSyncThreads(userID string, items []*SyncThread) (int64, error)

	// System settings
	GetSetting(key string) (string, bool, error)
	SetSetting(key, value string) error
	GetAllSettings() (map[string]string, error)

	// Dashboard stats
	GetAdminStats() (*AdminStats, error)
}
