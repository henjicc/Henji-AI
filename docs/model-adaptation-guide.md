# 模型与供应商适配指南

本文档旨在指导开发者（以及 AI 编程助手）如何为 Henji AI 添加新的模型供应商（Provider）或接入新的模型（Model）。

> **⚠️ 核心原则：以官方 API 文档为准**
>
> 本指南中提到的参数名称（如 `resolution`, `prompt`）仅作为通用示例。在实际适配过程中，**必须严格参照模型供应商的官方 API 文档**来定义参数和构造请求。不要盲目照搬本指南中的示例代码。
>
> **文档可能有误！** 遇到 422/400 等参数错误时，以实际 API 行为为准，不要完全相信文档。

## 📑 目录

### 基础架构
- [核心架构概述](#核心架构概述)
- [接入流程](#接入流程)
  - [添加新供应商](#1-添加新供应商-provider)
  - [添加新模型](#2-添加新模型-model)

### UI 与配置
- [UI 组件与 Schema 规范](#ui-组件与-schema-规范)
- [预设与重新编辑功能适配](#预设与重新编辑功能适配指南)

### 增强功能
- [价格配置指南](#价格配置指南)
- [进度条配置指南](#进度条配置指南)
- [本地保存机制](#本地保存机制)

### 开发指南
- [常见陷阱与注意事项](#常见陷阱与注意事项)
- [适配检查清单](#适配检查清单)
- [给 AI 编程助手的提示](#给-ai-编程助手的提示)
- [最佳实践总结](#最佳实践总结)

---

## 核心架构概述

Henji AI 的模型适配分为前端和后端两个部分：

1.  **前端 (Frontend)**:
    *   **配置**: `src/config/providers.json` 定义供应商和模型列表。
    *   **Schema**: `src/models/` 目录下的各个模型参数文件（如 `kling-2.5-turbo.ts`）定义模型的参数表单结构（Schema-Driven UI）。
    *   **UI**: `src/components/MediaGenerator/` 模块化组件根据 Schema 渲染表单，收集用户输入。
      - `index.tsx` - 主组件协调逻辑
      - `components/` - UI 子组件（模型选择、参数配置、输入区域）
      - `hooks/` - 状态管理和业务逻辑 hooks
      - `builders/` - 生成选项构建器
      - `utils/` - 工具函数和常量

2.  **后端/适配层 (Adapter Layer)**:
    *   **抽象基类**: `src/adapters/base/BaseAdapter.ts` 定义 `MediaGeneratorAdapter` 接口并提供 `BaseAdapter` 抽象基类，包含通用方法实现。
    *   **模块化适配器**: 具体适配器采用模块化结构，按功能拆分：
      - **配置**: `config.ts` - 基础配置常量
      - **路由**: `models/` - 各模型的路由处理（如 `kling-2.5-turbo.ts`）
      - **解析器**: `parsers/` - 响应解析器（图片、视频、音频）
      - **状态处理**: `statusHandler.ts` - 异步任务状态轮询
      - **主适配器**: `PPIOAdapter.ts` / `FalAdapter.ts` - 继承 `BaseAdapter`，协调各模块
    *   **通用方法**: `BaseAdapter` 提供了 `saveMediaLocally`（本地保存）、`formatError`（错误处理）和 `log`（日志记录）等通用方法。
    *   **工厂**: `src/adapters/index.ts` 负责实例化适配器。

---

## 接入流程

### 1. 添加新供应商 (Provider)

如果要接入一个新的 API 服务商

1.  **定义适配器**（推荐模块化结构）:
    *   在 `src/adapters/` 下创建新的供应商目录（如 `src/adapters/your-provider/`）
    *   **模块化结构**（参考 PPIO 和 FAL 适配器）:
      ```
      src/adapters/your-provider/
      ├── config.ts              # 基础配置（API URL、轮询间隔等）
      ├── models/                # 模型路由处理
      │   ├── model-a.ts        # 单个模型的请求构建逻辑
      │   ├── model-b.ts
      │   └── index.ts          # 导出所有模型路由
      ├── parsers/              # 响应解析器
      │   ├── imageParser.ts    # 图片响应解析
      │   ├── videoParser.ts    # 视频响应解析
      │   └── audioParser.ts    # 音频响应解析
      ├── statusHandler.ts      # 异步任务状态轮询（如需要）
      └── YourProviderAdapter.ts # 主适配器类
      ```
    *   **主适配器**: 继承 `BaseAdapter` 抽象基类，实现特定供应商的 API 调用逻辑。
    *   **模型路由**: 每个模型文件导出一个路由对象，包含 `matches()` 和 `build*Request()` 方法。
    *   **⚠️ 注意**: 在适配器中做好**参数过滤**，API 文档中标注的某些值可能实际不被接受。
    *   **通用方法**: 利用 `BaseAdapter` 提供的 `saveMediaLocally`（本地保存）、`formatError`（错误处理）和 `log`（日志记录）等通用方法，减少重复代码。

    **模型路由示例**:
    ```typescript
    // src/adapters/your-provider/models/model-a.ts
    export const modelARoute = {
      matches: (modelId: string) => modelId === 'model-a',
      buildVideoRequest: (params: GenerateVideoParams) => {
        const endpoint = '/v1/video/generate'
        const requestData = {
          prompt: params.prompt,
          duration: params.duration || 5,
          // ... 其他参数
        }
        return { endpoint, requestData }
      }
    }
    ```

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

> **⚠️ 重要**: 功能标签会影响用户在模型选择面板中的筛选体验，请根据模型的实际能力准确配置。如果未来需要添加新的功能类型，需要同时更新 `src/components/MediaGenerator/components/ModelSelectorPanel.tsx` 中的功能筛选器选项列表。

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
    *   **⚠️ 检查硬编码**: `src/components/MediaGenerator/builders/optionsBuilder.ts` 中有针对所有 `image` 类型的硬编码逻辑（如分辨率选择器），需要排除不适用的模型。

##### 🎥 视频模型 (Video Models)

*   **参数定义**: 常见参数有 `duration`, `aspect_ratio`, `camera_motion` 等。
*   **适配重点**:
    *   **智能路由**: 根据输入图片数量（0=文生视频, 1=图生视频, 2=首尾帧）选择接口。
    *   **自动宽高比匹配**: 当宽高比为 "auto" 且上传了图片时，可根据图片的实际宽高比自动匹配最适合的预设宽高比（如 16:9, 9:16, 1:1）。
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

我们强烈建议使用 `src/models/` 目录下的独立文件定义参数，由 `SchemaForm` 自动渲染 UI。

**模块化 Schema 结构**:
```
src/models/
├── kling-2.5-turbo.ts        # Kling 模型参数定义
├── vidu-q1.ts                # Vidu 模型参数定义
├── seedream-4.0.ts           # Seedream 模型参数定义
└── index.ts                  # 统一导出所有参数
```

**参数定义示例**:
```typescript
// src/models/your-model.ts
import { ParamDef } from '../types/schema'

export const yourModelParams: ParamDef[] = [
  {
    id: 'duration',
    type: 'dropdown',
    label: '时长',
    options: [
      { value: 5, label: '5秒' },
      { value: 10, label: '10秒' }
    ]
  },
  // ... 其他参数
]
```

**在 index.ts 中导出**:
```typescript
// src/models/index.ts
export { yourModelParams } from './your-model'
```

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
    // 在 MediaGenerator/index.tsx 中
    useEffect(() => {
      if (state.selectedModel === 'your-model') {
        if (state.uploadedImages.length > 0) {
          state.setAspectRatio('auto')  // 图生图模式
        } else if (state.aspectRatio === 'auto') {
          state.setAspectRatio('1:1')   // 文生图模式
        }
      }
    }, [state.uploadedImages.length, state.selectedModel])
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

**关键**: `calculator` 函数接收的 `params` 来自 `MediaGenerator/index.tsx` 中传递给 `PriceEstimate` 组件的参数对象。

#### 需要确保传递的参数

在 `MediaGenerator/index.tsx` 的 `PriceEstimate` 组件中，确保传递计算所需的所有参数：

```typescript
<PriceEstimate
  providerId={state.selectedProvider}
  modelId={state.selectedModel}
  params={{
    // 图片参数
    num_images: state.numImages,
    uploadedImages: state.uploadedImages,

    // 视频参数
    videoDuration: state.videoDuration,
    videoResolution: state.videoResolution,
    viduMode: state.viduMode,
    hailuoFastMode: state.hailuoFastMode,
    pixFastMode: state.pixFastMode,
    seedanceVariant: state.seedanceVariant,
    seedanceResolution: state.seedanceResolution,
    seedanceAspectRatio: state.seedanceAspectRatio,
    wanResolution: state.wanResolution,

    // 音频参数
    input: state.input,  // 文本内容
    audioSpec: state.audioSpec
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
2. `calculator` 函数中的参数名是否与 `MediaGenerator/index.tsx` 传递的一致
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
- 利用 BaseAdapter 抽象基类提供的通用方法

**实现步骤**:

1. **导入工具**:
```typescript
import { pollUntilComplete } from '@/utils/polling'
import { getExpectedPolls } from '@/utils/modelConfig'
import { BaseAdapter, ProgressStatus } from './base/BaseAdapter'
```

2. **创建 Adapter 类，继承 BaseAdapter**:
```typescript
export class YourAdapter extends BaseAdapter {
  constructor(apiKey: string) {
    super('your-provider') // 调用基类构造函数，传入供应商名称
    // 初始化 API 客户端等
  }
  
  // 实现抽象方法...
}
```

3. **实现 `pollTaskStatus` 方法**:
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

4. **修改 `generateVideo` 支持内部轮询**:
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
    taskId: `${this.name}:${taskId}`, // 使用完整格式的 taskId
    status: 'QUEUED'
  }
}
```

5. **使用 BaseAdapter 的通用方法保存媒体**:
```typescript
// 在获取到视频结果后
const videoUrl = result.video.url
const savedResult = await this.saveMediaLocally(videoUrl, 'video')
result.url = savedResult.url
; (result as any).filePath = savedResult.filePath
```

6. **App.tsx 调用**:
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

**问题**: `MediaGenerator` 模块中存在针对 `image`/`video`/`audio` **类型**的硬编码逻辑，新模型可能被错误应用。

**关键位置**:
- **选项构建器**: `src/components/MediaGenerator/builders/optionsBuilder.ts`
  - 搜索 `if (currentModel?.type === 'image')`
  - 搜索 `options.size =`
- **参数面板**: `src/components/MediaGenerator/components/ParameterPanel.tsx`
  - 检查是否需要为新模型添加参数渲染逻辑
- **主组件**: `src/components/MediaGenerator/index.tsx`
  - 搜索类型判断逻辑

**解决方案**: 在 `optionsBuilder.ts` 中添加模型排除逻辑
```typescript
// 不是所有图片模型都使用 size 参数
if (currentModel?.type === 'image' &&
    selectedModel !== 'nano-banana' &&
    selectedModel !== 'nano-banana-pro' &&
    selectedModel !== 'your-model') {
  // 处理分辨率...
  if (params.selectedResolution === 'smart') {
    // ...
  }
}
```

### 2. 参数处理完整性

**问题**: 如果为某个模型单独实现参数处理逻辑，容易遗漏**图片上传**等基础功能。

**解决方案**: 在 `optionsBuilder.ts` 中完整实现所有必要逻辑
```typescript
// src/components/MediaGenerator/builders/optionsBuilder.ts
else if (currentModel?.type === 'image' && selectedModel === 'your-model') {
  // 1. 模型专用参数
  options.your_param = params.yourParam

  // 2. ⚠️ 不要忘记图片上传！
  if (uploadedImages.length > 0) {
    options.images = uploadedImages
    const paths: string[] = [...uploadedFilePaths]
    for (let i = 0; i < uploadedImages.length; i++) {
      if (!paths[i]) {
        const blob = await dataUrlToBlob(uploadedImages[i])
        const saved = await saveUploadImage(blob)
        paths[i] = saved.fullPath
      }
    }
    setUploadedFilePaths(paths)
    options.uploadedFilePaths = paths
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

### 5. 共享状态默认值 ⚠️ 重要

**问题**: 多个视频模型共享相同的 `videoDuration` state，如果某个模型设置了特殊的默认值（如 Hailuo 为 6 秒），切换到其他模型时会继承这个值。

**典型场景**:
- 用户选择 Hailuo 2.3 模型（默认 6 秒）
- 切换到 Seedance V1 模型
- **问题**: Seedance 显示 6 秒，但 Schema 第一项是 5 秒

**根本原因**:
1. 所有视频模型共享 `videoDuration` state（在 `useMediaGeneratorState` hook 中定义）
2. 某些模型有专门的 useEffect 强制设置特定默认值
3. 其他模型没有对应的重置逻辑，会继承之前的值

**解决方案**: 在 `MediaGenerator/index.tsx` 中为需要特定默认值的模型添加 useEffect

```typescript
// src/components/MediaGenerator/index.tsx
// 示例：为 Seedance 添加时长默认值重置
useEffect(() => {
  if (currentModel?.type === 'video' &&
      (state.selectedModel === 'seedance-v1' ||
       state.selectedModel === 'seedance-v1-lite' ||
       state.selectedModel === 'seedance-v1-pro')) {
    if (state.videoDuration !== 5 && state.videoDuration !== 10) {
      state.setVideoDuration(5)  // Seedance 默认 5 秒
    }
  }
}, [state.selectedModel, state.videoDuration])
```

**关键点**:
1. **位置**: 在 `MediaGenerator/index.tsx` 主组件中添加
2. **仅在无效值时重置**: 使用 `!== 5 && !== 10` 而不是直接 `setVideoDuration(5)`，避免覆盖用户手动选择的值
3. **依赖项**: 仅依赖 `[state.selectedModel, state.videoDuration]`，避免不必要的触发
4. **状态访问**: 通过 `state` 对象访问状态和 setter

**适用范围**:
- `videoDuration` (Hailuo 6秒 vs 其他 5秒)
- `videoResolution` (不同模型的默认分辨率)
- 其他共享的视频/音频参数

**检查清单**:
- [ ] 确认新模型的默认值与现有模型不同
- [ ] 在 `MediaGenerator/index.tsx` 中添加对应的 useEffect 重置逻辑
- [ ] 使用条件判断避免覆盖用户选择
- [ ] 测试模型切换场景

---

## 🎯 预设与重新编辑功能适配指南

新增模型参数后,需要在预设系统中注册才能支持**保存预设**、**加载预设**和**重新编辑历史记录**功能。系统采用**集中式状态映射**架构,所有参数的 setter 映射关系集中在 `src/config/presetStateMapping.ts` 管理。

### 核心优势

- **一次配置，多处使用**: 同一个映射表同时支持预设功能和重新编辑功能
- **自动化映射**: 通过循环自动匹配参数和 setter，无需手动编写大量 if 语句
- **零维护成本**: 新增参数时只需在一个地方添加映射关系

### 适配步骤

#### 1. 在 `PresetSetters` 接口中添加 setter 类型定义

```typescript
// src/config/presetStateMapping.ts
export interface PresetSetters {
    // ... 现有参数 ...

    // 你的新参数 (按类型分类: 基础/图片/视频/音频/特定模型)
    setYourNewParam: (v: string) => void
}
```

#### 2. 在 `createPresetSetterMap` 返回对象中添加映射

```typescript
// src/config/presetStateMapping.ts
export function createPresetSetterMap(setters: PresetSetters) {
    return {
        // ... 现有映射 ...
        yourNewParam: setters.setYourNewParam  // 键名必须与保存时一致
    }
}
```

#### 3. 在 `MediaGenerator/index.tsx` 中传入 setter

```typescript
// src/components/MediaGenerator/index.tsx
const setterMap = useMemo(() => createPresetSetterMap({
    setInput: state.setInput,
    setSelectedModel: state.setSelectedModel,
    // ... 其他 setter ...
    setYourNewParam: state.setYourNewParam,  // ⚠️ 别忘了添加
}), [])
```

**注意**: 由于状态管理已模块化到 `useMediaGeneratorState` hook，所有 setter 都通过 `state` 对象访问。

### 自动化恢复机制

系统使用统一的自动化恢复逻辑，无需为每个参数编写恢复代码：

```typescript
// 预设加载 (PresetPanel.tsx)
for (const [key, value] of Object.entries(params)) {
  const setter = setterMap[key]
  if (setter && value !== undefined && value !== null) {
    setter(value)
  }
}

// 重新编辑 (MediaGenerator/index.tsx)
if (options) {
  for (const [key, value] of Object.entries(options)) {
    const setter = setterMap[key]
    if (setter && value !== undefined && value !== null) {
      setter(value)
    }
  }
}
```

### 注意事项

- **参数命名**: 使用驼峰命名,与 state 变量名保持一致
- **键名一致**: 映射表的键名必须与保存时使用的参数名完全一致
- **类型安全**: 在 `PresetSetters` 中明确定义类型,避免使用 `any`
- **向后兼容**: setter 应能处理 `undefined`,旧预设可能不包含新参数
- **自动生效**: 添加映射后，预设和重新编辑功能会自动支持新参数

---

## 📁 本地保存机制

### 概述

Henji AI 支持将生成的媒体（图片、视频、音频）保存到本地文件系统，提供更好的用户体验和离线访问能力。

### 实现方式

1. **BaseAdapter 通用方法**: `BaseAdapter` 抽象基类提供了 `saveMediaLocally` 通用方法，用于保存媒体到本地。
2. **自动保存**: 当媒体生成成功后，Adapter 会自动调用 `saveMediaLocally` 方法保存媒体到本地。
3. **无需环境检测**: 当前项目只考虑桌面环境，所以 `saveMediaLocally` 方法直接执行保存逻辑，无需检测是否在桌面环境。
4. **支持多种媒体类型**: 支持保存图片、视频和音频三种类型的媒体。

### 保存流程

1. **媒体生成成功**: 当 API 返回成功结果后，Adapter 会获取媒体 URL。
2. **调用 saveMediaLocally**: Adapter 调用 `BaseAdapter.saveMediaLocally` 方法，传入媒体 URL 和类型。
3. **执行保存**: `saveMediaLocally` 方法调用相应的保存函数（如 `saveVideoFromUrl`）保存媒体到本地。
4. **返回结果**: 保存成功后，返回本地文件 URL 和文件路径；保存失败时，返回原始 URL。
5. **更新 UI**: 使用本地文件 URL 更新 UI，用户可以直接查看和使用保存的媒体。

### 解析器实现要点

在实现响应解析器时，需要注意以下几点：

#### 1. 支持多种响应格式

不同模型的 API 可能返回不同的数据结构，解析器应该灵活处理：

```typescript
// 示例：音频解析器支持多种格式
export const parseAudioResponse = async (responseData: any): Promise<AudioResult> => {
  // MiniMax Speech 2.6 格式: { audio: "url", extra_info: {...} }
  if (responseData.audio) {
    return { url: responseData.audio }
  }

  // 其他音频模型格式: { audios: [{audio_url: "url"}] }
  if (responseData.audios && responseData.audios.length > 0) {
    return { url: responseData.audios[0].audio_url }
  }

  throw new Error('No audio returned from API')
}
```

#### 2. 正确设置 filePath 字段

解析器在保存媒体后，必须同时设置 `url` 和 `filePath` 字段：

```typescript
// 视频解析器示例
export const parseVideoResponse = async (
  responseData: any,
  adapter: BaseAdapter
): Promise<VideoResult> => {
  if (responseData.videos && responseData.videos.length > 0) {
    const videoUrl = responseData.videos[0].video_url

    try {
      const savedResult = await adapter['saveMediaLocally'](videoUrl, 'video')
      return {
        url: savedResult.url,
        filePath: savedResult.filePath,  // ⚠️ 必须设置 filePath
        status: 'TASK_STATUS_SUCCEEDED'
      }
    } catch (e) {
      adapter['log']('视频本地保存失败，回退为远程URL', e)
      return {
        url: videoUrl,
        status: 'TASK_STATUS_SUCCEEDED'
      }
    }
  }

  throw new Error('No video returned from API')
}
```

#### 3. 音频生成方法也需要保存

不仅视频需要本地保存，音频也需要：

```typescript
// 在 Adapter 的 generateAudio 方法中
async generateAudio(params: GenerateAudioParams): Promise<AudioResult> {
  // ... 发送请求 ...
  const audioResult = await parseAudioResponse(response.data)

  // ⚠️ 保存到本地
  try {
    const savedResult = await this.saveMediaLocally(audioResult.url, 'audio')
    return {
      url: savedResult.url,
      filePath: savedResult.filePath
    }
  } catch (e) {
    this.log('音频本地保存失败，回退为远程URL', e)
    return audioResult
  }
}
```

### 保存位置

媒体文件默认保存在应用的本地数据目录中，具体位置由 Tauri 框架管理。

### 错误处理

`saveMediaLocally` 方法包含完整的异常处理逻辑，确保即使保存失败也能返回结果，不会影响整体流程。保存失败时，会记录错误日志，并返回原始 URL，保证用户体验不受影响。

### 检查清单

- [ ] 解析器支持 API 的所有可能响应格式
- [ ] 视频解析器正确设置 `filePath` 字段
- [ ] 音频解析器正确设置 `filePath` 字段
- [ ] `generateAudio` 方法调用 `saveMediaLocally` 保存音频
- [ ] `generateVideo` 方法调用 `saveMediaLocally` 保存视频（如果是同步返回）
- [ ] 所有保存操作都有完整的错误处理

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
- [ ] `src/config/providers.json` 添加供应商和模型
- [ ] **重要**: 为模型配置正确的 `type` (image/video/audio) 和 `functions` 数组
- [ ] `src/components/SettingsModal.tsx` 添加 API Key 输入

**Schema 定义**:
- [ ] 在 `src/models/your-model.ts` 中定义参数 Schema（注意动态选项）
- [ ] 在 `src/models/index.ts` 中导出参数

**状态管理**:
- [ ] 在 `src/components/MediaGenerator/hooks/useMediaGeneratorState.ts` 中添加 state 和 setter

**UI 集成**:
- [ ] 在 `src/components/MediaGenerator/components/ParameterPanel.tsx` 中添加模型参数渲染逻辑
- [ ] 在 `src/components/MediaGenerator/builders/optionsBuilder.ts` 中添加选项构建逻辑
- [ ] **重要**: 添加图片上传处理（如果模型支持）

**预设与重新编辑**:
- [ ] 在 `src/config/presetStateMapping.ts` 的 `PresetSetters` 接口中添加 setter 类型定义
- [ ] 在 `createPresetSetterMap` 函数中添加参数映射关系
- [ ] 在 `MediaGenerator/index.tsx` 的 `setterMap` 中传入 setter

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
- [ ] 确保 `MediaGenerator/index.tsx` 传递所有计算所需的参数

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
5.  **全面检查**: 适配新模型时，**必须检查 `MediaGenerator` 模块中的硬编码逻辑**（特别是 `optionsBuilder.ts` 和 `ParameterPanel.tsx`），确认是否需要排除新模型或添加特殊处理。
6.  **防御性编程**: 对历史数据、API 响应进行空值检查。

---

## 最佳实践总结

### 架构设计原则

1.  **模块化优先**: 遵循单一职责原则，将功能拆分到独立的模块中（如 hooks、builders、parsers）。
2.  **集中式配置**: 使用配置文件（`providers.json`、`presetStateMapping.ts`）而非硬编码，便于维护和扩展。
3.  **自动化映射**: 通过循环和映射表自动处理参数，避免为每个参数编写重复的 if 语句。
4.  **一次配置，多处使用**: 同一个映射表同时支持预设功能和重新编辑功能，减少维护成本。

### API 适配原则

5.  **以实际测试为准**: API 文档可能过时或有误，遇到参数错误时以实际 API 行为为准。
6.  **单一模型入口**: 智能路由文生/图生接口，不拆分模型选项。
7.  **灵活适配**: 根据 API 特性（同步/异步/流式）灵活选择适配策略，不拘泥于固定模式。
8.  **参数过滤**: 在适配器中过滤掉 API 文档中提到但实际不支持的参数值。

### UI 开发原则

9.  **优先 Schema**: 能用 Schema 解决的 UI 就不要写硬编码组件。
10. **全面检查硬编码**: 新模型适配时必须排查现有的类型判断逻辑（特别是 `optionsBuilder.ts`）。
11. **完整性**: 单独实现模型逻辑时，不要遗漏图片上传等基础功能。

### 状态管理原则

12. **共享状态管理**: 如果新模型的默认值与其他模型不同，添加 useEffect 重置逻辑，避免状态污染。
13. **统一状态访问**: 通过 `state` 对象访问所有状态和 setter，保持代码一致性。

### 数据处理原则

14. **防御性编程**: 对历史数据、API 响应、用户输入做好空值和错误处理。
15. **本地保存**: 所有媒体（图片、视频、音频）都应保存到本地，并正确设置 `filePath` 字段。
16. **多格式支持**: 解析器应支持 API 的所有可能响应格式，提高兼容性。

### 开发流程原则

17. **先配置后实现**: 先在 `presetStateMapping.ts` 中添加映射，再实现具体功能，确保预设和重新编辑自动生效。
18. **渐进式开发**: 先实现基础功能，再添加进度条、价格估算等增强功能。
19. **充分测试**: 测试文生/图生/多图、参数变更、错误处理、预设保存/加载、重新编辑等所有场景。
