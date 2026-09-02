#!/usr/bin/env bash
# pi-tab-status 一键部署:把扩展安装到 ~/.pi/agent/extensions/
# 幂等:可重复运行。真源为本仓库;外部配置仓库(如个人 dotfiles 管理器)也可在部署后调用本脚本。
# 用法:bash setup.sh [--test](--test 先跑单测,失败则中止部署)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"

log(){ printf '\033[1;34m[tab-status]\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m[tab-status:warn]\033[0m %s\n' "$*" >&2; }
die(){ printf '\033[1;31m[tab-status:err]\033[0m %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null || die "未找到 node(需 >= 24,扩展依赖原生 TS 类型剥离)"

if [ "${1:-}" = "--test" ]; then
  log "运行单测..."
  (cd "$REPO_DIR" && npm test --silent) || die "单测失败,中止部署"
fi

EXT_DIR="$AGENT_DIR/extensions"
mkdir -p "$EXT_DIR"

log "部署 tab-status -> $EXT_DIR"
cp -f "$REPO_DIR/extensions/tab-status.ts" "$EXT_DIR/tab-status.ts"
rm -rf "$EXT_DIR/tab-status"
cp -r  "$REPO_DIR/extensions/tab-status" "$EXT_DIR/tab-status"

log "完成。新会话或 /reload 后生效;PI_TAB_STATUS=0 可临时关闭,"
log "卡住阈值 PI_TAB_STATUS_STALL_MS(默认 15 秒)、基础文本 PI_TAB_STATUS_BASE(默认自动探测)可调。"
