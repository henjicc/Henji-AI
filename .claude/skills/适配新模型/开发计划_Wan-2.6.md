# Wan 2.6 视频模型适配开发计划

## 第一部分：模型基本信息

### 1.1 模型标识

| 属性 | 值 | 说明 |
| :--- | :--- | :--- |
| **供应商** | ppio | 派欧云 PPIO |
| **模型 ID** | wan-2.6 | 系统内部唯一标识 |
| **显示名称** | Wan 2.6 | UI 显示的名称 |
| **模型类型** | video | 视频生成模型 |
| **别名** | 无 | - |

### 1.2 功能特性

| 功能 | 支持 | 备注 |
| :--- | :--- | :--- |
| 文生视频 | ✅ | 端点：/async/wan2.6-t2v |
| 图生视频 | ✅ | 端点：/async/wan2.6-i2v，最多 1 张图片 |
| 参考生视频 | ✅ | 端点：/async/wan2.6-v2v，最多 3 个视频 |
| 智能宽高比 | ✅ | 图生视频模式支持智能匹配 |
| 视频输入 | ✅ | 参考生视频模式支持上传 0-3 个视频 |

### 1.3 参数清单

| 参数 ID (带 ppio 前缀) | 类型 | 默认值 | 选项/范围 | API 字段对应 |
| :--- | :--- | :--- | :--- | :--- |
| `ppioWan26Mode` | dropdown | 'text-image-to-video' | 文/图生视频、参考生视频 | - (路由选择) |
| `ppioWan26AspectRatio` | dropdown | '16:9' | 16:9, 9:16, 1:1, 4:3, 3:4 | - (组合参数) |
| `ppioWan26Quality` | dropdown | '720P' | 720P, 1080P | - (组合参数) |
| `ppioWan26VideoDuration` | dropdown | 5 | 5, 10, 15 (文/图), 5, 10 (参考) | `duration` |
| `ppioWan26ShotType` | dropdown | 'multi' | single, multi | `shot_type` |
| `ppioWan26Audio` | toggle | true | true/false | `audio` |
| `ppioWan26PromptExtend` | toggle | false | true/false | `prompt_extend` |

**隐藏参数（不显示，部分需传递）：**
- `seed` - 不传递
- `negative_prompt` - 不传递
- `watermark` - 固定传递 `false`
- `audio_url` - 不传递
- `template` - 不传递（仅图生视频支持，暂不启用）
- `reference_video_urls` - 仅参考生视频模式传递（视频上传功能）

### 1.4 API 与定价

| 项目 | 内容 | 备注 |
| :--- | :--- | :--- |
| **API 端点** | `/async/wan2.6-t2v` (文生视频)<br>`/async/wan2.6-i2v` (图生视频)<br>`/async/wan2.6-v2v` (参考生视频) | 异步端点 |
| **基础价格** | 720P: ¥0.6/秒<br>1080P: ¥1.0/秒 | 人民币 |
| **价格计算** | 质量价格系数 × 时长（秒） | 示例：1080P 10秒 = ¥10.0 |
| **预估耗时** | 1-2 分钟 | 用于设置轮询策略 |

---

## 第二部分：开发实施步骤

### 阶段 1: 参数 Schema 定义

**目标**: 定义模型参数结构

**操作**:

- [ ] 新建 `src/models/ppio/wan-2.6.ts`
  - 定义 `ppioWan26Params: ParamDef[]`
  - 包含 7 个参数：模式、分辨率（比例）、质量档位、时长、镜头类型、生成音频、提示词优化
  - 配置分辨率特殊面板（使用 `resolutionConfig`）
  - 配置参数联动（`hidden` 函数）
  - 配置智能匹配（`autoSwitch`）

- [ ] 修改 `src/models/index.ts`
  - 导出 `ppioWan26Params`
  - 注册到 `modelSchemaMap['wan-2.6']`

**关键配置点**:

1. **模式参数** (`ppioWan26Mode`)：
   ```typescript
   {
     id: 'ppioWan26Mode',
     type: 'dropdown',
     label: '模式',
     defaultValue: 'text-image-to-video',
     options: [
       { value: 'text-image-to-video', label: '文/图生视频' },
       { value: 'reference-to-video', label: '参考生视频' }
     ]
   }
   ```

2. **分辨率参数** (`ppioWan26AspectRatio` + `ppioWan26Quality`)：
   - 使用**模式 A：比例 + 质量档位**
   - 组件显示名称：`'分辨率'`
   - 面板内部：上方显示"比例"，下方显示"质量"
   - 比例选项：16:9, 9:16, 1:1, 4:3, 3:4
   - 质量档位：720P, 1080P
   - 图生视频模式添加"智能"选项
   - 配置 `resolutionConfig`:
     ```typescript
     resolutionConfig: {
       type: 'aspect_ratio',
       smartMatch: true,
       visualize: true,
       extractRatio: (value) => {
         if (value === 'smart') return null
         const [w, h] = value.split(':').map(Number)
         return w / h
       },
       qualityOptions: [
         { value: '720P', label: '720P' },
         { value: '1080P', label: '1080P' }
       ],
       qualityKey: 'ppioWan26Quality',
       defaultQuality: '720P'
     }
     ```

3. **时长参数** (`ppioWan26VideoDuration`)：
   - 动态选项（根据模式）
   - 文/图生视频：5, 10, 15
   - 参考生视频：5, 10
   - 使用 `options` 函数实现动态切换

4. **参数联动**：
   - 参考生视频模式下，隐藏比例参数（因为 API 不同）
   - 使用 `hidden` 函数控制显示

**参考文件**: `src/models/ppio/vidu.ts`（Vidu Q1 模型，类似的模式切换逻辑）

---

### 阶段 2: 状态管理与类型

**目标**: 将新参数加入 React 状态管理与 TypeScript 类型系统

**操作**:

- [ ] 修改 `src/hooks/useMediaGeneratorState.ts`
  - 添加 7 个状态：
    ```typescript
    const [ppioWan26Mode, setPpioWan26Mode] = useState<string>('text-image-to-video')
    const [ppioWan26AspectRatio, setPpioWan26AspectRatio] = useState<string>('16:9')
    const [ppioWan26Quality, setPpioWan26Quality] = useState<string>('720P')
    const [ppioWan26VideoDuration, setPpioWan26VideoDuration] = useState<number>(5)
    const [ppioWan26ShotType, setPpioWan26ShotType] = useState<string>('multi')
    const [ppioWan26Audio, setPpioWan26Audio] = useState<boolean>(true)
    const [ppioWan26PromptExtend, setPpioWan26PromptExtend] = useState<boolean>(false)
    ```

- [ ] 修改 `src/components/MediaGenerator/builders/core/types.ts`
  - 在 `BuildOptionsParams` 接口添加：
    ```typescript
    ppioWan26Mode?: string
    ppioWan26AspectRatio?: string
    ppioWan26Quality?: string
    ppioWan26VideoDuration?: number
    ppioWan26ShotType?: string
    ppioWan26Audio?: boolean
    ppioWan26PromptExtend?: boolean
    ```

- [ ] 修改 `src/config/presetStateMapping.ts`
  - 在 `PresetSetters` 接口添加 7 个 setter 类型
  - 在 `presetStateMapping` 对象添加参数映射

---

### 阶段 3: UI 渲染逻辑

**目标**: 确保参数面板正确显示新模型参数

**操作**:

- [ ] 修改 `src/components/MediaGenerator/components/ParameterPanel.tsx`
  - 在排除参数列表中添加 `'seed'`, `'negative_prompt'`
  - 确认 `<SchemaRenderer>` 正确渲染 Wan 2.6 参数

- [ ] 修改 `src/components/MediaGenerator/components/InputArea.tsx`（**关键！**）
  - 在 `needsVideoUpload` 变量中添加 Wan 2.6 参考生视频模式的判断：
    ```typescript
    const needsVideoUpload =
      // ... 现有条件
      (selectedModel === 'wan-2.6' && ppioWan26Mode === 'reference-to-video') ||
      // ...
    ```
  - 这样参考生视频模式下才会显示视频上传区域

---

### 阶段 4: 参数传递管道

**目标**: 确保参数从 UI 状态流转到生成函数

**操作**:

- [ ] 修改 `src/components/MediaGenerator/index.tsx`

  **4.1 handleParamChange (setterMap)**
  ```typescript
  const setterMap: Record<string, (value: any) => void> = {
    // ... 现有映射
    ppioWan26Mode: setPpioWan26Mode,
    ppioWan26AspectRatio: setPpioWan26AspectRatio,
    ppioWan26Quality: setPpioWan26Quality,
    ppioWan26VideoDuration: setPpioWan26VideoDuration,
    ppioWan26ShotType: setPpioWan26ShotType,
    ppioWan26Audio: setPpioWan26Audio,
    ppioWan26PromptExtend: setPpioWan26PromptExtend,
  }
  ```

  **4.2 createPresetSetterMap**
  ```typescript
  const presetSetters: PresetSetters = {
    // ... 现有 setters
    setPpioWan26Mode,
    setPpioWan26AspectRatio,
    setPpioWan26Quality,
    setPpioWan26VideoDuration,
    setPpioWan26ShotType,
    setPpioWan26Audio,
    setPpioWan26PromptExtend,
  }
  ```

  **4.3 buildGenerateOptions**
  ```typescript
  const options = await buildGenerateOptions({
    // ... 现有参数
    ppioWan26Mode: state.ppioWan26Mode,
    ppioWan26AspectRatio: state.ppioWan26AspectRatio,
    ppioWan26Quality: state.ppioWan26Quality,
    ppioWan26VideoDuration: state.ppioWan26VideoDuration,
    ppioWan26ShotType: state.ppioWan26ShotType,
    ppioWan26Audio: state.ppioWan26Audio,
    ppioWan26PromptExtend: state.ppioWan26PromptExtend,
    // ...
  })
  ```

  **4.4 PriceEstimate props**
  ```typescript
  <PriceEstimate
    // ... 现有 props
    ppioWan26Mode={state.ppioWan26Mode}
    ppioWan26Quality={state.ppioWan26Quality}
    ppioWan26VideoDuration={state.ppioWan26VideoDuration}
  />
  ```

---

### 阶段 5: OptionsBuilder 配置

**目标**: 配置 UI 参数到 API 参数的映射规则

**操作**:

- [ ] 修改 `src/components/MediaGenerator/builders/configs/ppio-models.ts`

  添加 Wan 2.6 配置：
  ```typescript
  export const ppioWan26Config: ModelConfig = {
    id: 'wan-2.6',
    type: 'video',
    provider: 'ppio',

    paramMapping: {
      mode: {
        source: 'ppioWan26Mode',
        defaultValue: 'text-image-to-video'
      },
      aspectRatio: {
        source: 'ppioWan26AspectRatio',
        defaultValue: '16:9'
      },
      quality: {
        source: 'ppioWan26Quality',
        defaultValue: '720P'
      },
      duration: {
        source: ['ppioWan26VideoDuration', 'videoDuration'],
        defaultValue: 5
      },
      shotType: {
        source: 'ppioWan26ShotType',
        defaultValue: 'multi'
      },
      audio: {
        source: 'ppioWan26Audio',
        defaultValue: true
      },
      promptExtend: {
        source: 'ppioWan26PromptExtend',
        defaultValue: false
      }
    },

    features: {
      imageUpload: {
        enabled: true,
        maxImages: 1,
        mode: 'single',
        paramKey: 'images',
        convertToBlob: false  // PPIO 使用 base64
      },
      videoUpload: {
        enabled: true,  // 启用视频上传
        maxVideos: 3,
        paramKey: 'videos'
      }
    },

    customHandlers: {
      afterBuild: async (options, context) => {
        const mode = options.mode || 'text-image-to-video'

        // 处理图片上传（文/图生视频模式）
        if (mode === 'text-image-to-video' && context.uploadedImages.length > 0) {
          const { dataUrlToBlob, saveUploadImage } = await import('@/utils/save')
          const setUploadedFilePaths = (context.params as any).setUploadedFilePaths
          const uploadedFilePaths = (context.params as any).uploadedFilePaths || []

          options.images = [context.uploadedImages[0]]

          // 保存图片到本地（用于历史记录）
          if (!uploadedFilePaths[0]) {
            const blob = await dataUrlToBlob(context.uploadedImages[0])
            const saved = await saveUploadImage(blob, 'persist')
            setUploadedFilePaths([saved.fullPath])
            options.uploadedFilePaths = [saved.fullPath]
          } else {
            options.uploadedFilePaths = [uploadedFilePaths[0]]
          }
        }

        // 处理视频上传（参考生视频模式）
        if (mode === 'reference-to-video' && context.uploadedVideoFiles.length > 0) {
          options.videos = context.uploadedVideoFiles.slice(0, 3)
        }
      }
    }
  }
  ```

- [ ] 修改 `src/components/MediaGenerator/builders/configs/index.ts`
  ```typescript
  import { ppioWan26Config } from './ppio-models'

  export function registerAllConfigs() {
    // ... 现有注册
    optionsBuilder.registerConfig(ppioWan26Config)
  }
  ```

---

### 阶段 6: 适配器路由实现

**目标**: 实现 API 请求构建逻辑

**操作**:

- [ ] 新建 `src/adapters/ppio/models/wan-2.6.ts`

  实现内容：
  ```typescript
  import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'

  /**
   * PPIO Wan 2.6 模型路由
   * 支持 3 种模式：文生视频、图生视频、参考生视频
   */
  export const wan26Route = {
    matches: (modelId: string): modelId is 'wan-2.6' => modelId === 'wan-2.6',

    buildVideoRequest: async (params: GenerateVideoParams): Promise<{ endpoint: string; requestData: any }> => {
      const mode = params.mode || 'text-image-to-video'
      const images = params.images || []
      const videos = params.videos || []
      const aspectRatio = params.aspectRatio || '16:9'
      const quality = params.quality || '720P'
      const duration = params.duration || 5
      const shotType = params.shotType || 'multi'
      const audio = params.audio !== undefined ? params.audio : true
      const promptExtend = params.promptExtend || false
      const prompt = (params.prompt || '').slice(0, 2000)

      if (!prompt.trim()) {
        throw new Error('视频生成需要提供非空的 prompt')
      }

      let endpoint: string
      let requestData: any = {
        prompt,
        duration,
        shot_type: shotType,
        audio,
        prompt_extend: promptExtend,
        watermark: false  // 固定发送 false
      }

      // 分辨率映射表（比例 + 质量 → 具体数值）
      const resolutionMap: Record<string, Record<string, string>> = {
        '16:9': { '720P': '1280*720', '1080P': '1920*1080' },
        '9:16': { '720P': '720*1280', '1080P': '1080*1920' },
        '1:1': { '720P': '960*960', '1080P': '1440*1440' },
        '4:3': { '720P': '1088*832', '1080P': '1632*1248' },
        '3:4': { '720P': '832*1088', '1080P': '1248*1632' }
      }

      switch (mode) {
        case 'text-image-to-video':
          if (images.length > 0) {
            // 图生视频
            endpoint = '/async/wan2.6-i2v'
            requestData.img_url = images[0]  // Base64 编码
            requestData.resolution = quality  // 图生视频使用质量档位
          } else {
            // 文生视频
            endpoint = '/async/wan2.6-t2v'
            const size = resolutionMap[aspectRatio]?.[quality] || '1280*720'
            requestData.size = size  // 文生视频使用具体数值
          }
          break

        case 'reference-to-video':
          // 参考生视频
          if (videos.length === 0) {
            throw new Error('参考生视频模式需要上传至少 1 个视频')
          }

          endpoint = '/async/wan2.6-v2v'

          // 上传视频到通用上传服务
          const videoUrls = await Promise.all(
            videos.slice(0, 3).map(video => uploadVideoToGeneralService(video))
          )

          requestData.reference_video_urls = videoUrls.map(url => ({ url }))

          const size = resolutionMap[aspectRatio]?.[quality] || '1280*720'
          requestData.size = size  // 参考生视频使用具体数值
          break

        default:
          throw new Error(`不支持的 Wan 2.6 模式: ${mode}`)
      }

      return { endpoint, requestData }
    }
  }

  /**
   * 上传视频到通用上传服务
   */
  async function uploadVideoToGeneralService(video: File | string): Promise<string> {
    if (typeof video === 'string') {
      return video
    }

    try {
      const { UploadService } = await import('@/services/upload/UploadService')
      const uploadService = UploadService.getInstance()
      return await uploadService.uploadFile(video)
    } catch (error) {
      throw new Error(`视频上传失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  ```

- [ ] 修改 `src/adapters/ppio/models/index.ts`
  ```typescript
  import { wan26Route } from './wan-2.6'

  export const ppioModelRoutes: ModelRoute[] = [
    // ... 现有路由
    wan26Route
  ]
  ```

**关键实现点**:
1. **分辨率转换逻辑**: 比例 + 质量档位 → 具体数值
2. **端点选择**: 根据模式和图片数量选择正确端点
3. **参数传递差异**:
   - 文生视频/参考生视频 → `size: "1920*1080"`
   - 图生视频 → `resolution: "1080P"`
4. **视频上传**: 使用 `UploadService` 上传到通用服务

---

### 阶段 7: 元数据与定价

**目标**: 系统注册与计费配置

**操作**:

- [ ] 修改 `src/config/providers.json`

  在 PPIO 供应商的 models 数组中添加：
  ```json
  {
    "id": "wan-2.6",
    "name": "Wan 2.6",
    "type": "video",
    "progressConfig": {
      "type": "polling",
      "expectedPolls": 40
    }
  }
  ```

- [ ] 修改 `src/config/pricing.ts`

  **7.1 添加价格常量**
  ```typescript
  const PRICES = {
    // ... 现有价格
    WAN_26_720P: 0.6,   // 人民币/秒
    WAN_26_1080P: 1.0   // 人民币/秒
  }
  ```

  **7.2 添加价格配置**
  ```typescript
  export const pricingConfig: PricingRule[] = [
    // ... 现有配置
    {
      providerId: 'ppio',
      modelId: 'wan-2.6',
      currency: '¥',
      type: 'calculated',
      calculator: (params) => {
        const quality = params.ppioWan26Quality || params.quality || '720P'
        const duration = params.ppioWan26VideoDuration || params.videoDuration || 5

        const pricePerSecond = quality === '1080P'
          ? PRICES.WAN_26_1080P
          : PRICES.WAN_26_720P

        return pricePerSecond * duration
      }
    }
  ]
  ```

---

## 第三部分：特殊实现要点

### 1. 分辨率面板设计

**设计模式**: 比例 + 质量档位（模式 A）

**UI 结构**:
```
┌─────────────────────────────┐
│  分辨率                      │  ← 组件显示名称
├─────────────────────────────┤
│  比例                        │  ← 面板内部标签
│  [智能] [16:9] [9:16] [1:1] │  ← 图生视频时显示智能
│          [4:3] [3:4]         │
├─────────────────────────────┤
│  质量                        │  ← 面板内部标签
│  [720P]  [1080P]            │
└─────────────────────────────┘
```

**参数关系**:
- `ppioWan26AspectRatio`: 存储比例值（16:9, 9:16, 1:1, 4:3, 3:4, smart）
- `ppioWan26Quality`: 存储质量档位（720P, 1080P）
- 路由层组合两者，转换为 API 所需格式

**智能匹配逻辑**:
- 图生视频模式 + 有图片 → 自动添加"智能"选项并切换
- 智能匹配后，自动检测图片比例，选择最接近的预设比例

### 2. 视频上传功能

**实现步骤**:

1. **Config 配置** (`ppio-models.ts`):
   ```typescript
   features: {
     videoUpload: {
       enabled: true,
       maxVideos: 3,
       paramKey: 'videos'
     }
   }
   ```

2. **InputArea 注册** (`InputArea.tsx`):
   ```typescript
   const needsVideoUpload =
     (selectedModel === 'wan-2.6' && ppioWan26Mode === 'reference-to-video') ||
     // ... 其他条件
   ```

3. **路由处理** (`wan-2.6.ts`):
   ```typescript
   // 接收 uploadedVideoFiles（File 对象数组）
   const videos = params.videos || []

   // 上传到通用服务
   const videoUrls = await Promise.all(
     videos.slice(0, 3).map(video => uploadVideoToGeneralService(video))
   )

   // 传递给 API
   requestData.reference_video_urls = videoUrls.map(url => ({ url }))
   ```

**注意事项**:
- 前端状态 `uploadedVideos` 只包含缩略图
- 必须使用 `uploadedVideoFiles` 获取原始 File 对象
- 使用 `UploadService` 统一处理上传逻辑

### 3. 参数传递差异处理

**不同端点的参数格式**:

| 端点 | 分辨率参数名 | 参数格式 | 示例 |
|------|------------|---------|------|
| `/async/wan2.6-t2v` | `size` | 具体数值 | `"1920*1080"` |
| `/async/wan2.6-i2v` | `resolution` | 质量档位 | `"1080P"` |
| `/async/wan2.6-v2v` | `size` | 具体数值 | `"1920*1080"` |

**路由层转换逻辑**:
```typescript
const resolutionMap = {
  '16:9': { '720P': '1280*720', '1080P': '1920*1080' },
  // ...
}

if (endpoint === '/async/wan2.6-i2v') {
  requestData.resolution = quality  // 直接使用质量档位
} else {
  const size = resolutionMap[aspectRatio]?.[quality]
  requestData.size = size  // 转换为具体数值
}
```

### 4. 时长参数动态选项

**需求**: 不同模式支持不同的时长选项

**实现方式**: 使用 `options` 函数

```typescript
{
  id: 'ppioWan26VideoDuration',
  type: 'dropdown',
  label: '时长',
  defaultValue: 5,
  options: (values) => {
    const mode = values.ppioWan26Mode || 'text-image-to-video'

    if (mode === 'reference-to-video') {
      // 参考生视频：5s, 10s
      return [
        { value: 5, label: '5s' },
        { value: 10, label: '10s' }
      ]
    } else {
      // 文/图生视频：5s, 10s, 15s
      return [
        { value: 5, label: '5s' },
        { value: 10, label: '10s' },
        { value: 15, label: '15s' }
      ]
    }
  }
}
```

**配合 autoSwitch**: 当切换到参考生视频模式且当前时长为 15s 时，自动切换到 10s

---

## 第四部分：文件变更汇总

| 类别 | 文件路径 | 操作 |
| :--- | :--- | :--- |
| **新建** | `src/models/ppio/wan-2.6.ts` | 创建参数 Schema |
| **新建** | `src/adapters/ppio/models/wan-2.6.ts` | 创建模型路由 |
| **核心** | `src/models/index.ts` | 注册 Schema 映射 |
| **核心** | `src/hooks/useMediaGeneratorState.ts` | 添加状态管理 |
| **UI** | `src/components/MediaGenerator/components/ParameterPanel.tsx` | 排除参数配置 |
| **UI** | `src/components/MediaGenerator/components/InputArea.tsx` | 视频上传显示逻辑 |
| **UI** | `src/components/MediaGenerator/index.tsx` | 参数传递管道 |
| **类型** | `src/components/MediaGenerator/builders/core/types.ts` | 添加 TypeScript 类型 |
| **类型** | `src/config/presetStateMapping.ts` | 添加预设映射 |
| **配置** | `src/components/MediaGenerator/builders/configs/ppio-models.ts` | 添加 OptionsBuilder 配置 |
| **配置** | `src/components/MediaGenerator/builders/configs/index.ts` | 注册配置 |
| **配置** | `src/adapters/ppio/models/index.ts` | 注册路由 |
| **配置** | `src/config/providers.json` | 添加模型元数据 |
| **配置** | `src/config/pricing.ts` | 添加价格计算 |

---

## 第五部分：开发顺序建议

按照以下顺序开发，可以逐步验证功能：

### 第一阶段：基础框架（参数定义 + 状态管理）
1. ✅ 创建 `src/models/ppio/wan-2.6.ts`
2. ✅ 修改 `src/models/index.ts`
3. ✅ 修改 `src/hooks/useMediaGeneratorState.ts`
4. ✅ 修改 `src/components/MediaGenerator/builders/core/types.ts`
5. ✅ 修改 `src/config/presetStateMapping.ts`

**验证**: 参数面板能否正确显示所有参数

### 第二阶段：参数传递（UI → OptionsBuilder）
6. ✅ 修改 `src/components/MediaGenerator/index.tsx`（4 个位置）
7. ✅ 修改 `src/components/MediaGenerator/components/ParameterPanel.tsx`
8. ✅ 创建 `src/components/MediaGenerator/builders/configs/ppio-models.ts`（添加 Wan 2.6 配置）
9. ✅ 修改 `src/components/MediaGenerator/builders/configs/index.ts`

**验证**: 控制台打印 `buildGenerateOptions` 输出，检查参数是否正确传递

### 第三阶段：适配器路由（API 请求构建）
10. ✅ 创建 `src/adapters/ppio/models/wan-2.6.ts`
11. ✅ 修改 `src/adapters/ppio/models/index.ts`

**验证**:
- 文生视频能否正常生成
- 图生视频能否正常生成（不包含视频上传）

### 第四阶段：视频上传功能
12. ✅ 修改 `src/components/MediaGenerator/components/InputArea.tsx`
13. ✅ 完善 `wan-2.6.ts` 路由中的视频上传逻辑
14. ✅ 完善 `ppio-models.ts` 配置中的 `afterBuild` 钩子

**验证**: 参考生视频模式能否上传视频并成功生成

### 第五阶段：元数据与定价
15. ✅ 修改 `src/config/providers.json`
16. ✅ 修改 `src/config/pricing.ts`

**验证**: 价格估算是否正确显示

---

## 第六部分：测试用例

### 测试场景 1: 文生视频
- **模式**: 文/图生视频
- **比例**: 16:9
- **质量**: 1080P
- **时长**: 10s
- **期望端点**: `/async/wan2.6-t2v`
- **期望参数**: `{ size: "1920*1080", duration: 10, shot_type: "multi", audio: true, prompt_extend: false, watermark: false }`
- **期望价格**: ¥10.0

### 测试场景 2: 图生视频
- **模式**: 文/图生视频
- **上传**: 1 张图片
- **比例**: 智能（自动检测为 9:16）
- **质量**: 720P
- **时长**: 5s
- **期望端点**: `/async/wan2.6-i2v`
- **期望参数**: `{ img_url: "base64...", resolution: "720P", duration: 5, ... }`
- **期望价格**: ¥3.0

### 测试场景 3: 参考生视频
- **模式**: 参考生视频
- **上传**: 2 个视频
- **比例**: 1:1
- **质量**: 1080P
- **时长**: 10s
- **期望端点**: `/async/wan2.6-v2v`
- **期望参数**: `{ reference_video_urls: [{url: "..."}, {url: "..."}], size: "1440*1440", duration: 10, ... }`
- **期望价格**: ¥10.0

### 测试场景 4: 模式切换
- **操作**: 文/图生视频 → 参考生视频
- **期望**: 时长选项从 5/10/15 变为 5/10
- **期望**: 如果当前时长为 15s，自动切换到 10s

### 测试场景 5: 视频上传显示
- **操作**: 切换到参考生视频模式
- **期望**: 上传区域显示视频上传框
- **期望**: 顶部提示显示"最多上传 3 个视频"

---

## 第七部分：常见问题预防

### 问题 1: 参数面板不显示
**预防措施**:
- 确保 `ParameterPanel.tsx` 中没有误将 Wan 2.6 参数排除
- 确保 `modelSchemaMap['wan-2.6']` 正确注册

### 问题 2: 价格不更新
**预防措施**:
- 确保 `PriceEstimate` 传入了 `ppioWan26Quality` 和 `ppioWan26VideoDuration`
- 确保 `pricing.ts` 的计算器函数使用了正确的参数名

### 问题 3: 视频上传区域不显示
**预防措施**:
- 必须在 `InputArea.tsx` 中注册 `needsVideoUpload` 条件
- 确保 Config 中 `videoUpload.enabled: true`

### 问题 4: 分辨率传递错误
**预防措施**:
- 路由层仔细区分 `size` 和 `resolution` 参数
- 测试所有比例 + 质量组合的映射

### 问题 5: 智能匹配不工作
**预防措施**:
- 确保 `resolutionConfig.smartMatch: true`
- 确保 `extractRatio` 函数正确处理 'smart' 值
- 确保 `autoSwitch` 配置了 `watchKeys: ['uploadedImages']`

---

## 第八部分：参考资料

### 类似模型参考
- **PPIO Vidu Q1**: 模式切换逻辑（文/图/首尾帧/参考生视频）
- **PPIO Kling O1**: 视频上传功能
- **PPIO Kling 2.6 Pro**: 比例 + 质量档位面板

### 文档参考
- **分辨率面板设计规则**: `.claude/skills/适配新模型/resources/分辨率面板设计规则.md`
- **PPIO 适配指南**: `.claude/skills/适配新模型/resources/适配指南/ai-guide-ppio.md`
- **视频上传指南**: `.claude/skills/适配新模型/resources/常见问题/新模型视频上传适配指南.md`

### API 文档
- 文生视频: `docs/api/派欧云PPIO/视频/Wan-2.6-文生视频.md`
- 图生视频: `docs/api/派欧云PPIO/视频/Wan-2.6-图生视频.md`
- 参考生视频: `docs/api/派欧云PPIO/视频/Wan-2.6-参考生视频.md`

---

## 完成标志

当以下所有功能正常工作时，视为适配完成：

✅ 参数面板正确显示所有参数
✅ 分辨率面板显示比例 + 质量档位
✅ 图生视频时自动添加智能选项
✅ 文生视频能成功生成
✅ 图生视频能成功生成
✅ 参考生视频模式显示视频上传区域
✅ 参考生视频能成功上传并生成
✅ 价格估算正确显示
✅ 模式切换时参数正确联动
✅ 历史记录能正确保存和恢复

---

**开发计划制定完成！准备进入代码编写阶段。**
