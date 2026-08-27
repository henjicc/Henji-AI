# Changelog

本项目遵循语义化版本。`0.x` 阶段仍可能包含破坏性调整，升级时请先阅读对应版本说明。

## Unreleased

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
