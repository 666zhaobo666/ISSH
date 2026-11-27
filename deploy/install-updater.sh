#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$REPO_DIR/issh-data"
SCRIPT_PATH="$REPO_DIR/deploy/issh-updater.sh"

chmod +x "$SCRIPT_PATH"
mkdir -p "$DATA_DIR"

cat > /etc/systemd/system/issh-updater.service <<EOF
[Unit]
Description=ISSH Admin Panel One-Click Updater Daemon
After=docker.service network-online.target

[Service]
Type=simple
WorkingDirectory=$REPO_DIR
Environment="ISSH_REPO_DIR=$REPO_DIR"
Environment="ISSH_DATA_DIR=$DATA_DIR"
ExecStart=/usr/bin/env bash $SCRIPT_PATH
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now issh-updater.service
systemctl status issh-updater.service --no-pager -l
echo ""
echo "ISSH 宿主机一键更新守护进程已安装并启动！现在可以直接在 Admin 面板点击「一键更新」按钮。"
