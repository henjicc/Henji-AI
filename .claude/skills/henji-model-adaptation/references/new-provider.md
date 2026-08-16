# 场景 A：新增供应商

仅在 `providerId` 不在现有生成 runtime 集合（`ppio/fal/kie/modelscope`）时走本流程。注意：`bizyair` 当前主要作为 API Key / 上传兜底提供方存在，不等于已接入模型生成 provider。

## 1) 接入 Electron runtime（必须）

- 新建 `electron/main/services/ai-runtime/providers/{provider}.ts`，实现：
  - `execute(input)`
  - `continuePolling(input)`
- 在 `electron/main/services/ai-runtime/providers/index.ts` 注册 `executeGenerate` / `executeContinuePolling` 分发。
- 在 `electron/main/services/keystore.ts` 的 `KNOWN_AI_PROVIDER_IDS` 增加新 provider，保证设置页 key 状态可见。

实现时先固定 6 个点：

1. 提交地址拼接规则（相对路由/绝对 URL）
2. 鉴权头格式（Bearer/Key/自定义头）
3. 同步或异步
4. 轮询状态字段与成功/失败状态值
5. task_id / request_id 提取路径
6. 结果 URL 提取路径（数组与单值都要兼容）

## 2) 接入前端 provider 元信息（必须）

- `src/core/config/providers.ts`
  - 更新 `ApiKeyProvider` 联合类型
  - 更新 `API_KEY_PROVIDERS`
  - 若用于上传，更新 `UploadProvider` / `UPLOAD_PROVIDERS`
- `src/stores/settingsStore.ts`
  - 更新 `KNOWN_PROVIDER_IDS`
- 排序与显示（建议）
  - `src/utils/modelHelpers.ts` 的 `PROVIDER_ORDER`
  - `src/components/MediaGenerator/components/ModelSelectorPanel.tsx` 的 `PROVIDER_ORDER`

## 3) 国际化（必须）

- 若新增 provider 专属模型文案文件，除了新增 locale JSON，还要同步接入：
  - `src/i18n/config.ts` 的 import 与 `mergeModelDefs(...)`
  - `scripts/check-model-i18n.cjs` 的 `MODEL_LOCALE_FILES`
- `src/i18n/locales/zh-CN/models.json`
- `src/i18n/locales/en-US/models.json`
- `src/i18n/locales/zh-CN/models-{provider}.json`
- `src/i18n/locales/en-US/models-{provider}.json`
- `src/i18n/locales/zh-CN/settings.json`
- `src/i18n/locales/en-US/settings.json`

补齐 provider 名称、API Key 面板文案与链接。

## 4) 上传与媒体处理（按需）

若新供应商要求公网 URL 或特殊上传：

- 修改 `electron/main/services/ai-runtime/upload.ts`
- 必要时扩展 `electron/main/services/ai-runtime/upload-providers.ts`
- 明确本地路径/data URI/base64/public URL 的转换策略

## 5) Manifest / runtime 支撑（按需）

- 若新 provider 的模型会使用新的 endpoint 常量，更新 `scripts/generate-model-manifest.cjs` 的 `KNOWN_ENDPOINT_CONSTANTS`。
- 若 `request.builder` 需要复用运行时 helper，优先在 builder 内联；只有确认为公共能力时才同步扩展 `electron/main/services/ai-runtime/js-runtime.ts` 的 `JS_PRELUDE`。
- 若 provider 有特殊数值/枚举/图片尺寸约束，优先用模型定义的 `runtimeConstraints`，让 Electron runtime 在请求前统一归一化。

## 6) 先落地一个最小模型（强烈建议）

- 新建 `src/models/{provider}/{model}.model.ts` 做 smoke 测试。
- 保持 request 最小可跑通，不在 UI 写 provider 特判。

## 7) 验证

- `npm run gen:model-manifest`
- `npm run check:model-i18n`
- 运行新 provider 的请求构建、轮询、结果解析和上传精确测试。
- 按 `docs/rules/testing.md` 的风险级别选择主进程类型检查、相关 lint；不默认叠加全量命令。
- 只有需要完整产物链路时才运行 `npm run electron:build`。
- 若可用：`npm run electron:dev` 做端到端提交 + 轮询 + 结果下载验证

## 常见回退点

- 只改前端不改 Electron provider 分发（会在 runtime 报 unsupported_provider）
- 漏改 key status 列表，导致设置页不显示新 provider key 状态
- 新 provider 需要公网 URL，却未接入 upload 处理
- 新增 provider 专属 `models-{provider}.json` 后，忘记更新 `src/i18n/config.ts` 或 `scripts/check-model-i18n.cjs`
