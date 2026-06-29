# 场景 A：新增供应商

仅在 `providerId` 不在现有集合（`ppio/fal/kie/modelscope`）时走本流程。

## 1) 接入 Rust runtime（必须）

- 新建 `src-tauri/src/ai_runtime/providers/{provider}.rs`，实现：
  - `execute(input)`
  - `continue_polling(input)`
- 在 `src-tauri/src/ai_runtime/providers/mod.rs` 注册 match 分发。
- 在 `src-tauri/src/ai_runtime/key_store.rs` 的 `KNOWN_PROVIDER_IDS` 增加新 provider。

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

- `src/i18n/locales/zh-CN/models.json`
- `src/i18n/locales/en-US/models.json`
- `src/i18n/locales/zh-CN/settings.json`
- `src/i18n/locales/en-US/settings.json`

补齐 provider 名称、API Key 面板文案与链接。

## 4) 上传与媒体处理（按需）

若新供应商要求公网 URL 或特殊上传：

- 修改 `src-tauri/src/ai_runtime/upload/mod.rs`
- 必要时新增 `src-tauri/src/ai_runtime/upload/{provider}.rs`
- 明确本地路径/data URI/base64/public URL 的转换策略

## 5) 先落地一个最小模型（强烈建议）

- 新建 `src/models/{provider}/{model}.model.ts` 做 smoke 测试。
- 保持 request 最小可跑通，不在 UI 写 provider 特判。

## 6) 验证

- `npm run build`
- 若可用：`npm run tauri:dev` 做端到端提交 + 轮询 + 结果下载验证

## 常见回退点

- 只改前端不改 Rust provider（会在 runtime 报 unsupported_provider）
- 漏改 key status 列表，导致设置页不显示新 provider key 状态
- 新 provider 需要公网 URL，却未接入 upload 处理
