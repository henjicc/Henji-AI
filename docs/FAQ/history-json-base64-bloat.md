# History.json Base64 数据膨胀问题

本文档记录了历史记录文件（history.json）因保存 base64 数据而导致文件体积膨胀的问题及其解决方案。

## 目录

1. [问题描述](#1-问题描述)
2. [根本原因](#2-根本原因)
3. [解决方案](#3-解决方案)
4. [最佳实践](#4-最佳实践)
5. [相关代码位置](#5-相关代码位置)

---

## 1. 问题描述

### 现象

当用户使用 fal 模型（如 MiniMax Hailuo 2.3）上传图片生成视频时，`history.json` 文件体积异常增长，可能从几 KB 增长到数 MB 甚至更大。

### 影响

- **文件体积膨胀**：history.json 文件可能增长到数十 MB，影响应用启动速度
- **性能下降**：读取和解析大文件会导致应用卡顿
- **存储浪费**：base64 数据占用大量磁盘空间，而实际图片文件已经保存在本地

### 触发条件

- 使用支持图片上传的模型（如 fal Hailuo 2.3、Nano Banana、Kling 等）
- 上传图片后生成内容
- 历史记录保存时未正确清理 base64 数据

---

## 2. 根本原因

### 数据流转过程

1. **用户上传图片**：图片被读取为 base64 data URI
2. **OptionsBuilder 处理**：
   - 将 base64 数据保存到 `options.images` 或 `options.image_url`
   - 同时将图片保存到本地磁盘，路径存储在 `options.uploadedFilePaths`
3. **适配器调用**：适配器使用 base64 数据上传到 CDN 或直接发送 API 请求
4. **历史记录保存**：任务完成后，整个 `options` 对象被保存到 history.json

### 问题所在

历史记录清理代码（`src/App.tsx:1826-1840`）只删除了部分字段：

```typescript
// 旧的清理代码（不完整）
delete sanitizedOptions.images        // ✅ 删除了
delete sanitizedOptions.uploadedImages // ✅ 删除了
delete sanitizedOptions.videos        // ✅ 删除了
delete sanitizedOptions.uploadedVideos // ✅ 删除了
// ❌ 但没有删除 image_url 和 video_url
```

**关键问题**：许多 fal 模型使用 `paramKey: 'image_url'` 配置（单图模式），导致 base64 数据被存储在 `options.image_url` 字段中，而这个字段没有被清理代码删除。

### 为什么会有多个字段？

不同模型使用不同的字段名来存储图片数据：

- **多图模式**：`images` 数组（如 Veo 3.1、Pixverse V5.5）
- **单图模式**：`image_url` 字符串（如 Hailuo 2.3、Nano Banana、Kling）
- **特殊字段**：`uploadedImages`（如 Seedream V4/V4.5）

清理代码必须覆盖所有可能的字段名。

---

## 3. 解决方案

### 方案一：扩展黑名单（已实施）

在 `src/App.tsx:1826-1840` 的清理代码中添加缺失的字段：

```typescript
// 清理 options 中的 base64 数据，防止 history.json 膨胀
const sanitizedOptions = t.options ? { ...t.options } : undefined
if (sanitizedOptions) {
  // 删除已知的包含 base64 数据的字段
  delete sanitizedOptions.images
  delete sanitizedOptions.image_url      // ✅ 新增
  delete sanitizedOptions.uploadedImages
  delete sanitizedOptions.videos
  delete sanitizedOptions.video_url      // ✅ 新增
  delete sanitizedOptions.uploadedVideos

  // ... 其他清理逻辑
}
```

**优点**：
- 简单直接，性能好
- 覆盖了大部分常见情况

**缺点**：
- 添加新模型时，如果使用了新的字段名，需要手动更新清理代码

### 方案二：自动检测 + 白名单（推荐，已实施）

在黑名单删除的基础上，添加自动检测机制：

```typescript
// 1. 删除已知的包含 base64 数据的字段（黑名单，性能优化）
delete sanitizedOptions.images
delete sanitizedOptions.image_url
delete sanitizedOptions.uploadedImages
delete sanitizedOptions.videos
delete sanitizedOptions.video_url
delete sanitizedOptions.uploadedVideos

// 2. 自动检测并删除其他可能包含 base64 数据的字段（兜底保护）
const safeFields = new Set([
  'uploadedFilePaths', 'uploadedVideoFilePaths', // 文件路径字段（需要保留）
  'prompt', 'model', 'size', 'duration', 'aspectRatio', 'resolution', // 基础参数
  'seed', 'guidanceScale', 'numInferenceSteps', 'negativePrompt', // 生成参数
  // ... 其他已知的配置参数
])

for (const key in sanitizedOptions) {
  if (safeFields.has(key)) continue // 跳过安全字段

  const value = sanitizedOptions[key]
  // 检测是否为 base64 数据：
  // 1. 字符串类型
  // 2. 以 data: 开头（data URI）
  // 3. 或者长度超过 1000 字符（可能是 base64 字符串）
  if (typeof value === 'string' && (value.startsWith('data:') || value.length > 1000)) {
    console.warn(`[History] 自动删除疑似 base64 数据字段: ${key} (长度: ${value.length})`)
    delete sanitizedOptions[key]
  }
  // 检测数组中是否包含 base64 数据
  else if (Array.isArray(value) && value.length > 0) {
    const firstItem = value[0]
    if (typeof firstItem === 'string' && (firstItem.startsWith('data:') || firstItem.length > 1000)) {
      console.warn(`[History] 自动删除疑似 base64 数据数组字段: ${key} (数组长度: ${value.length})`)
      delete sanitizedOptions[key]
    }
  }
}
```

**优点**：
- **自动化**：添加新模型时无需手动更新清理代码
- **安全**：白名单保护重要的配置参数不被误删
- **可观察**：通过 console.warn 输出被删除的字段，便于调试
- **兜底保护**：即使新模型使用了未知的字段名，只要包含 base64 数据就会被自动删除

**缺点**：
- 略微增加运行时开销（但可以忽略不计）
- 需要维护白名单（但这是一次性工作）

### 检测规则说明

自动检测使用以下规则判断字段是否包含 base64 数据：

1. **Data URI 检测**：字符串以 `data:` 开头（如 `data:image/jpeg;base64,...`）
2. **长度检测**：字符串长度超过 1000 字符（base64 编码的图片通常很长）
3. **数组检测**：检查数组的第一个元素是否符合上述规则

这些规则可以有效识别 base64 数据，同时避免误删正常的配置参数（如 URL、文件路径等）。

---

## 4. 最佳实践

### 4.1 添加新模型时的注意事项

#### 推荐做法：使用标准字段名

在模型配置（`src/components/MediaGenerator/builders/configs/fal-models.ts`）中，优先使用已有的标准字段名：

```typescript
// ✅ 推荐：使用标准字段名
export const newModelConfig: ModelConfig = {
  id: 'new-model',
  type: 'video',
  provider: 'fal',

  features: {
    imageUpload: {
      enabled: true,
      maxImages: 1,
      mode: 'single',
      paramKey: 'image_url',  // ✅ 使用标准字段名
      convertToBlob: false
    }
  },

  customHandlers: commonImageUploadHandler  // ✅ 使用通用处理器
}
```

**标准字段名列表**：
- 单图模式：`image_url`
- 多图模式：`images`
- 单视频模式：`video_url`（如果需要）
- 多视频模式：`videos`

#### 如果必须使用新字段名

如果新模型的 API 要求使用特殊的字段名（如 `reference_image`、`first_frame_url` 等），有两种处理方式：

**方式 1：在路由处理器中映射**（推荐）

```typescript
// src/adapters/fal/models/new-model.ts
export const newModelRoute: FalModelRoute = {
  buildVideoRequest: async (params: GenerateVideoParams) => {
    const requestData: any = {
      prompt: params.prompt
    }

    // ✅ 从标准字段映射到特殊字段
    if (params.images && params.images.length > 0) {
      requestData.reference_image = params.images[0]  // API 要求的字段名
    }

    return { endpoint, modelId, requestData }
  }
}
```

**方式 2：添加到白名单**（不推荐）

如果确实需要在 options 中使用特殊字段名，需要将其添加到白名单中：

```typescript
// src/App.tsx:1839
const safeFields = new Set([
  // ... 现有字段
  'reference_image',  // ✅ 添加新的特殊字段
  'first_frame_url',
  // ...
])
```

但这种方式不推荐，因为：
- 需要手动维护白名单
- 容易遗漏
- 增加代码复杂度

### 4.2 使用通用处理器

所有 fal 模型都应该使用通用的图片/视频上传处理器：

```typescript
// ✅ 推荐：使用通用处理器
export const newModelConfig: ModelConfig = {
  // ...
  customHandlers: commonImageUploadHandler  // 图片模型
  // 或
  customHandlers: commonVideoUploadHandler  // 视频模型
  // 或
  customHandlers: commonMediaUploadHandler  // 图片+视频模型
}
```

这些通用处理器会自动：
1. 将图片保存到本地磁盘
2. 设置 `options.uploadedFilePaths`（文件路径）
3. 设置 `options.images`（base64 数据，用于 API 调用）

### 4.3 验证清理效果

添加新模型后，应该验证历史记录清理是否正常工作：

1. **生成测试任务**：使用新模型上传图片并生成内容
2. **检查 history.json**：
   ```bash
   # 查看 history.json 文件大小
   ls -lh "AppData/Henji-AI/history.json"

   # 搜索是否包含 base64 数据
   grep -o "data:image" "AppData/Henji-AI/history.json" | wc -l
   ```
3. **检查控制台日志**：如果有字段被自动删除，会输出警告日志：
   ```
   [History] 自动删除疑似 base64 数据字段: custom_image (长度: 50000)
   ```

### 4.4 文档更新

如果添加了新的特殊字段名，应该更新相关文档：

1. 在本文档中记录新字段名及其用途
2. 在模型适配指南中说明为什么使用特殊字段名
3. 在代码注释中标注字段的用途

---

## 5. 相关代码位置

### 5.1 历史记录清理代码

**文件**：`src/App.tsx`
**位置**：第 1826-1900 行
**功能**：在保存历史记录到 history.json 之前，清理 options 中的 base64 数据

**关键逻辑**：
1. 删除已知的 base64 数据字段（黑名单）
2. 自动检测并删除其他疑似 base64 数据的字段（白名单 + 自动检测）
3. 保留文件路径字段（`uploadedFilePaths`、`uploadedVideoFilePaths`）

### 5.2 模型配置

**文件**：`src/components/MediaGenerator/builders/configs/fal-models.ts`
**功能**：定义 fal 模型的配置，包括 `paramKey`（决定字段名）和 `customHandlers`（处理图片上传）

**关键配置**：
- `paramKey: 'image_url'`：单图模式，base64 数据存储在 `options.image_url`
- `paramKey: 'images'`：多图模式，base64 数据存储在 `options.images`
- `customHandlers: commonImageUploadHandler`：通用图片上传处理器

### 5.3 通用图片上传处理器

**文件**：`src/components/MediaGenerator/builders/configs/fal-models.ts`
**位置**：第 13-41 行
**功能**：
1. 将上传的图片保存到本地磁盘
2. 设置 `options.images`（base64 数据，用于 API 调用）
3. 设置 `options.uploadedFilePaths`（文件路径，用于历史记录）

### 5.4 FalAdapter 图片上传

**文件**：`src/adapters/fal/FalAdapter.ts`
**位置**：第 59-120 行
**功能**：
1. 检测图片是否为 base64 data URI
2. 如果是，上传到 fal CDN 并获取 URL
3. 如果上传失败，回退到 base64 数据（这可能导致 base64 数据被传递到 API）

**注意**：FalAdapter 不会修改原始的 `params.images`，所以即使上传失败，原始的 base64 数据仍然在 `options.images` 中，会被历史记录清理代码删除。

---

## 6. 故障排查

### 6.1 如何确认问题已解决

1. **检查文件大小**：
   ```bash
   # Windows
   dir "AppData\Henji-AI\history.json"

   # macOS/Linux
   ls -lh ~/Library/Application\ Support/Henji-AI/history.json
   ```
   正常情况下，history.json 应该在几十 KB 到几百 KB 之间（取决于历史记录数量）。

2. **搜索 base64 数据**：
   ```bash
   # 搜索 data URI
   grep -c "data:image" history.json
   grep -c "data:video" history.json
   ```
   应该返回 0（没有找到）。

3. **检查控制台日志**：
   打开浏览器开发者工具，查看是否有 `[History] 自动删除疑似 base64 数据字段` 的警告日志。

### 6.2 常见问题

#### 问题 1：history.json 仍然很大

**可能原因**：
- 历史记录数量过多（默认保存最近 50 条）
- 其他字段包含大量数据（如长提示词、复杂配置等）
- base64 数据存储在未知的字段中

**排查方法**：
1. 检查历史记录数量：
   ```javascript
   // 在浏览器控制台执行
   const history = JSON.parse(localStorage.getItem('history') || '[]')
   console.log('历史记录数量:', history.length)
   ```

2. 分析 history.json 内容：
   ```bash
   # 查看最大的字段
   cat history.json | jq '.[0].options | to_entries | map({key: .key, length: (.value | tostring | length)}) | sort_by(.length) | reverse | .[0:10]'
   ```

3. 检查是否有未知字段包含 base64 数据：
   - 打开 history.json
   - 搜索 `"data:"`
   - 查看是哪个字段包含 base64 数据
   - 将该字段添加到清理代码的黑名单或白名单中

#### 问题 2：自动检测误删了重要字段

**现象**：某些配置参数在历史记录恢复时丢失

**可能原因**：
- 该字段的值是一个长字符串（超过 1000 字符）
- 被自动检测误判为 base64 数据

**解决方法**：
将该字段添加到白名单中：
```typescript
// src/App.tsx:1839
const safeFields = new Set([
  // ... 现有字段
  'yourFieldName',  // ✅ 添加到白名单
])
```

#### 问题 3：历史记录恢复时图片丢失

**现象**：从历史记录恢复任务时，上传的图片无法显示

**可能原因**：
- `uploadedFilePaths` 字段被误删
- 图片文件已被删除
- 文件路径转换错误（相对路径 vs 绝对路径）

**排查方法**：
1. 检查 history.json 中是否包含 `uploadedFilePaths`：
   ```bash
   grep "uploadedFilePaths" history.json
   ```

2. 检查文件是否存在：
   ```bash
   # 查看上传目录
   ls -la "AppData/Henji-AI/uploads/"
   ```

3. 检查路径转换逻辑：
   - 查看 `src/App.tsx:1843-1848` 的路径转换代码
   - 确认相对路径和绝对路径的转换正确

---

## 7. 相关文档

- [Fal 模型适配常见问题](./fal-model-integration-issues.md)
- [Fal 模型适配指南](../ai-guide-fal.md)
- [Fal 模型适配指南 V2](../ai-guide-fal-v2.md)
- [模型适配指南](../others/model-adaptation-guide.md)

---

## 8. 更新日志

- **2025-12-10**：初始版本，记录 base64 数据膨胀问题及解决方案
  - 添加 `image_url` 和 `video_url` 字段到清理黑名单
  - 实现自动检测 + 白名单机制
  - 提供最佳实践和故障排查指南

---

**最后更新时间**：2025-12-10
