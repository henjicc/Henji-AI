# 文件路径处理问题修复总结

## 修复概览

本次修复解决了三个相关的文件路径处理问题：

1. ✅ **Base64 日志输出截断** - 控制台日志过长问题
2. ✅ **PPIO 图片 URL 处理** - `http://asset.localhost/` 格式处理
3. ✅ **重新编辑路径解析** - 相对路径无法读取问题

## 问题 1: Base64 日志输出截断

### 问题
API 请求日志中完整输出 base64 字符串，导致控制台难以阅读。

### 解决方案
在 `RequestBuilder.ts` 中添加 `truncateBase64InObject()` 方法：
- Data URI 截断到 50 字符
- 长字符串（>200）截断到 100 字符
- 显示总字符数

### 修改文件
- `src/core/request/RequestBuilder.ts`

---

## 问题 2: PPIO 图片 URL 处理

### 问题
PPIO 提供商接收到 `http://asset.localhost/C%3A%5CUsers%5C...` 格式的 URL，但无法正确处理，导致图片转换失败。

**错误日志**:
```
[ppio] 图片转换失败 {path: 'http://asset.localhost/...',
  error: Error: Failed to read local file: ... - URL is not a valid path}
```

### 根本原因
代码检查 `!img.includes('localhost')` 来判断是否为远程 URL，但 `http://asset.localhost/` 包含 localhost，导致被错误地当作本地文件路径处理。

### 解决方案
在 `PPIOProvider.ts` 的 `convertImagesToBase64()` 方法中添加专门处理：

```typescript
// 检测 Tauri asset 协议的 HTTP 格式
if (img.startsWith('http://asset.localhost/')) {
  // 提取并解码文件路径
  const encodedPath = img.replace('http://asset.localhost/', '')
  const decodedPath = decodeURIComponent(encodedPath)

  // 读取本地文件并转换为 base64
  const blob = await this.readLocalFile(decodedPath)
  const base64 = await this.blobToBase64(blob)
  return `data:${mimeType};base64,${base64}`
}
```

**处理流程**:
```
http://asset.localhost/C%3A%5CUsers%5C...
  ↓ 移除前缀
C%3A%5CUsers%5C...
  ↓ URL 解码
C:\Users\...
  ↓ 读取文件
Blob
  ↓ 转换
data:image/jpeg;base64,...
```

### 修改文件
- `src/core/providers/PPIOProvider.ts`

---

## 问题 3: 重新编辑路径解析

### 问题
重新编辑历史任务时，无法读取上传的图片文件。

**错误日志**:
```
重新编辑无法读取图片文件，尝试使用缓存:
failed to open file at path: Uploads/15e9d0a34bc1f3f0fd36a9bf1b051f0f7925b5c41c0e59a9a0a74067e5bd5f55.jpg
with error: 系统找不到指定的路径。 (os error 3)
```

### 根本原因
- 数据库存储的是相对路径：`Uploads/xxx.jpg`
- `fileToDataUrl()` 期望绝对路径
- Tauri 的 `readFile()` API 无法处理相对路径

### 解决方案

#### 1. 添加路径解析工具函数

在 `save.ts` 中添加 `resolveFilePath()`:

```typescript
export async function resolveFilePath(filePath: string): Promise<string> {
  // 检查是否为绝对路径
  const isAbsolute =
    /^[a-zA-Z]:[\\\/]/.test(filePath) || // Windows: C:\, D:\
    /^\//.test(filePath) ||               // Unix: /
    /^\\\\/.test(filePath)                // Windows UNC: \\server\share

  if (isAbsolute) {
    return filePath
  }

  // 相对路径，解析为数据目录下的路径
  const dataRoot = await getDataRoot()
  return await path.join(dataRoot, filePath)
}
```

#### 2. 更新重新编辑功能

在 `ConversationWorkspace.tsx` 中使用 `resolveFilePath()`:

```typescript
// 图片处理
for (const p of task.uploadedFilePaths) {
  const absolutePath = await resolveFilePath(p)
  const data = await fileToDataUrl(absolutePath)
  arr.push(data)
}

// 视频处理
for (const p of task.uploadedVideoFilePaths) {
  const absolutePath = await resolveFilePath(p)
  await fileToDataUrl(absolutePath)
  arr.push(p)
}
```

**处理流程**:
```
相对路径: Uploads/xxx.jpg
  ↓ getDataRoot()
C:\Users\...\AppData\Local\com.henji.ai\Henji-AI
  ↓ path.join()
C:\Users\...\AppData\Local\com.henji.ai\Henji-AI\Uploads\xxx.jpg
```

### 修改文件
- `src/utils/save.ts` - 添加 `resolveFilePath()`
- `src/workspaces/ConversationWorkspace.tsx` - 更新 `handleReedit()`

---

## 技术亮点

### 1. 统一的路径处理策略

三个问题都涉及文件路径处理，但场景不同：
- **问题 1**: 日志显示优化（不影响功能）
- **问题 2**: URL 格式转换（Tauri asset 协议）
- **问题 3**: 相对路径解析（数据库存储）

### 2. 向后兼容性

所有修复都保持向后兼容：
- 现有的绝对路径继续工作
- 现有的 data URI 继续工作
- 现有的远程 URL 继续工作
- 不需要数据迁移

### 3. 错误处理

保留了完整的错误处理和回退机制：
- 文件读取失败时回退到缓存的 base64
- 详细的错误日志便于调试
- 不会因为单个文件失败而中断整个流程

## 测试验证

### 验证清单

- [ ] **日志输出**: 控制台日志中 base64 字符串被正确截断
- [ ] **图片上传**: 使用 PPIO 模型上传图片并生成
- [ ] **重新编辑**: 点击历史任务的重新编辑按钮
- [ ] **视频处理**: 测试视频上传和重新编辑
- [ ] **跨平台**: 在 Windows 和 macOS 上测试

### 预期结果

#### 日志输出
```
📦 Request Body: {
  "images": [
    "data:image/jpeg;base64,/9j/4AAQSkZJRg... (45678 chars total)"
  ]
}
```

#### PPIO 图片处理
```
[ppio] 检测到 Tauri asset URL，读取本地文件...
[ppio] 图片转换成功 { size: 123456, mimeType: "image/jpeg" }
```

#### 重新编辑
```
[App] 成功读取图片文件: C:\Users\...\Uploads\xxx.jpg
```

## 影响范围

### 修改文件（3 个）
1. `src/core/request/RequestBuilder.ts`
2. `src/core/providers/PPIOProvider.ts`
3. `src/utils/save.ts`
4. `src/workspaces/ConversationWorkspace.tsx`

### 不影响
- 其他提供商（Fal, KIE, ModelScope）
- 文件保存逻辑
- 数据库存储格式
- API 请求的实际内容

## 相关文档

详细文档已创建：
1. `docs/fix-base64-logging-and-asset-url-handling.md` - 问题 1 & 2
2. `docs/fix-reedit-file-path-resolution.md` - 问题 3

## 后续优化建议

1. **统一路径处理**: 在所有文件操作中使用 `resolveFilePath()`
2. **路径验证**: 添加文件存在性检查
3. **单元测试**: 为路径处理函数添加测试
4. **性能优化**: 考虑缓存 `getDataRoot()` 的结果
5. **错误提示**: 提供更友好的用户错误提示

## 总结

本次修复解决了三个相关但独立的文件路径处理问题：
- ✅ 改善了开发体验（日志可读性）
- ✅ 修复了 PPIO 图片上传功能
- ✅ 修复了重新编辑功能

所有修复都经过 TypeScript 编译验证，保持向后兼容，不需要数据迁移。
