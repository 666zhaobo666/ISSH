# ISSH 项目架构与开发路线图 (Roadmap)

## 1. 项目定位与核心需求

打造一款**高颜值、多端可用、云端同步、内置轻量 AI 运维助手**的现代 SSH 客户端（融合 FinalShell 的实用闭环与现代终端的审美体验）。

### 核心功能清单
- **高颜值终端**：`xterm.js` (WebGL 渲染) + 毛玻璃/亚克力窗口 + 自定义主题/Nerd Font/连字/分屏/多标签页。
- **零侵入实时机器监控**：复用 SSH Exec 通道周期性读取 `/proc/*`、`df -P`、`ps` 等，实时展示 CPU、内存、Swap、网卡流量、磁盘占用、Top 进程。
- **终端路径跟随文件管理**：优先使用 OSC 7 转义序列 hook，降级支持命令/Prompt 解析，实现 `cd` 后 SFTP 目录自动同步。
- **全格式实时文件编辑**：内置 `CodeMirror 6`（支持 Java/Python/Go/YAML/Shell/Nginx 等语法高亮、Markdown 双栏实时预览、二进制 Hex 视图），`Ctrl+S` 保留原权限 SFTP 回写；桌面端支持调用本地外部编辑器并监听保存自动上传。
- **多端支持与云端同步**：覆盖 **Windows + Web + Android**，通过端到端加密（E2EE）云同步主机配置、SSH 密钥、快捷命令及 AI 配置。
- **轻量级 AI 助手**：接入兼容 OpenAI 格式的外部 API（体积轻量，不内置本地大模型）：
  - **Ask 模式**：只读问答、报错分析、命令建议（支持一键填入终端）。
  - **Agent 模式**：支持 Tool Calling（`ssh_exec`、`sftp_read/write/list`、`get_terminal_context`）自主排查与操作。
  - **审批机制**：支持 **Manual Approve**（命令确认卡片）与 **Auto Approve**（连续自动执行 + 高危命令正则安全护栏）。

---

## 2. 技术栈与跨端架构

前端 UI 与业务逻辑完全共享，仅将底层 SSH/SFTP 传输通道抽象为统一的 `ISshTransport` 接口：

| 层级 | 选型 | 说明 |
| :--- | :--- | :--- |
| **共享前端层** | React + TypeScript + Tailwind CSS + shadcn/ui | 一套代码覆盖 Windows、Web、Android UI |
| **终端组件** | `xterm.js` (WebGL Addon) | 60fps 渲染、真彩色、极高颜值上限 |
| **代码编辑器** | `CodeMirror 6` | 轻量、模块化、支持多语言高亮、Markdown 预览与移动端触控 |
| **桌面 / 移动壳** | Tauri 2.0 (Rust) | 打包体积小、内存低；Rust (`russh`) 原生直连 SSH/SFTP |
| **Web 网关与云同步** | Go (Docker 一键部署) | 提供 WebSocket-to-SSH/SFTP 网关与 E2EE 云同步 API |
| **AI 模块** | 轻量 OpenAI-Compatible Client + Tool Loop | 流式输出 + ReAct 循环，无重型框架依赖 |

---

## 3. 分阶段开发进度 (Milestones)

### Phase 0：工程骨架与统一抽象（第 1 周）
- [x] 初始化 Monorepo 结构（`packages/core`、`apps/desktop` 等，后续按需扩展 `packages/ui`、`apps/web`、`services/backend`）
- [x] 初始化 Tauri 2.0 + React + TypeScript + Tailwind CSS 桌面端工程（前端已编译通过；Rust 壳代码已就位，待本地安装 Rust 工具链后编译）
- [x] 定义统一的 `ISshTransport` 接口与状态管理模型（连接、PTY、Exec、SFTP、监控采样、AI 模型）

### Phase 1：Windows 桌面端核心闭环（第 2~3 周）
- [x] Rust 后端接入 `russh`，实现密码/私钥认证与 SSH 会话管理（含独立 `exec` 通道）
- [x] 集成 `xterm.js` + WebGL，实现多标签页、Tokyo Night 主题与 Windows Mica 毛玻璃效果
- [x] 实现零侵入性能监控面板（后台 Exec 定时采集 `/proc/*`、`df -P`、`ps` + 前端实时仪表盘）

### Phase 2：路径跟随文件管理 + 实时多语言编辑（第 4~5 周）
- [x] 实现 SFTP 文件列表、上传（含拖拽）、下载、新建文件夹、重命名与删除
- [x] 实现终端路径跟随（OSC 7 优先 + Shell Prompt 无感解析，`cd` 自动同步目录）
- [x] 集成 `CodeMirror 6`（Java/Python/JS/YAML/JSON/HTML/CSS/SQL/XML 多语言高亮、Markdown 分栏实时预览、二进制 Hex 视图、`Ctrl+S` 保留权限回写）
- [x] 桌面端增加“调用本地外部程序编辑 + File Watcher 自动上传”

### Phase 3：轻量级 AI 助手（第 6~7 周）
- [x] 实现 OpenAI-Compatible 流式 API 客户端与多预设配置管理（DeepSeek / OpenAI / Ollama 等）
- [x] 实现 **Ask 模式**（自动注入 OS、当前路径、选中文本或最近 150 行终端输出 + 一键填入终端）
- [x] 实现 **Agent 模式**（借鉴 OpenCode 工具规范：`ssh_exec`、`sftp_read`、`sftp_write`、`sftp_edit`、`sftp_list`、`sftp_grep`）
- [x] 实现 **Manual / Auto Approve 审批流** 及高危命令本地安全护栏

### Phase 4：云端同步 + Web 端网关（第 8~9 周）
- [x] 使用 Go 构建 WebSocket-to-SSH/SFTP 网关（支持 Docker 私有化部署）
- [x] 实现前端 `ISshTransport` 的 WebSocket 适配器，跑通 Web 端
- [x] 实现服务端账号体系、VIP 卡密、Admin 管理后台（含 `.zip` 一键灾备）与 AES-256-GCM 加密无感心跳云同步服务

### Phase 5：Android 端适配与体验打磨（第 10~11 周）
- [x] 基于 Tauri 2.0 Mobile 适配 Android 客户端架构与 GitHub Actions 自动编译 `.apk` 流水线（复用 Rust 原生直连能力）
- [x] 适配小屏响应式布局（主机 / 终端 / 文件 / 监控 / AI 全屏 5-Tab 切换 + 软键盘自动避让）
- [x] 增加终端虚拟快捷键栏（`Esc / Tab / 黏滞 Ctrl / Alt / ^C / 方向键 / 符号 / 常用命令抽屉`）并优化触屏交互
