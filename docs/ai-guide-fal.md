# Fal 适配器专用指南
---

## 核心特性与架构

### Fal 适配器的特殊性与注意事项

Fal 适配器使用官方 `@fal-ai/client` SDK，与其他适配器（PPIO、ModelScope）有显著不同：
可参考 src/adapters/fal 目录下的代码实现。
一个模型相同版本的不同端点，合并为一个路由，既可以根据用户的输入动态选择不同的端点，在参数面板上设置“模式”选项，用户也可以手动切换端点
随机种子 seed 参数不显示在参数面板上，请求时不传输该参数
负面提示词 negative_prompt 参数如果有，就全都放在所有参数最后，也就是最右侧
所有与 Fal 模型相关的文件名、变量名、模型 ID 都必须加上供应商前缀，以确保代码一致性和避免命名冲突：

- **文件名**: 使用 `fal-ai-` 前缀，例如：`fal-ai-kling-image-o1.ts`、`fal-ai-nano-banana.ts`
- **变量名**: 使用 `falAi` 前缀，例如：`falAiKlingImageO1Route`、`falAiNanoBananaParams`
- **模型 ID**: 在 `providers.json` 中使用 `fal-ai-` 前缀，例如：`fal-ai-kling-image-o1`、`fal-ai-nano-banana`
- **配置引用**: 所有配置文件（如 `pricing.ts`、`models/index.ts`）中的模型 ID 引用也必须使用带前缀的格式

**重要**: 前缀应用于所有 Fal 模型相关的代码元素，确保整个代码库中 Fal 模型的命名一致性。

| 特性 | Fal | PPIO/ModelScope |
|------|-----|-----------------|
| **图片上传** | 自动上传到 fal CDN | 使用 base64 或不支持 |
| **轮询方式** | SDK 自动轮询 (`fal.subscribe`) | 手动轮询 |
| **进度计算** | 基于轮询次数 | 基于时间或轮询次数 |
| **本地保存** | App.tsx 统一处理 | Adapter 内部处理 |

### 关键设计原则

1. **图片已上传**: 模型路由收到的 `params.images` 已经是 fal CDN URL，**直接使用**
2. **不保存媒体**: Fal 图片解析器**不调用** `saveMediaLocally`，由 App.tsx 统一处理
3. **轮询进度**: 必须配置 `"type": "polling"` 和 `expectedPolls`
4. **智能匹配**: 永远不要传递 `'smart'` 或 `'auto'` 给 API

---

## 完整适配流程

### 总览：7 个必须步骤

```
1. 创建模型路由 (adapters/fal/models/)
2. 注册路由 (models/index.ts)
3. 配置轮询次数 (config.ts)
4. 定义参数 Schema (src/models/)
5. 添加参数面板渲染 (ParameterPanel.tsx)
6. 注册参数映射 (handleSchemaChange + presetStateMapping)
7. 配置 providers.json
```

---

### 步骤 1: 创建模型路由 ⭐ 核心步骤

**位置**: `src/adapters/fal/models/[model-id].ts`

**图片模型完整模板**:

```typescript
import { GenerateImageParams } from '@/adapters/base/BaseAdapter'
import { FalModelRoute } from './index'

export const yourFalModelRoute: FalModelRoute = {
  // 1. 模型匹配规则（支持多个别名）
  matches: (modelId: string) =>
    modelId === 'fal-ai/your-model' ||
    modelId === 'your-model',

  // 2. 构建图片生成请求
  buildImageRequest: (params: GenerateImageParams) => {
    const images = params.images || []  //  已上传到 CDN，直接使用

    // 智能路由：根据是否有图片选择端点
    const hasImages = images.length > 0
    const submitPath = hasImages
      ? 'fal-ai/your-model/edit'      // 图生图端点
      : 'fal-ai/your-model'            // 文生图端点

    const modelId = 'fal-ai/your-model'  //  不含子路径（如 /edit）

    // 3. 构建请求数据
    const requestData: any = {
      prompt: params.prompt
    }

    // 4. 添加可选参数（根据 API 文档）
    if (params.num_images !== undefined) {
      requestData.num_images = params.num_images
    }

    //  关键：过滤掉 'smart' 和 'auto'，不传递给 API
    if (params.aspect_ratio !== undefined &&
        params.aspect_ratio !== 'smart' &&
        params.aspect_ratio !== 'auto') {
      requestData.aspect_ratio = params.aspect_ratio
    }

    // 5. 图生图时添加图片 URL
    if (hasImages) {
      requestData.image_urls = images  // 多图用 image_urls
      // 或 requestData.image_url = images[0]  // 单图用 image_url
    }

    return { submitPath, modelId, requestData }
  }
}
```

**视频模型完整模板**:

```typescript
import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'
import { FalModelRoute } from './index'

export const yourVideoModelRoute: FalModelRoute = {
  matches: (modelId: string) =>
    modelId === 'fal-ai/your-video-model' ||
    modelId === 'your-video-model',

  buildVideoRequest: async (params: GenerateVideoParams) => {
    const images = params.images || []
    const prompt = params.prompt || ''

    // 构建请求数据
    const requestData: any = {
      prompt
    }

    // 添加视频参数
    if (params.duration !== undefined) {
      requestData.duration = params.duration
    }

    //  智能匹配处理（如果支持）
    let aspectRatio = params.aspectRatio
    if ((aspectRatio === 'smart' || aspectRatio === 'auto') && images.length > 0) {
      try {
        const { getImageAspectRatio, matchAspectRatio } = await import('@/utils/aspectRatio')
        const ratio = await getImageAspectRatio(images[0])
        aspectRatio = matchAspectRatio(ratio)
        console.log(`[Fal] 智能计算宽高比: ${ratio.toFixed(2)}，匹配预设: ${aspectRatio}`)
      } catch (error) {
        console.error('[Fal] 计算图片宽高比失败:', error)
        aspectRatio = '16:9'  // 回退默认值
      }
    }

    // 只传递实际的比例值
    if (aspectRatio && aspectRatio !== 'smart' && aspectRatio !== 'auto') {
      requestData.aspect_ratio = aspectRatio
    }

    // 图生视频时添加图片
    if (images.length > 0) {
      requestData.image_url = images[0]  // 单图
    }

    return {
      endpoint: 'fal-ai/your-video-model',
      modelId: 'fal-ai/your-video-model',
      requestData
    }
  }
}
```

**关键注意事项**:

1. **submitPath vs modelId**:
   - `submitPath` 用于提交请求（可以有子路径如 `/edit`）
   - `modelId` 用于查询状态（**不含**子路径）

2. **图片参数**:
   - `params.images` 已经是 fal CDN URL，**直接使用**
   - 不要手动转换或上传

3. **智能匹配**:
   - 永远不要传递 `'smart'` 或 `'auto'` 给 API
   - 在路由中检测并转换为实际比例

4. **参数过滤**:
   - 使用 `!== undefined` 检查参数是否存在
   - 不要传递 `undefined` 或 `null` 给 API

### 步骤 2: 注册路由

**位置**: `src/adapters/fal/models/index.ts`

```typescript
import { yourFalModelRoute } from './your-fal-model'

export const falModelRoutes: FalModelRoute[] = [
  // ... 现有路由
  yourFalModelRoute  // 添加到数组末尾
]
```

---

### 步骤 3: 配置预估轮询次数

**位置**: `src/adapters/fal/config.ts`

```typescript
export const FAL_CONFIG = {
  modelEstimatedPolls: {
    // ... 现有配置
    'your-model': 25,  // 使用短名称（不含 fal-ai/ 前缀）
    'nano-banana': 10,
    'nano-banana-pro': 15
  }
}
```

**如何确定预估值**:

| 模型速度 | 平均完成时间 | 推荐 expectedPolls |
|---------|-------------|-------------------|
| 超快 | <30秒 | 5-10 |
| 快速 | 30-60秒 | 10-20 |
| 中速 | 1-2分钟 | 20-30 |
| 慢速 | 2-5分钟 | 30-60 |

**计算公式**: `expectedPolls ≈ 平均完成时间(秒) / 3秒 × 80%`

---

### 步骤 4: 定义参数 Schema

**位置**: `src/models/your-fal-model.ts`

```typescript
import { ParamDef } from '../types/schema'

export const yourFalModelParams: ParamDef[] = [
  // 图片数量（图片模型）
  {
    id: 'numImages',
    type: 'dropdown',
    label: '数量',
    defaultValue: 1,
    options: [
      { value: 1, label: '1张' },
      { value: 2, label: '2张' },
      { value: 4, label: '4张' }
    ]
  },

  // 宽高比（带智能匹配）
  {
    id: 'aspectRatio',
    type: 'dropdown',
    defaultValue: '1:1',
    resolutionConfig: {
      type: 'aspect_ratio',
      smartMatch: true,
      visualize: true,
      extractRatio: (value) => {
        if (value === 'smart') return null
        const [w, h] = value.split(':').map(Number)
        return w / h
      }
    },
    options: (values) => {
      const baseOptions = [
        { value: '1:1', label: '1:1' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' }
      ]

      // 图生图时添加智能选项
      if (values.uploadedImages?.length > 0) {
        return [{ value: 'smart', label: '智能' }, ...baseOptions]
      }

      return baseOptions
    }
  }
]
```

**然后在 `src/models/index.ts` 中导出**:

```typescript
export { yourFalModelParams } from './your-fal-model'

export const modelSchemaMap: Record<string, ParamDef[]> = {
  // ... 现有映射
  'your-fal-model': yourFalModelParams
}
```

---

### 步骤 5: 添加参数面板渲染

**位置**: `src/components/MediaGenerator/components/ParameterPanel.tsx`

在文件中添加渲染分支：

```typescript
// Your Fal Model 参数
if (selectedModel === 'your-fal-model') {
  return (
    <SchemaForm
      schema={yourFalModelParams}
      values={{
        numImages: values.numImages,
        aspectRatio: values.aspectRatio,
        uploadedImages  //  如果使用智能匹配，必须传递
      }}
      onChange={onChange}
    />
  )
}
```

**记得在文件顶部导入 Schema**:

```typescript
import { yourFalModelParams } from '@/models'
```

---

### 步骤 6: 注册参数映射

#### 6.1 在 handleSchemaChange 中注册

**位置**: `src/components/MediaGenerator/index.tsx`

```typescript
const handleSchemaChange = (id: string, value: any) => {
  const setterMap: Record<string, (v: any) => void> = {
    // ... 现有映射
    numImages: state.setNumImages,
    aspectRatio: state.setAspectRatio
  }

  const setter = setterMap[id]
  if (setter) {
    setter(value)
  }
}
```

#### 6.2 在 presetStateMapping 中注册

**位置**: `src/config/presetStateMapping.ts`

```typescript
// 1. 添加到接口
export interface PresetSetters {
  // ... 现有 setter
  setNumImages: (v: number) => void
  setAspectRatio: (v: string) => void
}

// 2. 添加到映射函数
export function createPresetSetterMap(setters: PresetSetters) {
  return {
    // ... 现有映射
    numImages: setters.setNumImages,
    aspectRatio: setters.setAspectRatio
  }
}
```

#### 6.3 传入 setter

**位置**: `src/components/MediaGenerator/index.tsx`

```typescript
const setterMap = useMemo(() => createPresetSetterMap({
  // ... 现有 setter
  setNumImages: state.setNumImages,
  setAspectRatio: state.setAspectRatio
}), [])
```

---

### 步骤 7: 配置 providers.json

**位置**: `src/config/providers.json`

在 fal 供应商的 models 数组中添加：

```json
{
  "id": "your-fal-model",
  "name": "Your Fal Model",
  "type": "image",
  "description": "模型描述",
  "functions": ["图片生成", "图片编辑"],
  "progressConfig": {
    "type": "polling",
    "expectedPolls": 25
  }
}
```

**关键字段**:
- `type`: `image` | `video` | `audio`
- `functions`: 功能标签数组
  - 图片: `图片生成`, `图片编辑`
  - 视频: `文生视频`, `图生视频`
- `progressConfig.type`:  **必须是** `"polling"`

---

### 步骤 8: 配置价格

**位置**: `src/config/pricing.ts`

**重要**: Fal 平台使用美元计价，但我们最终以人民币显示。配置时：
1. 在 `PRICES` 常量中使用美元价格
2. 在 `calculator` 中乘以 `USD_TO_CNY` 汇率常量（7.071）
3. `currency` 仍然设置为 `'¥'`

```typescript
// 1. 在 PRICES 常量中添加美元价格
const PRICES = {
  // fal 模型价格（美元）
  YOUR_FAL_MODEL: 0.0392,  // USD
  // ...
}

// 2. 在 pricingConfigs 数组中添加配置
{
  providerId: 'fal',
  modelId: 'your-fal-model',
  currency: '¥',  // 最终显示人民币
  type: 'calculated',
  calculator: (params) => {
    const numImages = params.num_images || 1
    // 美元价格 × 汇率 × 数量
    return PRICES.YOUR_FAL_MODEL * USD_TO_CNY * numImages
  }
}
```

**示例**（参考现有配置）:

```typescript
// nano-banana: $0.039/张
{
  providerId: 'fal',
  modelId: 'nano-banana',
  currency: '¥',
  type: 'calculated',
  calculator: (params) => {
    const numImages = params.num_images || 1
    return PRICES.NANO_BANANA * USD_TO_CNY * numImages
  }
}

// nano-banana-pro: $0.15/张（4K时×2）
{
  providerId: 'fal',
  modelId: 'nano-banana-pro',
  currency: '¥',
  type: 'calculated',
  calculator: (params) => {
    const numImages = params.num_images || 1
    const basePrice = PRICES.NANO_BANANA_PRO * USD_TO_CNY * numImages
    // 4K 分辨率时价格为 2 倍
    const multiplier = params.resolution === '4K' ? 2 : 1
    return basePrice * multiplier
  }
}

// veo3.1: 按秒计费，支持音频和快速模式
{
  providerId: 'fal',
  modelId: 'veo3.1',
  currency: '¥',
  type: 'calculated',
  calculator: (params) => {
    const duration = params.videoDuration || 8
    const mode = params.mode || 'text-image-to-video'
    const isFastMode = (params.veoFastMode || false) && mode !== 'reference-to-video'
    const isAudioOn = params.veoGenerateAudio || false

    // 获取价格（美元/秒）
    const pricePerSecondUSD = isFastMode
      ? (isAudioOn ? PRICES.VEO31.fast.audioOn : PRICES.VEO31.fast.audioOff)
      : (isAudioOn ? PRICES.VEO31.normal.audioOn : PRICES.VEO31.normal.audioOff)

    // 计算总价（转换为人民币）
    const totalPriceCNY = pricePerSecondUSD * USD_TO_CNY * duration

    // 保留两位小数
    return parseFloat(totalPriceCNY.toFixed(2))
  }
}
```

**关键要点**:
- ✅ 价格常量使用美元（与 fal 官方定价一致）
- ✅ calculator 中乘以 `USD_TO_CNY` 转换为人民币
- ✅ `currency: '¥'` 确保界面显示人民币符号
- ✅ 汇率统一管理，修改 `USD_TO_CNY` 常量即可全局更新

---

## 关键概念详解

### 1. submitPath vs modelId，重要

这是 Fal 适配器最容易出错的地方：

```typescript
//  正确：有子路径的模型（如 /edit）
{
  submitPath: 'fal-ai/nano-banana/edit',  // 提交请求用（含子路径）
  modelId: 'fal-ai/nano-banana',          // 查询状态用（不含子路径）
  requestData: { ... }
}

//  正确：完整路径的模型
{
  submitPath: 'fal-ai/bytedance/seedream/v4/text-to-image',
  modelId: 'fal-ai/bytedance/seedream/v4/text-to-image',  // 相同
  requestData: { ... }
}

// 错误：modelId 包含子路径
{
  submitPath: 'fal-ai/nano-banana/edit',
  modelId: 'fal-ai/nano-banana/edit',  // 错误！会导致状态查询失败
  requestData: { ... }
}
```

**规则**: `modelId` 永远不包含子路径（如 `/edit`, `/upscale`），只用于状态查询。

---

### 2. 图片参数处理，重要

Fal 适配器的图片已经自动上传到 CDN，**直接使用**：

```typescript
//  正确：直接使用
const images = params.images || []
if (images.length > 0) {
  requestData.image_urls = images  // FalAdapter 已上传到 CDN
}

// 错误：不要手动转换
requestData.image_urls = images.map(img =>
  img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`
)

// 错误：不要尝试上传
const uploadedUrls = await uploadToFalCDN(images)  // 不需要！
```

---

### 3. 智能匹配处理，重要

永远不要传递 `'smart'` 或 `'auto'` 给 API：

```typescript
//  正确：在路由中检测并转换
let aspectRatio = params.aspectRatio

if ((aspectRatio === 'smart' || aspectRatio === 'auto') && images.length > 0) {
  try {
    const { getImageAspectRatio, matchAspectRatio } = await import('@/utils/aspectRatio')
    const ratio = await getImageAspectRatio(images[0])
    aspectRatio = matchAspectRatio(ratio)  // 转换为实际比例
  } catch (error) {
    aspectRatio = '16:9'  // 回退默认值
  }
}

// 只传递实际的比例值
if (aspectRatio && aspectRatio !== 'smart' && aspectRatio !== 'auto') {
  requestData.aspect_ratio = aspectRatio
}

// 错误：直接传递
requestData.aspect_ratio = params.aspectRatio  // 可能是 'smart'，会导致 422 错误
```

---

### 4. 分辨率参数格式

Fal 模型使用三种格式之一，根据 API 文档选择：

```typescript
// 格式 1: aspect_ratio (字符串) - 最常用
requestData.aspect_ratio = params.aspectRatio  // "16:9", "1:1", "9:16"

// 格式 2: image_size (对象) - 某些模型
const [width, height] = params.imageSize.split('*').map(Number)
requestData.image_size = { width, height }

// 格式 3: resolution (字符串) - Nano Banana Pro
requestData.resolution = params.resolution  // "1K", "2K", "4K"
```

---

### 5. 多图输入场景

根据模型需求选择正确的参数名：

```typescript
// 单图（图生视频）
if (images.length > 0) {
  requestData.image_url = images[0]  // 单数
}

// 多图（图生图）
if (images.length > 0) {
  requestData.image_urls = images  // 复数
}

// 首尾帧（视频）
if (images.length >= 2) {
  requestData.start_image = images[0]
  requestData.end_image = images[1]
}
```

## 检查清单

###  Fal 特定步骤（必须完成）

- [ ] **步骤 1**: 创建模型路由文件 (`adapters/fal/models/[model-id].ts`)
  - [ ] 实现 `matches()` 方法（支持多个别名）
  - [ ] 实现 `buildImageRequest()` 或 `buildVideoRequest()`
  - [ ] 正确区分 `submitPath`（含子路径）和 `modelId`（不含子路径）
  - [ ] 直接使用 `params.images`（已上传到 CDN）
  - [ ] 过滤掉 `'smart'` 和 `'auto'`，不传递给 API
  - [ ] 添加智能匹配处理（如果支持）

- [ ] **步骤 2**: 注册路由 (`adapters/fal/models/index.ts`)
  - [ ] 导入新路由
  - [ ] 添加到 `falModelRoutes` 数组

- [ ] **步骤 3**: 配置预估轮询次数 (`adapters/fal/config.ts`)
  - [ ] 在 `modelEstimatedPolls` 中添加配置
  - [ ] 使用短名称（不含 `fal-ai/` 前缀）
  - [ ] 根据模型速度选择合适的值（5-60）

- [ ] **步骤 7**: 配置 providers.json
  - [ ] 添加模型配置到 fal 供应商的 models 数组
  - [ ] 设置正确的 `type` (image/video/audio)
  - [ ] 设置 `functions` 数组
  - [ ]  **关键**: `progressConfig.type` 必须是 `"polling"`
  - [ ] 设置 `expectedPolls` 与步骤 3 一致

###  通用步骤（必须完成）

- [ ] **步骤 4**: 定义参数 Schema (`src/models/[model-id].ts`)
  - [ ] 创建参数定义数组
  - [ ] 使用 `resolutionConfig` 配置分辨率选择器（如需要）
  - [ ] 添加动态选项（如智能匹配）

- [ ] **步骤 4.1**: 导出 Schema (`src/models/index.ts`)
  - [ ] 导出参数数组
  - [ ] 添加到 `modelSchemaMap`

- [ ] **步骤 5**: 添加参数面板渲染 (`ParameterPanel.tsx`)
  - [ ] 添加 `if (selectedModel === 'your-model')` 分支
  - [ ] 导入 Schema
  - [ ] 传递所有必需的 values（包括 `uploadedImages`）

- [ ] **步骤 6.1**: 注册参数映射 (`MediaGenerator/index.tsx`)
  - [ ] 在 `handleSchemaChange` 的 `setterMap` 中添加所有参数

- [ ] **步骤 6.2**: 预设映射 (`presetStateMapping.ts`)
  - [ ] 在 `PresetSetters` 接口中添加 setter 类型
  - [ ] 在 `createPresetSetterMap` 中添加映射
  - [ ] 在 `MediaGenerator/index.tsx` 的 setterMap 中传入 setter

###  其它步骤

- [ ] 配置价格 (`pricing.ts`)
- [ ] 添加状态管理（如果使用新参数）
- [ ] 添加默认值重置逻辑（如果共享状态）

---

## 核心要点总结

1. **图片已上传**: `params.images` 已经是 fal CDN URL，**直接使用**，不要手动上传
2. **区分路径**: `submitPath` 可以有子路径，`modelId` **永远不含**子路径
3. **轮询进度**: `providers.json` 必须配置 `"type": "polling"`
4. **智能匹配**: 永远不要传递 `'smart'` 或 `'auto'` 给 API，在路由中转换
5. **本地保存**: Fal 图片由 App.tsx 统一保存，解析器**不调用** `saveMediaLocally`