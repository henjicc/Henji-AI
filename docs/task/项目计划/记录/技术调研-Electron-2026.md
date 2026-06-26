# 技术调研：Electron 最新信息（2026-06 核实）

> 本文件记录迁移所依据的 Electron 生态最新事实，避免基于过时信息做方案。所有条目均于 2026-06 通过官方文档/发布页核实，附来源。后续执行任务前可直接引用，无需重新调研；如距本日期较久，建议复核版本号。

## 1. 版本与支持策略
- 最新稳定版：**Electron 42.5.0**（2026-06-23 发布）；同期维护 40.x、41.x。
- 发布节奏：约每 8 周一个大版本，跟随 Chromium；大版本前有 4 周 alpha + 4 周 beta。
- 支持策略：**仅支持最新 3 个大版本**（当前 40/41/42）。
- 结论：**目标锁定实施时的当前大版本（≥42）**，并建立「跟随大版本升级」的常态机制（每数月升一次），否则很快脱离支持窗口。这也正是迁移的核心收益之一（统一且较新的 Chromium）。

## 2. 构建工具链
- **electron-vite**：2026 年新项目（React + TS + Vite）推荐首选，HMR 快、main/preload/renderer 分离清晰、DX 最好。
- **Electron Forge**：官方维护的端到端工具链（含签名、公证、自动更新、分发），跟版最快；但其 **Vite 支持自 Forge v7.5.0 起标记为 experimental**，小版本可能有破坏性变更。
- 常见稳健组合：**electron-vite（开发/构建）+ electron-builder（打包/分发/自动更新）**。
- 结论：见 `重要决定.md` 决定 005。

## 3. 安全基线（2026 仍适用，Electron 20+ 默认）
- 推荐基线：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`。
- **IPC 即安全边界**：主进程必须校验来自渲染层的每一条消息（输入校验、权限、白名单），如同对待不可信 HTTP 请求。
- `contextBridge` 只暴露**窄而具名**的 API，禁止直接把 `ipcRenderer` 整个挂到 window。
- 结论：本项目 PAL（决定 003）天然契合该模型——preload 暴露 `window.henjiNative.{域}.{方法}` 白名单，主进程逐命令校验。

## 4. 数据库
- `node:sqlite`（Node 22.5+ 内置）**2026 仍为实验性、不建议生产使用**，需命令行开关。
- **better-sqlite3**：生产级、同步 API（与现有 `DatabaseService` 调用风格契合）；已补齐 **Electron 42 构建目标与预编译包**。
- 注意：仍是原生模块，需 `@electron/rebuild` 重建；**项目路径含空格会导致 node-gyp 构建失败**（本仓库路径 `D:\VibeCode\Henji-AI` 无空格，安全）。
- 结论：用 **better-sqlite3**（见决定 007）。表结构与 `henji.db` 文件保持不变，直接打开旧库。

## 5. 自动更新
- **electron-updater**（配合 electron-builder）：成熟、可控（支持多通道、灰度）。
- **update.electronjs.org + update-electron-app**：官方为**开源应用**提供的免费自更新服务，接入最简。本仓库为公开 GitHub 仓库 + Apache-2.0，**满足开源免费通道条件**，可作低成本首选。
- Forge 亦内置自动更新封装。
- 结论：见决定 006。现状的「GitHub Release API 轮询 + 手动下载」（`src/services/updateChecker.ts`）可升级为真正的增量自动更新。

## 6. 自定义协议与媒体加载（画布关键）
- `protocol.registerFileProtocol` 已弃用，改用 **`protocol.handle()`**；自定义协议被当作网络请求处理，handler 返回文件路径或用 `net.fetch()` 返回响应。
- 需在 `protocol.registerSchemesAsPrivileged` 注册 scheme 为 standard/secure/**stream:true**；`<video>/<audio>` 默认期望缓冲响应，流式协议须置 `stream:true`。
- **已知坑**：视频二次播放可能触发 `FFmpegDecodeError`，根因是请求被提前拦截/未正确处理 **Range 请求**。媒体协议 handler **必须支持 HTTP Range**，否则画布视频节点回放异常。
- 结论：任务 3.4 用 `protocol.handle()` 暴露本地媒体（替代 `convertFileSrc`/`asset:`），并实现 Range 支持。

## 7. 原生拖拽（拖出到外部应用）
- 用 **`webContents.startDrag()`**（preload→IPC→main，响应 `dragstart`）替代 `@crabnebula/tauri-plugin-drag`。
- **限制**：仅支持**已存在的本地文件**；拖远程内容需先落地为本地文件。Windows 历史上存在「Electron 自身不能作为自己拖拽的放置目标」的怪异行为，需测试。
- 结论：任务 3.8 处理「先物化文件再 startDrag」。

## 8. 后端能力 Node 化的库映射（全量重写，见决定 002）
| 原 Rust 能力 | Node 替代 | 备注/风险 |
| -- | -- | -- |
| `rusqlite` | better-sqlite3 | 见上，原生模块需 rebuild |
| `keyring` | Electron `safeStorage`（必要时 `keytar` 兜底） | 跨外壳密钥不互通，需迁移引导 |
| `reqwest` | `undici` / 内置 `fetch` | provider 多为自定义 HTTP，平移成本低 |
| `image` / `imageproc` / `ab_glyph` / `png` | `sharp`（libvips）+ `@napi-rs/canvas` 做文字/标注渲染 | **像素级一致性风险**：水印/分镜文字渲染需重点回归 |
| `zip` | `archiver`（写）/ `yauzl` 或 `adm-zip`（读） | 项目包格式需保持兼容 |
| `genai`（LLM 流式） | `undici` 流式 + IPC 事件/MessagePort 转发 | 取消用 `AbortController` |
| `boa_engine`（JS DSL） | **Node 原生执行 JS / `node:vm`** | 重写反而更简单：宿主即 JS 运行时 |
| `tracing` 日志 | Node 日志（`electron-log` 或自建） + 前端日志桥 | — |
| `dirs` / `app_local_data_dir` | `app.getPath('appData')` 等 | 路径需对齐旧目录，避免数据搬家（决定 004） |

## 来源
- [Electron Releases / Timelines](https://www.electronjs.org/docs/latest/tutorial/electron-timelines) · [releases.electronjs.org](https://releases.electronjs.org/)
- [electron-vite](https://electron-vite.org/) · [Electron Forge Vite Plugin](https://www.electronforge.io/config/plugins/vite)
- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security) · [Process Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox) · [Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [better-sqlite3 releases](https://github.com/WiseLibs/better-sqlite3/releases) · [node:sqlite vs better-sqlite3 讨论](https://github.com/WiseLibs/better-sqlite3/discussions/1245)
- [Updating Applications](https://www.electronjs.org/docs/latest/tutorial/updates) · [electron-builder Auto Update](https://www.electron.build/auto-update) · [update-electron-app](https://github.com/electron/update-electron-app)
- [protocol API](https://www.electronjs.org/docs/latest/api/protocol) · [Native File Drag & Drop](https://www.electronjs.org/docs/latest/tutorial/native-file-drag-drop)
