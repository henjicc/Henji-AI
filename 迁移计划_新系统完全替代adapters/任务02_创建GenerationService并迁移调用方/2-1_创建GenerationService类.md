# 2-1 创建GenerationService类

## 目标
创建统一的生成服务，实现Provider自动路由、API密钥管理和错误处理。

## 文件位置
`src/core/services/GenerationService.ts`

## 实现内容

### 类结构

```typescript
export class GenerationService {
  private providers: Map<string, ProviderHandler>
  private static instance: GenerationService | null = null

  private constructor() {
    this.providers = new Map()
  }

  static getInstance(): GenerationService {
    if (!GenerationService.instance) {
      GenerationService.instance = new GenerationService()
    }
    return GenerationService.instance
  }
}
```

### 核心方法

#### 1. generate() - 统一生成接口
```typescript
async generate(
  modelId: string,
  params: Record<string, any>,
  onProgress?: (status: ProgressStatus) => void
): Promise<GenerateResult> {
  try {
    // 1. 从 ModelRegistry 获取模型定义
    const model = ModelRegistry.getModel(modelId)
    if (!model) {
      throw new Error(`Model not found: ${modelId}`)
    }

    // 2. 获取对应的 Provider
    const provider = this.getProvider(model.meta.provider)

    // 3. 调用 Provider 的 generate 方法
    const result = await provider.generate(model, params)

    return result
  } catch (error) {
    throw this.handleError(error, modelId)
  }
}
```

#### 2. getProvider() - 获取或创建Provider
```typescript
private getProvider(providerName: string): ProviderHandler {
  // 检查缓存
  if (this.providers.has(providerName)) {
    return this.providers.get(providerName)!
  }

  // 创建新的 Provider
  const provider = this.initializeProvider(providerName)
  this.providers.set(providerName, provider)

  return provider
}
```

#### 3. initializeProvider() - 创建Provider实例
```typescript
private initializeProvider(providerName: string): ProviderHandler {
  // 获取 API Key
  const apiKey = this.getApiKey(providerName)
  if (!apiKey) {
    throw new ProviderError(
      `API key not found for provider: ${providerName}`,
      providerName,
      ProviderErrorCode.API_KEY_MISSING
    )
  }

  // 根据 provider 名称创建对应的实例
  switch (providerName) {
    case 'ppio':
      return new PPIOProvider(apiKey)
    case 'fal':
      return new FalProvider(apiKey)
    case 'kie':
      return new KIEProvider(apiKey)
    case 'modelscope':
      return new ModelscopeProvider(apiKey)
    default:
      throw new Error(`Unsupported provider: ${providerName}`)
  }
}
```

#### 4. API密钥管理

```typescript
// 获取API密钥
private getApiKey(provider: string): string | null {
  const key = localStorage.getItem(`${provider}_api_key`)
  return key
}

// 设置API密钥
setApiKey(provider: string, apiKey: string): void {
  localStorage.setItem(`${provider}_api_key`, apiKey)

  // 重新初始化对应的 Provider
  if (this.providers.has(provider)) {
    this.providers.delete(provider)
  }
}

// 验证API密钥
validateApiKey(provider: string): boolean {
  return !!this.getApiKey(provider)
}
```

#### 5. 错误处理

```typescript
private handleError(error: any, modelId: string): never {
  // 如果已经是 ProviderError，直接抛出
  if (error instanceof ProviderError) {
    console.error(`[GenerationService] Provider error for ${modelId}:`, error)
    throw error
  }

  // 包装为通用错误
  console.error(`[GenerationService] Error for ${modelId}:`, error)
  throw new Error(`Generation failed: ${error.message || String(error)}`)
}
```

#### 6. 便捷方法（可选）

```typescript
// 语义化的生成方法
async generateImage(modelId: string, params: Record<string, any>): Promise<GenerateResult> {
  return this.generate(modelId, params)
}

async generateVideo(modelId: string, params: Record<string, any>): Promise<GenerateResult> {
  return this.generate(modelId, params)
}

async generateAudio(modelId: string, params: Record<string, any>): Promise<GenerateResult> {
  return this.generate(modelId, params)
}
```

## 依赖导入

```typescript
import { ModelRegistry } from '@/core/ModelRegistry'
import { ProviderHandler, GenerateResult, ProgressStatus, ProviderError, ProviderErrorCode } from '@/core/providers/base'
import { PPIOProvider } from '@/core/providers/PPIOProvider'
import { FalProvider } from '@/core/providers/FalProvider'
import { KIEProvider } from '@/core/providers/KIEProvider'
import { ModelscopeProvider } from '@/core/providers/ModelscopeProvider'
```

## 实现步骤

1. 创建目录 `src/core/services/`
2. 创建 `GenerationService.ts` 文件
3. 实现单例模式
4. 实现 generate() 核心方法
5. 实现 Provider 管理（Map + 懒加载）
6. 实现 API 密钥管理
7. 实现错误处理
8. 添加便捷方法
9. 添加完整的 JSDoc 注释
10. TypeScript 编译验证

## 使用示例

```typescript
// 获取服务实例
const service = GenerationService.getInstance()

// 设置 API 密钥（首次使用）
service.setApiKey('ppio', 'your-ppio-api-key')
service.setApiKey('fal', 'your-fal-api-key')

// 生成内容
const result = await service.generate('kling-2.6-pro', {
  prompt: 'A beautiful sunset',
  ppioKling26VideoDuration: 10,
  ppioKling26AspectRatio: '16:9',
  ppioKling26CfgScale: 0.5
})

console.log('Result URL:', result.url)
console.log('Local path:', result.filePath)
```

## 验证标准
- [ ] 单例模式正确实现
- [ ] Provider 懒加载正确
- [ ] API 密钥管理正确
- [ ] 自动路由到正确的 Provider
- [ ] 错误处理完善
- [ ] TypeScript 编译无错误
- [ ] 所有方法都有 JSDoc 注释

## 预计工时
2-3小时

## 注意事项

1. **单例模式**
   - 全局只有一个实例
   - 在 constructor 中初始化空 Map
   - 不在构造函数中初始化 Provider（懒加载）

2. **Provider 缓存**
   - 使用 Map 缓存 Provider 实例
   - API 密钥变更时清除缓存
   - 避免重复创建实例

3. **错误信息**
   - 包含模型 ID
   - 包含 Provider 名称
   - 包含足够的调试信息

4. **暂不实现 Provider**
   - 此时 PPIOProvider、FalProvider 等还不存在
   - 可以先注释掉 switch 中的 case
   - 或者创建空的 Provider 类占位

## 完成标志
创建完成后，应该能这样使用：

```typescript
import { GenerationService } from '@/core/services/GenerationService'

const service = GenerationService.getInstance()

// 自动选择正确的 Provider
await service.generate('kling-2.6-pro', params) // → PPIOProvider
await service.generate('fal-ai-veo-3.1', params) // → FalProvider
await service.generate('kie-hailuo-2-3', params) // → KIEProvider
```
