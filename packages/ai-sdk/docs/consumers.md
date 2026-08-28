# SDK 消费项目清单

本清单是 `@henjicc/ai-sdk` 消费方的唯一维护入口，用于 SDK 发布后的跨仓升级协调。
绝对路径仅描述当前开发机上的仓库位置，不进入 SDK 运行时代码、发布包或用户配置。

最后核对日期：2026-08-28

当前 SDK 发布版本：`0.2.4`

## 判定口径

- **消费者**：package manifest / lockfile 声明 SDK，或源码、构建入口实际导入 SDK。
- **内部消费验证面**：位于 SDK 主仓库内，但有独立 manifest 和可运行构建的示例；它们不是外部仓库，仍需跟随发布版本验证。
- **非消费者证据**：README、任务交接、迁移记录中的文字引用，以及没有进入实际构建的声明，不单独算消费者。
- 扫描范围为 `/Users/henji/Documents/VibeCode` 下一级项目，排除了 `.git`、`node_modules`、`dist`、`target`、`build`、`coverage` 和缓存目录。

## 独立宿主

| 仓库 / 开发路径 | 宿主类型 | 当前精确版本 | SDK 入口与构建方式 | 凭据 / transport 责任 | 需同步的变更类型 | 验证命令 | 最后核对 |
|---|---|---|---|---|---|---|---|
| `Henji-AI`<br>`/Users/henji/Documents/VibeCode/Henji-AI` | Electron 42 主进程 + React/Vite；SDK 主开发、首发验证宿主 | `0.2.4` workspace 源码链接；`package-lock.json` 指向 `packages/ai-sdk` | 包根、`provider-packs/*`、`tool-packs/*`；根构建先执行 `build:sdk`，再构建 Electron | Electron 主进程注入 HTTP transport、凭据、媒体读取、日志、trace、取消与落盘；渲染层不直接持有密钥 | 公共类型/目录、provider preset、凭据坐标、transport、媒体、包导出、LLM/生成执行协议 | `npm run check:sdk`；相关 Vitest；改主进程后 `npm run electron:build` | 2026-08-28 |
| `henji-ai-ps`<br>`/Users/henji/Documents/VibeCode/henji-ai-ps` | Photoshop UXP 插件 + React/Vite IIFE（pnpm） | manifest/lock 均为 `0.1.8`；lock integrity `sha512-1EfNPtALkf9z++NeqTPjpOZd/9+2eLI+F+q0A5TaeQL1stoiIR0y3w4Gr8hiPXkB2SzyfUpLwllb0t87lDfV3g==` | `generation/core`、单模型/供应商 pack、LLM streaming；Vite 构建与 UXP smoke bundle | UXP 宿主注入受限 `fetch`、provider 凭据、媒体编码读取和脱敏日志；SDK 不读取 Node/文件系统 | 生成 pack/exports、受限环境可移植性、RuntimeContext、凭据 scope、媒体与流式 LLM；不因版本同步自动引入 GLM | `pnpm typecheck:uxp-smoke && pnpm check:uxp-sdk && pnpm smoke:uxp:build && pnpm check:uxp-smoke`；完整 `pnpm check` | 2026-08-28 |
| `say-it`<br>`/Users/henji/Documents/VibeCode/say-it` | Tauri 2 + Rust 管理 QuickJS；WebView 不运行 SDK | manifest/lock 均为 `0.2.3`；lock integrity `sha512-l/s48EeQvOyGU5w0+xF3EKIRZmHwlk37qVX2ftMGBJUx8xQNNDvq7FSUAGpDaGYzVCmR5gquSvb4atyYuVZOPg==` | 按需打包 capability、Bailian ASR/translation、Groq、LLM modules 为相互隔离 IIFE；Rust 加载 bundle | Rust Host API 注入 HTTP 字节流、WS、media-ref、CredentialStore、日志/trace、Abort/timeout/cancel；QuickJS/插件/WebView 不直取密钥 | capability/LLM 协议、按需 exports、descriptor source/坐标、QuickJS 可移植性、bundle 隔离；不因版本同步自动增加 BigModel bundle | `npm run sdk-runtime:typecheck && npm run sdk-runtime:build`；`npm run test:rust`；完整 `npm run check` | 2026-08-28 |

## SDK 仓内消费验证面

这些目录是可独立安装、构建的真实示例，但与 SDK 同属 `Henji-AI` 仓库，不重复算外部仓库。
它们均精确声明 `0.2.4`，且没有锁文件；发布后应随 SDK 精确升级并验证，避免 README 与公开包长期漂移。

| 路径 | 用途 / 入口 | 当前版本 | 宿主责任 | 验证命令 | 最后核对 |
|---|---|---|---|---|---|
| `/Users/henji/Documents/VibeCode/Henji-AI/packages/ai-sdk/examples/minimal-node` | `generation` + `runtime` 按需入口；完整 generation catalog、KIE dry-run/live 闸门，不带 LLM/BigModel | `0.2.4`（manifest，无 lock） | Node transport、环境凭据、文件媒体读取、日志 | 在目录内 `npm install && npm run dry-run` | 2026-08-28 |
| `/Users/henji/Documents/VibeCode/Henji-AI/packages/ai-sdk/examples/llm-chat` | `llm/streaming` 按需入口；OpenAI-compatible SSE 对话，不带 generation、BigModel preset/models/pricing、Groq 或 LLM modules（保留通用身份解析所需 profiles） | `0.2.4`（manifest，无 lock） | Node transport、环境凭据、流事件与取消 | 在目录内 `npm install && npm run dry-run && npm run check:bundle` | 2026-08-28 |
| `/Users/henji/Documents/VibeCode/Henji-AI/packages/ai-sdk/examples/form-renderer` | `generation` + `catalog` + `runtime` 按需入口；完整 generation catalog/参数契约与最小 renderer，不带 LLM/BigModel | `0.2.4`（manifest，无 lock） | 零网络 RuntimeContext；仅目录与 renderer | 在目录内 `npm install && npm run build && npm start` | 2026-08-28 |

## 非消费者证据

- `Henji-AI`、`henji-ai-ps`、`say-it` 的 README、任务文件和交接文档含历史版本或迁移描述；它们用于追溯，不形成额外消费者。
- `/Users/henji/Documents/VibeCode` 下的 `ai-roundtable`、`fast-install`、`henji`、`henji-dev`、`henjicc.github.io`、`mySkills`、`test` 未发现 `@henjicc/ai-sdk` 的 manifest、lockfile、源码 import 或构建脚本引用。
- SDK 自身的测试、fixture、导出检查和发布脚本属于生产者验证，不作为独立消费项目。

## 发布后维护规则

1. SDK 必须先在 `Henji-AI` 完成精确测试、全量/可移植性/包验证与远端回装，再发布。
2. 发布后更新本清单的“当前精确版本”和日期；消费项目必须精确锁版本并核对 lock integrity。
3. 只升级消费项目实际使用的按需入口。新增 provider/model 不等于所有宿主都要增加对应 bundle 或业务入口。
4. 涉及 provider 身份、endpoint profile、credentialId、transport、media 或协议事件时，逐项检查表中宿主责任边界，禁止在消费方复制 SDK 执行内核。
5. 消费项目升级完成后，将验证结果写入对应任务交接；本清单只维护稳定事实，不复制每次执行日志。
