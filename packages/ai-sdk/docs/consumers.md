# SDK 消费项目清单

本清单是 `@henjicc/ai-sdk` 消费方的唯一维护入口，用于 SDK 发布后的跨仓升级协调。
绝对路径仅描述当前开发机上的仓库位置，不进入 SDK 运行时代码、发布包或用户配置。

最后核对日期：2026-09-24

`0.6.0` 候选版本：新增 MiMo 2.6、GLM-5.3-FlashX、KIE HappyHorse 1.1、火山 Seedream 5.0 Flash 和百炼 Qwen Audio 3.1 ASR；补齐 MiMo Responses 思考事件与 ASR JSON/说话人解析。SDK 79 个测试文件 / 933 项测试、类型构建、可移植性、49 个公开入口和受限宿主验证通过；痕迹 AI 目录、参数组合、模型发现与旧配置兼容验证通过。MiMo 思考事件、ASR JSON 回退、HappyHorse 图生字段的修复撤销验证均检测到失败，恢复后通过。未执行付费请求。等待发布提交 CI 和 npm 身份恢复，尚未公共发布。

本轮消费影响：Henji-AI 自动组合新增 generation pack，无需新增助手工具；三个仓内示例的精确依赖同步到 `0.6.0`，公共发布后的独立安装验证待完成。外部 `say-it` 仍需先完成 `0.5.0` 文件上传桥迁移；当前未引入这批模型，不机械升级。`henji-ai-ps` 本机未定位，不声称已完成外部宿主升级。

Henji-AI 安装包的 GPT Image 2.5 高分辨率报错归属：宿主智能比例预处理曾忽略联动过滤，将 `smart` 转成 KIE 仅限 1K 的 `27:16`，SDK 在请求前正确拒绝。修复位于应用公共预处理，按当前分辨率/渠道的合法选项匹配；Flare/Sunburst 的 1K/2K/4K 及 APIMart、Grsai 同类筛选已有定向覆盖。无需放宽 SDK 契约或发布 SDK；安装包需随应用更新才包含修复，现有版本可手动选合法比例规避。

当前仓内候选 SDK：`0.6.0`；最近已确认公共 npm SDK：`0.5.2`（2026-09-21 已发布并完成公共匿名回装）。以下为历史发布证据。

`0.5.2` 完善轻量 `@henjicc/ai-sdk/llm/streaming`：正式类型支持文本、JSON Object 与 JSON Schema，Chat Completions 的最终请求体写入 `response_format`，OpenAI 输出上限写入 `max_completion_tokens`；结构化输出、思考模式和模型能力的非法组合会在请求前返回结构化错误。流式正文与思考继续分离，保留外部 `AbortSignal`，不设置默认总时限；未显式配置输出上限时不再注入 4096，服务端以 `length` 等原因结束时返回 `truncated: true`。发布前 77 个测试文件 / 909 项测试、可移植性、构建、49 个 Vite 公开入口和受限宿主门禁通过；故意撤销结构化参数、输出上限、OpenAI 字段映射和截断标记后，8 项定向断言失败，恢复后通过。公共索引可读后，已使用隔离 npm 配置和缓存匿名安装精确版本，并从已发布的轻量入口验证最终请求体包含 JSON Schema、思考强度和 24,000 token 上限，SSE 正文/思考事件分离且未截断。

- `0.5.2` tarball：https://registry.npmjs.org/@henjicc/ai-sdk/-/ai-sdk-0.5.2.tgz
- `0.5.2` shasum：`f1c06ae12c9240b203f3ad310c4eec35b755db13`
- `0.5.2` integrity：`sha512-ljb50njJ0bXWxwNmlgZ1+YDBoBgPiLhoNEDjsbhPbe4pc7aVZGcfvpDLh+zGdx9KsB7g7Xp3mqVM4MLpVQm15g==`

`0.5.1` 将 Grsai GPT Image 2.5 未指定变体时的默认值从官方公告仍在维护的 Flare 改为 Standard，并同步默认价格；显式选择 Flare / Sunburst 的调用保持兼容。公共 DTO、请求协议、宿主边界和其余模型未变。发布前 77 个测试文件 / 899 项测试、可移植性、构建、49 个 Vite 公开入口和受限宿主门禁通过；公共索引可读后，已在隔离用户 npm 配置的仓外目录匿名安装并完成 ESM 导入。

- `0.5.1` tarball：https://registry.npmjs.org/@henjicc/ai-sdk/-/ai-sdk-0.5.1.tgz
- `0.5.1` shasum：`40087e680f1b7de63a601d12758acb7280de305f`
- `0.5.1` integrity：`sha512-+L/mAmFU6zgJ0gdsIwy0T1Z9TDOABaxO3HgLsEvMUNbRQhs9K55golF1472EgSJsIDysScnUulFJfBVg0xsNBg==`

`0.5.0` 发布运行时代码提交 `1333422e`，补充边界回归提交 `da37e4bc`；后者必需 CI `35535140722` 全部成功。12组修复撤销验证均检测到失败，恢复后定向测试通过。固定候选包经仓外回装后发布，公共 registry 匿名安装的 shasum/integrity 与候选包一致；Vite公开入口和无TextEncoder/TextDecoder的受限宿主消费通过。npm网页登录与发布二次验证已完成；发布后等待公共索引可读才执行匿名验证，没有重复发布。

- tarball：https://registry.npmjs.org/@henjicc/ai-sdk/-/ai-sdk-0.5.0.tgz
- shasum：`1b66a7c54f4f86a01b73fdca68b1c63e53dcbe10`
- integrity：`sha512-MaPS87wDnvGdeAkGZOQHV+q/XPsQv9WZSPKYTYhqYrDhLbGUKS+m6h1sQ2oPM0GVXuZXKsos9BTJH61NSHjzag==`

本轮按用户SDK范围交付可安装包及宿主调整依据；未升级或修改外部say-it/Photoshop仓库。say-it必须实现新流式/原生文件上传桥并完成Tauri集成验收后再升级；不能只改10 MiB常量。

`0.5.0` 文件 ASR：四族九模型已核对。SDK 新增 describe/readChunk + fetchStream 的有界请求体消费，百炼异步 media-ref 必须通过 uploadFile 原生直传 OSS；旧宿主 read 兼容路径不得提升原内存阈值。structured media_too_large 保留实际字节、上限与可得时长。官方 Qwen 编码后10 MB对应原始7,500,000字节，Fun Flash 2,000,000,000字节/5分钟，Groq附件25,000,000，硅基流动50,000,000，百炼临时上传取min(1,000,000,000,凭证MB×1,000,000)。

本次完成SDK精确回归、12组修复撤销反向验证、全量发布门禁与真实QuickJS 64 MiB堆探针（50 MB multipart、7.5/12 MB JSON）；未执行付费请求。say-it 当前 Host API 虽有分块，适配器仍拼回完整Uint8Array，请求体也仍缓冲，必须接入新契约后才可调整分块总文件上限；原生OSS单独受凭证限制。当前任务交付SDK及宿主调整依据，未改写该外部仓库或声称完成Tauri验收。Henji-AI/Photoshop现有生成媒体读取未迁移到新ASR接口，不机械增加未使用能力。

2026-09-14 候选增量：安全网络失败在端点尝试耗尽后按 1/3/8 秒退避，每次失败重新判断重放安全性，取消立即结束退避。SDK 873 项测试、主进程定向测试与类型检查、可移植性及仓外 Vite／受限宿主消费通过；故意移除重试安全复核后，未知提交状态测试失败，恢复后通过。真实 Electron 主进程对本地服务及 KIE 无凭据只读查询，Node 与 Chromium 两栈均得到 HTTP 200；只证明当时连通，不代表付费生成成功，也未复现之前断连的外部原因。宿主增加关联原请求的脱敏 DNS／代理诊断，不更换网络栈。本机 npm 身份仍返回 401，本次候选变更尚未公共发布或同步外部消费者；下方旧候选包校验值仅对应此前版本内容。

`0.4.2`：共享 transport 将 Node 明确的 TLS 建立前 ECONNRESET 识别为未发送，允许备用端点切换；GET/HEAD 的瞬态断连也允许切换，提交状态不明的写请求仍禁止重放。错误附带脱敏端点、阶段、耗时和提交状态，Henji-AI 生成与继续查询日志保留这些字段。SDK 870 项测试、宿主 7 项定向测试、可移植性、类型构建、仓外 Node ESM / 严格 TypeScript / Vite 49 入口与受限宿主回装通过；故意放行普通 ECONNRESET 重放会被 3 项写请求测试检测，恢复后全量通过。未执行真实付费请求。外部宿主使用不同 transport，需按其错误契约核对影响，不能将 Node 连接前分类视为所有宿主均已实测。

修复提交 `5bf36dce` 已推送，CI `34758299265` 已启动。本机 npm 身份检查返回 `401 Unauthorized`，认证恢复且必需 CI 通过前不得发布；未声称完成公共回装或外部消费者升级。候选包 shasum 为 `dafaae4787798c3f22e5615fe8f5d60f4545c0a2`。宿主 Electron 类型检查与重启通过。上一提交 `45bb50b5` 的 CI 已存在两项画布能力引用相等断言失败，与本次网络修复无关，未夹带修改。

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
