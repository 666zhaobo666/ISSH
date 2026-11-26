package mail

import (
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/smtp"
	"strings"
)

type SMTPConfig struct {
	Host            string `json:"host"`
	Port            int    `json:"port"`
	Username        string `json:"username"`
	Password        string `json:"password"`
	FromName        string `json:"fromName"`
	FromEmail       string `json:"fromEmail"`
	UseTLS          bool   `json:"useTls"`
	RegisterSubject string `json:"registerSubject"`
	RegisterBody    string `json:"registerBody"`
	ResetSubject    string `json:"resetSubject"`
	ResetBody       string `json:"resetBody"`
}

func DefaultSMTPConfig() SMTPConfig {
	return SMTPConfig{
		Port:            465,
		FromName:        "ISSH",
		UseTLS:          true,
		RegisterSubject: "[{{siteName}}] 注册验证码：{{code}}",
		RegisterBody:    "您好！\n\n您正在注册 {{siteName}} 账号，验证码为：{{code}}\n\n验证码 {{expireMinutes}} 分钟内有效，如非本人操作请忽略。",
		ResetSubject:    "[{{siteName}}] 重置密码验证码：{{code}}",
		ResetBody:       "您好！\n\n您正在重置 {{siteName}} 账号密码，验证码为：{{code}}\n\n验证码 {{expireMinutes}} 分钟内有效，如非本人操作请忽略。",
	}
}

func ParseSMTPConfig(raw string) SMTPConfig {
	cfg := DefaultSMTPConfig()
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &cfg)
	}
	return cfg
}

func RenderTemplate(tpl, siteName, code string, expireMinutes int) string {
	r := strings.NewReplacer(
		"{{siteName}}", siteName,
		"{{code}}", code,
		"{{expireMinutes}}", fmt.Sprintf("%d", expireMinutes),
	)
	return r.Replace(tpl)
}

func SendEmail(cfg SMTPConfig, toEmail, subject, body string) error {
	if strings.TrimSpace(cfg.Host) == "" || cfg.Port <= 0 {
		return errors.New("SMTP 未配置，请联系管理员在后台设置发信邮箱")
	}
	fromEmail := strings.TrimSpace(cfg.FromEmail)
	if fromEmail == "" {
		fromEmail = cfg.Username
	}
	fromHeader := fromEmail
	if strings.TrimSpace(cfg.FromName) != "" {
		fromHeader = fmt.Sprintf("%s <%s>", cfg.FromName, fromEmail)
	}

	msg := strings.Join([]string{
		"From: " + fromHeader,
		"To: " + toEmail,
		"Subject: " + subject,
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"",
		body,
	}, "\r\n")

	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	auth := smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)

	if cfg.UseTLS && cfg.Port == 465 {
		conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: cfg.Host})
		if err != nil {
			return fmt.Errorf("SMTP TLS 连接失败: %w", err)
		}
		client, err := smtp.NewClient(conn, cfg.Host)
		if err != nil {
			return err
		}
		defer client.Close()
		if cfg.Username != "" {
			if err := client.Auth(auth); err != nil {
				return fmt.Errorf("SMTP 认证失败: %w", err)
			}
		}
		if err := client.Mail(fromEmail); err != nil {
			return err
		}
		if err := client.Rcpt(toEmail); err != nil {
			return err
		}
		w, err := client.Data()
		if err != nil {
			return err
		}
		if _, err := w.Write([]byte(msg)); err != nil {
			return err
		}
		if err := w.Close(); err != nil {
			return err
		}
		return client.Quit()
	}

	// STARTTLS / plain fallback (e.g., port 587 / 25)
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		return fmt.Errorf("SMTP 连接失败: %w", err)
	}
	client, err := smtp.NewClient(conn, cfg.Host)
	if err != nil {
		return err
	}
	defer client.Close()
	if cfg.UseTLS {
		if ok, _ := client.Extension("STARTTLS"); ok {
			if err := client.StartTLS(&tls.Config{ServerName: cfg.Host}); err != nil {
				return fmt.Errorf("STARTTLS 失败: %w", err)
			}
		}
	}
	if cfg.Username != "" {
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("SMTP 认证失败: %w", err)
		}
	}
	if err := client.Mail(fromEmail); err != nil {
		return err
	}
	if err := client.Rcpt(toEmail); err != nil {
		return err
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write([]byte(msg)); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return client.Quit()
}
