# 参数顺序模式（基于当前仓库）

统计基线（`src/models/**/*.model.ts`）：

- 模型总数：58
- 模态分布：video 33 / image 24 / audio 1
- 参数总数：约 287
- 条件显示/隐藏参数：约 59（主要集中在视频模式切换）

## 全局规则

- 不把 `prompt` 放进模型 params（项目已有统一输入区）。
- 有模式切换时，把模式参数尽量放在最前（通常 `order: 1`）。
- 同一组参数在不同模式下隐藏时，保持 `order` 稳定。
- 数值高级参数（seed/cfg/fps 等）放在后段。

## 分辨率/比例特殊面板（重点）

- 只要模型涉及比例/分辨率，优先使用统一的比例/分辨率面板，不要散落多个重复参数。
- 面板第一个选项建议为 `smart`（或智能），并作为默认值。
- `smart` 的本地计算规则：
  - 有输入图片：取第一张图片宽高比，在“当前模型支持的比例列表”里匹配最接近的一项。
  - 无输入图片：使用 `1:1`。
- 请求发送规则：
  - 不把 `auto/smart` 原样传给 API。
  - 始终在本地转成具体比例值后再发送（例如 `16:9`、`1:1`）。
  - 即使供应商文档支持 `auto/smart`，本项目也默认传具体值，保证行为可控一致。

## 展示参数 vs 请求参数（必须转换）

- UI 上的参数组合可以为统一体验服务（例如智能模式、复合面板、自定义选项）。
- 但 `request.builder` 输出必须是 API 文档可接受的结构。
- 若 UI 值与 API 值不一致，必须在 builder 做显式映射/转换，不可直接透传。
- 看起来“奇怪”的 UI 组合是允许的，前提是最终请求参数合法且可复现。

## 视频模型建议顺序

1. `mode` / `variant` / `version`
2. `duration` 或 `aspectRatio`
3. `aspectRatio` / `resolution` / `quality`
4. `quality` / `serviceTier` / `characterOrientation`
5. `audio` / `camera` / `cfgScale` / `seed` / `promptExtend`

说明：当前仓库中视频模型最常见是“模式优先、时长与比例前置”。

## 图片模型建议顺序

1. `aspectRatio` / `resolution` / `size`（或复合分辨率面板）
2. `quantity` / `numImages` / `baseSize`
3. `quality` / `steps` / `guidance`
4. `style` / `promptOptimization` / 其他高级项

说明：图片模型更偏向“分辨率先决”。

## 音频模型建议顺序

按现有 `ppio-minimax-speech`：

1. `spec`
2. `voiceId`
3. `speed`
4. `volume`
5. `pitch`
6. `emotion`
7. `sampleRate`
8. `bitrate`
9. `format`
10. `channel`

## 何时偏离建议顺序

仅在 API 明确要求强依赖时偏离，并在模型文件中保持可读性。
