# 分辨率面板设计规则

本文档总结了痕迹 AI 中分辨率面板的设计模式和最佳实践，用于指导新模型适配时的分辨率参数设计。

## 目录

- [核心类型定义](#核心类型定义)
- [三种主要设计模式](#三种主要设计模式)
- [设计模式选择指南](#设计模式选择指南)
- [参数配置详解](#参数配置详解)
- [面板内容动态切换机制](#面板内容动态切换机制)
- [UI 交互规则](#ui-交互规则)
- [常见问题与解决方案](#常见问题与解决方案)

---

## 核心类型定义

分辨率面板的核心配置接口定义在 `src/types/schema.ts`：

```typescript
export interface ResolutionConfig {
    // 基础配置
    type: 'aspect_ratio' | 'size' | 'resolution'
    smartMatch?: boolean
    visualize?: boolean
    extractRatio?: (value: any) => number | null
    customInput?: boolean

    // 质量档位配置
    qualityOptions?: Array<{ value: any; label: string }> | ((values: any) => Array<{ value: any; label: string }>)
    qualityKey?: string
    defaultQuality?: string
    hideAspectRatio?: (values: any) => boolean

    // 基础尺寸配置
    baseSize?: number
    baseSizeEditable?: boolean
    baseSizeMin?: number
    baseSizeMax?: number
    baseSizeStep?: number
    baseSizeKey?: string
    minSize?: number
    maxSize?: number

    // 专用计算器
    useSeedreamCalculator?: boolean
    seedreamProvider?: 'fal' | 'ppio'
    useQwenCalculator?: boolean
}
```

---

## 三种主要设计模式

### 模式 A：比例 + 质量档位（最常用）

**适用场景：** 视频生成模型，提供固定的质量档位（如 720P、1080P、2K、4K）

**UI 结构：**
- 上方：比例选择器（16:9、9:16、1:1 等）
- 下方：质量档位选择器（720P、1080P 等）
- 可选：智能匹配选项（图生视频模式）

**代表模型：**
- Fal.ai Vidu Q2
- Fal.ai Pixverse V5.5
- Fal.ai Sora 2
- Fal.ai Veo 3.1
- KIE Seedream 4.5
- Kling Image O1

**配置示例：**

```typescript
{
    id: 'aspectRatio',
    type: 'dropdown',
    label: '分辨率',
    defaultValue: '16:9',
    resolutionConfig: {
        type: 'aspect_ratio',
        smartMatch: true,          // 启用智能匹配
        visualize: true,           // 显示可视化预览
        extractRatio: (value) => {
            if (value === 'smart' || value === 'auto') return null
            const [w, h] = value.split(':').map(Number)
            return w / h
        },
        qualityOptions: [
            { value: '720p', label: '720P' },
            { value: '1080p', label: '1080P' }
        ],
        qualityKey: 'resolution',   // 质量档位存储的参数 ID
        defaultQuality: '1080p'
    },
    options: (values) => {
        const baseOptions = [
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
            { value: '1:1', label: '1:1' }
        ]
        // 图生视频模式下添加智能选项
        if (values.uploadedImages && values.uploadedImages.length > 0) {
            return [{ value: 'smart', label: '智能' }, ...baseOptions]
        }
        return baseOptions
    }
}
```

**关键特性：**
1. `qualityKey` 指向存储质量档位的参数 ID
2. `qualityOptions` 定义可选的质量档位
3. `smartMatch: true` 启用图片上传时的智能匹配
4. `extractRatio()` 函数用于从比例值中提取数值比例

---

### 模式 B：比例 + 可编辑基础尺寸

**适用场景：** 图像生成模型，需要灵活控制分辨率大小

**UI 结构：**
- 上方：比例选择器（支持更多比例选项）
- 下方：可编辑的基础尺寸滑块（如 512-2048）
- 实际分辨率 = 基础尺寸 × 比例

**代表模型：**
- Fal.ai Z-Image-Turbo
- ModelScope 通用/自定义模型

**配置示例：**

```typescript
{
    id: 'imageSize',
    type: 'dropdown',
    label: '分辨率',
    defaultValue: '1:1',
    resolutionConfig: {
        type: 'aspect_ratio',
        smartMatch: false,
        visualize: true,
        customInput: true,         // 支持自定义输入
        baseSize: 1440,            // 默认基础尺寸
        baseSizeEditable: true,    // 允许编辑基础尺寸
        baseSizeMin: 512,
        baseSizeMax: 2048,
        baseSizeStep: 8,           // 步进值（通常为 8 的倍数）
        extractRatio: (value) => {
            if (value.includes(':')) {
                const [w, h] = value.split(':').map(Number)
                return w / h
            }
            return null
        }
    },
    options: [
        { value: '21:9', label: '21:9' },
        { value: '16:9', label: '16:9' },
        { value: '3:2', label: '3:2' },
        { value: '4:3', label: '4:3' },
        { value: '1:1', label: '1:1' },
        { value: '3:4', label: '3:4' },
        { value: '2:3', label: '2:3' },
        { value: '9:16', label: '9:16' },
        { value: '9:21', label: '9:21' }
    ]
}
```

**关键特性：**
1. `baseSizeEditable: true` 允许用户调整基础尺寸
2. `baseSizeStep: 8` 确保分辨率为 8 的倍数（GPU 优化）
3. 支持更多比例选项（9 种常见比例）
4. 不使用 `qualityOptions`，通过基础尺寸控制质量

---

### 模式 C：Seedream 专用计算器

**适用场景：** PPIO Seedream 系列模型，有特殊的分辨率约束

**UI 结构：**
- 上方：比例选择器（含智能选项）
- 下方：语义化质量档位（高清 2K、超清 4K）
- 使用专用计算器处理 PPIO 约束

**代表模型：**
- PPIO Seedream 4.0
- PPIO Seedream 4.5

**配置示例：**

```typescript
{
    id: 'selectedResolution',
    type: 'dropdown',
    label: '分辨率',
    defaultValue: 'smart',
    resolutionConfig: {
        type: 'aspect_ratio',
        smartMatch: true,
        visualize: true,
        customInput: true,
        useSeedreamCalculator: true,      // 启用 Seedream 专用计算器
        seedreamProvider: 'ppio',         // 指定供应商约束
        baseSizeEditable: false,
        extractRatio: (value) => {
            if (value === 'smart') return null
            const [w, h] = value.split(':').map(Number)
            return w / h
        },
        qualityOptions: [
            { value: '2K', label: '高清 2K' },
            { value: '4K', label: '超清 4K' }
        ]
    },
    options: (values) => {
        const baseOptions = [
            { value: '21:9', label: '21:9' },
            { value: '16:9', label: '16:9' },
            { value: '3:2', label: '3:2' },
            { value: '4:3', label: '4:3' },
            { value: '1:1', label: '1:1' },
            { value: '3:4', label: '3:4' },
            { value: '2:3', label: '2:3' },
            { value: '9:16', label: '9:16' }
        ]
        return [{ value: 'smart', label: '智能' }, ...baseOptions]
    }
}
```

**关键特性：**
1. `useSeedreamCalculator: true` 启用专用计算逻辑
2. `seedreamProvider: 'ppio'` 应用 PPIO 约束（比例范围 [1/16, 16]，最大像素 16,777,216）
3. 质量档位使用语义化标签（2K/4K）
4. 始终包含智能选项

---

## 设计模式选择指南

### 决策树

```
是否需要分辨率控制？
├─ 否 → 不使用 resolutionConfig
└─ 是 → 继续

是否提供固定的质量档位？
├─ 是 → 使用模式 A（比例 + 质量档位）
│   └─ 是否为 Seedream 模型？
│       ├─ 是 → 使用模式 C（Seedream 计算器）
│       └─ 否 → 使用标准模式 A
└─ 否 → 使用模式 B（比例 + 可编辑基础尺寸）
```

### 选择建议

| 模型类型 | 推荐模式 | 理由 |
|---------|---------|------|
| 视频生成（固定档位） | 模式 A | 用户友好，档位清晰 |
| 图像生成（灵活控制） | 模式 B | 精细控制，适应性强 |
| PPIO Seedream | 模式 C | 满足特殊约束 |
| 固定分辨率模型 | 无 resolutionConfig | 使用普通 dropdown |

---

## 参数配置详解

### 1. 比例选项集合

**最小集合（2-3 个比例）：**
```typescript
options: [
    { value: '16:9', label: '16:9' },
    { value: '9:16', label: '9:16' },
    { value: '1:1', label: '1:1' }
]
```
- 适用于：简单视频模型
- 代表：Fal.ai Vidu Q2

**标准集合（5-6 个比例）：**
```typescript
options: [
    { value: '16:9', label: '16:9' },
    { value: '4:3', label: '4:3' },
    { value: '1:1', label: '1:1' },
    { value: '3:4', label: '3:4' },
    { value: '9:16', label: '9:16' }
]
```
- 适用于：通用视频模型
- 代表：Fal.ai Pixverse V5.5

**扩展集合（8-9 个比例）：**
```typescript
options: [
    { value: '21:9', label: '21:9' },
    { value: '16:9', label: '16:9' },
    { value: '3:2', label: '3:2' },
    { value: '4:3', label: '4:3' },
    { value: '1:1', label: '1:1' },
    { value: '3:4', label: '3:4' },
    { value: '2:3', label: '2:3' },
    { value: '9:16', label: '9:16' },
    { value: '9:21', label: '9:21' }
]
```
- 适用于：图像生成模型
- 代表：ModelScope、PPIO Seedream

### 2. 特殊比例值

| 值 | 含义 | 使用场景 |
|----|------|---------|
| `'smart'` | 智能匹配 | 图生视频，自动检测上传图片比例 |
| `'auto'` | 自动选择 | 模型自动决定最佳比例 |
| `'自定义'` | 自定义输入 | 允许用户输入任意比例 |

### 3. 质量档位配置

**静态质量选项：**
```typescript
qualityOptions: [
    { value: '720p', label: '720P' },
    { value: '1080p', label: '1080P' }
]
```

**动态质量选项（基于模式）：**
```typescript
qualityOptions: (values: any) => {
    const mode = values.mode || 'standard'
    if (mode === 'standard') {
        return [{ value: '720p', label: '720P' }]
    } else {
        return [
            { value: '720p', label: '720P' },
            { value: '1080p', label: '1080P' }
        ]
    }
}
```

**质量档位命名规范：**
- 像素级：360p, 480p, 540p, 720p, 1080p, 1440p, 2160p
- 语义级：1K, 2K, 4K
- 描述级：高清 2K, 超清 4K

### 4. 智能匹配配置

启用智能匹配需要三个配置：

```typescript
resolutionConfig: {
    smartMatch: true,
    extractRatio: (value) => {
        if (value === 'smart' || value === 'auto') return null
        const [w, h] = value.split(':').map(Number)
        return w / h
    }
}

// 在 options 中添加智能选项
options: (values) => {
    const baseOptions = [...]
    if (values.uploadedImages && values.uploadedImages.length > 0) {
        return [{ value: 'smart', label: '智能' }, ...baseOptions]
    }
    return baseOptions
}

// 配置自动切换
autoSwitch: {
    condition: (values) => values.uploadedImages && values.uploadedImages.length > 0,
    value: 'smart',
    watchKeys: ['uploadedImages']
}
```

---

## 面板内容动态切换机制

分辨率面板的一个核心特性是能够根据不同条件（如模式切换、图片上传等）动态改变显示内容。这确保了在不同使用场景下，用户只看到相关的选项。

### 1. 面板显示名称规则

#### 命名规范

分辨率面板的显示名称会根据面板内容动态变化，遵循以下规则：

| 面板内容 | 组件显示名称 | 面板内部命名 | 说明 |
|---------|------------|------------|------|
| 比例 + 质量档位 | **分辨率** | 比例 + **质量** | 质量实际就是分辨率档位 |
| 仅比例 | **比例** | 比例 | 无质量档位选择 |
| 仅质量档位 | **分辨率** | 分辨率 | 无比例选择 |

#### 示例说明

**场景 1：比例 + 质量档位（最常见）**

```
┌─────────────────────────────┐
│  分辨率                      │  ← 组件显示名称
├─────────────────────────────┤
│  比例                        │  ← 面板内部标签
│  [智能] [16:9] [9:16] [1:1] │
├─────────────────────────────┤
│  质量                        │  ← 面板内部标签（实际是分辨率档位）
│  [720P]  [1080P]            │
└─────────────────────────────┘
```

**参考模型：** Fal.ai Vidu Q2、Fal.ai Sora 2、KIE Seedance V3

**配置：**
```typescript
{
    id: 'aspectRatio',
    type: 'dropdown',
    label: '分辨率',  // 组件显示名称
    resolutionConfig: {
        type: 'aspect_ratio',
        qualityOptions: [...],
        qualityKey: 'resolution'
    }
}
```

---

**场景 2：仅比例选择**

```
┌─────────────────────────────┐
│  比例                        │  ← 组件显示名称
├─────────────────────────────┤
│  [21:9] [16:9] ... [9:21]   │
└─────────────────────────────┘
```

**使用场景：** 某些模式下不需要质量档位选择

**配置：**
```typescript
{
    id: 'aspectRatio',
    type: 'dropdown',
    label: '比例',  // 组件显示名称
    resolutionConfig: {
        type: 'aspect_ratio',
        // 无 qualityOptions
    }
}
```

---

**场景 3：仅质量档位选择**

```
┌─────────────────────────────┐
│  分辨率                      │  ← 组件显示名称
├─────────────────────────────┤
│  [720P]  [1080P]  [2160P]   │
└─────────────────────────────┘
```

**使用场景：** 图生视频时比例自动从图片检测，只需选择质量

**参考模型：** Fal.ai Vidu Q2（图生视频模式）、Fal.ai LTX-2（视频编辑模式）

**配置：**
```typescript
{
    id: 'resolution',
    type: 'dropdown',
    label: '分辨率',  // 组件显示名称
    options: [
        { value: '720p', label: '720P' },
        { value: '1080p', label: '1080P' },
        { value: '2160p', label: '2160P' }
    ]
    // 无 resolutionConfig
}
```

---

#### 动态名称切换

当使用 `hideAspectRatio` 隐藏比例选择器时，面板显示名称保持为"分辨率"，但内部只显示质量档位：

```typescript
{
    id: 'aspectRatio',
    type: 'dropdown',
    label: '分辨率',  // 始终显示"分辨率"
    resolutionConfig: {
        type: 'aspect_ratio',
        hideAspectRatio: (values) => {
            // 图生视频时隐藏比例选择器
            return values.uploadedImages?.length > 0
        },
        qualityOptions: [
            { value: '720p', label: '720P' },
            { value: '1080p', label: '1080P' }
        ],
        qualityKey: 'resolution'
    }
}
```

**UI 效果：**
- 文生视频：显示"分辨率"组件 → 内部显示"比例"+"质量"
- 图生视频：显示"分辨率"组件 → 内部只显示"质量"

**参考模型：** KIE Seedance V3

---

#### 命名规则总结

**核心原则：**
1. **组件名称优先使用"分辨率"** - 因为这是用户最熟悉的术语
2. **面板内部区分"比例"和"质量"** - 避免混淆
3. **"质量"实际代表分辨率档位** - 如 720P、1080P、2K、4K
4. **名称随内容动态变化** - 只有比例时显示"比例"，只有质量时显示"分辨率"

**参数命名建议：**
- 比例参数 ID：`aspectRatio`, `imageSize`, `selectedResolution`
- 质量参数 ID：`resolution`, `quality`, `{model}Resolution`
- 组件 label：优先使用 `'分辨率'`，特殊情况使用 `'比例'`

---

### 2. 核心概念

**设计原则：**
- 即使 API 支持 `auto` 等自动参数，我们也**始终在本地计算**最恰当的值传递给 API
- 保持设计统一性，所有模型使用相同的智能匹配逻辑
- 面板内容根据上下文动态调整，而非显示所有可能的选项

**三种动态切换方式：**
1. **options 函数** - 动态改变比例选项列表
2. **qualityOptions 函数** - 动态改变质量档位列表
3. **hideAspectRatio 函数** - 条件隐藏比例选择器

---

### 2. options 函数：动态比例选项

#### 场景 A：图生视频时添加智能选项

**使用场景：** 文生视频支持选择比例，图生视频时自动添加"智能"选项

**参考模型：** Fal.ai Pixverse V5.5、Fal.ai Sora 2

**实现方式：**
```typescript
options: (values) => {
    const hasImages = values.uploadedImages && values.uploadedImages.length > 0
    const baseOptions = [
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '1:1', label: '1:1' }
    ]

    // 上传图片后，在列表开头添加智能选项
    if (hasImages) {
        return [{ value: 'smart', label: '智能' }, ...baseOptions]
    }
    return baseOptions
}
```

**配合 autoSwitch：**
```typescript
autoSwitch: {
    condition: (values) => values.uploadedImages && values.uploadedImages.length > 0,
    value: 'smart',
    watchKeys: ['uploadedImages']  // 只监听图片变化
}
```

---

#### 场景 B：根据版本/模式显示不同比例

**使用场景：** 不同版本支持不同的比例选项

**参考模型：** KIE Seedance V3（Lite 版 6 个比例，Pro 版支持 21:9）

**实现方式：**
```typescript
options: (values) => {
    const version = values?.modelVersion || 'lite'

    if (version === 'lite') {
        return [
            { value: '16:9', label: '16:9' },
            { value: '4:3', label: '4:3' },
            { value: '1:1', label: '1:1' },
            { value: '3:4', label: '3:4' },
            { value: '9:16', label: '9:16' },
            { value: '9:21', label: '9:21' }
        ]
    } else {
        // Pro 版本支持 21:9
        return [
            { value: '21:9', label: '21:9' },
            { value: '16:9', label: '16:9' },
            { value: '4:3', label: '4:3' },
            { value: '1:1', label: '1:1' },
            { value: '3:4', label: '3:4' },
            { value: '9:16', label: '9:16' }
        ]
    }
}
```

---

#### 场景 C：根据上传媒体数量切换模式

**使用场景：** 根据上传的图片/视频数量自动切换模式，不同模式显示不同选项

**参考模型：** Fal.ai Vidu Q2（4 种模式：文生视频、图生视频、参考生视频、视频延长）

**实现方式：**
```typescript
// 模式参数自动切换
{
    id: 'mode',
    type: 'dropdown',
    autoSwitch: {
        watchKeys: ['uploadedImages', 'uploadedVideos'],
        condition: (values) => {
            const imageCount = values.uploadedImages?.length || 0
            const videoCount = values.uploadedVideos?.length || 0
            const currentMode = values.mode

            let targetMode: string
            if (videoCount > 0) targetMode = 'video-extension'
            else if (imageCount > 1) targetMode = 'reference-to-video'
            else if (imageCount === 1) targetMode = 'image-to-video'
            else targetMode = 'text-to-video'

            return currentMode !== targetMode
        },
        value: (values: any) => {
            const imageCount = values.uploadedImages?.length || 0
            const videoCount = values.uploadedVideos?.length || 0

            if (videoCount > 0) return 'video-extension'
            if (imageCount > 1) return 'reference-to-video'
            if (imageCount === 1) return 'image-to-video'
            return 'text-to-video'
        }
    }
}

// 比例选项根据模式动态变化
options: (values) => {
    const mode = values.mode || 'text-to-video'
    const imageCount = values.uploadedImages?.length || 0

    const baseOptions = [
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '1:1', label: '1:1' }
    ]

    // 参考生视频模式且有图片时，添加智能选项
    if (mode === 'reference-to-video' && imageCount > 0) {
        return [{ value: 'smart', label: '智能' }, ...baseOptions]
    }

    return baseOptions
}
```

---

### 3. qualityOptions 函数：动态质量档位

#### 场景 A：根据模式提供不同质量档位

**使用场景：** 标准模式只有 720P，专业模式有 720P 和 1080P

**参考模型：** Fal.ai Sora 2

**实现方式：**
```typescript
resolutionConfig: {
    type: 'aspect_ratio',
    qualityOptions: (values: any) => {
        const mode = values.mode || 'standard'
        if (mode === 'standard') {
            return [{ value: '720p', label: '720P' }]
        } else {
            return [
                { value: '720p', label: '720P' },
                { value: '1080p', label: '1080P' }
            ]
        }
    },
    qualityKey: 'resolution'
}
```

---

#### 场景 B：根据条件禁用某些质量档位

**使用场景：** Pro 快速模式下图生视频不支持 480p

**参考模型：** KIE Seedance V3

**实现方式：**
```typescript
resolutionConfig: {
    qualityOptions: (values) => {
        const version = values?.modelVersion || 'lite'
        const fastMode = values?.fastMode !== undefined ? values.fastMode : true
        const hasImages = values?.uploadedImages && values.uploadedImages.length > 0

        // Pro 快速模式图生视频不支持 480p
        const disable480p = version === 'pro' && fastMode && hasImages

        return [
            { value: '480p', label: '480P', disabled: disable480p },
            { value: '720p', label: '720P' },
            { value: '1080p', label: '1080P' }
        ]
    },
    qualityKey: 'resolution'
}
```

**配合 autoSwitch 自动切换：**
```typescript
{
    id: 'resolution',
    autoSwitch: {
        condition: (values) => {
            const version = values?.modelVersion || 'lite'
            const fastMode = values?.fastMode !== undefined ? values.fastMode : true
            const hasImages = values?.uploadedImages && values.uploadedImages.length > 0
            const currentResolution = values?.resolution || '720p'

            // 如果当前选择了被禁用的 480p，自动切换到 720p
            return version === 'pro' && fastMode && hasImages && currentResolution === '480p'
        },
        value: '720p'
    }
}
```

---

### 4. hideAspectRatio：条件隐藏比例选择器

#### 使用场景

**典型场景：** 图生视频时不需要用户选择比例（自动从图片检测），只需选择质量档位

**参考模型：** KIE Seedance V3

**实现方式：**
```typescript
resolutionConfig: {
    type: 'aspect_ratio',
    hideAspectRatio: (values) => {
        const hasImages = values?.uploadedImages && values.uploadedImages.length > 0
        return hasImages  // 有图片时隐藏比例选择器
    },
    qualityOptions: [
        { value: '480p', label: '480P' },
        { value: '720p', label: '720P' },
        { value: '1080p', label: '1080P' }
    ],
    qualityKey: 'resolution'
}
```

**UI 效果：**
- 文生视频：显示比例选择器 + 质量档位
- 图生视频：只显示质量档位（比例自动从图片检测）

---

### 5. 多参数联动：复杂场景处理

#### 场景：不同模式使用不同的分辨率参数

**使用场景：** 某些模式需要比例+质量，某些模式只需要质量

**参考模型：** Fal.ai Vidu Q2

**实现方式：**

**参数 1：带比例选择的分辨率（文生视频、参考生视频）**
```typescript
{
    id: 'aspectRatio',
    type: 'dropdown',
    label: '分辨率',
    hidden: (values) => {
        const mode = values.mode || 'text-to-video'
        // 图生视频和视频延长模式隐藏此参数
        return mode === 'image-to-video' || mode === 'video-extension'
    },
    resolutionConfig: {
        type: 'aspect_ratio',
        qualityOptions: [
            { value: '720p', label: '720P' },
            { value: '1080p', label: '1080P' }
        ],
        qualityKey: 'resolution'
    },
    options: (values) => {
        const mode = values.mode || 'text-to-video'
        const imageCount = values.uploadedImages?.length || 0

        const baseOptions = [
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
            { value: '1:1', label: '1:1' }
        ]

        if (mode === 'reference-to-video' && imageCount > 0) {
            return [{ value: 'smart', label: '智能' }, ...baseOptions]
        }

        return baseOptions
    }
}
```

**参数 2：仅质量选择的分辨率（图生视频、视频延长）**
```typescript
{
    id: 'resolutionOnly',
    type: 'dropdown',
    label: '分辨率',
    hidden: (values) => {
        const mode = values.mode || 'text-to-video'
        // 只在图生视频和视频延长模式显示
        return mode !== 'image-to-video' && mode !== 'video-extension'
    },
    resolutionConfig: {
        type: 'resolution',  // 注意：这里是 'resolution' 而不是 'aspect_ratio'
        qualityOptions: [
            { value: '720p', label: '720P' },
            { value: '1080p', label: '1080P' }
        ],
        qualityKey: 'resolution'
    },
    options: []  // 空数组，因为不需要比例选择
}
```

---

### 6. autoSwitch 与 watchKeys 机制

#### watchKeys 的重要性

**问题：** 不使用 `watchKeys` 会导致用户手动选择被强制覆盖

**示例对比：**

**❌ 错误做法（过度触发）：**
```typescript
autoSwitch: {
    condition: (values) => values.uploadedImages && values.uploadedImages.length > 0,
    value: 'smart'
    // 缺少 watchKeys，任何参数变化都会触发检查
}
```

**✅ 正确做法（精确控制）：**
```typescript
autoSwitch: {
    condition: (values) => values.uploadedImages && values.uploadedImages.length > 0,
    value: 'smart',
    watchKeys: ['uploadedImages']  // 只监听图片变化
}
```

---

#### 函数式 value：动态计算目标值

**使用场景：** 根据当前状态计算应该切换到的值

**示例：**
```typescript
autoSwitch: {
    watchKeys: ['uploadedImages', 'uploadedVideos'],
    condition: (values) => {
        // 检查是否需要切换
        const imageCount = values.uploadedImages?.length || 0
        const videoCount = values.uploadedVideos?.length || 0
        return imageCount > 0 || videoCount > 0
    },
    value: (values: any) => {
        // 动态计算目标值
        const imageCount = values.uploadedImages?.length || 0
        const videoCount = values.uploadedVideos?.length || 0

        if (videoCount > 0) return 'video-extension'
        if (imageCount > 1) return 'reference-to-video'
        if (imageCount === 1) return 'image-to-video'
        return 'text-to-video'
    }
}
```

---

### 7. 完整的动态切换流程

```
用户操作（上传图片/选择模式）
    ↓
触发参数变化（uploadedImages/mode）
    ↓
检查 watchKeys 是否匹配
    ↓
执行 autoSwitch.condition()
    ↓
条件满足 → 执行 autoSwitch.value()
    ↓
更新参数值
    ↓
重新计算 options() 和 qualityOptions()
    ↓
检查 hideAspectRatio() 是否隐藏比例选择器
    ↓
UI 面板重新渲染
```

---

### 8. 最佳实践

#### ✅ 推荐做法

1. **始终使用 watchKeys**
   - 避免不必要的切换
   - 保护用户的手动选择

2. **智能选项的统一处理**
   - 即使 API 支持 `auto`，也在本地计算具体值
   - 保持所有模型的一致性

3. **条件隐藏优于删除**
   - 使用 `hidden()` 而非返回空数组
   - 使用 `hideAspectRatio()` 而非创建新参数

4. **质量档位的保留**
   - 使用 `qualityKey` 统一管理
   - 切换比例时保留用户的质量选择

---

#### ❌ 避免的做法

1. **不要监听分辨率参数自身**
   ```typescript
   // ❌ 错误：会导致无限循环
   autoSwitch: {
       watchKeys: ['aspectRatio'],  // 监听自己
       condition: (values) => values.aspectRatio === '16:9',
       value: '9:16'
   }
   ```

2. **不要在 options 中执行复杂计算**
   ```typescript
   // ❌ 错误：性能问题
   options: (values) => {
       // 复杂的图片处理逻辑...
       return [...]
   }
   ```

3. **不要忘记配合 autoSwitch**
   ```typescript
   // ❌ 错误：智能选项出现了，但不会自动切换
   options: (values) => {
       if (values.uploadedImages?.length > 0) {
           return [{ value: 'smart', label: '智能' }, ...]
       }
       return [...]
   }
   // 缺少 autoSwitch 配置
   ```

---

## UI 交互规则

### 1. 面板布局

**标准布局（模式 A）：**
```
┌─────────────────────────────┐
│  分辨率                      │
├─────────────────────────────┤
│  [智能] [16:9] [9:16] [1:1] │  ← 比例选择器
├─────────────────────────────┤
│  [720P]  [1080P]            │  ← 质量档位选择器
└─────────────────────────────┘
```

**可编辑尺寸布局（模式 B）：**
```
┌─────────────────────────────┐
│  分辨率                      │
├─────────────────────────────┤
│  [21:9] [16:9] ... [9:21]   │  ← 比例选择器
├─────────────────────────────┤
│  基础尺寸: 1440             │  ← 可编辑滑块
│  ├────────●────────┤        │
│  512          2048           │
└─────────────────────────────┘
```

### 2. 可视化预览

当 `visualize: true` 时，显示比例预览框：

```typescript
resolutionConfig: {
    visualize: true
}
```

预览框根据选中的比例动态调整形状，帮助用户直观理解比例效果。

### 3. 条件显示/隐藏

**隐藏比例选择器：**
```typescript
resolutionConfig: {
    hideAspectRatio: (values) => values.mode === 'retake-video'
}
```

**隐藏整个参数：**
```typescript
{
    id: 'resolution',
    hidden: (values) => values.mode === 'specific-mode'
}
```

### 4. 自动切换行为

**触发条件：**
- 用户上传图片
- 切换生成模式
- 切换模型版本

**配置示例：**
```typescript
autoSwitch: {
    condition: (values) => values.uploadedImages && values.uploadedImages.length > 0,
    value: 'smart',
    watchKeys: ['uploadedImages']  // 只监听特定键，避免过度触发
}
```

**注意事项：**
- 使用 `watchKeys` 限制监听范围，避免不必要的切换
- 不要监听分辨率参数自身，会导致无限循环
- 切换后保留用户的质量档位选择

---

## 常见问题与解决方案

### 问题 1：质量档位不显示

**症状：** 配置了 `qualityOptions`，但 UI 上没有显示质量选择器

**原因：**
1. 缺少 `qualityKey` 配置
2. `qualityKey` 指向的参数不存在
3. `qualityKey` 指向的参数被 `hidden: true` 隐藏

**解决方案：**
```typescript
// 1. 确保 qualityKey 存在
resolutionConfig: {
    qualityOptions: [...],
    qualityKey: 'resolution'  // 必须指定
}

// 2. 确保目标参数存在且未隐藏
{
    id: 'resolution',
    type: 'dropdown',
    hidden: false,  // 不要隐藏
    options: [...]
}
```

### 问题 2：智能匹配不工作

**症状：** 上传图片后，比例没有自动切换到智能选项

**原因：**
1. `smartMatch: false` 或未配置
2. 缺少 `extractRatio` 函数
3. `autoSwitch` 配置错误
4. `options` 中没有 'smart' 选项

**解决方案：**
```typescript
// 完整的智能匹配配置
resolutionConfig: {
    smartMatch: true,
    extractRatio: (value) => {
        if (value === 'smart') return null
        const [w, h] = value.split(':').map(Number)
        return w / h
    }
},
options: (values) => {
    const baseOptions = [...]
    if (values.uploadedImages && values.uploadedImages.length > 0) {
        return [{ value: 'smart', label: '智能' }, ...baseOptions]
    }
    return baseOptions
},
autoSwitch: {
    condition: (values) => values.uploadedImages && values.uploadedImages.length > 0,
    value: 'smart',
    watchKeys: ['uploadedImages']
}
```

### 问题 3：分辨率值传递错误

**症状：** API 请求中的分辨率值不正确

**原因：**
1. 比例值直接传递，未转换为具体分辨率
2. 质量档位未正确映射到分辨率值

**解决方案：**

在 adapter 的 route 中进行转换：

```typescript
buildVideoRequest: (params) => {
    const aspectRatio = params.aspectRatio || '16:9'
    const quality = params.resolution || '1080p'

    // 映射到具体分辨率
    const resolutionMap = {
        '16:9': {
            '720p': '1280*720',
            '1080p': '1920*1080'
        },
        '9:16': {
            '720p': '720*1280',
            '1080p': '1080*1920'
        },
        '1:1': {
            '720p': '960*960',
            '1080p': '1440*1440'
        }
    }

    const size = resolutionMap[aspectRatio]?.[quality] || '1920*1080'

    return {
        endpoint: '/v3/async/model',
        requestData: {
            parameters: {
                size: size  // 传递具体分辨率
            }
        }
    }
}
```

### 问题 4：基础尺寸不是 8 的倍数

**症状：** 用户调整基础尺寸后，生成失败或出现警告

**原因：** GPU 优化要求分辨率为 8 的倍数

**解决方案：**
```typescript
resolutionConfig: {
    baseSizeStep: 8,  // 设置步进为 8
    baseSizeMin: 512,  // 确保最小值是 8 的倍数
    baseSizeMax: 2048  // 确保最大值是 8 的倍数
}
```

### 问题 5：质量档位选择不保留

**症状：** 切换比例后，质量档位重置为默认值

**原因：** 缺少 `defaultQuality` 配置或 `qualityKey` 参数的 `defaultValue` 不正确

**解决方案：**
```typescript
// 在 resolutionConfig 中设置
resolutionConfig: {
    qualityOptions: [...],
    qualityKey: 'resolution',
    defaultQuality: '1080p'  // 设置默认质量
}

// 在 qualityKey 指向的参数中设置
{
    id: 'resolution',
    type: 'dropdown',
    defaultValue: '1080p',  // 与 defaultQuality 一致
    options: [...]
}
```

---

## 最佳实践总结

### 1. 命名规范

**参数 ID 命名：**
- 比例参数 ID：`aspectRatio`, `imageSize`, `selectedResolution`
- 质量参数 ID：`resolution`, `quality`, `{model}Resolution`

**组件标签命名：**
- 比例 + 质量档位：使用 `'分辨率'`（面板内部显示"比例"+"质量"）
- 仅比例：使用 `'比例'`
- 仅质量档位：使用 `'分辨率'`

**面板内部标签：**
- 比例选择器：显示"比例"
- 质量档位选择器：显示"质量"（实际是分辨率档位）

### 2. 默认值选择

- 比例：优先 `'16:9'`（横屏）或 `'1:1'`（方形）
- 质量：优先 `'1080p'`（平衡质量与成本）
- 基础尺寸：`1440`（适中的图像质量）

### 3. 性能优化

- 使用 `watchKeys` 限制 `autoSwitch` 的监听范围
- 避免在 `extractRatio` 中执行复杂计算
- 动态 `qualityOptions` 函数应尽量简单

### 4. 用户体验

- 提供可视化预览（`visualize: true`）
- 图生视频模式必须支持智能匹配
- 质量档位使用清晰的标签（720P、1080P）
- 基础尺寸滑块提供实时预览

### 5. 代码组织

- 分辨率映射逻辑放在 adapter 的 route 中
- 复杂的计算器逻辑抽取为独立函数
- 相似模型共享分辨率配置

---

## 参考资料

- 类型定义：`src/types/schema.ts`
- 模式 A 示例：`src/models/fal-ai-vidu-q2.ts`
- 模式 B 示例：`src/models/fal-ai-z-image-turbo.ts`
- 模式 C 示例：`src/models/seedream-4.0.ts`
- 模型适配指南：`docs/model-adaptation-guide.md`
- 常见问题：`docs/FAQ/配置驱动架构-常见问题.md`
