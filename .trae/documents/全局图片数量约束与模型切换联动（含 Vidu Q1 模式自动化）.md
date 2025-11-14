## 目标
- 在模型切换时自动对已上传图片进行约束，确保与目标模型支持的图片数量一致：多余图片自动移除，UI 与文件选择属性同步更新。
- 针对 Vidu Q1：根据当前图片数量自动切换模式（2 张 → 首尾帧；1 张/0 张 → 文/图生视频；3–7 张 → 参考生视频）。
- 方案覆盖 Kling 2.5（仅 1 张）、Hailuo 2.3（仅 1 张）、Hailuo-02（至多 2 张）。

## 实现点
- 在 `src/components/MediaGenerator.tsx` 引入统一的约束计算：
  - `getMaxImageCount(modelId: string, viduMode?: string): number`
  - `coerceViduModeByImages(imagesCount: number): 'text-image-to-video' | 'start-end-frame' | 'reference-to-video'`
- 修改模型选择处理：`handleModelSelect(providerId, modelId)`：
  - 依据 `getMaxImageCount` 截断 `uploadedImages` 和 `uploadedFilePaths`（`slice(0, max)`），自动移除超限部分。
  - 若目标模型是 `vidu-q1`，调用 `coerceViduModeByImages` 自动设置 `viduMode`；否则保留原模式状态。
- 更新上传按钮与文件输入：
  - 上传区域的 `maxImageCount` 计算从当前模型与（对 Vidu）当前模式中获取，保持已存在的逻辑；
  - 文件输入 `multiple` 属性改为动态：`multiple={getMaxImageCount(selectedModel, viduMode) > 1}`，确保在切换到仅支持 1 张图的模型时自动变为单选。
- 新增守护 effect：
  - 监听 `selectedModel` 与 `uploadedImages.length`，在非用户主动上传情况下也能即时执行约束（例如从 Hailuo-02 切到 Hailuo 2.3 时自动降到 1 张）。

## 约束映射
- `kling-2.5-turbo`: 1
- `minimax-hailuo-2.3`: 1
- `minimax-hailuo-02`: 2
- `vidu-q1`: 随模式变化（`text-image-to-video` → 1，`start-end-frame` → 2，`reference-to-video` → 7）

## 验证
- 从 Hailuo-02（两张）切到 Hailuo 2.3/Kling：第二张自动移除，上传按钮切为单选，生成参数只包含首张。
- 切到 Vidu Q1：两张图自动将模式改为首尾帧；3–7 张自动改为参考生；1 张或 0 张为文/图生。
- 所有情形下上传按钮的显示/隐藏与 `multiple` 属性一致。

## 变更文件
- 仅 `src/components/MediaGenerator.tsx`：新增工具函数、改造 `handleModelSelect`、调整 `multiple` 属性、增加守护 effect。

确认后我将实现上述改动并测试。