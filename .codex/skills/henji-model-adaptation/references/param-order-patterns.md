# 参数顺序模式（基于当前仓库）

统计基线（`src/models/**/*.model.ts`）：

- 模型总数：49
- 模态分布：video 28 / image 20 / audio 1
- 参数总数：217
- 条件显示参数：33（主要集中在视频模式切换）

## 全局规则

- 不把 `prompt` 放进模型 params（项目已有统一输入区）。
- 有模式切换时，把模式参数尽量放在最前（通常 `order: 1`）。
- 同一组参数在不同模式下隐藏时，保持 `order` 稳定。
- 数值高级参数（seed/cfg/fps 等）放在后段。

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

按现有 `ppio-minimax-speech-2.6`：

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
