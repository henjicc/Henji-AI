# SDK 消费项目清单

本清单是 `@henjicc/ai-sdk` 消费方的唯一维护入口，用于 SDK 发布后的跨仓升级协调。
绝对路径仅描述当前开发机上的仓库位置，不进入 SDK 运行时代码、发布包或用户配置。

最后核对日期：2026-09-11

当前 SDK 版本：`0.4.1`（已发布到公共 npm）

`0.4.1`：修复 KIE GPT Image 2 / 2.5 的视频参考误标签，图片生成、编辑、多图输入及请求契约保持不变。109 个生成模型的跨模态视频标签检查、67 项定向测试、SDK 862 项全量测试、可移植性、类型构建及仓外公开入口/受限宿主回装通过。外部消费者登记版本为 `0.2.8`：say-it 不使用图片模型，不受影响；henji-ai-ps 的 KIE GPT Image 2 标签消费情况需在该项目可访问时核实，尚未升级。

修复提交 `ef2be83f` 的必需 CI `34575686946` 已全部通过。正式包与固定候选包 shasum 一致：`32b8dd00f3e320822999b626b8e95a50b6a8ff2f`。发布后在仓外隔离 npm 配置并移除令牌环境变量，已从公共 npm 匿名安装精确版本；Node ESM、严格 TypeScript、49 个 Vite 入口及无 TextEncoder/TextDecoder 的受限宿主验证通过。仓内 workspace 与三个示例 manifest 已锁定 `0.4.1`；未执行真实付费生成或外部消费项目升级。

- `0.4.1` tarball：`https://registry.npmjs.org/@henjicc/ai-sdk/-/ai-sdk-0.4.1.tgz`
- `0.4.1` integrity：`sha512-HtOoOlJWGR6m15wIvqI2VMJFk+ijHntXl2oZAqEA6Ri12gWqaa3JhPthisTj+epO7GwGcuGX4gW3a8qIDd4vAw==`

`0.4.0`：新增硅基流动聊天预设与分类模型发现，提交 `a678dab6` 已推送，必需 CI `34565921443` 全部通过。SDK 861 项测试、宿主配置 15 项测试、类型构建、49 个公开入口及受限宿主候选包回装通过；未执行真实付费推理。移除服务端分类参数的断牙验证使 4 项测试失败，恢复后全量通过。

账号网页二次验证已完成，正式包与候选包校验值一致。已在仓外隔离 npm 配置并移除令牌环境变量，从公共 npm 匿名安装精确版本：Node ESM、严格 TypeScript、Vite 49 个入口及无 TextEncoder/TextDecoder 的受限宿主验证通过，包含硅基流动动态模型发现。仓内 workspace 与三个示例 manifest 已锁定 `0.4.0`；现有外部消费者未新增硅基流动聊天使用，暂不升级。

- tarball：`https://registry.npmjs.org/@henjicc/ai-sdk/-/ai-sdk-0.4.0.tgz`
- shasum：`29a267d8a9f8375ac08b5af94569939473ab6a17`
- integrity：`sha512-4D2gHakuo7Fhhh3a987qrObqJd78k8mIhXPL9dgE3A5uywBi4ebHj7U4XVLUcbjv/HO34wH/+8kFlE5JMOGD0g==`

`0.3.0` 已发布：新增四家 GPT Image 2.5 pack、五家文本 embedding / 四家 rerank，DeepSeek 官方默认模型更新为 `deepseek-flash`。发布提交 `a2dc5bc4` 的必需 CI 门禁全部通过（运行 `34532267703`），SDK 全量 839 项测试和候选包回装通过。正式包已在隔离 npm 配置、无用户令牌的仓外环境从公共 npm 安装，标准 Vite 48 个入口与受限宿主验证通过；正式包校验值与候选包一致。未运行真实付费模型请求。

Henji-AI workspace 与三个仓内示例 manifest 均锁定 `0.4.0`；下表原有示例运行记录仅代表 `0.2.8` 历史证据，本次未完成三个示例的独立全套回装复验。`say-it` 已在 `D:/VibeCode/说吧` 定位，仍锁定公共 npm `0.2.8`，实际按需使用 ASR、translation 与 LLM modules，未使用本次新增硅基流动聊天能力，无需机械升级；未运行其真实宿主验收。`henji-ai-ps` 的下表路径为另一台开发机记录，本机未定位该路径，不声称本次完成外部升级。

## 判定口径

- **消费者**：package manifest / lockfile 声明 SDK，或源码、构建入口实际导入 SDK。
- **内部消费验证面**：位于 SDK 主仓库内，但有独立 manifest 和可运行构建的示例；它们不是外部仓库，仍需跟随发布版本验证。
- **非消费者证据**：README、任务交接、迁移记录中的文字引用，以及没有进入实际构建的声明，不单独算消费者。
- 扫描范围为 `/Users/henji/Documents/VibeCode` 下一级项目，排除了 `.git`、`node_modules`、`dist`、`target`、`build`、`coverage` 和缓存目录。

## 独立宿主

| 仓库 / 开发路径 | 宿主类型 | 当前精确版本 | SDK 入口与构建方式 | 凭据 / transport 责任 | 需同步的变更类型 | 验证命令 | 同步证据与边界 | 最后核对 |
|---|---|---|---|---|---|---|---|---|
| `Henji-AI`<br>`/Users/henji/Documents/VibeCode/Henji-AI` | Electron 42 主进程 + React/Vite；SDK 主开发、首发验证宿主 | workspace 源码与公共 npm 均为 `0.2.8` | 包根、`provider-packs/*`、`tool-packs/*`；根构建先执行 `build:sdk`，再构建 Electron | Electron 主进程注入 HTTP transport、凭据、媒体读取、日志、trace、取消与落盘；渲染层不直接持有密钥 | 公共类型/目录、provider preset、凭据坐标、transport、媒体、包导出、LLM/生成执行协议 | `npm run check:sdk`；相关 Vitest；改主进程后 `npm run electron:build` | `e74fdf09`；公共发布 prepublish 全门禁通过，72 个测试文件 / 766 项测试；正式 tarball 已在无 npm/GitHub 凭据的仓外目录完成安装与 ESM 导入；全新安装后的 workspace 解析已修复 | 2026-08-31 |
| `henji-ai-ps`<br>`/Users/henji/Documents/VibeCode/henji-ai-ps` | Photoshop UXP 插件 + React/Vite IIFE（pnpm） | manifest/lock 均精确锁定公共 npm `0.2.8`；lock integrity 与上方正式产物一致 | `generation/core`、单模型/供应商 pack、LLM streaming；Vite 构建与 UXP smoke bundle | UXP 宿主注入受限 `fetch`、provider 凭据、媒体编码读取和脱敏日志；SDK 不读取 Node/文件系统 | 生成 pack/exports、受限环境可移植性、RuntimeContext、凭据 scope、媒体与流式 LLM；不因版本同步自动引入 GLM | `pnpm typecheck:uxp-smoke && pnpm check:uxp-sdk && pnpm smoke:uxp:build && pnpm check:uxp-smoke`；完整 `pnpm check` | `e509716`；无用户 npm 凭据的 frozen lock 安装通过；Node 22 下四项门禁通过，正式产品仍仅 39 个 generation/erase packs，网络调用与受限环境风险均为 0 | 2026-08-31 |
| `say-it`<br>`/Users/henji/Documents/VibeCode/say-it` | Tauri 2 + Rust 管理 QuickJS；WebView 不运行 SDK | manifest/lock 均精确锁定公共 npm `0.2.8`；resolved、shasum、integrity 与上方正式产物一致 | 按需打包 capability、Bailian/火山实时 ASR、SiliconFlow/Groq 文件 ASR、translation、LLM modules 为相互隔离 IIFE；Rust 加载 bundle | Rust Host API 注入 HTTP 字节流、WS、media-ref、CredentialStore、日志/trace、Abort/timeout/cancel；QuickJS/插件/WebView 不直取密钥 | capability/LLM 协议、按需 exports、descriptor source/坐标、QuickJS 可移植性、bundle 隔离；不因版本同步自动增加未采用模型 | `npm run sdk-runtime:typecheck && npm run sdk-runtime:build`；`npm run test:ui`；Rust 定向/全量测试；`npm run ui:build` | SDK 迁移提交 `5eb4c8b`，0.2.8 基础验证 `df3107e`，Rust→QuickJS 可选字段省略修复 `9e70d32`；QuickJS multipart 内存修复 `3f00ea9` 属宿主传输实现问题，改为原生二进制句柄且保持 64 MiB 沙箱上限，10 MiB 音频边界回归、重定向/资源清理测试、SDK Runtime 类型检查与构建通过 | 2026-09-01 |

## SDK 仓内消费验证面

这些目录是可独立安装、构建的真实示例，但与 SDK 同属 `Henji-AI` 仓库，不重复算外部仓库。
它们的 manifest 均精确声明待发布的 `0.2.8`，且没有锁文件；公共 npm 发布后再从远端重新安装并回填验证证据。

| 路径 | 用途 / 入口 | 当前版本 | 宿主责任 | 验证命令 | 同步证据 | 最后核对 |
|---|---|---|---|---|---|---|
| `/Users/henji/Documents/VibeCode/Henji-AI/packages/ai-sdk/examples/minimal-node` | `generation` + `runtime` 按需入口；完整 generation catalog、KIE dry-run/live 闸门，不带 LLM/BigModel | `0.2.8`（精确 manifest，无 lock、无 workspace alias） | Node transport、环境凭据、文件媒体读取、日志 | 在目录内 `npm install && npm run dry-run` | 已在无用户 npm 凭据的临时副本中从公共 npm 回装；dry-run 网络调用为 0 | 2026-08-31 |
| `/Users/henji/Documents/VibeCode/Henji-AI/packages/ai-sdk/examples/llm-chat` | `llm/streaming` 按需入口；OpenAI-compatible SSE 对话，不带 generation、BigModel preset/models/pricing、Groq 或 LLM modules（保留通用身份解析所需 profiles） | `0.2.8`（精确 manifest，无 lock、无 workspace alias） | Node transport、环境凭据、流事件与取消 | 在目录内 `npm install && npm run dry-run && npm run check:bundle` | 已从公共 npm 回装；dry-run 网络调用为 0，bundle 38 个模块、无越界模块 | 2026-08-31 |
| `/Users/henji/Documents/VibeCode/Henji-AI/packages/ai-sdk/examples/form-renderer` | `generation` + `catalog` + `runtime` 按需入口；完整 generation catalog/参数契约与最小 renderer，不带 LLM/BigModel | `0.2.8`（精确 manifest，无 lock、无 workspace alias） | 零网络 RuntimeContext；仅目录与 renderer | 在目录内 `npm install && npm run build && npm start` | 已从公共 npm 回装；构建与五类代表模型表单渲染通过 | 2026-08-31 |

## 非消费者证据

- `Henji-AI`、`henji-ai-ps`、`say-it` 的 README、任务文件和交接文档含历史版本或迁移描述；它们用于追溯，不形成额外消费者。
- `/Users/henji/Documents/VibeCode` 下的 `ai-roundtable`、`fast-install`、`henji`、`henji-dev`、`henjicc.github.io`、`mySkills`、`test` 未发现 `@henjicc/ai-sdk` 的 manifest、lockfile、源码 import 或构建脚本引用。
- SDK 自身的测试、fixture、导出检查和发布脚本属于生产者验证，不作为独立消费项目。

## 发布后维护规则

1. SDK 必须先在 `Henji-AI` 完成精确测试、全量/可移植性/包验证与远端回装，再发布。
2. 发布后按变更影响逐个同步本清单中的实际消费者；外部消费者必须精确锁版本并核对 lock integrity，再回写 commit、验证状态、边界和日期。
3. 只升级消费项目实际使用的按需入口。新增 provider/model 不等于所有宿主都要增加对应 bundle 或业务入口。
4. 涉及 provider 身份、endpoint profile、credentialId、transport、media 或协议事件时，逐项检查表中宿主责任边界，禁止在消费方复制 SDK 执行内核。
5. 消费项目升级完成后，将验证结果写入对应任务交接；本清单只维护稳定事实，不复制每次执行日志。
