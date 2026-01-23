# 修复日志输出和资源 URL 处理

## 问题描述

### 问题 1: Base64 日志输出未截断
在 API 请求日志中，完整的 base64 字符串被输出到控制台，导致日志过长、难以阅读。

**影响文件**: `src/core/request/RequestBuilder.ts`

### 问题 2: PPIO 提供商图片 URL 处理错误
PPIO 提供商在处理图片时，应该：
- 图片：使用 base64 格式传递
- 视频：使用通用文件上传服务

但实际上，当接收到 `http://asset.localhost/...` 格式的 URL 时，代码尝试将其作为本地文件路径读取，导致失败。

**错误日志**:
```
[ppio] 图片转换失败 {path: 'http://asset.localhost/C%3A%5CUsers%5C...',
  error: Error: Failed to read local file: http://asset.localhost/... - URL is not a valid path}
```

**影响文件**: `src/core/providers/PPIOProvider.ts`

## 解决方案

### 修复 1: 添加 Base64 截断功能

在 `RequestBuilder.ts` 中添加了 `truncateBase64InObject()` 方法，用于在日志输出时自动截断 base64 字符串。

**实现逻辑**:
1. 检测 `data:` 开头的 data URI，截断 base64 部分到 50 字符
2. 检测长度超过 200 的字符串，截断到 100 字符
3. 递归处理对象和数组
4. 显示总字符数，例如：`... (12345 chars total)`

**代码位置**: `src/core/request/RequestBuilder.ts:273-311`

**修改内容**:
```typescript
// 修改前
console.log('📥 Input Params:', JSON.stringify(params, null, 2))
console.log('📦 Request Body:', JSON.stringify(body, null, 2))

// 修改后
console.log('📥 Input Params:', this.truncateBase64InObject(params))
console.log('📦 Request Body:', this.truncateBase64InObject(body))
```

### 修复 2: 处理 Tauri Asset URL

在 `PPIOProvider.ts` 的 `convertImagesToBase64()` 方法中，添加了对 `http://asset.localhost/` 格式 URL 的专门处理。

**实现逻辑**:
1. 检测 `http://asset.localhost/` 前缀
2. 提取并解码 URL 编码的文件路径
3. 使用 `readLocalFile()` 读取本地文件
4. 转换为 base64 data URI

**代码位置**: `src/core/providers/PPIOProvider.ts:165-199`

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

## 测试验证

### 验证 1: 日志输出
运行应用后，控制台日志应该显示：
```
📦 Request Body: {
  "prompt": "...",
  "images": [
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJ... (45678 chars total)"
  ]
}
```

### 验证 2: 图片处理
使用图片上传功能时，日志应该显示：
```
[ppio] 检测到 Tauri asset URL，读取本地文件... {
  url: "http://asset.localhost/C%3A%5CUsers%5C...",
  path: "C:\\Users\\..."
}
[ppio] 图片转换成功 { size: 123456, mimeType: "image/jpeg" }
```

## 影响范围

### 修改文件
1. `src/core/request/RequestBuilder.ts` - 添加 base64 截断功能
2. `src/core/providers/PPIOProvider.ts` - 修复 asset URL 处理

### 不影响
- 其他提供商（Fal, KIE, ModelScope）
- 现有的 base64 和远程 URL 处理逻辑
- API 请求的实际内容（只影响日志显示）

## 相关文件

- `src/core/providers/base/utils.ts` - `readLocalFile()` 工具函数
- `src/core/providers/base/ProviderHandler.ts` - Provider 基类

## 注意事项

1. **日志截断仅用于显示**：实际发送到 API 的数据不受影响
2. **URL 解码**：`decodeURIComponent()` 正确处理 Windows 路径中的特殊字符
3. **错误处理**：保留了详细的错误日志，便于调试
4. **向后兼容**：不影响现有的 data URI、远程 URL 和本地路径处理

## 后续优化建议

1. 考虑将 asset URL 处理逻辑提取到 `utils.ts` 中，供其他提供商复用
2. 添加单元测试覆盖各种 URL 格式
3. 考虑在日志中添加图片尺寸信息，便于调试
