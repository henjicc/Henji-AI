## 变更目标
- 在 PixVerse 模型（`pixverse-v4.5`）下隐藏“时长”控件，不影响其它模型与控件。

## 影响范围
- 前端组件：`src/components/MediaGenerator.tsx`
- 当前“时长”控件渲染条件位于：`src/components/MediaGenerator.tsx:1292` 附近（`currentModel?.type === 'video' && selectedModel !== 'vidu-q1'`）。
- 适配器层对 PixVerse 未使用 `duration` 参数（`src/adapters/PPIOAdapter.ts`），因此隐藏 UI 不影响生成逻辑。

## 技术实现
1. 修改“时长”控件的显示条件，显式排除 PixVerse：
   - 从：`currentModel?.type === 'video' && selectedModel !== 'vidu-q1'`
   - 改为：`currentModel?.type === 'video' && selectedModel !== 'vidu-q1' && selectedModel !== 'pixverse-v4.5'`
   - 代码位置：`src/components/MediaGenerator.tsx:1292-1296`（包裹“时长”控件的顶层条件）。
2. 保持 Kling 与 Hailuo 特定下拉逻辑不变：
   - Hailuo 下拉：`[6, 10]`（`src/components/MediaGenerator.tsx:1330-1336`）
   - Kling 下拉：`[5, 10]`（`src/components/MediaGenerator.tsx:1341-1347`）
3. 不改动 PixVerse 的其它控件：
   - 分辨率、`fastMode`、`negativePrompt` 等（参见 `src/components/MediaGenerator.tsx` 分辨率区域与 `src/adapters/PPIOAdapter.ts` 参数映射）。

## 验证步骤
- 选择 PixVerse（`pixverse-v4.5`）：
  - 确认“时长”控件不显示。
  - 分辨率/快速模式/负面提示等保持可用。
- 选择 Kling（`kling-2.5-turbo`）：
  - “时长”下拉显示，选项 `[5, 10]` 正常工作。
- 选择 Hailuo（`minimax-hailuo-2.3/02`）：
  - “时长”下拉显示，选项 `[6, 10]` 正常工作，分辨率联动生效。
- 选择 Vidu（`vidu-q1`）：
  - 按原逻辑不显示“时长”控件。

## 回滚策略
- 若需要恢复，撤回上述条件修改，回到仅排除 `vidu-q1` 的逻辑。

## 注意事项
- 不改动生成参数注入处；PixVerse 非使用 `duration`，隐藏纯属 UI 层调整。
- 保持现有样式与状态管理不变，避免影响其它控件的 `ref` 与 dropdown 状态。