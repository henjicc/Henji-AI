## 目标与范围
- 将 Hailuo（minimax-hailuo-2.3）的参数控件样式、间距、交互统一到 Kling 风格。
- 使用自定义下拉实现“时长”和“分辨率”，并加入时长-分辨率联动规则。
- 保留已做的逻辑：隐藏负面提示与随机种子、图生视频仅一张图、Fast 改为图生视频的开关。

## UI 状态与通用样式
- 在 `src/components/MediaGenerator.tsx` 增加 Hailuo 的下拉状态与引用：
  - `isHailuoDurationDropdownOpen`、`hailuoDurationDropdownClosing`、`hailuoDurationRef`
  - `isHailuoResolutionDropdownOpen`、`hailuoResolutionDropdownClosing`、`hailuoResolutionRef`
- 复用 Kling 的下拉样式与交互类：`bg-zinc-800/70 backdrop-blur-lg border border-[rgba(46,46,46,0.8)] rounded-lg px-3 py-2 h-[38px] text-sm focus:outline-none focus:ring-2 focus:ring-[#007eff]/50 transition-all duration-300 cursor-pointer`。
- 在外部点击关闭逻辑中，加入 Hailuo 的两个下拉引用与开关，保持交互一致。

## 时长下拉（自定义）
- 替换 Hailuo 现有原生 `<select>` 为自定义下拉（结构与 Kling 时长一致）：
  - 触发按钮显示当前值；点击展开菜单；菜单项：`6`、`10`。
  - 选择后设置 `videoDuration` 并关闭下拉。
  - 统一视觉样式与动效（scale-in/out、hover 背景等）。

## 分辨率下拉（自定义与联动）
- 替换 Hailuo 分辨率为自定义下拉，选项动态：
  - 当 `videoDuration === 10`：仅显示 `768P`，选择后保持；同时在 `useEffect` 联动中强制设为 `768P`。
  - 当 `videoDuration === 6`：显示 `768P`、`1080P`。
- 下拉样式与时长一致（统一类与动效）。

## 联动与校正
- 在 `useEffect` 中确保：
  - `videoDuration` 默认落在 `6` 或 `10`，否则重置为 `6`。
  - 当时长切换到 `10` 时，自动把分辨率设为 `768P`。
  - 当切换回 `6` 时，如果当前是 `768P`，允许用户选择 `1080P`；保持现有值不强制覆盖。

## Fast 模式开关位置与样式
- 将“Fast模式”开关渲染在分辨率控件旁，仅当 `uploadedImages.length > 0` 时显示。
- 使用与其他布尔开关一致的按钮样式（开启为主题色高亮，关闭为暗色边框）。

## 图片上传限制与隐藏
- 保持 Hailuo 图生仅一张图片：
  - `maxImageCount = 1` 当 `selectedModel === 'minimax-hailuo-2.3'`。
  - 有一张图片时，上传按钮不再渲染；文件输入 `multiple={false}`。

## 参数传递与端点切换
- 保持生成参数：当图生视频时把 `hailuoFast` 一并传递。
- 适配器中根据 `hailuoFast` 决定端点：`/async/minimax-hailuo-2.3-fast-i2v` 或普通 `/async/minimax-hailuo-2.3-i2v`；文生视频无 Fast。

## 样式一致性与间距
- 检查 Hailuo 区域的控件容器宽度（`min-w`）、间距（`gap`）、标签与控件对齐，统一到 Kling 的布局节奏。
- 保持控件高度 `h-[38px]` 与文本 `text-sm` 一致。

## 验证
- 切换到 Hailuo：
  - 未上传图片：无 Fast 开关；时长下拉（6/10）与分辨率下拉（768P/1080P）呈现；选 `10` 时分辨率下拉只剩 `768P`。
  - 上传一张图片：Fast 开关出现；上传按钮隐藏；切换 Fast 打印端点日志应切换到 `fast-i2v`。
- 生成时：适配器日志打印的 `duration`/`resolution` 与联动规则一致；`hailuoFast` 仅在图生时传递。

## 变更文件
- `src/components/MediaGenerator.tsx`：新增状态与引用，自定义两个下拉，联动逻辑与样式，Fast 开关位置与样式，上传按钮隐藏逻辑。
- 如需：`src/adapters/PPIOAdapter.ts` 保持现状（已支持 `hailuoFast`）。

请确认以上方案，我将按该方案进行具体实现。