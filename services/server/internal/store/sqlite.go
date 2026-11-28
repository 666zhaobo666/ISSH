package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

var (
	ErrNotFound     = errors.New("not found")
	ErrEmailExists  = errors.New("email already exists")
	ErrTokenInvalid = errors.New("token invalid or already used")
)

type SQLiteStore struct {
	db *sql.DB
}

func OpenSQLite(dbPath string) (*SQLiteStore, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)", dbPath)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &SQLiteStore{db: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *SQLiteStore) Close() error {
	return s.db.Close()
}

func (s *SQLiteStore) VacuumInto(destPath string) error {
	escaped := strings.ReplaceAll(destPath, "'", "''")
	_, err := s.db.Exec(fmt.Sprintf("VACUUM INTO '%s'", escaped))
	return err
}

func (s *SQLiteStore) migrate() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			email TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			nickname TEXT NOT NULL DEFAULT '',
			avatar_path TEXT NOT NULL DEFAULT '',
			role TEXT NOT NULL DEFAULT 'user',
			status TEXT NOT NULL DEFAULT 'active',
			vip_expire_at INTEGER NOT NULL DEFAULT 0,
			token_version INTEGER NOT NULL DEFAULT 1,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS email_codes (
			id TEXT PRIMARY KEY,
			email TEXT NOT NULL,
			purpose TEXT NOT NULL,
			code TEXT NOT NULL,
			expires_at INTEGER NOT NULL,
			used INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL
		);`,
		`CREATE INDEX IF NOT EXISTS idx_email_codes_lookup ON email_codes(email, purpose, created_at DESC);`,
		`CREATE TABLE IF NOT EXISTS vip_tokens (
			id TEXT PRIMARY KEY,
			code TEXT NOT NULL UNIQUE,
			duration_days INTEGER NOT NULL,
			status TEXT NOT NULL DEFAULT 'unused',
			batch_note TEXT NOT NULL DEFAULT '',
			redeemed_by TEXT NOT NULL DEFAULT '',
			redeemed_at INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL
		);`,
		`CREATE INDEX IF NOT EXISTS idx_vip_tokens_status ON vip_tokens(status, created_at DESC);`,
		`CREATE TABLE IF NOT EXISTS user_sync_profiles (
			user_id TEXT PRIMARY KEY,
			version INTEGER NOT NULL DEFAULT 1,
			encrypted_payload BLOB NOT NULL,
			checksum TEXT NOT NULL DEFAULT '',
			updated_at INTEGER NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS user_sync_threads (
			user_id TEXT NOT NULL,
			thread_id TEXT NOT NULL,
			version INTEGER NOT NULL DEFAULT 1,
			encrypted_payload BLOB NOT NULL,
			deleted INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (user_id, thread_id)
		);`,
		`CREATE INDEX IF NOT EXISTS idx_sync_threads_ver ON user_sync_threads(user_id, version);`,
		`CREATE TABLE IF NOT EXISTS system_settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS audit_logs (
			id TEXT PRIMARY KEY,
			level TEXT NOT NULL,
			action TEXT NOT NULL,
			ip TEXT NOT NULL DEFAULT '',
			actor TEXT NOT NULL DEFAULT '',
			detail TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL
		);`,
		`CREATE INDEX IF NOT EXISTS idx_audit_logs_time ON audit_logs(created_at DESC);`,
		`CREATE TABLE IF NOT EXISTS banned_ips (
			ip TEXT PRIMARY KEY,
			reason TEXT NOT NULL DEFAULT '',
			expires_at INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL
		);`,
	}
	for _, st := range stmts {
		if _, err := s.db.Exec(st); err != nil {
			return err
		}
	}
	return nil
}

func (s *SQLiteStore) CreateUser(u *User) error {
	_, err := s.db.Exec(
		`INSERT INTO users (id, email, password_hash, nickname, avatar_path, role, status, vip_expire_at, token_version, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		u.ID, strings.ToLower(strings.TrimSpace(u.Email)), u.PasswordHash, u.Nickname, u.AvatarPath,
		u.Role, u.Status, u.VipExpireAt, u.TokenVersion, u.CreatedAt, u.UpdatedAt,
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return ErrEmailExists
		}
		return err
	}
	return nil
}

func scanUser(row interface{ Scan(...any) error }) (*User, error) {
	u := &User{}
	err := row.Scan(
		&u.ID, &u.Email, &u.PasswordHash, &u.Nickname, &u.AvatarPath,
		&u.Role, &u.Status, &u.VipExpireAt, &u.TokenVersion, &u.CreatedAt, &u.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return u, err
}

func (s *SQLiteStore) GetUserByID(id string) (*User, error) {
	row := s.db.QueryRow(
		`SELECT id, email, password_hash, nickname, avatar_path, role, status, vip_expire_at, token_version, created_at, updated_at
		 FROM users WHERE id = ?`, id,
	)
	return scanUser(row)
}

func (s *SQLiteStore) GetUserByEmail(email string) (*User, error) {
	row := s.db.QueryRow(
		`SELECT id, email, password_hash, nickname, avatar_path, role, status, vip_expire_at, token_version, created_at, updated_at
		 FROM users WHERE email = ?`, strings.ToLower(strings.TrimSpace(email)),
	)
	return scanUser(row)
}

func (s *SQLiteStore) ListUsers(query string, limit, offset int) ([]*User, int64, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := strings.TrimSpace(strings.ToLower(query))
	var total int64
	var rows *sql.Rows
	var err error
	if q == "" {
		if err = s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&total); err != nil {
			return nil, 0, err
		}
		rows, err = s.db.Query(
			`SELECT id, email, password_hash, nickname, avatar_path, role, status, vip_expire_at, token_version, created_at, updated_at
			 FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?`, limit, offset,
		)
	} else {
		like := "%" + q + "%"
		if err = s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE LOWER(email) LIKE ? OR LOWER(nickname) LIKE ?`, like, like).Scan(&total); err != nil {
			return nil, 0, err
		}
		rows, err = s.db.Query(
			`SELECT id, email, password_hash, nickname, avatar_path, role, status, vip_expire_at, token_version, created_at, updated_at
			 FROM users WHERE LOWER(email) LIKE ? OR LOWER(nickname) LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
			like, like, limit, offset,
		)
	}
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var list []*User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, 0, err
		}
		list = append(list, u)
	}
	return list, total, nil
}

func (s *SQLiteStore) UpdateUserProfile(id, nickname, avatarPath string) error {
	now := time.Now().UnixMilli()
	_, err := s.db.Exec(
		`UPDATE users SET nickname = ?, avatar_path = ?, updated_at = ? WHERE id = ?`,
		nickname, avatarPath, now, id,
	)
	return err
}

func (s *SQLiteStore) UpdateUserPassword(id, passwordHash string) error {
	now := time.Now().UnixMilli()
	_, err := s.db.Exec(
		`UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?`,
		passwordHash, now, id,
	)
	return err
}

func (s *SQLiteStore) UpdateUserStatus(id, status string) error {
	now := time.Now().UnixMilli()
	// 封禁（disabled）时同时清除 VIP 权限，避免被封禁用户仍保留 VIP 权益。
	// token_version + 1 会使用户已签发的 token 全部失效，实现「踢下线」。
	if status == "disabled" {
		_, err := s.db.Exec(
			`UPDATE users SET status = ?, token_version = token_version + 1, vip_expire_at = 0, updated_at = ? WHERE id = ?`,
			status, now, id,
		)
		return err
	}
	_, err := s.db.Exec(
		`UPDATE users SET status = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?`,
		status, now, id,
	)
	return err
}

func (s *SQLiteStore) UpdateUserVip(id string, vipExpireAt int64) error {
	now := time.Now().UnixMilli()
	_, err := s.db.Exec(
		`UPDATE users SET vip_expire_at = ?, updated_at = ? WHERE id = ?`,
		vipExpireAt, now, id,
	)
	return err
}

func (s *SQLiteStore) DeleteUser(id string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	_, _ = tx.Exec(`DELETE FROM user_sync_profiles WHERE user_id = ?`, id)
	_, _ = tx.Exec(`DELETE FROM user_sync_threads WHERE user_id = ?`, id)
	if _, err := tx.Exec(`DELETE FROM users WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *SQLiteStore) AddAuditLog(entry *AuditLog) error {
	_, err := s.db.Exec(
		`INSERT INTO audit_logs (id, level, action, ip, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		entry.ID, entry.Level, entry.Action, entry.IP, entry.Actor, entry.Detail, entry.CreatedAt,
	)
	return err
}

func (s *SQLiteStore) ListAuditLogs(limit int) ([]*AuditLog, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.Query(
		`SELECT id, level, action, ip, actor, detail, created_at FROM audit_logs ORDER BY created_at DESC LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*AuditLog{}
	for rows.Next() {
		a := &AuditLog{}
		if err := rows.Scan(&a.ID, &a.Level, &a.Action, &a.IP, &a.Actor, &a.Detail, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, nil
}

func (s *SQLiteStore) ClearLogsAndExpiredCodes() (int64, int64, error) {
	res1, err := s.db.Exec(`DELETE FROM audit_logs`)
	if err != nil {
		return 0, 0, err
	}
	n1, _ := res1.RowsAffected()
	now := time.Now().UnixMilli()
	res2, err := s.db.Exec(`DELETE FROM email_codes WHERE expires_at < ? OR used = 1`, now)
	if err != nil {
		return n1, 0, err
	}
	n2, _ := res2.RowsAffected()
	return n1, n2, nil
}

func (s *SQLiteStore) BanIP(b *BannedIP) error {
	_, err := s.db.Exec(
		`INSERT INTO banned_ips (ip, reason, expires_at, created_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT(ip) DO UPDATE SET reason = excluded.reason, expires_at = excluded.expires_at, created_at = excluded.created_at`,
		b.IP, b.Reason, b.ExpiresAt, b.CreatedAt,
	)
	return err
}

func (s *SQLiteStore) UnbanIP(ip string) error {
	_, err := s.db.Exec(`DELETE FROM banned_ips WHERE ip = ?`, ip)
	return err
}

func (s *SQLiteStore) IsIPBanned(ip string, nowMs int64) (*BannedIP, error) {
	b := &BannedIP{}
	err := s.db.QueryRow(
		`SELECT ip, reason, expires_at, created_at FROM banned_ips WHERE ip = ?`, ip,
	).Scan(&b.IP, &b.Reason, &b.ExpiresAt, &b.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if b.ExpiresAt > 0 && b.ExpiresAt < nowMs {
		_ = s.UnbanIP(ip)
		return nil, nil
	}
	return b, nil
}

func (s *SQLiteStore) ListBannedIPs() ([]*BannedIP, error) {
	rows, err := s.db.Query(`SELECT ip, reason, expires_at, created_at FROM banned_ips ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*BannedIP{}
	now := time.Now().UnixMilli()
	for rows.Next() {
		b := &BannedIP{}
		if err := rows.Scan(&b.IP, &b.Reason, &b.ExpiresAt, &b.CreatedAt); err != nil {
			return nil, err
		}
		if b.ExpiresAt == 0 || b.ExpiresAt >= now {
			out = append(out, b)
		}
	}
	return out, nil
}

func (s *SQLiteStore) CountAdmins() (int64, error) {
	var n int64
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE role = 'admin'`).Scan(&n)
	return n, err
}

func (s *SQLiteStore) SaveEmailCode(c *EmailCode) error {
	_, err := s.db.Exec(
		`INSERT INTO email_codes (id, email, purpose, code, expires_at, used, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`,
		c.ID, strings.ToLower(strings.TrimSpace(c.Email)), c.Purpose, c.Code, c.ExpiresAt, c.CreatedAt,
	)
	return err
}

func (s *SQLiteStore) GetLatestEmailCode(email, purpose string) (*EmailCode, error) {
	c := &EmailCode{}
	var used int
	err := s.db.QueryRow(
		`SELECT id, email, purpose, code, expires_at, used, created_at
		 FROM email_codes WHERE email = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1`,
		strings.ToLower(strings.TrimSpace(email)), purpose,
	).Scan(&c.ID, &c.Email, &c.Purpose, &c.Code, &c.ExpiresAt, &used, &c.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	c.Used = used != 0
	return c, err
}

func (s *SQLiteStore) ConsumeEmailCode(id string) error {
	_, err := s.db.Exec(`UPDATE email_codes SET used = 1 WHERE id = ?`, id)
	return err
}

func (s *SQLiteStore) CreateVipTokens(tokens []*VipToken) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	stmt, err := tx.Prepare(
		`INSERT INTO vip_tokens (id, code, duration_days, status, batch_note, redeemed_by, redeemed_at, created_at)
		 VALUES (?, ?, ?, 'unused', ?, '', 0, ?)`,
	)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, t := range tokens {
		if _, err := stmt.Exec(t.ID, t.Code, t.DurationDays, t.BatchNote, t.CreatedAt); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *SQLiteStore) ListVipTokens(status string, limit, offset int) ([]*VipToken, int64, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var total int64
	var rows *sql.Rows
	var err error
	st := strings.TrimSpace(status)
	if st == "" || st == "all" {
		if err = s.db.QueryRow(`SELECT COUNT(*) FROM vip_tokens`).Scan(&total); err != nil {
			return nil, 0, err
		}
		rows, err = s.db.Query(
			`SELECT t.id, t.code, t.duration_days, t.status, t.batch_note, t.redeemed_by, COALESCE(u.email, ''), t.redeemed_at, t.created_at
			 FROM vip_tokens t LEFT JOIN users u ON u.id = t.redeemed_by
			 ORDER BY t.created_at DESC LIMIT ? OFFSET ?`, limit, offset,
		)
	} else {
		if err = s.db.QueryRow(`SELECT COUNT(*) FROM vip_tokens WHERE status = ?`, st).Scan(&total); err != nil {
			return nil, 0, err
		}
		rows, err = s.db.Query(
			`SELECT t.id, t.code, t.duration_days, t.status, t.batch_note, t.redeemed_by, COALESCE(u.email, ''), t.redeemed_at, t.created_at
			 FROM vip_tokens t LEFT JOIN users u ON u.id = t.redeemed_by
			 WHERE t.status = ? ORDER BY t.created_at DESC LIMIT ? OFFSET ?`, st, limit, offset,
		)
	}
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var list []*VipToken
	for rows.Next() {
		t := &VipToken{}
		if err := rows.Scan(&t.ID, &t.Code, &t.DurationDays, &t.Status, &t.BatchNote, &t.RedeemedBy, &t.RedeemedEmail, &t.RedeemedAt, &t.CreatedAt); err != nil {
			return nil, 0, err
		}
		list = append(list, t)
	}
	return list, total, nil
}

func (s *SQLiteStore) RedeemVipToken(code, userID string, nowMs int64) (int64, int, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, 0, err
	}
	defer func() { _ = tx.Rollback() }()

	var tokenID string
	var durationDays int
	var status string
	err = tx.QueryRow(`SELECT id, duration_days, status FROM vip_tokens WHERE code = ?`, strings.TrimSpace(code)).
		Scan(&tokenID, &durationDays, &status)
	if errors.Is(err, sql.ErrNoRows) || status != "unused" {
		return 0, 0, ErrTokenInvalid
	}
	if err != nil {
		return 0, 0, err
	}

	var currentExpire int64
	if err := tx.QueryRow(`SELECT vip_expire_at FROM users WHERE id = ?`, userID).Scan(&currentExpire); err != nil {
		return 0, 0, err
	}

	base := nowMs
	if currentExpire > nowMs {
		base = currentExpire
	}
	newExpire := base + int64(durationDays)*24*3600*1000

	res, err := tx.Exec(
		`UPDATE vip_tokens SET status = 'redeemed', redeemed_by = ?, redeemed_at = ? WHERE id = ? AND status = 'unused'`,
		userID, nowMs, tokenID,
	)
	if err != nil {
		return 0, 0, err
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		return 0, 0, ErrTokenInvalid
	}

	if _, err := tx.Exec(`UPDATE users SET vip_expire_at = ?, updated_at = ? WHERE id = ?`, newExpire, nowMs, userID); err != nil {
		return 0, 0, err
	}

	if err := tx.Commit(); err != nil {
		return 0, 0, err
	}
	return newExpire, durationDays, nil
}

func (s *SQLiteStore) RevokeVipToken(id string) error {
	_, err := s.db.Exec(`UPDATE vip_tokens SET status = 'revoked' WHERE id = ? AND status = 'unused'`, id)
	return err
}

func (s *SQLiteStore) GetSyncProfile(userID string) (*SyncProfile, error) {
	p := &SyncProfile{}
	err := s.db.QueryRow(
		`SELECT user_id, version, encrypted_payload, checksum, updated_at FROM user_sync_profiles WHERE user_id = ?`,
		userID,
	).Scan(&p.UserID, &p.Version, &p.EncryptedPayload, &p.Checksum, &p.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

func (s *SQLiteStore) UpsertSyncProfile(p *SyncProfile) (int64, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()

	var curVer int64
	err = tx.QueryRow(`SELECT version FROM user_sync_profiles WHERE user_id = ?`, p.UserID).Scan(&curVer)
	if errors.Is(err, sql.ErrNoRows) {
		curVer = 0
	} else if err != nil {
		return 0, err
	}
	nextVer := curVer + 1
	_, err = tx.Exec(
		`INSERT INTO user_sync_profiles (user_id, version, encrypted_payload, checksum, updated_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET
		   version = excluded.version,
		   encrypted_payload = excluded.encrypted_payload,
		   checksum = excluded.checksum,
		   updated_at = excluded.updated_at`,
		p.UserID, nextVer, p.EncryptedPayload, p.Checksum, p.UpdatedAt,
	)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return nextVer, nil
}

func (s *SQLiteStore) GetThreadsMaxVersion(userID string) (int64, error) {
	var v sql.NullInt64
	err := s.db.QueryRow(`SELECT MAX(version) FROM user_sync_threads WHERE user_id = ?`, userID).Scan(&v)
	if err != nil {
		return 0, err
	}
	if !v.Valid {
		return 0, nil
	}
	return v.Int64, nil
}

func (s *SQLiteStore) ListSyncThreadsSince(userID string, sinceVersion int64) ([]*SyncThread, error) {
	rows, err := s.db.Query(
		`SELECT user_id, thread_id, version, encrypted_payload, deleted, updated_at
		 FROM user_sync_threads WHERE user_id = ? AND version > ? ORDER BY version ASC`,
		userID, sinceVersion,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*SyncThread
	for rows.Next() {
		t := &SyncThread{}
		var del int
		if err := rows.Scan(&t.UserID, &t.ThreadID, &t.Version, &t.EncryptedPayload, &del, &t.UpdatedAt); err != nil {
			return nil, err
		}
		t.Deleted = del != 0
		out = append(out, t)
	}
	return out, nil
}

func (s *SQLiteStore) UpsertSyncThreads(userID string, items []*SyncThread) (int64, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()

	var maxVer sql.NullInt64
	if err := tx.QueryRow(`SELECT MAX(version) FROM user_sync_threads WHERE user_id = ?`, userID).Scan(&maxVer); err != nil {
		return 0, err
	}
	cur := int64(0)
	if maxVer.Valid {
		cur = maxVer.Int64
	}

	for _, item := range items {
		cur++
		del := 0
		if item.Deleted {
			del = 1
		}
		_, err := tx.Exec(
			`INSERT INTO user_sync_threads (user_id, thread_id, version, encrypted_payload, deleted, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT(user_id, thread_id) DO UPDATE SET
			   version = excluded.version,
			   encrypted_payload = excluded.encrypted_payload,
			   deleted = excluded.deleted,
			   updated_at = excluded.updated_at`,
			userID, item.ThreadID, cur, item.EncryptedPayload, del, item.UpdatedAt,
		)
		if err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return cur, nil
}

func (s *SQLiteStore) GetSetting(key string) (string, bool, error) {
	var val string
	err := s.db.QueryRow(`SELECT value FROM system_settings WHERE key = ?`, key).Scan(&val)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	return val, err == nil, err
}

func (s *SQLiteStore) SetSetting(key, value string) error {
	now := time.Now().UnixMilli()
	_, err := s.db.Exec(
		`INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		key, value, now,
	)
	return err
}

func (s *SQLiteStore) GetAllSettings() (map[string]string, error) {
	rows, err := s.db.Query(`SELECT key, value FROM system_settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		m[k] = v
	}
	return m, nil
}

func (s *SQLiteStore) GetAdminStats() (*AdminStats, error) {
	st := &AdminStats{}
	now := time.Now().UnixMilli()
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&st.TotalUsers)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE vip_expire_at > ? AND status = 'active'`, now).Scan(&st.ActiveVipUsers)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE status = 'disabled'`).Scan(&st.DisabledUsers)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM vip_tokens WHERE status = 'unused'`).Scan(&st.UnusedTokens)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM vip_tokens WHERE status = 'redeemed'`).Scan(&st.RedeemedTokens)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM user_sync_profiles`).Scan(&st.SyncedProfiles)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM user_sync_threads WHERE deleted = 0`).Scan(&st.SyncedThreads)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM audit_logs`).Scan(&st.AuditLogCount)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM banned_ips`).Scan(&st.BannedIPCount)
	return st, nil
}
