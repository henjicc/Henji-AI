# 场景 B：现有供应商新增模型

仅在供应商已接入 runtime 时走本流程。

## 1) 选参考模型（先复用再改）

优先选择“同供应商 + 同模态 + 同家族版本”文件做起点。

推荐参考：

- PPIO 图片：`src/models/ppio/seedream-4.5.model.ts`
- PPIO 视频：`src/models/ppio/kling-o1.model.ts`、`src/models/ppio/wan-2.6.model.ts`
- PPIO 音频：`src/models/ppio/minimax-speech-2.6.model.ts`
- FAL 图片：`src/models/fal/z-image-turbo.model.ts`
- FAL 视频：`src/models/fal/kling-video-o1.model.ts`
- KIE 图片：`src/models/kie/z-image.model.ts`
- KIE 视频：`src/models/kie/sora2.model.ts`
- ModelScope 图片：`src/models/modelscope/qwen-image.model.ts`

## 2) 新建模型定义

- 新建 `src/models/{provider}/{model-name}.model.ts`
- 使用 `defineModel()`，补齐：
  - `meta.id/provider/type/i18nScope/name/description/tags`
  - `params/linkages/endpoints/request/pricing`
- 文件名必须以 `.model.ts` 结尾。

## 3) 参数设计

- 顺序规则见 `param-order-patterns.md`。
- 先通过 schema 表达模式差异，不在 UI 里写 `if (modelId===...)`。
- 需要媒体输入约束时优先用：
  - `inputLimits`
  - `requirements`
- 处理隐藏/固定参数时，遵循 `hidden-default-params.md`。
- 涉及比例/分辨率时，默认接入“智能比例”面板：
  - 默认 `smart`
  - 有图按首图匹配最近支持比例
  - 无图回退 `1:1`
  - 发送请求前转成具体比例值，不直传 `auto/smart`

## 4) 请求构建

- 在 `request.builder` 内只处理模型请求映射。
- 以 API 文档为准，不盲拷旧模型字段。
- 不要把全局 prompt 再定义为模型 params（项目已有统一 prompt 输入）。
- PPIO 多媒体优先复用 `src/models/ppio/mediaSources.ts`。
- builder 必须“自包含”：只使用函数体内可访问的变量/函数。不要依赖文件顶层 helper（Rust JS 沙箱执行时会 `ReferenceError`）。
- 比例字段必须发送最终具体值（如 `16:9`），不发送 `smart/auto`。
- UI 层的复合参数/特殊组合，必须在 builder 转成 API 要求字段后再发送。
- 禁止把 UI 值未经转换直接透传给 API。
- 若该模型在 `scripts/generate-model-manifest.cjs` 有 `CUSTOM_BUILDER_OVERRIDES`，需要同步更新 override。

## 5) i18n 与文案

- 在 `src/i18n/locales/zh-CN/models-{provider}.json` 新增 `defs.{modelId}`。
- 在 `src/i18n/locales/en-US/models-{provider}.json` 同步新增。
- 若用了 shared helper，确保 key 存在并能通过 i18n 检查。

## 6) 价格（必须确认）

- `pricing` 不能拍脑袋填写。
- 若用户没给价格，先追问后再编码。
- 追问至少包含：
  - 固定价还是计算价
  - 与分辨率/时长/数量是否有关
  - 价格文案如何展示
- 拿不到价格时，不提交最终模型定义。

## 7) 何时需要改 Rust provider

默认不改。仅当出现以下情况才改：

- 该模型返回结构与当前 provider 提取逻辑不兼容
- 轮询状态字段/状态值不同
- 鉴权、路由、method 有 provider 级新规则

## 8) 验证

- `npm run build`
- 推荐 `npm run tauri:dev` 验证真实提交与回包
- 若本地已有运行中的 Tauri 进程，改完后需重启或触发 manifest reload，确认 runtime 使用最新 `model-manifest.json`。
