## 目标与范围
- 适配以下派欧云视频模型的文生/图生接口：Kling 2.5 Turbo、Minimax Hailuo 2.3（含 Fast 图生）、PixVerse v4.5、Wan 2.5 Preview、Seedance V1 Lite/Pro。
- 保持与 Vidu Q1 一致的异步 task_id → 轮询查询 → 成功后本地保存与 UI 展示的完整流。

## 架构沿用
- 适配器层：复用并扩展 `src/adapters/PPIOAdapter.ts` 的 `generateVideo` 与请求构建策略（参考 87–177、205–273）。
- 工厂与服务：保持 `AdapterFactory` 与 `apiService` 不变（`src/adapters/index.ts:13–19`，`src/services/api.ts:13–24`）。
- 轮询与展示：复用 `App.tsx` 轮询与结果写入（`src/App.tsx:316–373`、成功展示区 `756–813`）。

## 数据类型扩展
- 在 `src/adapters/base/BaseAdapter.ts` 扩展 `GenerateVideoParams`，新增常用视频生成字段（保持可选）：
  - `negativePrompt`, `cfgScale`, `fastMode`, `cameraFixed`, `lastImage`, `size`, `promptExtend`, `watermark`, `audio`, `audioUrl`, `resolution`（字符串档位或具体分辨率）, `aspectRatio`（字符串）。
- 保持返回结果结构与进度字段不变（`TaskStatus` 60–65）。

## 适配器实现（端点与映射）
- 基础：所有请求仍由 `axios` 客户端（`baseURL: https://api.ppinfra.com/v3`，`Authorization: Bearer <key>`）发起（`src/adapters/PPIOAdapter.ts:19–27`）。
- 新增模型分支（根据 `params.model` 与是否有图片决定 t2v/i2v）：
  - Kling 2.5 Turbo
    - 文生：`/async/kling-2.5-turbo-t2v`，映射 `prompt,duration,aspect_ratio,cfg_scale,mode,negative_prompt`
    - 图生：`/async/kling-2.5-turbo-i2v`，映射 `image(取第一张),prompt,duration,cfg_scale,mode,negative_prompt`
  - Minimax Hailuo 2.3
    - 文生：`/async/minimax-hailuo-2.3-t2v`，映射 `prompt,duration,resolution,enable_prompt_expansion`
    - 图生：`/async/minimax-hailuo-2.3-i2v`，映射 `image,prompt,duration,resolution,enable_prompt_expansion`
    - Fast 图生：`/async/minimax-hailuo-2.3-fast-i2v`，同上，端点不同（由 `params.fastMode === true` 或独立模型决定）
  - PixVerse v4.5
    - 文生：`/async/pixverse-v4.5-t2v`，映射 `prompt,aspect_ratio,resolution,negative_prompt,fast_mode,style,seed`
    - 图生：`/async/pixverse-v4.5-i2v`，映射 `image,prompt,resolution,negative_prompt,fast_mode,style,seed`
  - Wan 2.5 Preview
    - 文生：`/async/wan-2.5-t2v-preview`，映射为 `{ input: { prompt, negative_prompt, audio_url }, parameters: { size, duration, prompt_extend, watermark, audio, seed } }`
    - 图生：`/async/wan-2.5-i2v-preview`，映射为 `{ input: { prompt, negative_prompt, img_url, audio_url }, parameters: { resolution, duration, prompt_extend, watermark, audio, seed } }`
  - Seedance V1 Lite
    - 文生：`/async/seedance-v1-lite-t2v`，映射 `prompt,resolution,aspect_ratio,duration,camera_fixed,seed`
    - 图生：`/async/seedance-v1-lite-i2v`，映射 `image,prompt,resolution,aspect_ratio,last_image?,camera_fixed,seed,duration`
  - Seedance V1 Pro（需实名/企业认证，代码层正常支持）
    - 文生：`/async/seedance-v1-pro-t2v`，映射 `prompt,resolution,aspect_ratio,duration,camera_fixed,seed`
    - 图生：`/async/seedance-v1-pro-i2v`，映射 `image,prompt,resolution,aspect_ratio,camera_fixed,seed,duration`
- 结果查询：保持统一 `/async/task-result`，成功从 `videos[0].video_url` 取视频并本地保存为 `blob:` 展示（`src/adapters/PPIOAdapter.ts:205–247`）。

## UI 与配置
- 在 `src/config/providers.json` 新增模型条目（`type: 'video'`）：
  - `kling-2.5-turbo`（单模型，UI 以是否上传图片区分文/图生）
  - `minimax-hailuo-2.3` 与 `minimax-hailuo-2.3-fast`（Fast 可用独立模型或复用 `fastMode` 开关）
  - `pixverse-v4.5`
  - `wan-2.5-preview`
  - `seedance-v1-lite`
  - `seedance-v1-pro`
- 在 `src/components/MediaGenerator.tsx`：新增“通用视频参数面板”，按所选模型呈现必要字段并写入 `options`（传递到适配器）：
  - 通用：`duration, aspectRatio 或 resolution/size, seed, negativePrompt`
  - Kling：`cfgScale(0–1), mode(固定 'pro'), negativePrompt`
  - Minimax：`resolution(遵循时长限制), enable_prompt_expansion, fastMode`
  - PixVerse：`aspect_ratio, resolution, fast_mode, style, seed, negative_prompt`
  - Wan：`size 或 resolution, prompt_extend, watermark, audio, audioUrl`
  - Seedance：`resolution, aspect_ratio, camera_fixed, seed, lastImage(仅 Lite 图生)`
- 文/图生选择策略：沿用现有逻辑，依据是否有上传图片决定调用 t2v 或 i2v 端点；少量模型需特例字段校验（如 Seedance Lite 图生需 ≤1 首帧与 `lastImage` 可选）。

## 校验与错误处理
- 参数校验：在 UI 侧做最小必要校验（图片数量范围、必填项，如参考生需 `prompt`），适配器侧遇到缺失直接抛 `Error`（复用 `handleError`，`src/adapters/PPIOAdapter.ts:275–287`）。
- 认证提醒：Seedance/V1 Pro 与 Wan 的“认证/实名”限制在 UI 以提示文案呈现；代码层不做硬拦截。

## 验证方式
- 本地以假数据跑通 UI 生成 → 适配器入参构建 → 接口返回 `task_id` → 轮询 → 成功展示；
- 手动用小样本参数分别触发：Kling/PixVerse/Minimax/Wan/Seedance 的文生与图生，检查 `task_id`、进度与本地保存日志；
- 保持 Vidu Q1 的进度平滑算法（`src/App.tsx:355–363`），如部分模型耗时更长可视情况提高 `maxPolls`。

## 变更文件清单
- `src/adapters/base/BaseAdapter.ts`（类型扩展）
- `src/adapters/PPIOAdapter.ts`（`generateVideo` 增加模型映射分支与请求构建）
- `src/config/providers.json`（新增各视频模型）
- `src/components/MediaGenerator.tsx`（新增通用视频参数面板与按模型的选项映射）

## 交互与兼容
- 保持 `SettingsModal` 与适配器初始化不变（默认派欧云，`src/components/SettingsModal.tsx:67–71`）。
- 新模型列表出现在模型下拉中（`src/components/MediaGenerator.tsx:599–631`）。

如确认以上方案，我将据此实施代码更改与最小化 UI 扩展，保持与现有风格一致，并逐项验证每个模型的文生/图生流程。