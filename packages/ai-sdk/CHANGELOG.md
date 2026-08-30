# Changelog

## Unreleased

## 0.2.7 - 2026-08-31

- ASR 按需能力从百炼 9 个模型扩展到 15 个：新增火山引擎 SeedASR 2.0 文件 submit/query 与二进制实时 WebSocket、硅基流动 SenseVoiceSmall/TeleSpeechASR，以及 Groq Whisper Large v3/Turbo。
- 火山实时协议严格校验 V1 大端二进制帧、sequence、payload size、gzip 与终包语义；文件标准版只接受官方要求的公网 URL，不为本地文件伪造上传能力。
- Groq 与硅基流动使用各自官方 multipart 转写契约并统一输出 `SpeechRecognitionOutput`；Groq `verbose_json` 额外归一化时长、分句和词级时间戳，免费层默认按 25 MB 本地上限保护，消费宿主可按套餐显式调整。
- 新增四个 ASR 独立 exports、官方来源 fixture、协议断牙测试、bundle 隔离、仓外 Vite/Node ESM 与无全局 TextEncoder/TextDecoder 的受限宿主门禁。

- 默认生成目录从 99 个扩展到 105 个模型，新增六个 Fal 入口：IC-Light v2 重打光，以及 Topaz、Topaz 透明图、SeedVR2、Bria Creative、Ideogram 高清放大；按需工具仍不混入默认目录。
- IC-Light v2 固定单图约 1MP 重打光契约，并提供五档官方初始光照方向；Fal GPT Image 2 新增 `2:1` 比例和显式约 2K 输出档。
- Topaz 图片放大统一为 Precision / Creative / Generative 显式模式路由，按模式裁剪模型、增强和人脸参数；Topaz 计价改为按实时官方输出 MP 阶梯计算，不再将所有超过 48MP 的任务直接估为 `$1.36`。
- Fal 可选图片工具扩展到 12 个：保留 3 个消除工具，新增 6 个重打光、暗光增强、扩图、商品摄影、照片修复、背景移除工具，以及 Qwen、Perspective、FLUX 2 三个多角度工具；提供 3 / 6 / 3 三个聚合 pack 和对应单模型入口。
- 多角度工具分别支持九档离散方位、透视水平/垂直旋转与 FLUX 2 连续水平、垂直、缩放控制；图片实用工具保持单图输入、官方字段限制和独立固定/按 MP 估价。
- 新增可移植的 `StructuredGenerationOutput` / `layer-stack` 响应契约；火山引擎、APIMart、KIE 的 Seedream 5.0 Pro 图层拆分统一解析输出顺序、尺寸、格式、包围盒和原始索引，同时保留供应商原始 metadata。
- Fal 队列提交现在只把 `sync_mode: true` 当作本地直连路由标记；显式 `sync_mode: false` 会继续发送给队列，保证 Pixelcut 等端点返回可持久化 CDN URL。
- Fal 返回或恢复的 `status_url` / `response_url` 必须属于官方 `https://queue.fal.run` 源，拒绝带用户信息或第三方源的任务 URL，且 `invalid_endpoint` 不进入轮询重试，避免 API Key 被外带。
- `continuePolling()` 只解析模型端点，不再为了续查重建并校验完整生成请求体；持久化任务可在没有原始媒体参数时安全恢复轮询。
- 新增 `openai-responses` 模型步骤协议，与 Chat Completions 并存；标准 Responses SSE、usage、失败与取消统一落到既有模型步骤事件和错误契约。
- 预制供应商按“供应商端点 × 具体模型”自动选择协议：DeepSeek、火山引擎、百炼、MiniMax 与智谱国内 GLM-5.3 的已确认组合默认 Responses，聚合网关和未确认模型继续 Chat。
- Anthropic 协议仍未实现，不再向宿主设置界面提供伪选项；自定义未知端点只需在 Chat / Responses 之间选择。
- `LlmProviderSetup` 新增可选 `connectionOverrides`：预设默认继续按具体模型自动路由，只有用户主动修改时才覆盖 API 地址或统一请求协议；供应商身份、凭据槽与模型能力仍保留预设契约。
- 发布门禁同步锁定 105 个默认模型、12 个 Fal 工具、三类工具聚合包以及仓库外 Node ESM、严格 TypeScript、Vite 与受限宿主包回装；fixture/scripted 验证不发起付费供应商请求。

## 0.2.6 - 2026-08-28

- 新增统一的 `PROVIDER_METADATA` 与 `findProviderMetadata(providerId, options)` 公共契约，覆盖全部生成供应商、LLM 预设与 BigModel 国内/国际端点的官网和 API Key 入口。
- 派欧云、KIE、APIMart 的 `websiteUrl` 保留项目已有邀请码，其余供应商使用正常官网；未知自定义供应商返回 `null`，宿主无需复制或猜测链接。
- LLM preset 与 endpoint profile 改为消费统一供应商目录，并更新 Kimi、MiniMax、小米 MiMo、百炼、火山引擎等已变化的控制台入口。

## 0.2.5 - 2026-08-28

- 新增 `LlmProviderSetup` 的 preset/custom 来源契约和 `builtin | user` 生命周期；已有配置字段与工厂参数均保持可选，0.2.4 消费代码无需迁移即可继续运行。
- `createProviderFromPreset()` 现在显式返回稳定 `credentialId` 与 setup 来源，并允许宿主把正式内置记录标为 `builtin`；BigModel cn/global 仍保持区域化 endpoint profile 与凭据隔离。
- 新增 API Key 管理地址规范化与解析：endpoint profile 官方地址优先，其次 preset 官方地址，custom 只接受不含内嵌凭据、长度不超过 2048 的绝对 HTTP(S) URL。

## 0.2.4 - 2026-08-28

- 新增 `@henjicc/ai-sdk/llm/bigmodel` 按需入口：保留 `bigmodel` 中国大陆默认实例，并在同一协议族内提供 `cn/global` 两个端点 profile、独立凭据槽和分区价格。
- 新增 GLM-5.3-Flash 的保守能力目录与 Chat Completions 文件引用、普通 SSE 工具分片支持；结构化输出、`tool_stream` 与 SDK 未实现的 `file_id` 上传保持关闭。
- LLM 原生流式与模型步按 `providerFamilyId` 应用协议规则、按 `credentialId` 取密钥，并拒绝 BigModel 跨区端点或凭据错配。

本项目遵循语义化版本。`0.x` 阶段仍可能包含破坏性调整，升级时请先阅读对应版本说明。

## 0.2.3 - 2026-08-28

- 修复 Fun-ASR Realtime 把官方 `sentence_begin=true`、`sentence_end=false`、`text=""` 句首生命周期事件误报为 `invalid_response`；空句首现在继续等待真实文本。
- 保持严格终态：空 final 仍报协议错误，任务全程没有有效 final 时在 `task-finished` 报无有效转写；空 `task-finished.payload` 不覆盖已累计结果。
- 重复 final 只累计并通知一次；补齐官方事件 fixture、用户错误回归、空终态、终态顺序、错误与资源释放断牙测试。

## 0.2.2 - 2026-08-28

- 新增按需入口 `@henjicc/ai-sdk/llm/modules`：外部包、插件与内置 LLM 共用 source-aware 注册、流式/非流式执行、模型发现、取消、drain、namespace 注销和 dispose 生命周期。
- LLM module 复用现有 Chat DTO、Token/ReasoningToken、usage、Abort/timeout、RuntimeContext、日志、trace 与统一 discovery；client 统一发射 Usage/Finish/Done/Error，插件不需要导入 SDK，也没有第二套插件专用执行器。
- module ID 与 provider/model 坐标冲突均拒绝覆盖并列出双方 source；新增 `createGroqLlmModule()`，正式验证外部插件不能遮蔽内置 Groq。
- 新增精确资源/断牙测试、无网络 bundle 隔离门禁，以及远端 Node ESM、strict TypeScript、Vite 和无全局 `TextEncoder` / `TextDecoder` 消费验证。

## 0.2.1 - 2026-08-28

- 修复构建期 ESM specifier 重写漏掉精确 `.` / `..` 目录导入，确保 Node ESM 消费方可直接加载 ASR、实时 ASR、翻译和 Groq 按需入口。
- 发布门禁新增仓库外 Node ESM 实际执行，连同严格 TypeScript、Vite、无全局 `TextEncoder` / `TextDecoder` 与 bundle 隔离一起验证；发布说明将 `0.2.0` 标记为不建议使用。

## 0.2.0 - 2026-08-28

- 新增供应商无关的 ASR、翻译与实时会话能力协议；宿主按需注入 HTTP、实时连接、媒体读取、凭据、日志、Abort 与超时，不依赖 Node/Electron 或浏览器全局 WebSocket。
- 新增 5 个百炼短音频/文件 ASR、4 个百炼实时 ASR、Qwen-MT Flash/Plus/Lite，以及 Groq GPT-OSS 20B 流式聊天、静态默认模型与模型发现入口；具体能力均需从独立子路径显式导入。
- capability descriptor 新增必填 `source.kind/source.namespace`，支持内置/外部/插件所有权、冲突诊断、来源批量卸载和资源释放；module ID、provider/kind/model 坐标与统一 discovery ID 冲突不再静默覆盖。
- **破坏性变更**：百炼 ASR module ID 从 `bailian.<modelId>` 统一为 `bailian.speech-recognition.<modelId>`，SDK 不保留旧 ID 或 `funasr` provider alias；已有宿主持久化数据需一次性迁移。
- 新增 ASR、翻译、Groq 与开放 OCR/custom operation 的穷举/断牙测试及独立 bundle 门禁；所有供应商 fixture 均不含真实密钥，本版本发布验证不发起付费模型请求。

## 0.1.8 - 2026-08-28

- 修复 Photoshop UXP 9.2 缺少全局 `TextDecoder` 时 LLM SSE 无法启动：窄流式入口改用 SDK 内部增量 UTF-8 解码器，不要求宿主注入 DOM 或 Node polyfill。
- UTF-8 解码覆盖中文与 emoji 跨 chunk、畸形/过长/代理项/越界序列的替换字符语义，以及流结束截断尾段 flush；LLM reasoning/text/usage/stop/`[DONE]` 和 Abort 契约不变。
- UXP 门禁不再向 VM 注入 `TextEncoder` / `TextDecoder`，并禁止重新引入直接 `TextDecoder` 构造。

## 0.1.7 - 2026-08-28

- 新增 `@henjicc/ai-sdk/llm/streaming` 受限宿主入口，仅包含原生 OpenAI-compatible SSE、取消、必要类型与错误协议，不静态带入 modelStep、Zod 或 Vercel AI SDK。
- 原生 SSE 补齐 usage 与 finish reason 结果，保持 reasoning/text 事件与旧入口兼容；覆盖 UTF-8 跨 chunk、`[DONE]`、供应商错误与 Abort。
- 新增关闭 tree-shaking 的 UXP LLM IIFE/ESM 发布门禁，禁止动态代码生成、Node 全局与非必需 Streams polyfill。

## 0.1.6 - 2026-08-28

- APIMart Nano Banana 2、Lite、Pro 新增常规/官方双渠道，保持常规渠道为默认，并按渠道切换精确模型 ID 与估价。
- APIMart Seedream 5 Pro 补齐官方合法的 `2:1` / `1:2`；Pro/Lite 对列表外比例显式报错，不再静默降级 1:1。
- Fal Seedream 5 Pro/Lite、Qwen Image 3、GPT Image 2、Z-Image 补齐通用比例与显式约 1MP 请求档；GPT Image 2 补齐 `quality=auto`，所有 0.1.5 默认保持不变。
- 补齐 Photoshop adapter 迁移交接；APIMart Midjourney、Z-Image、GPT Image 2 与 Fal Nano 隐藏默认经官方契约核证后维持现实现。

## 0.1.5 - 2026-08-28

- 新增零内置依赖的 `generation/core`、99 个完整单模型 pack、8 个 provider adapter/pack；默认
  `generation` 仍保持 99 模型兼容行为。
- 新增 provider-scoped 媒体预处理/上传策略，完整 pack 可独立完成媒体读取、上传与生成生命周期。
- 新增开放 capability module 协议，支持 ASR/OCR 等非媒体生成能力按模块注册、发现、类型化执行与取消。
- 新增 3 个不进入默认目录的 Fal 图像消除单模型 pack 与聚合 `tool-packs/fal-image-edit-tools`，复用同一
  Fal 上传、队列、轮询、错误与取消内核。
- 新增跨 generation、LLM 与开放扩展的统一能力画像和组合筛选；筛选只作用于宿主已导入候选，
  静态最小化仍由单模型、供应商或模型集合 pack 的 import 边界决定。

## 0.1.4 - 2026-08-27

- 新增 `@henjicc/ai-sdk/generation` 与 `createGenerationClient`，复用根客户端唯一生成内核，不静态带入 LLM/Vercel AI SDK。
- 新增 generation IIFE/VM 发布门禁：99 模型目录与零网络生命周期通过，禁止 Node、动态代码生成、global fetch、Streams、File、`btoa`/`atob` 等受限宿主风险。
- Fal CDN 上传改为全程使用 `RuntimeContext.transport` 的 REST initiate + signed PUT，不再依赖 `@fal-ai/client` 或构造 `File`；补齐成功、失败、取消 fixture。
- 保留 `uploadToFal(apiKey, prepared)` 两参数兼容调用；新宿主应显式传 Transport 或使用生成客户端。

## 0.1.3 - 2026-08-27

- 修复 Fal 队列任务在提交 alias 与状态查询 canonical route 不一致时轮询失败：优先保存供应商返回的完整 `status_url`，仅缺失时才按 `request_id` 重建。
- 完整 `status_url` 轮询完成后仍还原纯 request id，避免状态 URL 被媒体结果收集器误判为生成结果。
- KIE/Fal Seedream 4.0、4.5 四个历史 override 已完成真实供应商单张最小规格验证；KIE/APIMart/PPIO 只读连通性与 KIE/APIMart 设置页余额展示已完成正式 Electron 验证。

## 0.1.2 - 2026-08-27

- 修复发布包在标准 Vite 开发模式下无法解析：五个 `exports` 入口不再优先指向未随包发布的 `src/`，统一解析到已发布的 `dist/` ESM 与类型声明。
- 发布前门禁新增仓库外临时消费方的标准 Vite dev server 解析回归，覆盖包根及四个子路径入口，防止再次发布只在 monorepo 内可用的条件导出。

## 0.1.1 - 2026-08-27

- 新增 Electron、Tauri、UXP 接入指南，以及供应商域名与错误处理参考。
- 新增 `minimal-node`、`form-renderer`、`llm-chat` 三个可构建示例。
- 重写快速开始，补齐 GitHub Packages 私有安装、四项宿主接口注入和生成/轮询示例。

- 不改变 `0.1.0` 的运行时 API；此补丁版用于交付完整指南、示例与已知限制。

## 0.1.0 - 2026-08-27

- 首次私有发布到 GitHub Packages：`@henjicc/ai-sdk`。
- 提供 8 个生成供应商、99 个模型目录、媒体上传预处理与统一 `createAIClient` 入口。
- 提供 OpenAI-compatible LLM 流式执行与模型步能力。
- 提供 5 个 ESM 导出入口、完整 TypeScript 类型声明及模型/LLM 适配文档。
- 产物保留源码模块结构，不预打成单文件，供 UXP、Tauri 与现代 Node 打包器静态分析和 tree-shaking。

迁移说明：这是首次发布，无历史 npm 版本需要迁移；仓库内原占位导入名 `@henji/ai-sdk` 已统一改为 `@henjicc/ai-sdk`。
