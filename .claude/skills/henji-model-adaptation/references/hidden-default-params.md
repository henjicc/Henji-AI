# 隐藏参数与固定默认值策略

把参数分成 3 类管理。

## A. 显示并请求

- 正常写入 `params`，在 `request.builder` 按条件映射。

## B. 不显示且不请求

- 直接不定义到 `params`，也不要在 builder 发送。
- 常见于产品暂不开放的高级参数（例如部分模型的 negative prompt）。
- Henji-AI 当前新增适配约定：`output_format` / `outputFormat` 统一走这一类，不展示也不请求。

## C. 不显示但固定请求

- 不放到 `params`，在 builder 固定写入常量。
- 仅用于“产品统一策略”或“API 推荐默认”。

当前仓库已存在示例：

- `enable_safety_checker: false`
  - `src/models/fal/seedance.model.ts`
  - `src/models/fal/seedream-v4.model.ts`
  - `src/models/fal/seedream-v4.5.model.ts`
  - `src/models/fal/wan-2.5-preview.model.ts`
  - `src/models/fal/z-image-turbo.model.ts`
- `watermark: false`
  - `src/models/ppio/seedance-1.5-pro.model.ts`
  - `src/models/ppio/seedream-4.0.model.ts`
  - `src/models/ppio/seedream-4.5.model.ts`
  - `src/models/ppio/wan-2.5-preview.model.ts`
  - `src/models/ppio/wan-2.6.model.ts`
- 历史存量里存在输出格式字段，但不要作为新增适配参考：
  - `output_format: 'png'` in `src/models/fal/z-image-turbo.model.ts`

## Negative Prompt 现状

- 当前主要由 ModelScope 系列暴露并映射（`modelscopeNegativePrompt`）。
- 其他供应商大多未暴露也未发送。
- 若新模型文档支持 negative prompt，但产品不开放：走 B 类。

## 设计检查表

- 是否展示给用户？
- 是否必须发送给 API？
- 若固定发送，固定值是否有产品决策依据？
- 是否会影响多模态/多模式兼容？

## 落地原则

- 不发送 API 文档未定义字段。
- 固定默认值要集中在 builder，避免散落在 UI。
- 同一字段在同供应商模型中保持命名一致。
- 对于 `output_format` / `outputFormat`，当前新增模型直接不定义、不发送；不要因为文档支持或仓库里有历史存量就继续扩散。
