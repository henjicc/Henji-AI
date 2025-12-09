# Fal 模型适配指南 v2

---

## 1. 快速开始：5 个真实示例

### 示例 1：纯文生图（Nano Banana）

```typescript
export const nanoBananaConfig: ModelConfig = {
  id: 'nano-banana',
  type: 'image',
  provider: 'fal',

  paramMapping: {
    num_images: {
      source: ['falNanoBananaNumImages', 'numImages'],
      defaultValue: 1
    },
    aspect_ratio: {
      source: ['falNanoBananaAspectRatio', 'aspectRatio'],
      defaultValue: '1:1'
    },
    seed: 'seed',
    guidance_scale: 'guidanceScale',
    num_inference_steps: 'numInferenceSteps',
    enable_safety_checker: 'enableSafetyChecker'
  },

  features: {
    smartMatch: {
      enabled: true,
      paramKey: 'aspect_ratio',
      defaultRatio: '1:1'
    }
  }

  // 不需要 customHandlers（无图片上传）
}
```

**特点**：
- 纯文生图，无图片上传
- 使用 smartMatch 自动匹配宽高比
- 不需要 customHandlers

---

### 示例 2：图生图（Kling Image O1）

```typescript
export const falKlingImageO1Config: ModelConfig = {
  id: 'fal-ai-kling-image-o1',
  type: 'image',
  provider: 'fal',

  paramMapping: {
    num_images: {
      source: ['falKlingImageO1NumImages', 'numImages'],
      defaultValue: 1
    },
    aspect_ratio: {
      source: ['falKlingImageO1AspectRatio', 'aspectRatio'],
      defaultValue: '1:1'
    },
    seed: 'seed',
    negative_prompt: 'negativePrompt'
  },

  features: {
    smartMatch: {
      enabled: true,
      paramKey: 'aspect_ratio',
      defaultRatio: '1:1'
    },
    imageUpload: {
      enabled: true,
      maxImages: 1,
      mode: 'single',
      paramKey: 'image_url',
      convertToBlob: false
    }
  },

  customHandlers: commonImageUploadHandler
}
```

**特点**：
- 支持图片上传（单张）
- 使用 `commonImageUploadHandler` 处理图片
- 使用 smartMatch 自动匹配宽高比

---

### 示例 3：图生视频（Veo 3.1）

```typescript
export const falVeo31Config: ModelConfig = {
  id: 'veo3.1',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    mode: {
      source: 'falVeo31Mode',
      defaultValue: 'text-image-to-video'
    },
    duration: {
      source: ['falVeo31VideoDuration', 'videoDuration'],
      defaultValue: 8
    },
    veoAspectRatio: {
      source: 'falVeo31AspectRatio',
      defaultValue: '16:9'
    },
    veoResolution: {
      source: 'falVeo31Resolution',
      defaultValue: '1080p'
    },
    veoEnhancePrompt: 'falVeo31EnhancePrompt',
    veoGenerateAudio: 'falVeo31GenerateAudio',
    veoAutoFix: 'falVeo31AutoFix',
    fastMode: 'falVeo31FastMode'
  },

  features: {
    smartMatch: {
      enabled: true,
      paramKey: 'veoAspectRatio',
      defaultRatio: '16:9'
    },
    imageUpload: {
      enabled: true,
      maxImages: 2,
      mode: 'multiple',
      paramKey: 'images',
      convertToBlob: false
    }
  },

  customHandlers: commonImageUploadHandler
}
```

**特点**：
- 支持多张图片上传（首尾帧）
- 使用 `mode` 参数决定端点
- 使用 smartMatch 自动匹配宽高比

---

### 示例 4：视频编辑（LTX-2）

```typescript
export const falLtx2Config: ModelConfig = {
  id: 'ltx-2',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    mode: {
      source: 'falLtx2Mode',
      defaultValue: 'text-to-video'
    },
    duration: {
      source: ['falLtx2RetakeDuration', 'falLtx2VideoDuration', 'videoDuration'],
      defaultValue: 6
    },
    ltxResolution: {
      source: 'falLtx2Resolution',
      defaultValue: '1080p'
    },
    ltxFps: {
      source: 'falLtx2Fps',
      defaultValue: 25
    },
    ltxGenerateAudio: {
      source: 'falLtx2GenerateAudio',
      defaultValue: true
    },
    ltxFastMode: {
      source: 'falLtx2FastMode',
      defaultValue: true
    },
    ltxRetakeStartTime: {
      source: 'falLtx2RetakeStartTime',
      defaultValue: 0
    },
    ltxRetakeMode: {
      source: 'falLtx2RetakeMode',
      defaultValue: 'replace_audio_and_video'
    }
  },

  features: {
    imageUpload: {
      enabled: true,
      maxImages: 1,
      mode: 'single',
      paramKey: 'image_url',
      convertToBlob: false
    },
    videoUpload: {
      enabled: true,
      maxVideos: 1,
      paramKey: 'videos'
    }
  },

  customHandlers: commonMediaUploadHandler
}
```

**特点**：
- 支持图片和视频上传
- 使用 `commonMediaUploadHandler` 处理媒体文件
- 使用 `mode` 参数决定端点（文生视频/图生视频/视频编辑）

---

### 示例 5：多模式模型（Kling Video O1）

```typescript
export const falKlingVideoO1Config: ModelConfig = {
  id: 'kling-video-o1',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    mode: {
      source: 'falKlingVideoO1Mode',
      defaultValue: 'image-to-video'
    },
    duration: {
      source: ['falKlingVideoO1VideoDuration', 'videoDuration'],
      defaultValue: 5
    },
    aspectRatio: {
      source: 'falKlingVideoO1AspectRatio',
      defaultValue: '16:9'
    },
    keepAudio: {
      source: 'falKlingVideoO1KeepAudio',
      defaultValue: false
    },
    elements: 'falKlingVideoO1Elements',
    negative_prompt: 'videoNegativePrompt'
  },

  features: {
    smartMatch: {
      enabled: true,
      paramKey: 'aspectRatio',
      defaultRatio: '16:9'
    },
    imageUpload: {
      enabled: true,
      maxImages: 2,
      mode: 'multiple',
      paramKey: 'images',
      convertToBlob: false
    },
    videoUpload: {
      enabled: true,
      maxVideos: 1,
      paramKey: 'videos'
    }
  },

  customHandlers: commonMediaUploadHandler
}
```

**特点**：
- 支持 4 种模式：图生视频、参考生视频、视频编辑、视频参考
- 同时支持图片和视频上传
- 使用 smartMatch 自动匹配宽高比

---

## 2. 配置参考

### 2.1 paramMapping（参数映射）

将 UI 参数映射到 API 参数。

#### 形式 1：字符串映射

```typescript
paramMapping: {
  seed: 'seed'  // API 的 seed 参数来自 params.seed
}
```

#### 形式 2：数组映射（优先级回退）

```typescript
paramMapping: {
  duration: {
    source: ['falVeo31VideoDuration', 'videoDuration'],
    defaultValue: 8
  }
}
```

**工作原理**：
1. 优先使用 `params.falVeo31VideoDuration`
2. 如果不存在，使用 `params.videoDuration`
3. 如果都不存在，使用 `defaultValue`

**使用场景**：
- 模型特定参数 + 通用参数回退
- 新旧参数兼容

#### 形式 3：对象映射（完整配置）

```typescript
paramMapping: {
  num_images: {
    source: 'falNanoBananaNumImages',
    defaultValue: 1
  }
}
```

---

### 2.2 features（功能配置）

#### smartMatch（智能宽高比匹配）

当用户上传图片时，自动匹配图片的宽高比。

```typescript
features: {
  smartMatch: {
    enabled: true,
    paramKey: 'aspect_ratio',
    defaultRatio: '16:9'
  }
}
```

**工作流程**：
1. 用户上传图片 → UI 参数自动设置为 `'smart'`
2. 生成时 → OptionsBuilder 计算图片实际宽高比
3. 替换 `'smart'` → 最接近的预设比例（如 `'16:9'`、`'1:1'`）
4. 传递给 API → 具体的比例值

**注意**：
- `paramKey` 必须是 API 参数名（paramMapping 的 key）
- 用户可手动选择具体比例，覆盖智能匹配

---

#### imageUpload（图片上传配置）

```typescript
features: {
  imageUpload: {
    enabled: true,
    maxImages: 1,
    mode: 'single',
    paramKey: 'image_url',
    convertToBlob: false
  }
}
```

**mode 说明**：
- `'single'`：单张图片，API 参数为字符串
- `'multiple'`：多张图片，API 参数为数组

---

#### videoUpload（视频上传配置）

```typescript
features: {
  videoUpload: {
    enabled: true,
    maxVideos: 1,
    paramKey: 'videos'
  }
}
```

**注意**：
- 视频以 File 对象形式传递给适配器
- 适配器会自动转换为 base64 并上传到 Fal CDN
- 视频文件不会保存到 history.json

---

### 2.3 customHandlers（自定义处理器）

在 `buildGenerateOptions` 后执行自定义逻辑。

#### 通用处理器 1：commonImageUploadHandler

用于支持图片上传的模型。

```typescript
import { commonImageUploadHandler } from './fal-models'

customHandlers: commonImageUploadHandler
```

**功能**：
- 设置 `options.images`（data URL 数组）
- 保存图片到本地文件系统
- 记录文件路径到 `options.uploadedFilePaths`

**适用模型**：Nano Banana、Kling Image O1、Veo 3.1、Seedance V1 等

---

#### 通用处理器 2：commonVideoUploadHandler

用于支持视频上传的模型。

```typescript
import { commonVideoUploadHandler } from './fal-models'

customHandlers: commonVideoUploadHandler
```

**功能**：
- 设置 `options.videos`（File 对象数组）
- 保存视频缩略图到 `options.uploadedVideos`
- 保存视频文件到本地并记录路径到 `options.uploadedVideoFilePaths`

**适用模型**：LTX-2（视频编辑模式）、Vidu Q2（视频延长模式）

---

#### 通用处理器 3：commonMediaUploadHandler

用于同时支持图片和视频上传的模型。

```typescript
import { commonMediaUploadHandler } from './fal-models'

customHandlers: commonMediaUploadHandler
```

**功能**：组合 `commonImageUploadHandler` 和 `commonVideoUploadHandler`

**适用模型**：Kling Video O1、LTX-2、Vidu Q2

---

#### 自定义处理器模板

当需要特殊逻辑时（如分辨率计算、参数转换）：

```typescript
customHandlers: {
  afterBuild: async (options: Record<string, any>, context: BuildContext) => {
    const params = context.params

    // 1. 处理图片上传（如果需要）
    if (context.uploadedImages.length > 0) {
      const { dataUrlToBlob, saveUploadImage } = await import('@/utils/save')
      const setUploadedFilePaths = (params as any).setUploadedFilePaths
      const uploadedFilePaths = (params as any).uploadedFilePaths || []

      options.images = context.uploadedImages

      const paths: string[] = [...uploadedFilePaths]
      for (let i = 0; i < context.uploadedImages.length; i++) {
        if (!paths[i]) {
          const blob = await dataUrlToBlob(context.uploadedImages[i])
          const saved = await saveUploadImage(blob, 'persist')
          paths[i] = saved.fullPath
        }
      }

      setUploadedFilePaths(paths)
      options.uploadedFilePaths = paths
    }

    // 2. 自定义逻辑（示例：分辨率计算）
    if (params.selectedResolution === 'smart') {
      const { calculateSeedreamSmartResolution } = await import('../../utils/resolutionUtils')
      const smartSize = await calculateSeedreamSmartResolution(
        context.uploadedImages[0],
        params.resolutionQuality
      )
      options.imageSize = smartSize.replace('x', '*')
    }

    // 3. 参数格式转换（示例：确保数组格式）
    if (options.images && !Array.isArray(options.images)) {
      options.images = [options.images]
    }
  }
}
```

**重要规则**：
- 可以修改 `options` 对象
- 可以调用 setter 函数（如 `setUploadedFilePaths`）
- 不要直接修改 `context.params` 的属性

---

## 3. 决策树

### 3.1 如何选择 customHandlers？

```
模型支持图片上传？
├─ 否 → 不需要 customHandlers
└─ 是 → 模型支持视频上传？
    ├─ 否 → 需要自定义逻辑（如分辨率计算）？
    │   ├─ 否 → 使用 commonImageUploadHandler
    │   └─ 是 → 自定义处理器（基于 commonImageUploadHandler 扩展）
    └─ 是 → 使用 commonMediaUploadHandler
```

### 3.2 如何配置 features？

```
模型类型？
├─ 纯文生图/文生视频
│   └─ features: { smartMatch: {...} }
│
├─ 图生图/图生视频
│   └─ features: {
│       smartMatch: {...},
│       imageUpload: {...}
│     }
│
└─ 视频编辑/多模态
    └─ features: {
        smartMatch: {...},
        imageUpload: {...},
        videoUpload: {...}
      }
```

### 3.3 如何处理多模式模型？

**方案 1：使用 mode 参数决定端点**

```typescript
paramMapping: {
  mode: {
    source: 'falVeo31Mode',
    defaultValue: 'text-image-to-video'
  }
}
```

适配器会根据 `mode` 参数选择不同的 API 端点。

**方案 2：在适配器中根据上传内容自动判断**

```typescript
// 适配器逻辑（参考）
if (params.videos && params.videos.length > 0) {
  endpoint = 'video-to-video'
} else if (params.images && params.images.length > 0) {
  endpoint = 'image-to-video'
} else {
  endpoint = 'text-to-video'
}
```

---

## 4. 常见问题

### Q1: API 要求 images 必须是数组，但只有一张图片怎么办？

**A**: 在 customHandlers 中包装成数组：

```typescript
customHandlers: {
  afterBuild: async (options, context) => {
    // ... 标准图片上传逻辑 ...

    // 确保 images 是数组格式
    if (options.images && !Array.isArray(options.images)) {
      options.images = [options.images]
    }
  }
}
```

**适用场景**：某些 API 端点要求数组格式

---

### Q2: 如何处理分辨率计算？

**A**: 在 customHandlers 中添加分辨率计算逻辑：

```typescript
customHandlers: {
  afterBuild: async (options, context) => {
    const params = context.params

    // 处理图片上传...

    // 分辨率计算
    if (params.selectedResolution === 'smart' && context.uploadedImages.length > 0) {
      const { calculateSeedreamSmartResolution } = await import('../../utils/resolutionUtils')
      const smartSize = await calculateSeedreamSmartResolution(
        context.uploadedImages[0],
        params.resolutionQuality
      )
      // Fal 使用 "width*height" 格式（注意是 '*' 而不是 'x'）
      options.imageSize = smartSize.replace('x', '*')
    }
  }
}
```

**适用场景**：Seedream V4/V4.5

---

### Q3: 为什么 File 对象不会保存到 history.json？

**A**: App.tsx 的 sanitization 逻辑会删除以下字段：

```typescript
delete sanitizedOptions.images
delete sanitizedOptions.uploadedImages
delete sanitizedOptions.videos
delete sanitizedOptions.uploadedVideos
```

**保留的字段**：
- `uploadedFilePaths`：图片本地文件路径
- `uploadedVideoFilePaths`：视频本地文件路径

这些路径用于历史记录恢复和重新编辑。

---

### Q4: paramMapping 的 source 数组如何工作？

**A**: 按优先级顺序尝试，使用第一个存在的值：

```typescript
duration: {
  source: ['falLtx2RetakeDuration', 'falLtx2VideoDuration', 'videoDuration'],
  defaultValue: 6
}
```

**查找顺序**：
1. `params.falLtx2RetakeDuration`（视频编辑模式专用）
2. `params.falLtx2VideoDuration`（LTX-2 通用时长）
3. `params.videoDuration`（全局通用时长）
4. `6`（默认值）

---

### Q5: smartMatch 的 paramKey 应该填什么？

**A**: 填写 **API 参数名**（paramMapping 的 key），不是 UI 参数名。

```typescript
paramMapping: {
  veoAspectRatio: {
    source: 'falVeo31AspectRatio',
    defaultValue: '16:9'
  }
}

features: {
  smartMatch: {
    paramKey: 'veoAspectRatio'
  }
}
```

---

## 5. 完整配置模板

### 模板 1：纯文生图模型

```typescript
export const yourModelConfig: ModelConfig = {
  id: 'your-model-id',
  type: 'image',
  provider: 'fal',

  paramMapping: {
    num_images: {
      source: ['yourModelNumImages', 'numImages'],
      defaultValue: 1
    },
    aspect_ratio: {
      source: ['yourModelAspectRatio', 'aspectRatio'],
      defaultValue: '1:1'
    },
    seed: 'seed'
  },

  features: {
    smartMatch: {
      enabled: true,
      paramKey: 'aspect_ratio',
      defaultRatio: '1:1'
    }
  }
}
```

---

### 模板 2：图生图模型

```typescript
export const yourModelConfig: ModelConfig = {
  id: 'your-model-id',
  type: 'image',
  provider: 'fal',

  paramMapping: {
    num_images: {
      source: ['yourModelNumImages', 'numImages'],
      defaultValue: 1
    },
    aspect_ratio: {
      source: ['yourModelAspectRatio', 'aspectRatio'],
      defaultValue: '1:1'
    },
    seed: 'seed',
    negative_prompt: 'negativePrompt'
  },

  features: {
    smartMatch: {
      enabled: true,
      paramKey: 'aspect_ratio',
      defaultRatio: '1:1'
    },
    imageUpload: {
      enabled: true,
      maxImages: 1,
      mode: 'single',
      paramKey: 'image_url',
      convertToBlob: false
    }
  },

  customHandlers: commonImageUploadHandler
}
```

---

### 模板 3：图生视频模型

```typescript
export const yourModelConfig: ModelConfig = {
  id: 'your-model-id',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    duration: {
      source: ['yourModelVideoDuration', 'videoDuration'],
      defaultValue: 5
    },
    aspectRatio: {
      source: 'yourModelAspectRatio',
      defaultValue: '16:9'
    },
    resolution: {
      source: 'yourModelResolution',
      defaultValue: '1080p'
    }
  },

  features: {
    smartMatch: {
      enabled: true,
      paramKey: 'aspectRatio',
      defaultRatio: '16:9'
    },
    imageUpload: {
      enabled: true,
      maxImages: 1,
      mode: 'single',
      paramKey: 'image_url',
      convertToBlob: false
    }
  },

  customHandlers: commonImageUploadHandler
}
```

---

### 模板 4：多模式视频模型

```typescript
export const yourModelConfig: ModelConfig = {
  id: 'your-model-id',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    mode: {
      source: 'yourModelMode',
      defaultValue: 'text-to-video'
    },
    duration: {
      source: ['yourModelVideoDuration', 'videoDuration'],
      defaultValue: 5
    },
    aspectRatio: {
      source: 'yourModelAspectRatio',
      defaultValue: '16:9'
    },
    resolution: {
      source: 'yourModelResolution',
      defaultValue: '1080p'
    }
  },

  features: {
    smartMatch: {
      enabled: true,
      paramKey: 'aspectRatio',
      defaultRatio: '16:9'
    },
    imageUpload: {
      enabled: true,
      maxImages: 2,
      mode: 'multiple',
      paramKey: 'images',
      convertToBlob: false
    },
    videoUpload: {
      enabled: true,
      maxVideos: 1,
      paramKey: 'videos'
    }
  },

  customHandlers: commonMediaUploadHandler
}
```

---

## 6. 注册配置

在 `src/components/MediaGenerator/builders/configs/index.ts` 中注册：

```typescript
import { yourModelConfig } from './fal-models'

export const optionsBuilder = new OptionsBuilder()

optionsBuilder.registerConfig(yourModelConfig)
```

---

## 7. 快速参考表

| 场景 | customHandlers | imageUpload | videoUpload | smartMatch |
|------|---------------|-------------|-------------|------------|
| 纯文生图 | 不需要 | 不需要 | 不需要 | 推荐 |
| 图生图 | commonImageUploadHandler | 必需 | 不需要 | 推荐 |
| 纯文生视频 | 不需要 | 不需要 | 不需要 | 推荐 |
| 图生视频 | commonImageUploadHandler | 必需 | 不需要 | 推荐 |
| 视频编辑 | commonMediaUploadHandler | 必需 | 必需 | 可选 |
| 多模态 | commonMediaUploadHandler | 必需 | 必需 | 推荐 |

---

## 8. 关键概念总结

### paramMapping
- 将 UI 参数映射到 API 参数
- 支持字符串、数组（优先级回退）、对象三种形式
- 数组形式用于模型特定参数 + 通用参数回退

### features
- `smartMatch`：自动匹配图片宽高比
- `imageUpload`：配置图片上传功能
- `videoUpload`：配置视频上传功能

### customHandlers
- `commonImageUploadHandler`：处理图片上传
- `commonVideoUploadHandler`：处理视频上传
- `commonMediaUploadHandler`：处理图片+视频上传
- 自定义处理器：添加特殊逻辑（分辨率计算、参数转换等）

### 文件路径保存
- 图片/视频的 data URL 和 File 对象不会保存到 history.json
- 只保存本地文件路径（`uploadedFilePaths`、`uploadedVideoFilePaths`）
- 用于历史记录恢复和重新编辑