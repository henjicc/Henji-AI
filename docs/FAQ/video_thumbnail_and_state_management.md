# 视频缩略图处理与状态管理最佳实践 (Tauri + React)

本文总结了在修复 PPIO Kling O1 等视频模型缩略图问题时积累的经验，涵盖了 Tauri 环境下的视频路径处理、状态同步以及 UI 体验优化。

## 1. 核心概念区分

在处理视频上传和显示时，必须明确区分两种数据格式的使用场景：

| 数据格式 | 示例 | 适用场景 | 限制 |
|---------|------|---------|------|
| **Base64 Data URL** | `data:image/jpeg;base64,...` | `<img>` 标签、上传给 API 的缩略图 | 体积大，不适合作为长列表的视频源 |
| **Asset URL** | `asset://localhost/...` (Tauri) | `<video>` 标签 `src`、`fetch` (需配置 scopes) | `<img>` 标签无法直接播放视频，`fetch` 直接调用可能受限 |
| **File Object** | JS `File` 对象 | 上传组件内部状态、生成缩略图 | 无法持久化保存到 storage/history |

## 2. 常见问题与解决方案

### 问题一：历史记录中视频不显示缩略图
**现象**：生成任务后，历史记录中的视频位置空白或无法播放，刷新页面后才显示。
**原因**：任务创建时错误地将 `uploadedVideos` (Base64 图片) 赋值给了 `<video>` 标签需要的 `videos` 字段。`<video>` 标签无法渲染 Base64 **图片**作为视频源。
**解决**：
- **任务创建时**：使用 `convertFileSrc(filePath)` 将本地视频文件路径转换为 Tauri 的 Asset URL。
- **历史记录加载时**：同样使用 `convertFileSrc` 恢复视频 URL。
- `<video src={assetUrl} />` 会自动显示视频第一帧作为缩略图。

### 问题二：重新编辑时 UI 闪烁或显示裂开图标
**现象**：点击"重新编辑"将视频回填到上传区域时，会短暂显示一个裂开的图片图标。
**原因**：
1. **状态更新不同步**：先设置了文件路径 (`setUploadedVideoFilePaths`)，导致组件尝试渲染，但此时缩略图数据 (`uploadedVideos`) 尚未生成完毕。
2. **渲染无效数据**：组件在渲染列表时未过滤 `undefined` 或 `null` 的项。

**最佳实践**：
1. **Promise.all 批量处理**：在恢复状态前，先异步完成所有耗时操作（读取文件、生成缩略图）。
2. **原子化状态更新**：等待所有数据准备好后，一次性设置所有相关状态 (`Videos`, `Files`, `Paths`)，避免中间状态。
3. **组件鲁棒性**：在 `map` 渲染列表时，始终添加 `.filter(item => item !== undefined)` 防御性代码。

```typescript
// ✅ 推荐做法
Promise.all(paths.map(async (path) => {
  // 1. 读取文件
  // 2. 生成缩略图
  return { file, thumbnail, path }
})).then(results => {
  const valid = results.filter(r => r !== null);
  // 3. 一次性更新所有状态
  setUploadedVideos(valid.map(r => r.thumbnail));
  setUploadedVideoFiles(valid.map(r => r.file));
  setUploadedVideoFilePaths(valid.map(r => r.path));
});
```

### 问题三：Tauri 环境下 File 对象重建
**现象**：重新编辑时无法直接使用 Asset URL 创建 File 对象。
**原因**：浏览器的 `fetch('asset://...')` 在某些安全策略下可能受限，且直接 fetch 视频文件可能导致内存压力。
**解决**：
使用 Tauri 的 `fs` 插件读取本地文件，然后创建 File 对象：
```typescript
import { readFile } from '@tauri-apps/plugin-fs';
const bytes = await readFile(filePath);
const file = new File([new Blob([bytes])], 'video.mp4', { type: 'video/mp4' });
```

### 问题四：模型参数自动切换失效
**现象**：上传视频后，模型模式（Mode）没有自动切换到"视频编辑"或"参考视频"模式。
**原因**：Schema 定义中的 `autoSwitch` `watchKeys` 漏掉了 `uploadedVideos`。
**解决**：确保 `watchKeys` 包含所有触发条件字段。
```typescript
autoSwitch: {
  watchKeys: ['uploadedImages', 'uploadedVideos'], // ✅ 包含视频字段
  condition: (values) => values.uploadedVideos?.length > 0,
  value: () => 'video-edit'
}
```

## 3. 调试技巧

当遇到缩略图相关问题时，检查以下几点：
1. **数据源类型**：console.log 打印 `videos` 字段，确认是 `data:image...` 还是 `asset://...`。
2. **组件预期**：确认 UI 组件 (`FileUploader` vs `HistoryCard`) 期望的是图片还是视频流。
   - `FileUploader` (InputArea) 通常需要 **图片缩略图** (Base64) 用于 `<img>` 显示。
   - `HistoryCard` 通常使用 `<video>` 标签，可以使用 **视频文件 URL**。
3. **时序问题**：在网络请求或重计算期间，UI 是否渲染了中间状态？（使用 Loading 状态或过滤无效项）。
