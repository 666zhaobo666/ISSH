#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${ISSH_REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
DATA_DIR="${ISSH_DATA_DIR:-$REPO_DIR/issh-data}"
TRIGGER_FILE="$DATA_DIR/.update-trigger"
STATUS_FILE="$DATA_DIR/.update-status.json"
LOG_FILE="$DATA_DIR/.update.log"
HEARTBEAT_FILE="$DATA_DIR/.updater-heartbeat"

mkdir -p "$DATA_DIR"

write_status() {
  local state="$1"
  local started="$2"
  local finished="$3"
  local msg="$4"
  cat > "$STATUS_FILE" <<EOF
{"state":"$state","startedAt":$started,"finishedAt":$finished,"message":"$msg"}
EOF
}

echo "[issh-updater] watching $DATA_DIR for repo $REPO_DIR"

while true; do
  touch "$HEARTBEAT_FILE"

  if [ -f "$TRIGGER_FILE" ]; then
    rm -f "$TRIGGER_FILE"
    STARTED_MS=$(( $(date +%s) * 1000 ))
    write_status "running" "$STARTED_MS" 0 "正在拉取最新代码并重建 Docker 容器..."

    {
      echo "=========================================="
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] 开始执行 ISSH 服务端与 Web 端更新"
      echo "项目目录: $REPO_DIR"
      echo "=========================================="
    } >> "$LOG_FILE"

    if (
      cd "$REPO_DIR"
      git checkout -- services/server/Dockerfile 2>/dev/null || true
      git pull origin main
      docker compose up -d --build
    ) >> "$LOG_FILE" 2>&1; then
      FINISHED_MS=$(( $(date +%s) * 1000 ))
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] 更新成功，服务已重新启动！" >> "$LOG_FILE"
      write_status "success" "$STARTED_MS" "$FINISHED_MS" "更新成功！服务端与 Web 端已切换至最新版本。"
    else
      FINISHED_MS=$(( $(date +%s) * 1000 ))
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] 更新失败，请检查上方错误日志。" >> "$LOG_FILE"
      write_status "error" "$STARTED_MS" "$FINISHED_MS" "更新失败，请查看构建日志。"
    fi
  fi

  sleep 3
done
