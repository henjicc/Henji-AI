# 模型与供应商适配指南

本文档旨在指导开发者（以及 AI 编程助手）如何为 Henji AI 添加新的模型供应商（Provider）或接入新的模型（Model）。

> **⚠️ 核心原则：以官方 API 文档为准**
>
> 本指南中提到的参数名称（如 `resolution`, `prompt`）仅作为通用示例。在实际适配过程中，**必须严格参照模型供应商的官方 API 文档**来定义参数和构造请求。不要盲目照搬本指南中的示例代码。
>
> **文档可能有误！** 遇到 422/400 等参数错误时，以实际 API 行为为准，不要完全相信文档。

## 核心架构概述

Henji AI 的模型适配分为前端和后端两个部分：

1.  **前端 (Frontend)**:
    *   **配置**: `src/config/providers.json` 定义供应商和模型列表。
    *   **Schema**: `src/schemas/modelParams.ts` 定义模型的参数表单结构（Schema-Driven UI）。
    *   **UI**: `MediaGenerator.tsx` 根据 Schema 渲染表单，收集用户输入。

2.  **后端/适配层 (Adapter Layer)**:
    *   **接口**: `src/adapters/base/BaseAdapter.ts` 定义统一的 `MediaGeneratorAdapter` 接口。
    *   **实现**: 具体适配器（如 `PPIOAdapter.ts`）实现接口，负责参数转换、API 调用和结果标准化。
    *   **工厂**: `src/adapters/index.ts` 负责实例化适配器。

---

## 接入流程

### 1. 添加新供应商 (Provider)

如果要接入一个新的 API 服务商

1.  **定义适配器**:
    *   在 `src/adapters/` 下创建新的适配器文件。
    *   实现 `MediaGeneratorAdapter` 接口。
    *   **⚠️ 注意**: 在适配器中做好**参数过滤**，API 文档中标注的某些值可能实际不被接受。

2.  **注册适配器**:
    *   修改 `src/adapters/index.ts`，在 `AdapterType` 中添加新类型。
    *   在工厂方法的 `switch` 语句中添加实例化逻辑。

3.  **配置供应商**:
    *   修改 `src/config/providers.json`，添加供应商和模型配置。

4.  **配置 API 密钥**:
    *   在 `src/components/SettingsModal.tsx` 中添加 API Key 输入框。
    *   使用 `localStorage` 保存，Key 格式：`{provider_id}_api_key`。

5.  **⚠️ 动态适配器初始化**:
    *   确保 `App.tsx` 的 `handleGenerate` 中有**动态适配器初始化逻辑**。
    *   不要硬编码只使用一个适配器。

6.  **Tauri 权限配置**（桌面应用）:
    *   在 `src-tauri/capabilities/default.json` 中添加新 CDN 域名到三个 HTTP 权限块。
    *   **必须重启应用**才能生效。

### 2. 添加新模型 (Model)

#### 模型分类规范 🏷️

添加新模型时，必须在 `src/config/providers.json` 中正确配置以下三个维度的分类：

1. **供应商 (Provider)**: 模型所属的 API 服务商
   - 例如：`piaoyun`, `fal`
   - 如果是新供应商，需要先按照「添加新供应商」流程进行配置

2. **类型 (Type)**: 模型的媒体类型
   - 必选值：`image` | `video` | `audio`
   - 这决定了模型在 UI 中的基础筛选分类

3. **功能 (Functions)**: 模型支持的具体功能（数组）
   - **图片模型**可选值：`图片生成`, `图片编辑`
   - **视频模型**可选值：`文生视频`, `图生视频`, `首尾帧`, `参考生视频`
   - **音频模型**可选值：`语音合成`
   - 一个模型可以有多个功能标签

**配置示例**：
```json
{
  "id": "your-model",
  "name": "Your Model Name",
  "type": "video",
  "description": "模型描述",
  "functions": ["文生视频", "图生视频", "首尾帧"]
}
```

> **⚠️ 重要**: 功能标签会影响用户在模型选择面板中的筛选体验，请根据模型的实际能力准确配置。如果未来需要添加新的功能类型，需要同时更新 `MediaGenerator.tsx` 中的功能筛选器选项列表。

#### 通用原则：功能合并与智能路由

**重要原则**：不要因为同一个模型提供了不同的 API 端点（如 Text-to-Image 和 Image-to-Image）就在 UI 上拆分成两个模型选项。

*   **正确做法**：只列出一个模型选项。
    *   **前端**：Schema 中不区分模式，而是根据用户是否上传了图片来动态显示/隐藏相关参数。
    *   **后端 (Adapter)**：在 `generateImage` 或 `generateVideo` 方法中，检查 `params.images` 是否存在，从而智能路由到正确的 API 端点。

#### 各类型模型适配指南

请依据API文档自动判断模型类型

##### 🖼️ 图片模型 (Image Models)

*   **参数定义**: 根据 API 文档定义参数（如宽高比、采样器、步数等）。
*   **适配重点**:
    *   **图生图**: 检查 `params.images`。注意 API 对图片格式的要求（URL vs Base64）。
    *   **参数映射**: 将前端通用参数映射为 API 特定参数。
    *   **⚠️ 检查硬编码**: `MediaGenerator.tsx` 中有针对所有 `image` 类型的硬编码逻辑（如分辨率选择器），需要排除不适用的模型。

##### 🎥 视频模型 (Video Models)

*   **参数定义**: 常见参数有 `duration`, `aspect_ratio`, `camera_motion` 等。
*   **适配重点**:
    *   **智能路由**: 根据输入图片数量（0=文生视频, 1=图生视频, 2=首尾帧）选择接口。
    *   **结果查询**:
        *   **异步轮询**: 大多数视频 API 需要轮询。返回 `taskId` 并实现 `checkStatus`。
        *   **同步/其他**: 如果 API 是同步返回或使用 WebSocket，请根据实际情况实现，不强制要求轮询。

##### 🔊 音频模型 (Audio Models)

*   **参数定义**: `text`, `voice_id`, `speed` 等。
*   **适配重点**:
    *   **音色处理**: 如果音色列表过长，考虑特殊的 UI 处理。
    *   **结果处理**: 处理同步返回的二进制流或 URL，或者异步任务 ID。

---

## UI 组件与 Schema 规范

### 推荐：使用通用组件 (Schema-Driven)

我们强烈建议使用 `src/schemas/modelParams.ts` 定义参数，由 `SchemaForm` 自动渲染 UI。

### 慎用：特殊面板 (Custom Panels)

虽然系统支持自定义面板，但应**尽量避免使用**，除非遇到 Schema 无法解决的极端复杂交互。

**现有参考示例**（可在代码中搜索参考）：
*   **即梦分辨率选择器**: 复杂的自定义分辨率 UI。
*   **Minimax Speech 音色**: 带有分类和搜索的大型音色选择器。
*   **Minimax Speech 高级选项**: 复杂的参数组合面板。

### Schema 高级特性

1.  **动态可见性 (`hidden`)**:
    ```typescript
    hidden: (values) => values.sequential_image_generation !== 'auto'
    ```

2.  **动态选项 (`options`)** 🌟 重要：
    ```typescript
    // 根据上传图片数量动态调整选项
    options: (values) => {
      const baseOptions = [
        { value: '1:1', label: '1:1' },
        { value: '16:9', label: '16:9' },
        // ...
      ]
      
      // 图生图时添加 auto 选项
      if (values.uploadedImages && values.uploadedImages.length > 0) {
        return [{ value: 'auto', label: '自动' }, ...baseOptions]
      }
      
      return baseOptions
    }
    ```
    
    **配合 useEffect 切换默认值**:
    ```typescript
    // 在 MediaGenerator.tsx 中
    useEffect(() => {
      if (selectedModel === 'your-model') {
        if (uploadedImages.length > 0) {
          setAspectRatio('auto')  // 图生图模式
        } else if (aspectRatio === 'auto') {
          setAspectRatio('1:1')   // 文生图模式
        }
      }
    }, [uploadedImages.length, selectedModel])
    ```

3.  **值转换 (`toValue` / `fromValue`)**:
    用于 `toggle` 类型，当 UI 状态 (boolean) 与实际参数值 (string/number) 不一致时使用。

4.  **工具提示 (`tooltip`)**:
    *   **默认策略**: **不要主动添加 Tooltip**，除非参数含义非常晦涩难懂且对用户至关重要。保持界面简洁。

---

## 💰 价格配置指南

### 概述

Henji AI 集成了实时价格估算功能，显示在生成面板的右下角。为新模型配置价格是可选的，但强烈建议配置以提供更好的用户体验。

### 价格配置结构

价格配置位于 `src/config/pricing.ts`，采用 **Provider + Model ID** 双重标识来支持"同一模型在不同供应商下价格不同"的场景。

#### PricingConfig 接口

```typescript
interface PricingConfig {
  providerId: string    // 供应商 ID（如 'piaoyun', 'fal'）
  modelId: string       // 模型 ID（如 'seedream-4.0'）
  currency: '¥' | '$'   // 货币符号（统一使用人民币 ¥）
  type: 'fixed' | 'calculated'  // 价格类型
  
  // 固定价格字段
  fixedPrice?: number   // 固定价格（如 0.2）
  unit?: string         // 单位（可选，目前不显示）
  
  // 动态计算字段
  calculator?: (params: any) => number | { min: number; max: number }
}
```

### 配置步骤

#### 1. 固定价格模型（推荐用于简单计费）

**适用场景**: 价格不随参数变化的模型（如图片生成固定单价）

**配置示例**:
```typescript
{
  providerId: 'piaoyun',
  modelId: 'seedream-4.0',
  currency: '¥',
  type: 'fixed',
  fixedPrice: 0.2
}
```

**显示效果**: `预估: ¥0.2`

#### 2. 动态计价模型（用于复杂计费）

**适用场景**: 价格随时长、分辨率、模式等参数变化

##### 示例 1: 按图片数量计费

```typescript
{
  providerId: 'fal',
  modelId: 'nano-banana',
  currency: '¥',
  type: 'calculated',
  calculator: (params) => {
    const numImages = params.num_images || 1
    return 0.2775 * numImages
  }
}
```

##### 示例 2: 按时长分级计费

```typescript
{
  providerId: 'piaoyun',
  modelId: 'kling-2.5-turbo',
  currency: '¥',
  type: 'calculated',
  calculator: (params) => {
    const duration = params.videoDuration || 5
    return duration === 10 ? 5 : 2.5
  }
}
```

##### 示例 3: 多维度计费（分辨率 + 时长 + 模式）

```typescript
{
  providerId: 'piaoyun',
  modelId: 'minimax-hailuo-2.3',
  currency: '¥',
  type: 'calculated',
  calculator: (params) => {
    const hasImage = params.uploadedImages?.length > 0
    const duration = params.videoDuration || 6
    const resolution = (params.videoResolution || '768p') as '768p' | '1080p'
    const isFast = params.hailuoFastMode
    
    // 根据不同条件组合返回不同价格
    let priceTable
    if (hasImage && isFast) {
      priceTable = HAILUO_FAST_IMAGE_PRICES
    } else if (hasImage) {
      priceTable = HAILUO_IMAGE_PRICES
    } else {
      priceTable = HAILUO_TEXT_PRICES
    }
    
    return priceTable[resolution]?.[duration] || 0
  }
}
```

##### 示例 4: 按字符数计费（音频模型）

```typescript
{
  providerId: 'piaoyun',
  modelId: 'minimax-speech-2.6',
  currency: '¥',
  type: 'calculated',
  calculator: (params) => {
    const textLength = params.input?.length || 0
    const charsIn10k = textLength / 10000
    const pricePerChar = params.audioSpec === 'audio-pro' ? 3.5 : 2
    return charsIn10k * pricePerChar
  }
}
```

### 参数传递

**关键**: `calculator` 函数接收的 `params` 来自 `MediaGenerator.tsx` 中传递给 `PriceEstimate` 组件的参数对象。

#### 需要确保传递的参数

在 `MediaGenerator.tsx` 的 `PriceEstimate` 组件中，确保传递计算所需的所有参数：

```typescript
<PriceEstimate
  providerId={selectedProvider}
  modelId={selectedModel}
  params={{
    // 图片参数
    num_images: numImages,
    uploadedImages,
    
    // 视频参数
    videoDuration,
    videoResolution,
    viduMode,
    hailuoFastMode,
    pixFastMode,
    seedanceVariant,
    seedanceResolution,
    seedanceAspectRatio,  // 如需按宽高比计费
    wanResolution,
    
    // 音频参数
    input,  // 文本内容
    audioSpec
  }}
/>
```

⚠️ **重要**: 如果新增了影响价格的参数，必须在此处添加传递。

### 价格常量管理

为了便于批量调整价格，建议在 `pricing.ts` 的 `PRICES` 常量中集中管理：

```typescript
const PRICES = {
  // 图片
  SEEDREAM: 0.2,
  NANO_BANANA: 0.2775,
  
  // 视频 - 分级定价
  KLING: {
    5: 2.5,
    10: 5
  },
  
  // 复杂嵌套定价
  HAILUO_23: {
    text: {
      '768p': { 6: 2, 10: 4 },
      '1080p': { 6: 3.5, 10: 0 }
    },
    // ...
  }
} as const
```

### 价格显示格式

- **自动格式化**: 价格会自动去除尾部的 0（`0.20` → `0.2`）
- **小数精度**: 
  - 价格 < 1 元: 最多 4 位小数
  - 价格 ≥ 1 元: 最多 2 位小数
- **单位显示**: 单位信息不会显示给用户，但仍可配置以便未来扩展

### 常见计费模式

#### 1. 阶梯计费

```typescript
calculator: (params) => {
  const duration = params.videoDuration || 5
  if (duration <= 5) return 2.5
  if (duration <= 10) return 5
  return 10
}
```

#### 2. 组合计费（分辨率 × 时长）

```typescript
const PRICE_TABLE = {
  '480p': { 5: 1.5, 10: 3 },
  '720p': { 5: 3, 10: 6 },
  '1080p': { 5: 5, 10: 10 }
}

calculator: (params) => {
  const duration = params.videoDuration || 5
  const resolution = params.videoResolution || '720p'
  return PRICE_TABLE[resolution]?.[duration] || 0
}
```

#### 3. 模式切换计费

```typescript
calculator: (params) => {
  const isFastMode = params.fastMode
  const basePrice = 2.5
  return isFastMode ? basePrice * 2 : basePrice
}
```

### 注意事项

1. **唯一性**: `providerId` + `modelId` 的组合必须唯一
2. **货币统一**: 目前统一使用人民币 `¥`
3. **空值处理**: 在 `calculator` 中使用 `||` 提供默认值，避免计算错误
4. **类型断言**: 对于枚举类型的参数，使用 TypeScript 类型断言确保类型安全
5. **返回值**: 可以返回单个数字，或 `{ min: number; max: number }` 表示价格范围
6. **零值**: 返回 `0` 表示该参数组合下不支持（会显示为 ¥0）
7. **无配置**: 如果模型没有配置价格，价格估算不会显示

### 调试技巧

如果价格显示不正确，检查：
1. `providerId` 和 `modelId` 是否与 `providers.json` 中的一致
2. `calculator` 函数中的参数名是否与 `MediaGenerator.tsx` 传递的一致
3. 在 `calculator` 中添加 `console.log(params)` 查看实际传入的参数
4. 检查是否有类型转换问题（如字符串 vs 数字）

---

## 📊 进度条配置指南

### 概述

Henji AI 集成了统一的进度条系统，为用户提供实时的任务进度反馈。所有模型都应配置进度信息以提供更好的用户体验。

### 进度条架构

#### 核心组件

1. **UI 组件**: `src/components/ui/ProgressBar.tsx`
   - 纯展示组件，接收 `progress` (0-100) 并渲染进度条
   - 支持自定义颜色、高度、动画时长

2. **进度计算工具**: `src/utils/progress.ts`
   - `calculateProgress(current, expected)`: 渐近式进度计算
   - 预期范围内：快速增长到 95%
   - 超过预期：缓慢逼近 99%（永不卡死）

3. **轮询工具**: `src/utils/polling.ts`
   - `pollUntilComplete()`: 通用异步任务轮询
   - 自动集成 `calculateProgress` 进度计算
   - 支持自定义轮询间隔、最大次数、完成/失败判断

4. **模型配置工具**: `src/utils/modelConfig.ts`
   - `getProgressConfig(modelId)`: 获取模型的进度配置
   - `getExpectedPolls(modelId)`: 获取预期轮询次数
   - `getExpectedDuration(modelId)`: 获取预期耗时

### 配置步骤

#### 1. 在 `providers.json` 中添加 `progressConfig`

每个模型应根据其实际特性配置进度类型：

##### 异步轮询模型（视频生成）

**适用场景**: API 返回 `taskId`，需要轮询查询结果

```json
{
  "id": "vidu-q1",
  "name": "Vidu Q1",
  "type": "video",
  "description": "...",
  "functions": ["文生视频", "图生视频"],
  "progressConfig": {
    "type": "polling",
    "expectedPolls": 60
  }
}
```

**参数说明**:
- `type: "polling"`: 基于轮询次数的进度
- `expectedPolls`: 预期轮询次数（用于进度计算）
  - 快速模型（如 minimax-hailuo-2.3）: 20-30
  - 中速模型（如 kling-2.5）: 30-40
  - 慢速模型（如 vidu-q1）: 50-60

##### 同步时间模型（快速图片生成）

**适用场景**: API 同步返回结果，但耗时较长（>5秒）

```json
{
  "id": "seedream-4.0",
  "name": "即梦图片生成 4.0",
  "type": "image",
  "description": "...",
  "functions": ["图片生成", "图片编辑"],
  "progressConfig": {
    "type": "time",
    "expectedDuration": 20000
  }
}
```

**参数说明**:
- `type: "time"`: 基于时间的进度
- `expectedDuration`: 预期耗时（毫秒）
  - 快速模型: 5000-10000
  - 中速模型: 15000-25000
  - 慢速模型: 30000+

##### 无进度反馈模型

**适用场景**: API 返回极快（<2秒）或无法预估时长

```json
{
  "id": "minimax-speech-2.6",
  "name": "MiniMax Speech-2.6",
  "type": "audio",
  "description": "同步语音合成",
  "functions": ["语音合成"],
  "progressConfig": {
    "type": "none"
  }
}
```

或直接省略 `progressConfig` 字段（默认 `type: "none"`）

#### 2. Adapter 实现进度支持

##### 方案 A: Adapter 内部轮询（推荐）

**优势**: 
- 职责清晰（Adapter 负责 API 细节）
- 新增模型只需改配置，不动业务层代码
- 与 FalAdapter、PPIOAdapter 一致

**实现步骤**:

1. **导入工具**:
```typescript
import { pollUntilComplete } from '@/utils/polling'
import { getExpectedPolls } from '@/utils/modelConfig'
import { ProgressStatus } from './base/BaseAdapter'
```

2. **实现 `pollTaskStatus` 方法**:
```typescript
async pollTaskStatus(
  taskId: string,
  modelId: string,
  onProgress?: (status: ProgressStatus) => void
): Promise<VideoResult> {
  const estimatedPolls = getExpectedPolls(modelId)
  
  const result = await pollUntilComplete<VideoResult>({
    checkFn: async () => {
      const status = await this.checkStatus(taskId)
      return {
        status: status.status,
        result: status.result as VideoResult | undefined
      }
    },
    isComplete: (status) => status === 'COMPLETED' || status === 'SUCCESS',
    isFailed: (status) => status === 'FAILED',
    onProgress: (progress, status) => {
      if (onProgress) {
        onProgress({
          status: status as any,
          progress,
          message: this.getStatusMessage(status)
        })
      }
    },
    interval: 3000,           // 轮询间隔（毫秒）
    maxAttempts: 120,         // 最大轮询次数
    estimatedAttempts: estimatedPolls
  })

  return result
}
```

3. **修改 `generateVideo` 支持内部轮询**:
```typescript
async generateVideo(params: GenerateVideoParams): Promise<VideoResult> {
  // ... 提交任务 ...
  const response = await this.apiClient.post(endpoint, requestData)
  const taskId = response.data.task_id
  
  // 如果提供了 onProgress，Adapter 内部轮询
  if (params.onProgress) {
    return await this.pollTaskStatus(taskId, params.model, params.onProgress)
  }
  
  // 否则返回 taskId（向后兼容）
  return {
    taskId: taskId,
    status: 'QUEUED'
  }
}
```

4. **App.tsx 调用**:
```typescript
result = await apiService.generateVideo(input, model, {
  ...options,
  onProgress: (status: any) => {
    setTasks(prev => prev.map(t =>
      t.id === taskId ? {
        ...t,
        progress: status.progress || 0,
        message: status.message
      } : t
    ))
  }
})
```

##### 方案 B: 时间模拟进度（同步模型）

**适用场景**: API 同步返回，但耗时较长

**实现步骤**:

1. **在 `App.tsx` 的 `handleGenerate` 中添加定时器**:
```typescript
case 'image':
  let progressTimer: ReturnType<typeof setInterval> | null = null
  
  if (model === 'your-sync-model') {
    const startTime = Date.now()
    const expectedDuration = getExpectedDuration(model)

    progressTimer = setInterval(() => {
      const elapsed = Date.now() - startTime
      const progress = calculateProgress(elapsed, expectedDuration)

      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, progress } : t
      ))
    }, 100) // 每100ms更新一次
  }

  try {
    result = await apiService.generateImage(input, model, options)
  } finally {
    if (progressTimer) {
      clearInterval(progressTimer)
    }
  }
```

#### 3. UI 显示条件

在 `App.tsx` 的任务渲染部分，确保进度条显示条件正确：

```typescript
{task.status === 'generating' && (
  <div className="...">
    {/* 进度条：视频任务 或 有进度值的图片任务 */}
    {(task.type === 'video' ||
      (task.type === 'image' && task.provider === 'fal') ||
      (task.type === 'image' && task.provider === 'piaoyun' && 
       (task.model === 'seedream-4.0' || (task.progress || 0) > 0))
    ) && (
      <ProgressBar
        progress={task.progress || 0}
        className="mt-3"
      />
    )}
  </div>
)}
```

**关键点**:
- 视频任务默认显示进度条
- 图片任务需要明确配置（避免卡在 0%）
- 使用模型ID判断或 `progress > 0` 条件

### 进度值含义

| 进度值 | 含义 | 何时设置 |
|--------|------|---------|
| 0% | 任务初始化 | 任务创建时 |
| 1-5% | 排队中 | 检测到 `IN_QUEUE` 状态 |
| 5-95% | 生成中（预期范围内） | 按轮询次数/时间计算 |
| 95-99% | 生成中（超出预期，渐近逼近） | 超过预期后的缓慢增长 |
| 100% | 完成 | API 返回成功结果 |

### 预期值设定指南

#### 轮询次数（`expectedPolls`）

根据模型实际平均完成时间和轮询间隔（通常3秒）估算：

```
expectedPolls ≈ 平均完成时间(秒) / 轮询间隔(秒) × 80%
```

**示例**:
- 模型平均 3 分钟完成，轮询间隔 3 秒
- `expectedPolls = 180 / 3 × 0.8 = 48`（取整到 50）

**经验值**:
- **超快**（30秒内）: 10-15
- **快速**（1分钟）: 20-25
- **中速**（2-3分钟）: 35-50
- **慢速**（5分钟+）: 60-80

#### 时长（`expectedDuration`）

根据实际测试的平均完成时间设定：

**图片生成**:
- 轻量模型: 5000-10000ms
- 标准模型: 15000-25000ms
- 高质量模型: 30000-45000ms

### 常见问题

#### Q: 进度条一直卡在某个百分比？

**A**: 检查以下几点：
1. `expectedPolls` / `expectedDuration` 是否设置过大
2. Adapter 是否正确调用 `onProgress` 回调
3. `pollUntilComplete` 的 `interval` 是否过长

#### Q: 进度条跳动太快/太慢？

**A**: 调整 `expectedPolls` / `expectedDuration`：
- 太快 → 增加预期值
- 太慢 → 减少预期值
- 建议调整幅度为 ±20%

#### Q: 如何测试进度条？

**A**:
1. 在 Adapter 中添加日志：
   ```typescript
   console.log('[Adapter] Progress:', progress, 'Status:', status)
   ```
2. 在 `App.tsx` 中查看 state 更新：
   ```typescript
   console.log('[App] Task progress updated:', taskId, progress)
   ```
3. 观察实际完成时间，调整配置值

#### Q: 新增异步模型时，进度条不动？

**A**: 确认以下检查清单：
- [ ] `providers.json` 中配置了 `progressConfig`
- [ ] Adapter 实现了 `pollTaskStatus` 方法
- [ ] `generateVideo` 中检测 `onProgress` 并调用内部轮询
- [ ] `App.tsx` 传递了 `onProgress` 回调
- [ ] UI 显示条件包含了该模型

### 最佳实践

1. **配置优先**: 优先使用 `providers.json` 配置，避免硬编码
2. **Adapter 封装**: 让 Adapter 处理轮询，保持 App 层简洁
3. **工具复用**: 使用 `pollUntilComplete` 和 `calculateProgress`，避免重复代码
4. **渐进逼近**: 永远使用渐近式算法，避免进度条"卡死"
5. **合理预期**: 根据实际测试设定 `expectedPolls`/`expectedDuration`
6. **用户体验**: 即使超时，进度条也应继续缓慢增长

---

## ⚠️ 常见陷阱与注意事项


### 1. UI 硬编码逻辑冲突

**问题**: `MediaGenerator.tsx` 中存在针对 `image`/`video`/`audio` **类型**的硬编码逻辑，新模型可能被错误应用。

**关键位置**（行号仅供参考，请搜索关键字）:
- 分辨率选择器: 搜索 `{/* 分辨率设置按钮`
- 智能分辨率计算: 搜索 `if (currentModel?.type === 'image')`
- Size 参数设置: 搜索 `options.size =`

**解决方案**: 添加模型排除逻辑
```typescript
// 不是所有图片模型都需要分辨率选择器
{currentModel?.type === 'image' && selectedModel !== 'your-model' && (
  <PanelTrigger label="分辨率" ... />
)}

// 不是所有图片模型都使用 size 参数
if (currentModel?.type === 'image' && selectedModel !== 'your-model') {
  // 处理分辨率...
}
```

### 2. 参数处理完整性

**问题**: 如果为某个模型单独实现参数处理逻辑，容易遗漏**图片上传**等基础功能。

**解决方案**: 完整实现所有必要逻辑
```typescript
else if (currentModel?.type === 'image' && selectedModel === 'your-model') {
  // 1. 模型专用参数
  options.your_param = yourParam
  
  // 2. ⚠️ 不要忘记图片上传！
  if (uploadedImages.length > 0) {
    options.images = uploadedImages
    // 保存文件路径的逻辑...
  }
}
```

### 3. API 文档与实际不符

**现象**: API 文档说支持某个参数值，但实际返回 422 错误。

**示例**: fal API 文档说 `aspect_ratio` 支持 `"auto"`，但实际不接受。

**解决方案**: 在适配器中过滤
```typescript
// 过滤掉文档中提到但实际不支持的值
if (params.aspect_ratio !== undefined && params.aspect_ratio !== 'auto') {
  requestData.aspect_ratio = params.aspect_ratio
}
// 添加注释说明原因
```

### 4. 历史数据安全

**问题**: 渲染历史记录时，某些字段可能为 `undefined`，导致应用崩溃。

**解决方案**: 添加空值检查
```typescript
{task.result.type === 'image' && task.result.url && (
  task.result.url.includes('|||') ? /* 多图 */ : /* 单图 */
)}
```

---

## 📋 适配检查清单

**适配器层**:
- [ ] 创建适配器类，实现 `MediaGeneratorAdapter` 接口
- [ ] 在 `src/adapters/index.ts` 注册
- [ ] 实现智能路由（如需要）
- [ ] 处理图片格式（base64/URL）
- [ ] 参数过滤（API 可能不接受文档中的所有值）
- [ ] 完整的错误处理

**配置层**:
- [ ] `providers.json` 添加供应商和模型
- [ ] **重要**: 为模型配置正确的 `type` (image/video/audio) 和 `functions` 数组
- [ ] `modelParams.ts` 定义参数 Schema（注意动态选项）
- [ ] `SettingsModal.tsx` 添加 API Key 输入

**UI 集成**:
- [ ] `MediaGenerator.tsx` 导入 Schema、添加 state、实现 onChange
- [ ] **重要**: 添加图片上传处理（如果模型支持）
- [ ] 渲染 `SchemaForm`

**排查硬编码**:
- [ ] 搜索 `currentModel?.type === 'image'` 等判断
- [ ] 确认是否需要排除新模型
- [ ] 确保 `App.tsx` 有动态适配器初始化

**价格配置** 💰:
- [ ] 在 `src/config/pricing.ts` 添加价格配置
- [ ] 配置 `providerId` 和 `modelId`（两者组合必须唯一）
- [ ] 选择价格类型（固定 `fixed` 或动态计算 `calculated`）
- [ ] 设置货币符号和单位
- [ ] 如果是动态计费，实现 `calculator` 函数
- [ ] 确保 `MediaGenerator.tsx` 传递所有计算所需的参数

**进度条配置** 📊:
- [ ] 在 `providers.json` 中添加 `progressConfig`
  - [ ] 异步模型：配置 `type: "polling"` 和 `expectedPolls`
  - [ ] 同步模型：配置 `type: "time"` 和 `expectedDuration`
  - [ ] 极快模型：配置 `type: "none"` 或省略
- [ ] Adapter 实现进度支持
  - [ ] 异步模型：实现 `pollTaskStatus` 方法
  - [ ] 同步模型：在 `App.tsx` 添加时间进度逻辑
  - [ ] 导入并使用 `pollUntilComplete` / `calculateProgress` 工具
- [ ] 更新 UI 显示条件（`App.tsx`）
  - [ ] 确保进度条显示判断包含新模型
- [ ] 测试进度条行为
  - [ ] 验证进度平滑增长
  - [ ] 验证超时后渐近逼近 99%
  - [ ] 根据实际测试调整 `expectedPolls`/`expectedDuration`

**Tauri 配置**:
- [ ] `src-tauri/capabilities/default.json` 添加 CDN 域名
- [ ] **重启应用**验证

**测试**:
- [ ] 文生/图生/多图功能
- [ ] 参数变更是否生效
- [ ] 错误处理（无效 API Key）

---

## 🤖 给 AI 编程助手的提示

如果你是正在阅读本文档的 AI 助手，请遵循以下规则：

1.  **决策确认**: 当遇到 API 文档中有多种实现方式，或者需要对 UI 进行较大改动（如引入新依赖、创建复杂自定义组件）时，**必须先询问用户**，不要擅自决策。
2.  **信息补全**: 如果发现缺少必要的 API 参数说明或 Endpoint 信息，**请明确告知用户需要补充哪些信息**，而不是猜测或使用占位符。
3.  **代码风格**: 保持与现有代码一致的风格（TypeScript, Tailwind CSS, Schema 定义方式）。
4.  **参数校验**: 在 Adapter 中尽量做好参数的预处理和校验，避免将无效参数发送给 API。
5.  **全面检查**: 适配新模型时，**必须检查 `MediaGenerator.tsx` 中的硬编码逻辑**，确认是否需要排除。
6.  **防御性编程**: 对历史数据、API 响应进行空值检查。

---

## 最佳实践总结

1.  **以实际测试为准**: API 文档可能过时或有误，遇到参数错误时以实际 API 行为为准。
2.  **单一模型入口**: 智能路由文生/图生接口，不拆分模型选项。
3.  **优先 Schema**: 能用 Schema 解决的 UI 就不要写硬编码组件。
4.  **灵活适配**: 根据 API 特性（同步/异步/流式）灵活选择适配策略，不拘泥于固定模式。
5.  **防御性编程**: 对历史数据、API 响应、用户输入做好空值和错误处理。
6.  **全面检查硬编码**: 新模型适配时必须排查现有的类型判断逻辑。
7.  **完整性**: 单独实现模型逻辑时，不要遗漏图片上传等基础功能。
