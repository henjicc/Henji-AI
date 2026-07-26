# 图片 / 视频 / 音频适配差异

## 图片模型

- 核心关注：分辨率、宽高比、数量、编辑图输入。
- 常见参数：`aspectRatio/resolution/size/numImages/steps/guidance`。
- 常见策略：
  - 无图时走文生图路由，有图时走图生图路由。
  - 分辨率可走复合面板（如 Seedream）。
- 归并策略：
  - 同模型名/版本若同时提供文生图和图像编辑端点，且只由“是否上传图片”决定，默认合并成一个模型，通过 `endpoints.selector` + builder 自动切换。
  - 若还支持“多参考图生成”“局部重绘”“风格参考”等无法仅靠有无图片区分的子能力，补 `mode` 参数，不要继续堆自动推断。

## 视频模型

- 核心关注：模式切换、时长、分辨率、输入媒体约束。
- 常见参数：`mode/duration/aspectRatio/resolution/quality/audio`。
- 必做项：
  - `inputLimits` + `requirements` 定义图片/视频数量规则。
  - `visible` 或 linkage 处理模式化参数显隐。
  - 明确异步轮询配置（`meta.polling`）。
- 归并策略：
  - 同模型名/版本若仅包含文生视频、首帧图生视频、首尾帧视频，且可由上传图片数量 0/1/2 张唯一判定，优先合并成一个模型，可先不暴露 `mode`。
  - 若希望用户明确感知当前所处子模式，可保留 `mode` 下拉，但用 linkage 在上传 2 张图时自动切到 `start-end-frame`；上传 0/1 张图时保持或回到 `text-image-to-video`。
  - 若包含参考生视频、视频编辑、视频参考、视频延长、多参考图等分支，默认设计 `mode`，再用 `inputLimits`/`requirements` 约束每个分支。
  - 若不同分支的价格、轮询状态值、结果结构明显不同，也应优先显式 `mode`，避免隐式切换导致用户无法理解计费和约束。

## 音频模型

- 核心关注：文本到语音、音色与音频编码配置。
- 常见参数：`spec/voice/speed/volume/pitch/sampleRate/format`。
- 当前仓库基线：`src/models/ppio/minimax-speech-2.6.model.ts`。

## 上传与媒体处理注意点

- 并非所有供应商都接受同一种媒体输入（URL/data URI/base64）。
- 若模型要求公网 URL，优先确认 `electron/main/services/ai-runtime/upload.ts` 与 `electron/main/services/ai-runtime/upload-providers.ts` 是否已覆盖。

## 实操建议

- 同模态先复用同供应商模板。
- 模式复杂的视频模型，优先先做“单模式跑通”，再扩展多模式。
- 音频模型不要沿用视频的参数顺序与交互假设。
- 现有归并参考：
  - 图片自动切换：`src/models/ppio/nano-banana-2.model.ts`
  - 视频显式 mode：`src/models/ppio/kling-o1.model.ts`
  - 视频多端点显式 mode：`src/models/ppio/wan-2.7.model.ts`、`src/models/fal/kling-video-v2.6-pro.model.ts`
