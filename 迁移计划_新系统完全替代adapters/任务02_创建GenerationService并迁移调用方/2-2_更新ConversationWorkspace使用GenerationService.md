# 2-2 更新ConversationWorkspace使用GenerationService

## 目标
将 ConversationWorkspace 从使用旧的 ApiService 迁移到新的 GenerationService。

## 文件位置
`src/workspaces/ConversationWorkspace.tsx`

## 修改内容

### 1. 导入语句修改

#### 旧代码
```typescript
import { apiService } from '@/services/api'
```

#### 新代码
```typescript
import { GenerationService } from '@/core/services/GenerationService'
```

### 2. 初始化方式修改

#### 旧代码
```typescript
// 在组件内某处调用
apiService.initializeAdapter({
  type: selectedProvider,
  modelName: selectedModel
})
```

#### 新代码
```typescript
// 使用单例，无需初始化
const generationService = GenerationService.getInstance()

// 只需确保 API Key 已设置（在设置页面或首次使用时设置）
// generationService.setApiKey('ppio', apiKey)
```

### 3. onGenerate 回调修改

找到 `onGenerate` 函数的定义（通常在组件顶部或 props 中）

#### 旧代码
```typescript
const handleGenerate = async (
  input: string,
  model: string,
  type: 'image' | 'video' | 'audio',
  options?: any
) => {
  try {
    let result

    if (type === 'image') {
      result = await apiService.generateImage(input, model, options)
    } else if (type === 'video') {
      result = await apiService.generateVideo(input, model, options)
    } else if (type === 'audio') {
      result = await apiService.generateAudio(input, model, options)
    }

    // 处理结果...
  } catch (error) {
    // 错误处理...
  }
}
```

#### 新代码
```typescript
const handleGenerate = async (
  input: string,
  model: string,
  type: 'image' | 'video' | 'audio',
  options?: any
) => {
  try {
    const generationService = GenerationService.getInstance()

    // 统一调用，不再区分类型
    const result = await generationService.generate(model, {
      prompt: input,  // 图片/视频使用 prompt
      text: input,    // 音频使用 text
      ...options
    })

    // 处理结果...
  } catch (error) {
    // 错误处理...
  }
}
```

### 4. 参数格式调整

确保传给 `generate()` 的参数包含所有必需的值：

```typescript
// 示例：Kling 2.6 Pro
const result = await generationService.generate('kling-2.6-pro', {
  prompt: input,
  ppioKling26Mode: options.ppioKling26Mode || 'text-image-to-video',
  ppioKling26VideoDuration: options.ppioKling26VideoDuration || 5,
  ppioKling26AspectRatio: options.ppioKling26AspectRatio || '16:9',
  ppioKling26CfgScale: options.ppioKling26CfgScale ?? 0.5,
  ppioKling26Sound: options.ppioKling26Sound || false,
  // ... 其他参数
  images: options.uploadedImages,
  video: options.video
})
```

### 5. 错误处理更新

#### 旧代码
```typescript
catch (error) {
  console.error('Generation failed:', error)
  showError(error.message)
}
```

#### 新代码
```typescript
catch (error) {
  if (error instanceof ProviderError) {
    console.error(`Provider error [${error.provider}]:`, error.code, error.message)
    showError(`${error.provider} 错误: ${error.message}`)
  } else {
    console.error('Generation failed:', error)
    showError(error.message || '生成失败')
  }
}
```

### 6. 移除旧的 Adapter 初始化逻辑

查找并删除以下代码（如果存在）：

```typescript
// 删除这些
apiService.setApiKey(apiKey)
apiService.initializeAdapter({ type: 'ppio', modelName: 'xxx' })
apiService.getAdapter()
```

## 实现步骤

1. 备份 `ConversationWorkspace.tsx`
2. 修改导入语句
3. 查找所有 `apiService` 的调用位置
4. 逐一替换为 `generationService.generate()`
5. 更新参数格式
6. 更新错误处理
7. 删除旧的初始化逻辑
8. TypeScript 编译验证
9. 功能测试

## 查找替换技巧

使用编辑器的查找替换功能：

1. 查找：`apiService.generateImage`
   替换为：`generationService.generate`

2. 查找：`apiService.generateVideo`
   替换为：`generationService.generate`

3. 查找：`apiService.generateAudio`
   替换为：`generationService.generate`

4. 查找：`import.*apiService`
   手动替换为新的导入

## 验证标准
- [ ] TypeScript 编译无错误
- [ ] 没有残留的 apiService 引用
- [ ] 参数格式正确（包含所有必需参数）
- [ ] 错误处理完善
- [ ] 功能测试通过

## 测试清单
- [ ] 测试图片生成（任意 PPIO 图片模型）
- [ ] 测试视频生成（任意 PPIO 视频模型）
- [ ] 测试音频生成（如有）
- [ ] 测试错误场景（无 API Key、网络错误等）
- [ ] 测试参数传递（检查控制台的 API 请求日志）

## 预计工时
1-2小时

## 注意事项

1. **ModelId vs Model Name**
   - 旧系统：使用 model name（如 'kling-2.6-pro'）
   - 新系统：使用 modelId（如 'kling-2.6-pro'）
   - 两者通常相同，但要确认

2. **参数完整性**
   - 确保 options 对象包含所有必需参数
   - 参考模型定义的 params 列表
   - 检查控制台的请求日志验证

3. **图片/视频上传**
   - options.uploadedImages（图片数组）
   - options.video（视频 File 或路径）
   - 这些参数要正确传递

4. **向后兼容**
   - 如果有历史记录恢复功能，确保兼容
   - 如果有预设功能，确保参数格式一致

## 常见问题

### 问题1：找不到 GenerationService
**原因**：还未实现 GenerationService
**解决**：先完成任务 2-1

### 问题2：参数未发送到 API
**原因**：options 对象缺少参数，或参数名不匹配
**解决**：
1. 检查传给 generate() 的参数对象
2. 查看控制台的 🚀 API Request 日志
3. 对比模型定义的 param id

### 问题3：类型错误
**原因**：ProviderError 类型未导入
**解决**：
```typescript
import { GenerationService } from '@/core/services/GenerationService'
import { ProviderError } from '@/core/providers/base'
```

## 完成标志
修改完成后，应该能：

1. ✅ 成功调用新的 GenerationService
2. ✅ 控制台打印 🚀 API Request 日志
3. ✅ 参数正确传递到 API
4. ✅ 错误处理友好

示例日志：
```
🚀 API Request: kling-2.6-pro
📍 Endpoint: /async/kling-v2.6-pro-t2v
📦 Request Body: {
  "prompt": "A beautiful sunset",
  "duration": 10,
  "aspect_ratio": "16:9",
  "cfg_scale": 0.5
}
```
