# 图片 / 视频 / 音频适配差异

## 图片模型

- 核心关注：分辨率、宽高比、数量、编辑图输入。
- 常见参数：`aspectRatio/resolution/size/numImages/steps/guidance`。
- 常见策略：
  - 无图时走文生图路由，有图时走图生图路由。
  - 分辨率可走复合面板（如 Seedream）。

## 视频模型

- 核心关注：模式切换、时长、分辨率、输入媒体约束。
- 常见参数：`mode/duration/aspectRatio/resolution/quality/audio`。
- 必做项：
  - `inputLimits` + `requirements` 定义图片/视频数量规则。
  - `visible` 或 linkage 处理模式化参数显隐。
  - 明确异步轮询配置（`meta.polling`）。

## 音频模型

- 核心关注：文本到语音、音色与音频编码配置。
- 常见参数：`spec/voice/speed/volume/pitch/sampleRate/format`。
- 当前仓库基线：`src/models/ppio/minimax-speech-2.6.model.ts`。

## 上传与媒体处理注意点

- 并非所有供应商都接受同一种媒体输入（URL/data URI/base64）。
- 若模型要求公网 URL，优先确认 `src-tauri/src/ai_runtime/upload/mod.rs` 是否已覆盖。

## 实操建议

- 同模态先复用同供应商模板。
- 模式复杂的视频模型，优先先做“单模式跑通”，再扩展多模式。
- 音频模型不要沿用视频的参数顺序与交互假设。
