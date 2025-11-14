## 目标
- 对齐 Wan 2.5 Preview 文/图生视频接口，按需求移除音频 URL 控件、水印开关（默认关闭）、随机种子输入。
- 图生视频沿用 Hailuo 的图片 base64 传输方式。
- 优化 Wan 相关下拉菜单样式，使其与 Hailuo/Kling/PixVerse 保持一致的动画与交互。

## 代码变更范围
- 适配器：`src/adapters/PPIOAdapter.ts`
- UI：`src/components/MediaGenerator.tsx`
- 参考接口定义：`src/adapters/base/BaseAdapter.ts`

## 适配器改动（Wan 2.5 Preview）
- 文件：`src/adapters/PPIOAdapter.ts`
- 定位：Wan 分支 `wan-2.5-preview`（285–329）
- 改动点：
  - 图生视频（i2v）：
    - 取消对 `params.imageUrl` 的要求（当前在 292–299、300–311）。
    - 从 `params.images[0]` 提取 base64（与 Kling/PixVerse 同步，参考 180–186、263–271 的写法），在请求中以 `input.image` 传递。
    - 不再传 `audio_url`；仅保留 `parameters.audio`。
    - 固定 `parameters.watermark: false`；不再传 `seed`。
    - 保留 `parameters.resolution`（值：480P/720P/1080P），`parameters.duration`（5/10），`parameters.prompt_extend`（默认 true）。
  - 文生视频（t2v）：
    - `input` 仅包含 `prompt`、`negative_prompt`；去掉 `audio_url`。
    - `parameters` 保留 `size`（如 1920*1080 等）、`duration`、`prompt_extend`、`audio`，固定 `watermark: false`；不传 `seed`。
  - 负面提示：继续映射 `negative_prompt`。

## UI 改动（Wan 专属）
- 文件：`src/components/MediaGenerator.tsx`
- 定位与现状：
  - Wan 尺寸与分辨率：1596–1615、1574–1595 处使用 `<select>` 与 `<input>`，样式与其他下拉不一致。
  - Wan 额外控件：
    - 音频 URL 输入（1598–1601）需要移除。
    - 水印开关（1606–1609）需要移除，后端固定为关闭。
    - 随机种子输入（1658–1663）需在 Wan 场景下不显示。
    - 图片 URL 输入（1590–1594）需要移除，改为使用已上传图片的 base64。
- 改动点：
  - 新增 Wan 下拉状态与引用：
    - `isWanSizeDropdownOpen`、`wanSizeDropdownClosing`、`wanSizeRef`
    - `isWanResolutionDropdownOpen`、`wanResolutionDropdownClosing`、`wanResolutionRef`
    - 复用现有关闭动画逻辑（参考 341–435 的 handleClose*Dropdown 模式）。
  - 优化 Wan 尺寸下拉：
    - 使用与 Hailuo/PixVerse 一致的弹出面板样式与动画（`bg-zinc-800/90`、`animate-scale-in/out`）。
    - 直接提供合法 `size` 选项列表（来自文档）：
      - 480P：`832*480`、`480*832`、`624*624`
      - 720P：`1280*720`、`720*1280`、`960*960`、`1088*832`、`832*1088`
      - 1080P：`1920*1080`、`1080*1920`、`1440*1440`、`1632*1248`、`1248*1632`
    - 默认 `wanSize='1920*1080'`。
  - 优化 Wan 分辨率下拉（图生视频场景下显示）：
    - 用统一风格的下拉面板取代 `<select>`，选项：`480P`、`720P`、`1080P`（保持现有 `wanResolution` 状态）。
  - 生成参数整理：
    - 在 Wan 生成分支（608–622）中：
      - 移除 `options.audioUrl`、`options.watermark`、`options.seed`。
      - 当存在上传图片时：不再使用 `options.imageUrl`；改为 `options.images=[uploadedImages[0]]` 并保留 `options.resolution=wanResolution`。
      - 无图片时：保留 `options.size=wanSize`。
      - 保留 `options.audio`、`options.promptExtend`、`options.negativePrompt`、`options.duration`。
  - 随机种子输入隐藏策略：
    - 修改显示条件以排除 `wan-2.5-preview`（1658–1663 处逻辑），其他模型维持原样。

## 参数对齐与约束
- i2v：`resolution` 使用档位名（480P/720P/1080P），时长 5 或 10，`prompt_extend` 默认 true。
- t2v：`size` 使用具体分辨率值（如 `1920*1080`），时长 5 或 10，`prompt_extend` 默认 true。
- 音频：仅保留自动配音开关 `audio`；移除自定义 `audio_url` 控件与传参。
- 水印：后端固定 `false`；UI 不再展示。
- 随机种子：UI 不展示；适配器不传。

## 结果与轮询
- 保持现有异步查询逻辑：`checkStatus` 读取 `videos[0].video_url` 并保存至本地（`src/adapters/PPIOAdapter.ts:465–481`）。
- UI 与任务队列无需变更。

## 兼容性与回退策略
- 图生视频改为 base64：若后端拒绝 `input.image`（以文档仅示 `img_url` 的情形），预备回退方案：
  - 增加后端上传模块，将 base64 上传到临时可公开访问的文件服务，得到 URL 后作为 `img_url`。该方案仅在实际调用失败时启用。
- 本次先按 base64 实现；若运行时报 Wan i2v 参数错误，再按回退方案补充上传逻辑。

## 验证
- 启动开发环境并对以下用例验证：
  - 文生视频：`wan-2.5-preview`，选择 `size=1920*1080`，`duration=5/10`，`audio开启/关闭`；应返回 `task_id` 并在轮询后生成视频。
  - 图生视频：粘贴/上传图片（base64），选择 `resolution=1080P`，`duration=5`；应返回 `task_id` 并生成视频。
  - UI：检查下拉动画与关闭行为与 Hailuo 分辨率面板一致；音频 URL、图片 URL、水印、随机种子不再展示。

## 交付
- 提交对 `PPIOAdapter` 与 `MediaGenerator` 的修改，保持其余模块不变。
- 不更改 `providers.json` 描述，但行为以最新适配为准。

如确认上述方案，我将按计划实现并自测。