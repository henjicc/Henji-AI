# KIE 适配器专用指南

---

## 统一参数命名规范

**所有 KIE 模型参数必须使用 `kie` 前缀**：

```
kie{ModelName}{ParameterName}
```

**示例**：
- `kieNanoBananaAspectRatio` - KIE Nano Banana 宽高比
- `kieNanoBananaResolution` - KIE Nano Banana 分辨率

**原因**：
- 避免与其他供应商的相同模型参数冲突（如 Fal 的 Nano Banana Pro）
- 确保预设功能正确保存和恢复参数
- 确保价格计算使用正确的参数值

---

## 核心特性与架构

### KIE 适配器的特点

| 特性 | KIE | Fal | PPIO |
|------|-----|-----|------|
| **图片上传** | 上传到 KIE CDN | 自动上传到 fal CDN | 使用 base64 |
| **轮询方式** | 手动轮询 | SDK 自动轮询 | 手动轮询 |
| **进度计算** | 基于轮询次数 | 基于轮询次数 | 基于时间或轮询次数 |
| **本地保存** | Adapter 内部处理 | App.tsx 统一处理 | Adapter 内部处理 |
| **API 结构** | 统一端点 | 模型特定端点 | 模型特定端点 |

### 关键设计原则

1. **统一任务端点**: 所有模型使用 `/api/v1/jobs/createTask` 创建任务
2. **统一状态查询**: 使用 `/api/v1/jobs/recordInfo` 查询任务状态
3. **图片需上传**: 图片必须先上传到 KIE CDN，然后传递 URL
4. **轮询进度**: 必须配置 `"type": "polling"` 和 `expectedPolls`
5. **智能匹配**: 智能选项始终显示，由用户手动选择
6. **本地保存**: 所有媒体调用 `saveMediaLocally` 并设置 `filePath`

---

## 完整适配流程

### 总览：8 个必须步骤

```
1. 定义参数 Schema (使用 kie 前缀)
2. 添加参数面板渲染
3. 添加状态管理 (使用 kie 前缀)
4. 注册参数映射
5. 添加 OptionsBuilder 配置
6. 创建模型路由 (adapters/kie/models/)
7. 配置轮询次数 (providers.json)
8. 配置价格 (pricing.ts)
```

---

## 步骤 1: 定义参数 Schema

**位置**: `src/models/kie-[model-id].ts`

```typescript
import { ParamDef } from '../types/schema'

export const kieYourModelParams: ParamDef[] = [
  // ⚠️ 参数 ID 必须使用 kie 前缀
  {
    id: 'kieYourModelAspectRatio',  // 使用 kie 前缀！
    type: 'dropdown',
    defaultValue: '1:1',
    resolutionConfig: {
      type: 'aspect_ratio',
      smartMatch: true,
      visualize: true,
      extractRatio: (value) => {
        if (value === 'smart') return null  // ⚠️ 只处理 'smart'
        const [w, h] = value.split(':').map(Number)
        return w / h
      },
      qualityOptions: [  // ⚠️ 统一面板：分辨率选项
        { value: '1K', label: '1K' },
        { value: '2K', label: '2K' },
        { value: '4K', label: '4K' }
      ],
      qualityKey: 'kieYourModelResolution'  // ⚠️ 分辨率参数名
    },
    options: [  // ⚠️ 智能选项始终显示
      { value: 'smart', label: '智能' },
      { value: '1:1', label: '1:1' },
      { value: '16:9', label: '16:9' },
      { value: '9:16', label: '9:16' }
    ],
    className: 'min-w-[100px]'
  }
]
```

**注册 Schema**: 在 `src/models/index.ts` 中：

```typescript
export { kieYourModelParams } from './kie-your-model'

export const modelSchemaMap: Record<string, ParamDef[]> = {
  'kie-your-model': kieYourModelParams,
  'your-model-kie': kieYourModelParams  // 支持别名
}
```

---

## 步骤 2-4: 参数面板、状态管理、参数映射

参考 [ai-guide-new-model.md](./ai-guide-new-model.md) 的步骤 2-4，使用 `kie` 前缀的参数名。

---

## 已实现的模型

### Nano Banana Pro

**模型 ID**: `kie-nano-banana-pro` (别名: `nano-banana-pro-kie`)

**类型**: 图片生成

**参数**:
- `kieNanoBananaAspectRatio`: 宽高比 + 分辨率统一面板 (默认: 宽高比 'smart', 分辨率 '2K')
  - 宽高比选项: 'smart', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'
  - 分辨率选项: '1K', '2K', '4K'

**功能**:
- 文生图
- 图生图 (最多 8 张图片)
- 智能宽高比匹配

**预估轮询次数**: 30 次 (约 1.5 分钟)

---

## 实现架构

### 1. 适配器结构

```
src/adapters/kie/
├── KIEAdapter.ts           # 主适配器类
├── config.ts               # API 配置
├── models/
│   ├── index.ts           # 路由注册
│   └── nano-banana-pro.ts # Nano Banana Pro 路由
└── parsers/
    ├── index.ts
    └── imageParser.ts     # 图片响应解析
```

### 2. 核心文件说明

#### KIEAdapter.ts

主适配器类，继承 `BaseAdapter`，实现:
- `generateImage()`: 图片生成方法
- `uploadImageToKIE()`: 上传图片到 KIE CDN
- `checkStatus()`: 查询任务状态
- `pollTaskStatus()`: 轮询任务直到完成

**关键实现**:
```typescript
async generateImage(params: GenerateImageParams): Promise<ImageResult> {
  // 1. 上传图片到 KIE CDN
  let uploadedImageUrls: string[] = []
  if (params.images && params.images.length > 0) {
    uploadedImageUrls = await Promise.all(
      params.images.map(img => this.uploadImageToKIE(img))
    )
  }

  // 2. 构建请求（传入上传后的 URL）
  const { requestData } = route.buildImageRequest({
    ...params,
    images: uploadedImageUrls
  })

  // 3. 创建任务
  const response = await this.apiClient.post(
    KIE_CONFIG.createTaskEndpoint,
    requestData
  )

  // 4. 轮询或返回 taskId
  if (params.onProgress) {
    return await this.pollTaskStatus(taskId, params.model, params.onProgress)
  }
  return { taskId, status: 'QUEUED' }
}
```

#### models/nano-banana-pro.ts

模型路由，定义如何构建 API 请求:

```typescript
export const kieNanoBananaProRoute: KIEModelRoute = {
  matches: (modelId: string) =>
    modelId === 'kie-nano-banana-pro' ||
    modelId === 'nano-banana-pro-kie',

  buildImageRequest: (params: GenerateImageParams) => {
    const images = params.images || []  // 已上传到 CDN 的 URL
    const requestData: any = {
      model: 'nano-banana-pro',
      input: {
        prompt: params.prompt
      }
    }

    // 添加可选参数
    if (params.aspect_ratio &&
        params.aspect_ratio !== 'smart') {  // ⚠️ 只过滤 'smart'
      requestData.input.aspect_ratio = params.aspect_ratio
    }

    if (params.resolution) {
      requestData.input.resolution = params.resolution
    }

    // ⚠️ output_format 已移除，API 使用默认值

    // 图生图时添加图片 URL
    if (images.length > 0) {
      requestData.input.image_input = images
    }

    return { requestData }
  }
}
```

#### parsers/imageParser.ts

解析 KIE API 响应并保存到本地:

```typescript
export const parseImageResponse = async (
  responseData: any,
  adapter: KIEAdapter
): Promise<ImageResult> => {
  // KIE 返回格式: { resultUrls: ["url1", "url2", ...] }
  if (responseData.resultUrls && Array.isArray(responseData.resultUrls)) {
    const urls = responseData.resultUrls

    // 保存所有图片到本地
    const savedResults = await Promise.all(
      urls.map(url => adapter['saveMediaLocally'](url, 'image'))
    )

    // 单图返回
    if (savedResults.length === 1) {
      return {
        url: savedResults[0].url,
        filePath: savedResults[0].filePath,  // ⚠️ 必须设置
        status: 'COMPLETED'
      }
    }

    // 多图用 ||| 分隔
    return {
      url: savedResults.map(r => r.url).join('|||'),
      filePath: savedResults.map(r => r.filePath).join('|||'),
      status: 'COMPLETED'
    }
  }

  throw new Error('API 未返回图片 URL')
}
```

### 3. 参数配置

#### 参数 Schema (`src/models/kie-nano-banana-pro.ts`)

```typescript
export const kieNanoBananaProParams: ParamDef[] = [
  {
    id: 'kieNanoBananaAspectRatio',  // ⚠️ 使用 kie 前缀
    type: 'dropdown',
    defaultValue: '1:1',
    resolutionConfig: {
      type: 'aspect_ratio',
      smartMatch: true,
      visualize: true,
      extractRatio: (value) => {
        if (value === 'smart') return null  // ⚠️ 只处理 'smart'
        const [w, h] = value.split(':').map(Number)
        return w / h
      },
      qualityOptions: [  // ⚠️ 统一面板：分辨率选项
        { value: '1K', label: '1K' },
        { value: '2K', label: '2K' },
        { value: '4K', label: '4K' }
      ],
      qualityKey: 'kieNanoBananaResolution'  // ⚠️ 分辨率参数名
    },
    options: [  // ⚠️ 智能选项始终显示
      { value: 'smart', label: '智能' },
      { value: '1:1', label: '1:1' },
      { value: '2:3', label: '2:3' },
      { value: '3:2', label: '3:2' },
      { value: '3:4', label: '3:4' },
      { value: '4:3', label: '4:3' },
      { value: '4:5', label: '4:5' },
      { value: '5:4', label: '5:4' },
      { value: '9:16', label: '9:16' },
      { value: '16:9', label: '16:9' },
      { value: '21:9', label: '21:9' }
    ],
    className: 'min-w-[100px]'
  }
  // ⚠️ 注意：分辨率和输出格式参数已移除
  // 分辨率通过 resolutionConfig.qualityOptions 配置
  // 输出格式使用 API 默认值
]
```

**关键变化**：
1. **统一面板模式**：使用 `resolutionConfig.qualityOptions` 和 `qualityKey` 将分辨率集成到宽高比面板
2. **智能选项始终显示**：不再使用动态 options 函数和 autoSwitch
3. **移除独立参数**：分辨率和输出格式不再是独立的参数定义
4. **智能匹配逻辑**：由 `handleSmartMatch` 函数自动处理（无图片时使用 1:1，有图片时匹配图片宽高比）

#### OptionsBuilder 配置 (`src/components/MediaGenerator/builders/configs/kie-models.ts`)

```typescript
export const kieNanoBananaProConfig: ModelConfig = {
  id: 'kie-nano-banana-pro',
  type: 'image',
  provider: 'kie',

  paramMapping: {
    aspect_ratio: {
      source: ['kieNanoBananaAspectRatio', 'aspectRatio'],
      defaultValue: '1:1'
    },
    resolution: {
      source: ['kieNanoBananaResolution', 'resolution'],
      defaultValue: '2K'  // ⚠️ 默认值改为 2K
    }
    // ⚠️ output_format 已移除，使用 API 默认值
  },

  features: {
    smartMatch: {
      enabled: true,
      paramKey: 'aspect_ratio',
      defaultRatio: '1:1'  // ⚠️ 无图片时使用此默认值
    },
    imageUpload: {
      enabled: true,
      maxImages: 8,  // KIE 支持最多 8 张图片
      mode: 'multiple',
      paramKey: 'image_input',
      convertToBlob: false  // KIE 适配器会处理上传
    }
  },

  customHandlers: kieImageUploadHandler
}
```

### 4. 状态管理

所有参数都需要在以下位置注册:

1. **useMediaGeneratorState.ts**: 添加状态变量
2. **ParameterPanel.tsx**: 添加渲染分支
3. **MediaGenerator/index.tsx**: 在 `handleSchemaChange` 中注册
4. **presetStateMapping.ts**: 添加预设映射

### 5. 适配器注册

**src/adapters/index.ts**:
```typescript
import { KIEAdapter } from './kie/KIEAdapter'

export type AdapterType = 'piaoyun' | 'fal' | 'modelscope' | 'kie' | ...

export class AdapterFactory {
  static createAdapter(config: AdapterConfig): MediaGeneratorAdapter {
    switch (config.type) {
      case 'kie':
        return new KIEAdapter(config.apiKey)
      // ...
    }
  }
}
```

### 6. providers.json 配置

```json
{
  "id": "kie",
  "name": "KIE",
  "type": "multi",
  "models": [
    {
      "id": "kie-nano-banana-pro",
      "name": "Nano Banana Pro",
      "type": "image",
      "description": "基于 Nano Banana Pro 模型的图像生成，支持图生图",
      "functions": ["图片生成", "图片编辑"],
      "progressConfig": {
        "type": "polling",
        "expectedPolls": 30
      }
    }
  ]
}
```

---

## 添加新模型

### 快速步骤

1. **创建模型路由** (`src/adapters/kie/models/[model-id].ts`)
2. **定义参数 Schema** (`src/models/kie-[model-id].ts`)
3. **添加 OptionsBuilder 配置** (`src/components/MediaGenerator/builders/configs/kie-models.ts`)
4. **注册参数映射** (ParameterPanel, useMediaGeneratorState, handleSchemaChange, presetStateMapping)
5. **配置 providers.json**
6. **配置价格** (`src/config/pricing.ts`)

### 详细指南

参考 [ai-guide-new-model.md](./ai-guide-new-model.md) 了解完整的模型添加流程。

---

## API Key 配置

### 添加 API Key 输入

**位置**: `src/components/SettingsModal.tsx`

需要添加:
1. 状态变量: `const [kieApiKey, setKieApiKey] = useState('')`
2. 显示状态: `const [showKieApiKey, setShowKieApiKey] = useState(false)`
3. 初始化: 从 localStorage 读取 `kie_api_key`
4. 处理函数: `handleKieApiKeyChange`
5. UI 输入框

**示例代码**:
```typescript
// 状态变量
const [kieApiKey, setKieApiKey] = useState('')
const [showKieApiKey, setShowKieApiKey] = useState(false)

// 初始化
useEffect(() => {
  const savedKieApiKey = localStorage.getItem('kie_api_key') || ''
  setKieApiKey(savedKieApiKey)
}, [])

// 处理函数
const handleKieApiKeyChange = (value: string) => {
  setKieApiKey(value)
  localStorage.setItem('kie_api_key', value)
}

// UI 输入框（在 API 标签页中）
<div className="space-y-2">
  <label className="text-sm font-medium">KIE API Key</label>
  <div className="relative">
    <input
      type={showKieApiKey ? 'text' : 'password'}
      value={kieApiKey}
      onChange={(e) => handleKieApiKeyChange(e.target.value)}
      className="w-full px-3 py-2 border rounded-lg pr-10"
      placeholder="输入 KIE API Key"
    />
    <button
      onClick={() => setShowKieApiKey(!showKieApiKey)}
      className="absolute right-2 top-1/2 -translate-y-1/2"
    >
      {showKieApiKey ? '隐藏' : '显示'}
    </button>
  </div>
</div>
```

---

## 价格配置

### 添加价格计算

**位置**: `src/config/pricing.ts`

```typescript
{
  providerId: 'kie',
  modelId: 'kie-nano-banana-pro',
  currency: '¥',
  type: 'calculated',
  calculator: (params) => {
    // ⚠️ 使用 kie 前缀的参数名，并提供回退
    const resolution = params.kieNanoBananaResolution
                    || params.resolution
                    || '1K'
    const hasImage = params.uploadedImages?.length > 0

    // 根据分辨率和是否有图片计算价格
    let basePrice = 0.1  // 基础价格

    if (resolution === '2K') {
      basePrice = 0.2
    } else if (resolution === '4K') {
      basePrice = 0.4
    }

    // 图生图可能有额外费用
    if (hasImage) {
      basePrice *= 1.5
    }

    return basePrice
  }
}
```

---

## 常见问题

### 1. 图片上传失败

**问题**: 图片上传到 KIE CDN 失败

**解决方案**:
- 检查 API Key 是否正确
- 检查图片格式是否支持 (JPEG, PNG, WebP)
- 检查图片大小是否超过 30MB
- 查看控制台错误信息

### 2. 任务轮询超时

**问题**: 任务轮询超过最大次数仍未完成

**解决方案**:
- 增加 `maxPollAttempts` 配置
- 检查 KIE API 状态
- 查看任务是否失败 (`failMsg`)

### 3. 参数未生效

**问题**: 修改参数后生成结果未变化

**解决方案**:
- 检查参数是否在所有位置正确注册
- 检查 OptionsBuilder 配置的 paramMapping
- 检查模型路由是否正确使用参数
- 使用浏览器开发工具查看实际发送的请求

### 4. 智能匹配不工作

**问题**: 智能宽高比不生效

**解决方案**:
- 检查 resolutionConfig 配置（smartMatch: true）
- 检查 OptionsBuilder 的 smartMatch 配置（enabled: true, paramKey, defaultRatio）
- 确认 uploadedImages 正确传递
- 查看控制台智能匹配日志：`[Smart Match] Matched ratio: ...`
- **注意**：不要使用 autoSwitch，智能匹配由用户手动选择"智能"选项触发

---

## 最佳实践

### 1. 参数命名

**始终使用供应商前缀**:
```typescript
// ✅ 正确
kieNanoBananaAspectRatio
kieNanoBananaResolution

// ❌ 错误
aspectRatio  // 会与其他供应商冲突
resolution
```

### 2. 错误处理

**使用 try-catch 并提供友好的错误信息**:
```typescript
try {
  const result = await this.generateImage(params)
  return result
} catch (error) {
  throw this.handleError(error)  // 使用 BaseAdapter 的错误处理
}
```

### 3. 本地保存

**所有媒体必须保存到本地并设置 filePath**:
```typescript
const savedResult = await adapter['saveMediaLocally'](url, 'image')
return {
  url: savedResult.url,
  filePath: savedResult.filePath,  // ⚠️ 必须设置
  status: 'COMPLETED'
}
```

### 4. 智能匹配

**永远不要传递 'smart' 给 API**:
```typescript
// 在模型路由中过滤
if (params.aspect_ratio !== 'smart') {
  requestData.input.aspect_ratio = params.aspect_ratio
}
```

**智能匹配的正确实现方式**:
- ✅ 智能选项始终显示在参数列表中
- ✅ 不使用 autoSwitch 自动切换
- ✅ 由用户手动选择"智能"选项
- ✅ handleSmartMatch 函数自动处理：无图片时使用 defaultRatio，有图片时匹配图片宽高比
- ❌ 不要使用动态 options 函数根据是否有图片显示/隐藏智能选项
- ❌ 不要使用 autoSwitch 在上传图片时自动切换到智能选项

### 5. 统一面板模式

**使用 resolutionConfig 合并相关参数**:
```typescript
{
  id: 'kieNanoBananaAspectRatio',
  type: 'dropdown',
  resolutionConfig: {
    type: 'aspect_ratio',
    smartMatch: true,
    visualize: true,
    qualityOptions: [  // 分辨率选项
      { value: '1K', label: '1K' },
      { value: '2K', label: '2K' },
      { value: '4K', label: '4K' }
    ],
    qualityKey: 'kieNanoBananaResolution'  // 分辨率参数名
  }
}
```

**优势**:
- 减少参数数量，界面更简洁
- 相关参数集中在一个面板，用户体验更好
- 与 fal 等其他供应商保持一致的 UI 模式

### 6. API 响应格式处理

**使用 fallback 字段处理 API 响应不一致**:
```typescript
// API 文档说返回 fileUrl，但实际可能返回 downloadUrl
const fileUrl = uploadResponse.data.data.fileUrl || uploadResponse.data.data.downloadUrl

if (!fileUrl) {
  throw new Error('上传响应中未找到文件 URL')
}
```

**经验**:
- API 文档可能与实际实现不一致
- 添加详细的日志输出实际响应结构
- 使用 fallback 字段提高兼容性

---

## 参考资料

- [KIE API 文档](./api/KIE/)
- [添加新供应商指南](./ai-guide-new-provider.md)
- [添加新模型指南](./ai-guide-new-model.md)
- [Fal 适配器指南](./ai-guide-fal.md)

---

## 更新日志

### 2025-12-11
- ✅ **统一分辨率面板**：将宽高比和分辨率合并为一个面板，使用 resolutionConfig 模式
- ✅ **优化智能匹配逻辑**：
  - 移除 "auto" 选项，只保留 "smart"
  - 智能选项始终显示，不再动态显示/隐藏
  - 移除 autoSwitch 配置，由用户手动选择
  - handleSmartMatch 自动处理：无图片时使用 1:1，有图片时匹配图片宽高比
- ✅ **参数调整**：
  - 质量默认值从 1K 改为 2K
  - 移除输出格式参数，使用 API 默认值
- ✅ **修复 API 响应格式问题**：使用 fileUrl || downloadUrl fallback 处理
- ✅ **完善文档**：添加统一面板模式、智能匹配最佳实践、API 响应处理经验

### 2025-12-10
- ✅ 创建 KIE 适配器基础架构
- ✅ 实现 Nano Banana Pro 模型
- ✅ 添加参数 Schema 和 OptionsBuilder 配置
- ✅ 注册适配器到工厂
- ✅ 配置 providers.json
- ✅ 创建 KIE 适配指南文档
- ✅ 添加 KIE API Key 输入到 SettingsModal
- ✅ 配置 Nano Banana Pro 价格（1K/2K: ¥0.64, 4K: ¥0.85）
- ✅ 添加轮询日志输出
- ✅ 修复 history.json 重复警告问题

---

## 待办事项

- [x] 添加 KIE API Key 输入到 SettingsModal
- [x] 配置 Nano Banana Pro 价格
- [x] 统一分辨率面板
- [x] 优化智能匹配逻辑
- [ ] 添加 Tauri 权限配置（如需要）
- [ ] 测试完整流程
- [ ] 添加更多 KIE 模型

---

## 联系与支持

如有问题或建议，请参考项目文档或提交 Issue。
