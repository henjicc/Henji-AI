## 目标
- 按照 Minimax Hailuo 2.3 的适配方式，新增 Hailuo-02 的完整支持：端点调用、参数规范化、UI 控件与上传约束。

## 接口实现（PPIOAdapter）
- 文件：`src/adapters/PPIOAdapter.ts`
- 新增分支：`params.model === 'minimax-hailuo-02'`
  - 端点：`/async/minimax-hailuo-02`（文档提供的是单一端点）
  - 参数映射：
    - `prompt`: 使用 `params.prompt`
    - `duration`: 仅支持 `6` 或 `10`，默认 `6`（沿用 2.3 的 `normalizeHailuo` 逻辑：10 秒强制 `768P`）
    - `resolution`: `6s` 支持 `768P`、`1080P`；`10s` 仅 `768P`
    - `enable_prompt_expansion`: 来自 `promptExtend`，默认 `true`
    - 图生：`image: images[0]`
    - 首尾帧（若上传两张图）：`image: images[0]`，`end_image: images[1]`
  - 返回处理沿用现有 `checkStatus`（读取 `videos[0].video_url`）。

## 模型配置（providers）
- 文件：`src/config/providers.json`
- 新增模型项：
  - `id: "minimax-hailuo-02"`
  - `name: "Minimax Hailuo-02"`
  - `type: "video"`
  - `description: "文生/图生视频，支持结束帧；6/10 秒与 768P/1080P"`

## 前端 UI（MediaGenerator）
- 文件：`src/components/MediaGenerator.tsx`
- 控件渲染规则（参考 2.3）：
  - 时长：采用 Kling 风格的自定义下拉，选 `6` 或 `10`
  - 分辨率：自定义下拉；`6s` 显示 `768P/1080P`，`10s` 仅 `768P`
  - 负面提示与随机种子：在 Hailuo-02 下隐藏
  - Fast 模式：不显示（仅 2.3 有 Fast 图生）
- 上传约束：
  - 支持最多 2 张图片（第 1 张为首帧，第 2 张为结束帧）
  - 已上传 2 张后隐藏上传按钮；`multiple={true}` 但以内逻辑限制数量
- 生成参数映射：
  - `options.duration = videoDuration`
  - `options.resolution = videoResolution`
  - `options.promptExtend = minimaxEnablePromptExpansion`
  - 无图：仅文本
  - 1 张图：`options.images = [image]`
  - 2 张图：`options.images = [first, second]`（适配器按两张分别映射 `image` 与 `end_image`）

## 权限与下载
- 之前已扩展 `*.myqcloud.com` 到 HTTP 作用域（`src-tauri/capabilities/default.json:22-41`），无需再改；Hailuo-02 的返回视频可正常下载并保存。

## 验证
- 文生：仅 prompt，6/10 秒与分辨率联动正确；能够返回并保存本地。
- 图生（1 张）：仅首帧；端点成功返回。
- 首尾帧（2 张）：`end_image` 生效；端点成功返回。
- 日志：`[PPIOAdapter] API端点`、`请求数据` 正确，`[save] video saved` 与本地 blob 地址展示正常。

## 变更文件
- `src/adapters/PPIOAdapter.ts`（新增 Hailuo-02 分支）
- `src/config/providers.json`（新增模型项）
- `src/components/MediaGenerator.tsx`（UI 控件、上传约束与参数映射）

如果确认，我将按上述方案实现并提交改动。