# 1-1 创建ProviderHandler基类、接口定义、工具函数

## 目标
一次性创建完整的Provider基础架构，包括基类、类型定义和工具函数库。

## 文件结构
```
src/core/providers/
├── base/
│   ├── ProviderHandler.ts    # 抽象基类
│   ├── types.ts               # 类型定义
│   ├── errors.ts              # 错误类
│   ├── utils.ts               # 工具函数
│   └── index.ts               # 统一导出
```

## 实现内容

### 1. ProviderHandler.ts - 抽象基类

#### 核心方法
```typescript
export abstract class ProviderHandler {
  protected baseURL: string
  protected apiKey: string
  protected providerName: string

  constructor(providerName: string, baseURL: string, apiKey: string)

  // 主流程：模板方法模式
  async generate(model: ModelDefinition, params: Record<string, any>): Promise<GenerateResult>

  // 子类必须实现的抽象方法
  protected abstract preprocessRequest(model: ModelDefinition, params: Record<string, any>): Promise<Record<string, any>>
  protected abstract postprocessResponse(response: any, model: ModelDefinition): Promise<any>

  // 可覆盖的方法
  protected async execute(endpoint: string, data: any): Promise<any>
  protected async get(endpoint: string): Promise<any>

  // 通用工具方法
  protected async saveMedia(response: any, type: 'image' | 'video' | 'audio'): Promise<GenerateResult>
  protected async readLocalFile(path: string): Promise<Blob>
  protected blobToBase64(blob: Blob): Promise<string>
  protected dataURItoBlob(dataURI: string): Blob
  protected getFalApiKey(): string
  protected log(message: string, ...args: any[]): void
}
```

#### generate() 流程
```typescript
async generate(model: ModelDefinition, params: Record<string, any>) {
  // 1. 使用 RequestBuilder 构建请求
  const builder = new RequestBuilder()
  const request = builder.build(model.meta.id, params, { debug: true })

  // 2. 供应商特定的预处理（图片上传、格式转换等）
  const preprocessedParams = await this.preprocessRequest(model, {
    ...params,
    ...request.body
  })

  // 3. 执行 API 调用
  const response = await this.execute(request.url, preprocessedParams)

  // 4. 供应商特定的后处理（轮询等）
  const finalResponse = await this.postprocessResponse(response, model)

  // 5. 保存媒体文件到本地
  return this.saveMedia(finalResponse, model.meta.type)
}
```

### 2. types.ts - 类型定义

```typescript
// 生成结果
export interface GenerateResult {
  url: string
  filePath?: string
  taskId?: string
  status: 'completed' | 'timeout' | 'failed'
}

// 进度状态
export interface ProgressStatus {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'TASK_CREATED'
  queue_position?: number
  message?: string
  progress?: number
}

// Provider配置
export interface ProviderConfig {
  name: string
  baseURL: string
  apiKey: string
  timeout?: number
}

// 轮询配置
export interface PollingConfig {
  interval: number
  maxAttempts: number
  expectedAttempts?: number
}
```

### 3. errors.ts - 错误类

```typescript
export enum ProviderErrorCode {
  API_KEY_MISSING = 'API_KEY_MISSING',
  API_REQUEST_FAILED = 'API_REQUEST_FAILED',
  UPLOAD_FAILED = 'UPLOAD_FAILED',
  POLLING_TIMEOUT = 'POLLING_TIMEOUT',
  INVALID_RESPONSE = 'INVALID_RESPONSE',
  FILE_READ_FAILED = 'FILE_READ_FAILED'
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public provider: string,
    public code: ProviderErrorCode,
    public details?: any
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
```

### 4. utils.ts - 工具函数

```typescript
// 文件转换
export function dataURItoBlob(dataURI: string): Blob
export async function blobToDataURI(blob: Blob): Promise<string>

// 本地文件处理
export async function readLocalFile(path: string): Promise<Blob>
export function isLocalPath(path: string): boolean
export function normalizeFilePath(path: string): string

// URL处理
export function isDataURI(str: string): boolean
export function isRemoteURL(str: string): boolean
export function extractMimeType(source: string): string

// API密钥管理
export function getApiKey(provider: string): string | null
export function setApiKey(provider: string, apiKey: string): void

// 辅助函数
export function sleep(ms: number): Promise<void>
export async function retry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts: number; delay: number; onRetry?: (attempt: number) => void }
): Promise<T>
```

### 5. index.ts - 统一导出

```typescript
export * from './ProviderHandler'
export * from './types'
export * from './errors'
export * from './utils'
```

## 实现步骤

1. 创建目录结构 `src/core/providers/base/`
2. 实现 `types.ts` - 先定义类型
3. 实现 `errors.ts` - 定义错误类
4. 实现 `utils.ts` - 实现工具函数
5. 实现 `ProviderHandler.ts` - 实现基类
6. 实现 `index.ts` - 统一导出
7. TypeScript 编译验证

## 参考旧代码

### BaseAdapter 基类
- 位置：`old-Henji-AI/src/adapters/base/BaseAdapter.ts`
- 参考：saveMediaLocally、formatError、log 方法

### 文件处理逻辑
- 位置：`old-Henji-AI/src/adapters/ppio/PPIOAdapter.ts` 第39-82行
- 参考：resolveToBlobOrUrl 方法

### 工具函数
- 位置：`old-Henji-AI/src/utils/save.ts`
- 参考：文件保存逻辑

## 验证标准
- [ ] TypeScript 编译无错误
- [ ] 所有类型定义完整
- [ ] 所有方法都有 JSDoc 注释
- [ ] 工具函数单元测试通过（或手动验证）
- [ ] 基类的 generate() 流程清晰正确

## 预计工时
3-4小时

## 注意事项

1. **基类职责**
   - 只包含所有Provider共享的逻辑
   - 不包含任何供应商特定的代码
   - 保持方法简洁，职责单一

2. **类型安全**
   - 所有方法都有明确的类型定义
   - 使用泛型增强灵活性
   - 避免使用 any，优先使用 unknown

3. **错误处理**
   - 所有错误都使用 ProviderError
   - 错误信息要包含足够的调试信息
   - 错误码要清晰明确

4. **工具函数**
   - 处理 Tauri 的 asset:// 协议
   - 兼容 Windows 和 macOS 路径
   - 大文件处理要考虑性能

5. **导入依赖**
   - `@/core/ModelRegistry` - 获取模型定义
   - `@/core/request/RequestBuilder` - 构建请求
   - `@/utils/save` - 文件保存
   - `@tauri-apps/plugin-fs` - 本地文件读取

## 完成标志
创建完成后，应该能这样使用：

```typescript
import { ProviderHandler, GenerateResult, ProviderError } from '@/core/providers/base'

class MyProvider extends ProviderHandler {
  constructor(apiKey: string) {
    super('my-provider', 'https://api.example.com', apiKey)
  }

  protected async preprocessRequest(model, params) {
    // 自定义预处理
    return params
  }

  protected async postprocessResponse(response, model) {
    // 自定义后处理
    return response
  }
}
```
