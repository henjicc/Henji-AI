# Henji-AI 重构计划

> 创建时间：2025-01-21
> 状态：规划中

---

## 一、当前架构问题分析

### 1.1 适配新模型的痛点

当前适配一个新模型需要修改 **10-12 个文件**：

| 序号 | 文件 | 职责 | 问题 |
|------|------|------|------|
| 1 | `src/models/{provider}/{model}.ts` | 参数 Schema | ✅ 核心，需保留 |
| 2 | `src/models/index.ts` | Schema 注册 | ❌ 手动注册 |
| 3 | `src/components/.../useMediaGeneratorState.ts` | 状态定义 | ❌ 640行，160+ useState |
| 4 | `src/config/presetStateMapping.ts` | Setter 映射 | ❌ 588行手动映射 |
| 5 | `src/components/.../builders/core/types.ts` | 类型定义 | ❌ 手动添加字段 |
| 6 | `src/components/.../builders/configs/*.ts` | OptionsBuilder | ❌ 重复的参数映射 |
| 7 | `src/adapters/{provider}/models/{model}.ts` | API 路由 | ✅ 需保留，但可简化 |
| 8 | `src/adapters/{provider}/models/index.ts` | 路由注册 | ❌ 手动注册 |
| 9 | `src/config/providers.json` | UI 元数据 | ❌ 分散配置 |
| 10 | `src/config/pricing.ts` | 价格计算 | ❌ 分散配置 |
| 11 | `src/components/.../index.tsx` | 参数传递 | ❌ 4处需要同步修改 |
| 12 | `src/components/.../InputArea.tsx` | 条件渲染 | ❌ 硬编码条件 |

### 1.2 状态管理爆炸

`useMediaGeneratorState.ts` 现状：
- **640 行代码**
- **160+ 个 useState**
- 每个模型添加 5-10 个状态变量
- 同一参数因供应商不同重复定义（如 aspectRatio 在 3 个供应商中各定义一次）

```typescript
// 当前问题示例：同一参数重复 3 次
const [ppioKling26AspectRatio, setPpioKling26AspectRatio] = useState('16:9')
const [falKlingV26ProAspectRatio, setFalKlingV26ProAspectRatio] = useState('16:9')
const [kieKlingV26AspectRatio, setKieKlingV26AspectRatio] = useState('16:9')
```

### 1.3 配置分散

同一个模型的配置分散在 5 个地方：

```
providers.json     → 模型名称、描述、功能标签
models/*.ts        → 参数定义、UI 组件、默认值
pricing.ts         → 价格计算逻辑
adapters/*/models/ → API 端点、请求构建
useMediaGeneratorState.ts → 默认值（重复！）
```

**问题**：默认值在 Schema 和 State 中重复定义，容易不一致。

---

## 二、重构目标

### 2.1 核心目标

1. **解耦合**：降低模块间依赖，提高可维护性
2. **单文件适配**：新模型只需创建一个配置文件（最重要！）
3. **i18n 支持**：国际化
4. **SQLite 存储**：替换 JSON 文件存储
5. **节点化调用**：为画布模式做准备

### 2.2 目标优先级

| 优先级 | 目标 | 重要性 | 难度 |
|--------|------|--------|------|
| P0 | 单文件适配 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| P1 | 状态管理重构 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| P2 | i18n 支持 | ⭐⭐⭐ | ⭐⭐ |
| P2 | SQLite 存储 | ⭐⭐⭐ | ⭐⭐ |
| P3 | 节点化/画布模式 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

---

## 三、参数系统设计（核心）

> ⚠️ 这是最重要的部分，必须在重构开始前规划好

### 3.1 单文件配置格式

#### 3.1.1 配置文件结构概览

```
一个模型 = 一个配置文件（.model.ts）

配置文件包含：
├── meta          # 元数据（ID、名称、类型、标签等）
├── params        # 参数定义（UI组件、类型、默认值、API字段名等）
├── linkages      # 联动规则（参数间的依赖和自动切换）
├── endpoints     # 端点路由（API端点选择和切换逻辑）
├── request       # 请求构建（基础参数、预处理等）
└── pricing       # 价格计算
```

#### 3.1.2 完整配置示例

```typescript
// src/models/ppio/wan-2.6.model.ts

export default {
  // ==================== 元数据 ====================
  meta: {
    id: 'wan-2.6',
    provider: 'ppio',
    type: 'video',
    name: 'model.wan26.name',           // i18n key
    description: 'model.wan26.desc',     // i18n key
    tags: ['video', 'text-to-video', 'image-to-video', 'reference-to-video'],
    icon: 'video-camera',

    // 进度配置
    polling: {
      interval: 3000,
      maxAttempts: 40
    }
  },

  // ==================== 参数定义 ====================
  params: [
    {
      order: 1,                          // 显示顺序
      id: 'mode',                        // 内部标识
      name: 'param.mode',                // i18n key（显示名称）
      tooltip: 'param.mode.tooltip',     // i18n key（可选，设置就显示）

      component: 'dropdown',             // 组件类型
      valueType: 'string',               // 值类型：string | number | boolean

      default: 'text-image-to-video',
      options: [
        { value: 'text-image-to-video', label: 'param.mode.textImage' },
        { value: 'reference-to-video', label: 'param.mode.reference' }
      ],

      apiField: 'mode',                  // API 请求时的字段名（可选，不设置就不发送）
    },

    {
      order: 2,
      id: 'duration',
      name: 'param.duration',

      component: 'dropdown',
      valueType: 'number',               // 虽然是下拉框，但值是数字

      default: 5,
      options: [
        { value: 5, label: '5s' },
        { value: 10, label: '10s' },
        { value: 15, label: '15s' }
      ],

      apiField: 'duration',
    },

    {
      order: 3,
      id: 'resolution',
      name: 'param.resolution',

      component: 'panel',                // 特殊面板
      panelType: 'resolution',           // 面板类型
      panelConfig: {
        mode: 'aspect-quality',          // 比例+质量模式
        aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
        qualityTiers: ['720P', '1080P'],
        defaultAspectRatio: '16:9',
        defaultQuality: '720P',
        smartMatch: true,                // 图片上传时自动匹配
      },

      // 面板输出多个值，需要定义如何映射到 API
      apiMapping: {
        // 根据端点不同，使用不同的映射
        'text-to-video': {
          transform: (value) => ({
            size: `${value.width}*${value.height}`
          })
        },
        'image-to-video': {
          transform: (value) => ({
            resolution: value.quality  // 720P / 1080P
          })
        }
      }
    },

    {
      order: 4,
      id: 'audio',
      name: 'param.audio',
      tooltip: 'param.audio.tooltip',

      component: 'switch',
      valueType: 'boolean',

      default: true,
      apiField: 'audio',
    },

    {
      order: 5,
      id: 'promptExtend',
      name: 'param.promptExtend',

      component: 'switch',
      valueType: 'boolean',

      default: false,
      apiField: 'prompt_extend',         // 注意：API 用下划线
    },

    // ========== 上传参数 ==========
    {
      order: 10,
      id: 'images',
      name: 'param.images',

      component: 'image-upload',

      maxCount: 1,
      format: 'base64',                  // base64 | url
      base64Prefix: false,               // 是否带 data:image/... 前缀

      // 条件显示
      visible: {
        condition: 'mode !== "reference-to-video"'
      },

      // 触发智能匹配
      onUpload: {
        smartMatch: ['resolution']       // 触发分辨率智能匹配
      },

      apiField: 'img_url',               // 单图时的 API 字段名
    },

    {
      order: 11,
      id: 'videos',
      name: 'param.videos',

      component: 'video-upload',

      maxCount: 3,
      uploadService: 'general',          // 使用通用上传服务

      visible: {
        condition: 'mode === "reference-to-video"'
      },

      // 特殊的 API 映射
      apiTransform: (urls) => ({
        reference_video_urls: urls.map(url => ({ url }))
      })
    }
  ],

  // ==================== 参数联动规则 ====================
  linkages: [
    // 规则1：切换模式时清空上传
    {
      trigger: 'mode',                   // 触发参数
      effect: 'reset',                   // 效果类型
      targets: ['images', 'videos'],     // 目标参数
    },

    // 规则2：分辨率影响时长选项
    {
      trigger: 'resolution.quality',
      effect: 'filterOptions',
      target: 'duration',
      filter: (quality, options) => {
        if (quality === '1080P') {
          return options.filter(o => o.value <= 10)
        }
        return options
      }
    },

    // 规则3：参考模式限制时长
    {
      trigger: 'mode',
      effect: 'filterOptions',
      target: 'duration',
      filter: (mode, options) => {
        if (mode === 'reference-to-video') {
          return options.filter(o => o.value <= 10)
        }
        return options
      }
    },

    // 规则4：图片上传自动切换模式（autoSwitch）
    {
      trigger: 'images',
      effect: 'autoSwitch',
      target: 'resolution',
      condition: (images) => images?.length > 0,
      value: { aspectRatio: 'smart' },
      noRestore: false,                  // 条件不满足时恢复默认
    }
  ],

  // ==================== 端点路由 ====================
  endpoints: {
    // 默认端点选择逻辑
    select: (params, context) => {
      if (params.mode === 'reference-to-video') {
        return 'reference-to-video'
      }
      if (context.uploadedImages?.length > 0) {
        return 'image-to-video'
      }
      return 'text-to-video'
    },

    // 端点定义
    routes: {
      'text-to-video': {
        path: '/async/wan2.6-t2v',
        method: 'POST',
      },
      'image-to-video': {
        path: '/async/wan2.6-i2v',
        method: 'POST',
      },
      'reference-to-video': {
        path: '/async/wan2.6-v2v',
        method: 'POST',
      }
    }
  },

  // ==================== 请求构建 ====================
  request: {
    // 基础参数（所有端点共用）
    base: {
      watermark: false,                  // 固定值
    },

    // 参数预处理
    preprocess: (params) => {
      // 可以在这里做最终的参数调整
      return params
    },
  },

  // ==================== 价格计算 ====================
  pricing: {
    currency: '¥',

    // 价格表
    rates: {
      '720P': 0.6,    // 每秒
      '1080P': 1.0,   // 每秒
    },

    // 计算函数
    calculate: (params, rates) => {
      const quality = params.resolution?.quality || '720P'
      const duration = params.duration || 5
      return rates[quality] * duration
    }
  }
}
```

### 3.2 参数定义详解

#### 3.2.1 基础参数属性

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `order` | number | ✅ | 显示顺序（从左到右/从上到下） |
| `id` | string | ✅ | 内部标识（唯一） |
| `name` | string | ✅ | i18n key，显示名称 |
| `tooltip` | string | ❌ | i18n key，鼠标悬停提示 |
| `component` | string | ✅ | UI 组件类型 |
| `valueType` | string | ✅ | 值类型：string / number / boolean |
| `default` | any | ✅ | 默认值 |
| `apiField` | string | ❌ | API 请求时的字段名（不设置则不发送） |

#### 3.2.2 组件类型

| component | 说明 | 额外属性 |
|-----------|------|----------|
| `dropdown` | 下拉选择 | options[] |
| `number` | 数字输入框 | min, max, step, unit |
| `slider` | 滑块 | min, max, step, marks[] |
| `switch` | 开关 | - |
| `text` | 文本输入 | maxLength, placeholder, multiline |
| `radio` | 单选组 | options[] |
| `panel` | 特殊面板 | panelType, panelConfig |
| `image-upload` | 图片上传 | maxCount, format, base64Prefix |
| `video-upload` | 视频上传 | maxCount, uploadService |

#### 3.2.3 API 字段映射

三种方式处理参数到 API 的映射：

```typescript
// 方式1：简单映射（直接使用 apiField）
{
  id: 'duration',
  apiField: 'duration',        // 参数值直接作为 duration 字段发送
}

// 方式2：值转换（apiTransform）
{
  id: 'videos',
  apiTransform: (urls) => ({
    reference_video_urls: urls.map(url => ({ url }))
  })
}

// 方式3：端点相关映射（apiMapping）
{
  id: 'resolution',
  apiMapping: {
    'text-to-video': {
      transform: (v) => ({ size: `${v.width}*${v.height}` })
    },
    'image-to-video': {
      transform: (v) => ({ resolution: v.quality })
    }
  }
}
```

### 3.3 联动系统设计

#### 3.3.1 联动类型

| effect | 说明 | 必需属性 |
|--------|------|----------|
| `reset` | 重置目标参数为默认值 | targets |
| `filterOptions` | 过滤目标参数的选项 | target, filter |
| `filterRange` | 过滤滑块/数字的范围 | target, filter |
| `setValue` | 直接设置值 | target, value |
| `autoSwitch` | 条件满足时自动切换 | target, condition, value |
| `disable` | 禁用目标参数 | target, condition |
| `hide` | 隐藏目标参数 | target, condition |
| `custom` | 自定义处理 | handler |

#### 3.3.2 联动定义接口

```typescript
interface Linkage {
  // 触发条件
  trigger: string | string[]           // 触发参数 ID（支持嵌套如 resolution.quality）

  // 效果
  effect: LinkageEffect
  target?: string                      // 目标参数
  targets?: string[]                   // 多个目标

  // 效果参数
  filter?: (triggerValue: any, options: any[], allParams: any) => any[]
  value?: any | ((triggerValue: any, allParams: any) => any)
  condition?: (triggerValue: any, allParams: any) => boolean
  handler?: (triggerValue: any, allParams: any) => Record<string, any>

  // 控制
  noRestore?: boolean                  // autoSwitch 时，条件不满足是否恢复
  debounce?: number                    // 防抖延迟（ms）
}
```

#### 3.3.3 联动示例

```typescript
linkages: [
  // ========== 基础联动 ==========

  // 1. 重置：切换模式时清空上传
  {
    trigger: 'mode',
    effect: 'reset',
    targets: ['images', 'videos']
  },

  // 2. 过滤选项：1080P 时限制时长
  {
    trigger: 'resolution.quality',
    effect: 'filterOptions',
    target: 'duration',
    filter: (quality, options) => {
      if (quality === '1080P') {
        return options.filter(o => o.value <= 10)
      }
      return options
    }
  },

  // 3. 过滤范围：参考模式限制时长滑块
  {
    trigger: 'mode',
    effect: 'filterRange',
    target: 'duration',
    filter: (mode) => {
      if (mode === 'reference-to-video') {
        return { min: 5, max: 10 }
      }
      return { min: 5, max: 15 }
    }
  },

  // ========== 自动切换 ==========

  // 4. 上传图片时自动切换分辨率为智能
  {
    trigger: 'images',
    effect: 'autoSwitch',
    target: 'resolution.aspectRatio',
    condition: (images) => images?.length > 0,
    value: 'smart',
    noRestore: false
  },

  // 5. 动态值：根据图片比例自动匹配
  {
    trigger: 'images',
    effect: 'autoSwitch',
    target: 'resolution.aspectRatio',
    condition: (images) => images?.length > 0,
    value: (images, params) => {
      const ratio = getImageRatio(images[0])
      return findClosestRatio(ratio, ['16:9', '9:16', '1:1'])
    }
  },

  // ========== 显示/禁用控制 ==========

  // 6. 条件禁用
  {
    trigger: 'resolution.quality',
    effect: 'disable',
    target: 'duration',
    condition: (quality) => quality === '1080P',
    message: 'param.duration.disabled1080p'  // 禁用时的提示
  },

  // 7. 条件隐藏
  {
    trigger: 'advancedMode',
    effect: 'hide',
    targets: ['cfgScale', 'seed', 'negativePrompt'],
    condition: (advanced) => !advanced
  },

  // ========== 复杂联动 ==========

  // 8. 自定义处理：多参数联动
  {
    trigger: ['mode', 'resolution.quality'],
    effect: 'custom',
    handler: (triggers, allParams) => {
      const { mode, resolution } = allParams

      if (mode === 'reference-to-video' && resolution?.quality === '1080P') {
        return {
          'resolution.quality': '720P',
          '_toast': 'toast.referenceNo1080p'
        }
      }
      return {}
    }
  }
]
```

### 3.4 端点路由设计

#### 3.4.1 端点选择器

```typescript
endpoints: {
  // 方式1：基于规则的选择器
  select: {
    rules: [
      { condition: 'mode === "reference-to-video"', endpoint: 'reference-to-video' },
      { condition: 'images.length > 0', endpoint: 'image-to-video' },
      { endpoint: 'text-to-video' }  // 默认
    ]
  },

  // 方式2：函数选择器（更灵活）
  select: (params, context) => {
    if (params.mode === 'reference-to-video') return 'reference-to-video'
    if (context.images?.length > 0) return 'image-to-video'
    return 'text-to-video'
  },

  // 端点定义
  routes: {
    'text-to-video': {
      path: '/async/wan2.6-t2v',
      method: 'POST',
      params: {
        include: ['prompt', 'duration', 'size', 'audio'],
        exclude: ['img_url']
      }
    },
    'image-to-video': {
      path: '/async/wan2.6-i2v',
      method: 'POST',
    }
  }
}
```

#### 3.4.2 单端点简化

对于只有一个端点的模型：

```typescript
endpoints: {
  default: '/api/z-image/generate'
}
```

### 3.5 简化版配置示例

对于简单模型，配置可以非常简洁：

```typescript
// src/models/kie/z-image.model.ts

export default {
  meta: {
    id: 'kie-z-image',
    provider: 'kie',
    type: 'image',
    name: 'model.zImage.name',
  },

  params: [
    {
      order: 1,
      id: 'resolution',
      name: 'param.resolution',
      component: 'dropdown',
      valueType: 'string',
      default: '1024*1024',
      options: [
        { value: '1024*768', label: '1024×768 (4:3)' },
        { value: '1024*1024', label: '1024×1024 (1:1)' },
        { value: '768*1024', label: '768×1024 (3:4)' },
      ],
      apiField: 'size',
    }
  ],

  linkages: [],

  endpoints: {
    default: '/api/z-image/generate'
  },

  pricing: {
    currency: '¥',
    fixed: 0.028
  }
}
```

### 3.6 运行时处理流程

```typescript
class ModelRuntime {
  constructor(config: ModelConfig) {
    this.config = config
  }

  // 1. 初始化参数状态
  initParams(): Record<string, any> {
    const params = {}
    for (const p of this.config.params) {
      params[p.id] = p.default
    }
    return params
  }

  // 2. 处理参数变化（执行联动）
  handleParamChange(paramId: string, value: any, currentParams: Record<string, any>) {
    const newParams = { ...currentParams, [paramId]: value }

    for (const linkage of this.config.linkages) {
      if (this.shouldTrigger(linkage, paramId)) {
        const changes = this.executeLinkage(linkage, newParams)
        Object.assign(newParams, changes)
      }
    }

    return newParams
  }

  // 3. 构建 API 请求
  buildRequest(params: Record<string, any>, context: Context) {
    const endpointKey = this.selectEndpoint(params, context)
    const endpoint = this.config.endpoints.routes[endpointKey]

    const body = { ...this.config.request?.base }

    for (const p of this.config.params) {
      if (!p.apiField && !p.apiTransform && !p.apiMapping) continue

      const value = params[p.id]

      if (p.apiMapping?.[endpointKey]) {
        Object.assign(body, p.apiMapping[endpointKey].transform(value))
      } else if (p.apiTransform) {
        Object.assign(body, p.apiTransform(value))
      } else if (p.apiField) {
        body[p.apiField] = this.convertType(value, p.valueType)
      }
    }

    return { url: endpoint.path, method: endpoint.method || 'POST', body }
  }

  // 4. 计算价格
  calculatePrice(params: Record<string, any>): number {
    if (this.config.pricing.fixed) {
      return this.config.pricing.fixed
    }
    return this.config.pricing.calculate(params, this.config.pricing.rates)
  }
}
```

### 3.7 参数类型总结

#### 3.7.1 基础组件类型

| 类型 | 说明 | 配置项 |
|------|------|--------|
| `text` | 文本输入框 | maxLength, placeholder, multiline |
| `number` | 数字输入框 | min, max, step, unit |
| `slider` | 滑块 | min, max, step, marks |
| `dropdown` | 下拉选择 | options[] |
| `switch` | 开关 | - |
| `radio` | 单选组 | options[] |
| `checkbox` | 复选框组 | options[] |

#### 3.7.2 复合组件类型

| 类型 | 说明 | 组成部分 |
|------|------|----------|
| `panel:resolution` | 分辨率面板 | 比例 + 质量 + 自定义输入 |
| `panel:voice` | 音色选择面板 | 分类 + 试听 + 搜索 |
| `image-upload` | 图片上传 | 上传区 + 预览 + 数量限制 |
| `video-upload` | 视频上传 | 上传区 + 预览 + 时长显示 |
| `panel:color` | 颜色选择器 | 预设色 + 自定义 |

### 3.2 特殊面板系统设计

> ⚠️ 这是参数系统的重要组成部分，需要在重构前规划好

#### 3.2.1 特殊面板概述

特殊面板是指那些**无法用基础参数类型表达的复杂 UI 组件**。根据当前项目分析，存在以下几类：

| 面板类型 | 复杂度 | 当前状态 | 说明 |
|----------|--------|----------|------|
| **ResolutionPanel** | ⭐⭐⭐ | ✅ 已实现 | 比例+质量+自定义尺寸，多子组件组合 |
| **ModelSelectorPanel** | ⭐⭐⭐⭐⭐ | ✅ 已实现 | 搜索+多层筛选+网格+键盘导航，非常复杂 |
| **VoiceSelectorPanel** | ⭐⭐⭐ | ❌ 待实现 | 音色分类+试听+搜索 |
| **StyleGalleryPanel** | ⭐⭐ | ❌ 待实现 | 风格缩略图网格选择 |
| **ColorPickerPanel** | ⭐⭐ | ❌ 待实现 | 色板+取色器 |

#### 3.2.2 设计原则：通用版 vs 专用版

采用**分层设计**，兼顾灵活性和复用性：

```
┌─────────────────────────────────────────────────────────────────┐
│                    Level 3: 专用面板                             │
│  完全自定义的复杂面板，如 ModelSelectorPanel                      │
│  • 有独特的交互逻辑（键盘导航、智能搜索等）                        │
│  • 无法通过配置组合实现                                           │
│  • 需要单独开发和维护                                             │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ 继承/扩展
┌─────────────────────────────────────────────────────────────────┐
│                    Level 2: 可组合面板                           │
│  通过子组件组合实现，如 ResolutionPanel、VoiceSelectorPanel      │
│  • 由多个基础组件组成                                             │
│  • 支持配置驱动的灵活组合                                         │
│  • 子组件间有联动关系                                             │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ 组合
┌─────────────────────────────────────────────────────────────────┐
│                    Level 1: 基础组件                             │
│  原子级 UI 组件，可独立使用也可被组合                             │
│  • AspectRatioSelector (比例选择)                                │
│  • QualityTierSelector (质量选择)                                │
│  • CustomSizeInput (自定义尺寸)                                  │
│  • SearchInput (搜索框)                                          │
│  • FilterTabs (筛选标签)                                         │
│  • GridSelector (网格选择器)                                     │
│  • AudioPreview (音频试听)                                       │
└─────────────────────────────────────────────────────────────────┘
```

#### 3.2.3 特殊面板注册系统

```typescript
// src/core/panels/PanelRegistry.ts

// 面板类型定义
type PanelType =
  | 'resolution'        // 分辨率面板
  | 'model-selector'    // 模型选择面板
  | 'voice-selector'    // 音色选择面板
  | 'style-gallery'     // 风格画廊面板
  | 'color-picker'      // 颜色选择面板
  | 'composite'         // 通用可组合面板
  | 'custom'            // 完全自定义面板

// 面板配置接口
interface SpecialPanelConfig {
  // 基础信息
  type: PanelType
  label: I18nText

  // 面板外观
  width?: number              // 面板宽度，默认 320
  alignment?: 'above' | 'below' | 'left' | 'right' | 'center'
  closeOnPanelClick?: boolean // 点击面板内容是否关闭

  // 触发器外观
  triggerStyle?: 'button' | 'input' | 'card'
  triggerDisplay?: (value: any) => string  // 如何显示当前值

  // 面板特定配置（根据 type 不同而不同）
  config: ResolutionConfig | VoiceSelectorConfig | CompositeConfig | CustomConfig

  // 数据
  value: any
  onChange: (value: any) => void

  // 条件控制
  showWhen?: (params: Params) => boolean
  disabled?: (params: Params) => boolean
}

// 面板注册表
class PanelRegistry {
  private panels: Map<PanelType, React.ComponentType<any>> = new Map()

  // 注册面板组件
  register(type: PanelType, component: React.ComponentType<any>) {
    this.panels.set(type, component)
  }

  // 获取面板组件
  get(type: PanelType): React.ComponentType<any> | undefined {
    return this.panels.get(type)
  }

  // 渲染面板
  render(config: SpecialPanelConfig): React.ReactNode {
    const Component = this.panels.get(config.type)
    if (!Component) {
      console.warn(`Unknown panel type: ${config.type}`)
      return null
    }
    return <Component {...config} />
  }
}

export const panelRegistry = new PanelRegistry()

// 初始化时注册所有面板
panelRegistry.register('resolution', ResolutionPanel)
panelRegistry.register('model-selector', ModelSelectorPanel)
panelRegistry.register('voice-selector', VoiceSelectorPanel)
panelRegistry.register('composite', CompositePanel)
```

#### 3.2.4 可组合面板设计（CompositePanel）

可组合面板是一个**通用容器**，可以通过配置组合多个基础组件：

```typescript
// 可组合面板配置
interface CompositeConfig {
  // 子组件列表
  components: CompositeComponent[]

  // 布局方式
  layout: 'vertical' | 'horizontal' | 'grid'
  gap?: number

  // 组件间联动
  linkages?: ComponentLinkage[]
}

// 子组件定义
interface CompositeComponent {
  id: string
  type: 'aspect-ratio' | 'quality-tier' | 'custom-size' | 'search' | 'filter' | 'grid' | 'preview'
  label?: I18nText

  // 组件特定配置
  config: AspectRatioConfig | QualityTierConfig | CustomSizeConfig | ...

  // 显示条件
  showWhen?: (compositeValue: any) => boolean
}

// 组件间联动
interface ComponentLinkage {
  source: string      // 源组件 ID
  target: string      // 目标组件 ID
  effect: 'filter' | 'reset' | 'update'
  handler: (sourceValue: any, targetConfig: any) => any
}
```

**示例：通过配置创建分辨率面板**

```typescript
// 使用 CompositePanel 配置方式实现分辨率面板
const resolutionPanelConfig: CompositeConfig = {
  layout: 'vertical',
  gap: 16,

  components: [
    {
      id: 'aspectRatio',
      type: 'aspect-ratio',
      label: { zh: '比例', en: 'Aspect Ratio' },
      config: {
        options: ['16:9', '9:16', '1:1', '4:3', '3:4'],
        visualize: true,  // 显示可视化图标
        smartMatch: true  // 支持智能匹配
      }
    },
    {
      id: 'quality',
      type: 'quality-tier',
      label: { zh: '质量', en: 'Quality' },
      config: {
        options: [
          { value: '720P', label: '720P', hint: '1280×720' },
          { value: '1080P', label: '1080P', hint: '1920×1080' }
        ]
      }
    },
    {
      id: 'customSize',
      type: 'custom-size',
      label: { zh: '自定义尺寸', en: 'Custom Size' },
      config: {
        enableToggle: true,
        widthRange: [512, 4096],
        heightRange: [512, 4096],
        step: 64
      },
      showWhen: (value) => value.aspectRatio !== 'smart'
    },
    {
      id: 'preview',
      type: 'preview',
      config: {
        format: '{width} × {height} ({aspectRatio})'
      }
    }
  ],

  linkages: [
    {
      source: 'aspectRatio',
      target: 'customSize',
      effect: 'update',
      handler: (ratio, config) => {
        // 切换比例时更新自定义尺寸的默认值
        return calculateDefaultSize(ratio)
      }
    }
  ]
}
```

#### 3.2.5 专用面板设计

对于像 **ModelSelectorPanel** 这样复杂的面板，采用专用设计：

```typescript
// 专用面板直接实现，不走配置
// src/components/panels/ModelSelectorPanel.tsx

interface ModelSelectorPanelProps {
  // 选中状态
  selectedProvider: string
  selectedModel: string
  onSelect: (providerId: string, modelId: string) => void

  // 筛选状态
  filterProvider: string
  filterType: 'all' | 'favorite' | 'image' | 'video' | 'audio'
  filterFunction: string
  onFilterChange: (filters: Filters) => void

  // 收藏
  favorites: Set<string>
  onToggleFavorite: (modelId: string) => void
}

// 专用面板的特点：
// 1. 有独特的搜索算法（拼音匹配、评分排序）
// 2. 有复杂的键盘导航（方向键、Enter）
// 3. 有多层筛选逻辑
// 4. 有响应式网格布局
// 5. 有实时可见性管理

// 这些逻辑无法通过配置实现，需要专门开发
```

#### 3.2.6 现有面板分析

##### ResolutionPanel（当前实现）

```
当前结构：
┌─────────────────────────────────────────┐
│ 分辨率面板（320px 宽）                   │
├─────────────────────────────────────────┤
│ 比例选择（4列网格）                      │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐            │
│ │智能│ │21:9│ │16:9│ │3:2 │ ...        │
│ │ ▢  │ │ ▭  │ │ ▭  │ │ ▭  │            │
│ └────┘ └────┘ └────┘ └────┘            │
├─────────────────────────────────────────┤
│ 质量选择（2列网格）                      │
│ ┌──────────┐ ┌──────────┐              │
│ │ 高清 2K  │ │ 超清 4K  │              │
│ └──────────┘ └──────────┘              │
├─────────────────────────────────────────┤
│ 自定义尺寸                               │
│ ┌────────┐ ↔ ┌────────┐                │
│ │ 1280   │   │ 720    │                │
│ └────────┘   └────────┘                │
└─────────────────────────────────────────┘

特点：
- 专为即梦 4.0 设计
- 9 个比例选项 + 智能选项
- 2K/4K 质量切换
- 自定义尺寸输入（智能模式下禁用）
- 每个比例有可视化图标
```

##### ModelSelectorPanel（当前实现）

```
当前结构：
┌─────────────────────────────────────────────────────────────┐
│ 模型选择面板                                                 │
├─────────────────────────────────────────────────────────────┤
│ 🔍 搜索模型...                                         [X]  │
├─────────────────────────────────────────────────────────────┤
│ 供应商筛选：                                                 │
│ [全部] [PPIO] [Fal] [KIE] [ModelScope] │ [收藏] [图] [视] [音]│
├─────────────────────────────────────────────────────────────┤
│ 功能筛选：                                                   │
│ [图片生成] [图片编辑] [文生视频] [图生视频] [首尾帧] ...      │
├─────────────────────────────────────────────────────────────┤
│ 模型网格（响应式 2-5 列）：                                   │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐             │
│ │ ⭐          │ │ ⭐          │ │ ⭐          │             │
│ │ 可灵 2.6    │ │ Wan 2.6     │ │ Veo 3.1     │             │
│ │ PPIO · 视频 │ │ PPIO · 视频 │ │ Fal · 视频  │             │
│ └─────────────┘ └─────────────┘ └─────────────┘             │
│ ...                                                          │
└─────────────────────────────────────────────────────────────┘

特点：
- 智能搜索（中文、拼音、首字母，带评分排序）
- 四层筛选（供应商 → 类型 → 功能 → 搜索）
- 完整键盘导航（方向键 + Enter）
- 响应式网格（2/3/4/5 列）
- 收藏系统
- 动态可见性管理
```

##### VoiceSelectorPanel（待设计）

```
建议结构：
┌─────────────────────────────────────────────────────────────┐
│ 音色选择面板                                                 │
├─────────────────────────────────────────────────────────────┤
│ 🔍 搜索音色...                                               │
├─────────────────────────────────────────────────────────────┤
│ 分类筛选：                                                   │
│ [全部] [女声] [男声] [儿童] [特殊]                           │
├─────────────────────────────────────────────────────────────┤
│ 音色列表：                                                   │
│ ┌───────────────────────────────────────────────────────┐   │
│ │ 🔊 温柔女声                                    [试听▶] │   │
│ │    清新自然，适合旁白、有声书                          │   │
│ └───────────────────────────────────────────────────────┘   │
│ ┌───────────────────────────────────────────────────────┐   │
│ │ 🔊 磁性男声                                    [试听▶] │   │
│ │    低沉有力，适合广告、纪录片                          │   │
│ └───────────────────────────────────────────────────────┘   │
│ ...                                                          │
└─────────────────────────────────────────────────────────────┘

特点：
- 按性别/风格分类
- 每个音色有试听按钮
- 音色描述/适用场景
- 支持搜索
- 可通过 CompositePanel 配置实现
```

#### 3.2.7 在模型定义中使用特殊面板

```typescript
// 方式1：使用预定义的面板类型
{
  id: 'resolution',
  type: 'panel',
  panelType: 'resolution',  // 使用注册的分辨率面板
  config: {
    aspectRatios: ['16:9', '9:16', '1:1'],
    qualityTiers: ['720P', '1080P'],
    smartMatch: true
  }
}

// 方式2：使用可组合面板
{
  id: 'resolution',
  type: 'panel',
  panelType: 'composite',
  config: {
    layout: 'vertical',
    components: [
      { type: 'aspect-ratio', ... },
      { type: 'quality-tier', ... }
    ]
  }
}

// 方式3：引用专用面板（不走配置）
{
  id: 'model',
  type: 'panel',
  panelType: 'model-selector',
  // ModelSelectorPanel 的配置通过 props 传入，不在这里定义
}
```

---

### 3.3 分辨率面板详细设计

> 作为最常用的特殊面板，这里详细说明其设计

#### 3.3.1 组件拆分

```
ResolutionPanel (容器组件)
├── AspectRatioSelector  // 比例选择器
├── QualityTierSelector  // 质量档位选择器
├── CustomSizeInput      // 自定义尺寸输入
└── PreviewDisplay       // 预览显示
```

#### 3.3.2 三种分辨率模式

根据 API 需求，分辨率有三种模式：

| 模式 | 说明 | 示例 | 适用场景 |
|------|------|------|----------|
| Mode A | 比例 + 质量档位 | `16:9` + `720P` | Wan 2.6 |
| Mode B | 预设分辨率 | `1280x720` | 部分图片模型 |
| Mode C | 自定义尺寸 | `width: 1920, height: 1080` | 高级用户 |

#### 3.3.3 分辨率参数定义

```typescript
interface ResolutionParamDef {
  id: string
  type: 'resolution'
  label: I18nText

  // 模式配置
  mode: 'aspect-quality' | 'preset' | 'custom' | 'hybrid'

  // 比例选项（Mode A）
  aspectRatios?: {
    options: AspectRatioOption[]
    default: string
    smartMatch?: boolean  // 是否根据上传图片自动匹配
  }

  // 质量档位（Mode A）
  qualityTiers?: {
    options: QualityOption[]
    default: string
    // 不同比例可用的质量档位可能不同
    availableFor?: Record<string, string[]>
  }

  // 预设分辨率（Mode B）
  presets?: {
    options: PresetOption[]
    default: string
  }

  // 自定义尺寸（Mode C）
  customSize?: {
    enabled: boolean
    minWidth: number
    maxWidth: number
    minHeight: number
    maxHeight: number
    step: number
  }

  // 转换函数：将 UI 值转换为 API 需要的格式
  transform: (value: ResolutionValue) => any
}

// 分辨率值类型
interface ResolutionValue {
  mode: 'aspect-quality' | 'preset' | 'custom'
  aspectRatio?: string      // '16:9'
  quality?: string          // '720P'
  preset?: string           // '1280x720'
  width?: number            // 1920
  height?: number           // 1080
}

// 比例选项
interface AspectRatioOption {
  value: string             // '16:9'
  label: I18nText           // { zh: '16:9 横屏', en: '16:9 Landscape' }
  icon?: string             // 可选图标
}

// 质量选项
interface QualityOption {
  value: string             // '720P'
  label: I18nText           // { zh: '720P 标清', en: '720P SD' }
  resolution?: string       // 实际分辨率提示 '1280×720'
}
```

#### 3.2.4 分辨率面板 UI 结构

```
┌─────────────────────────────────────────────────────────────┐
│ 分辨率                                          [?] 帮助   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  比例：                                                     │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐              │
│  │ 16:9 │ │ 9:16 │ │ 1:1  │ │ 4:3  │ │ 3:4  │              │
│  │  ▭   │ │  ▯   │ │  ▢   │ │  ▭   │ │  ▯   │              │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘              │
│     ✓                                                       │
│                                                             │
│  质量：                                                     │
│  ┌────────────┐ ┌────────────┐                             │
│  │   720P     │ │   1080P    │                             │
│  │ 1280×720   │ │ 1920×1080  │                             │
│  └────────────┘ └────────────┘                             │
│       ✓                                                     │
│                                                             │
│  [  ] 自定义尺寸                                           │
│  ┌─────────────┐   ┌─────────────┐                         │
│  │ 宽度: 1280  │ × │ 高度: 720   │                         │
│  └─────────────┘   └─────────────┘                         │
│                                                             │
│  预览：1280 × 720 (16:9)                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 参数联动系统

参数之间存在复杂的联动关系，需要设计一个灵活的联动系统。

#### 3.3.1 联动类型

| 联动类型 | 说明 | 示例 |
|----------|------|------|
| 显示/隐藏 | 根据其他参数决定是否显示 | mode='reference' 时显示视频上传 |
| 选项过滤 | 根据其他参数过滤可选项 | 720P 时时长支持 5-15s，1080P 时只支持 5-10s |
| 值联动 | 一个参数变化时自动调整另一个 | 切换比例时自动重置质量为默认值 |
| 智能匹配 | 根据上传内容自动设置 | 上传图片后自动匹配最接近的比例 |

#### 3.3.2 联动定义方式

```typescript
interface ParamDef {
  id: string
  type: string
  // ...其他属性

  // 方式1：显示条件
  showWhen?: (params: Params, context: Context) => boolean

  // 方式2：选项过滤
  filterOptions?: (options: Option[], params: Params) => Option[]

  // 方式3：值变化时的副作用
  onChange?: (newValue: any, params: Params) => Partial<Params> | void

  // 方式4：智能匹配
  smartMatch?: {
    trigger: 'image-upload' | 'video-upload'
    matcher: (uploadedFile: FileInfo, options: Option[]) => string
  }
}
```

#### 3.3.3 联动示例

```typescript
// 示例1：分辨率影响时长选项
{
  id: 'duration',
  type: 'dropdown',
  label: { zh: '时长', en: 'Duration' },
  options: [
    { value: 5, label: '5s' },
    { value: 10, label: '10s' },
    { value: 15, label: '15s' }
  ],
  // 1080P 时不支持 15s
  filterOptions: (options, params) => {
    if (params.quality === '1080P') {
      return options.filter(o => o.value <= 10)
    }
    return options
  }
}

// 示例2：模式影响上传区显示
{
  id: 'videoUpload',
  type: 'video-upload',
  label: { zh: '参考视频', en: 'Reference Video' },
  maxCount: 3,
  // 只在参考模式时显示
  showWhen: (params) => params.mode === 'reference-to-video'
}

// 示例3：上传图片自动匹配比例
{
  id: 'aspectRatio',
  type: 'aspect-ratio',
  options: ['16:9', '9:16', '1:1', '4:3', '3:4'],
  smartMatch: {
    trigger: 'image-upload',
    matcher: (file, options) => {
      const ratio = file.width / file.height
      // 找最接近的比例
      return findClosestRatio(ratio, options)
    }
  }
}

// 示例4：切换模式时重置相关参数
{
  id: 'mode',
  type: 'dropdown',
  options: [
    { value: 'text-to-video', label: '文生视频' },
    { value: 'image-to-video', label: '图生视频' },
    { value: 'reference-to-video', label: '参考生视频' }
  ],
  onChange: (newMode, params) => {
    // 切换模式时清空上传的文件
    return {
      uploadedImages: [],
      uploadedVideos: []
    }
  }
}
```

### 3.4 上传组件设计

#### 3.4.1 图片上传

```typescript
interface ImageUploadParamDef {
  id: string
  type: 'image-upload'
  label: I18nText

  // 数量限制
  maxCount: number
  minCount?: number

  // 格式限制
  accept?: string[]  // ['image/png', 'image/jpeg', 'image/webp']
  maxSize?: number   // 单位 MB

  // 显示条件
  showWhen?: (params: Params) => boolean

  // 上传后的处理
  onUpload?: (files: UploadedFile[]) => void

  // 是否触发智能匹配
  triggerSmartMatch?: string[]  // 触发哪些参数的智能匹配，如 ['aspectRatio']

  // 上传格式
  uploadFormat: 'base64' | 'url' | 'file'
  base64WithPrefix?: boolean  // Base64 是否带 data:image/... 前缀
}
```

#### 3.4.2 视频上传

```typescript
interface VideoUploadParamDef {
  id: string
  type: 'video-upload'
  label: I18nText

  // 数量限制
  maxCount: number
  minCount?: number

  // 格式限制
  accept?: string[]  // ['video/mp4', 'video/webm']
  maxSize?: number   // 单位 MB
  maxDuration?: number  // 单位 秒

  // 显示条件
  showWhen?: (params: Params) => boolean

  // 上传服务
  uploadService: 'general' | 'provider-specific'  // 使用通用上传还是供应商特定上传

  // 上传后回调
  onUpload?: (files: UploadedVideo[]) => void
}

interface UploadedVideo {
  url: string
  duration: number
  thumbnail?: string
}
```

### 3.5 完整的参数定义示例

以 Wan 2.6 为例，展示完整的单文件配置：

```typescript
// src/models/ppio/wan-2.6.model.ts
import { defineModel } from '@/core/defineModel'

export default defineModel({
  // ========== 元数据 ==========
  id: 'wan-2.6',
  provider: 'ppio',
  type: 'video',

  name: { zh: 'Wan 2.6', en: 'Wan 2.6' },
  description: {
    zh: '支持文生视频、图生视频、参考生视频三种模式，720P/1080P 双档位',
    en: 'Supports text/image/reference to video, 720P/1080P quality tiers'
  },

  functions: ['text-to-video', 'image-to-video', 'reference-to-video'],

  progressConfig: {
    type: 'polling',
    interval: 3000,
    maxAttempts: 40
  },

  // ========== 参数定义 ==========
  parameters: [
    // 生成模式
    {
      id: 'mode',
      type: 'dropdown',
      label: { zh: '生成模式', en: 'Generation Mode' },
      default: 'text-image-to-video',
      options: [
        { value: 'text-image-to-video', label: { zh: '文/图生视频', en: 'Text/Image to Video' } },
        { value: 'reference-to-video', label: { zh: '参考生视频', en: 'Reference to Video' } }
      ],
      onChange: (newMode) => ({
        // 切换模式时清空上传
        uploadedImages: [],
        uploadedVideos: []
      })
    },

    // 分辨率（复合组件）
    {
      id: 'resolution',
      type: 'resolution',
      label: { zh: '分辨率', en: 'Resolution' },
      mode: 'aspect-quality',

      aspectRatios: {
        options: [
          { value: '16:9', label: { zh: '16:9 横屏', en: '16:9 Landscape' } },
          { value: '9:16', label: { zh: '9:16 竖屏', en: '9:16 Portrait' } },
          { value: '1:1', label: { zh: '1:1 方形', en: '1:1 Square' } },
          { value: '4:3', label: { zh: '4:3', en: '4:3' } },
          { value: '3:4', label: { zh: '3:4', en: '3:4' } }
        ],
        default: '16:9',
        smartMatch: true  // 根据上传图片自动匹配
      },

      qualityTiers: {
        options: [
          { value: '720P', label: { zh: '720P', en: '720P' }, resolution: '1280×720' },
          { value: '1080P', label: { zh: '1080P', en: '1080P' }, resolution: '1920×1080' }
        ],
        default: '720P'
      },

      // 转换为 API 格式
      transform: (value) => {
        const sizeMap = {
          '16:9': { '720P': '1280*720', '1080P': '1920*1080' },
          '9:16': { '720P': '720*1280', '1080P': '1080*1920' },
          '1:1': { '720P': '960*960', '1080P': '1440*1440' },
          '4:3': { '720P': '1088*832', '1080P': '1632*1248' },
          '3:4': { '720P': '832*1088', '1080P': '1248*1632' }
        }
        return {
          size: sizeMap[value.aspectRatio][value.quality],
          resolution: value.quality  // 图生视频用这个
        }
      }
    },

    // 时长
    {
      id: 'duration',
      type: 'slider',
      label: { zh: '时长', en: 'Duration' },
      default: 5,
      min: 5,
      max: 15,
      step: 5,
      unit: 's',
      marks: [
        { value: 5, label: '5s' },
        { value: 10, label: '10s' },
        { value: 15, label: '15s' }
      ],
      // 参考模式只支持 5-10s
      filterRange: (params) => {
        if (params.mode === 'reference-to-video') {
          return { max: 10 }
        }
        return {}
      }
    },

    // 镜头类型
    {
      id: 'shotType',
      type: 'dropdown',
      label: { zh: '镜头类型', en: 'Shot Type' },
      default: 'multi',
      options: [
        { value: 'single', label: { zh: '单镜头', en: 'Single Shot' } },
        { value: 'multi', label: { zh: '多镜头', en: 'Multi Shot' } }
      ]
    },

    // 音频开关
    {
      id: 'audio',
      type: 'switch',
      label: { zh: '生成音频', en: 'Generate Audio' },
      default: true
    },

    // 提示词扩展
    {
      id: 'promptExtend',
      type: 'switch',
      label: { zh: '提示词扩展', en: 'Prompt Extend' },
      default: false,
      description: { zh: '自动扩展优化提示词', en: 'Automatically expand and optimize prompt' }
    },

    // 图片上传
    {
      id: 'imageUpload',
      type: 'image-upload',
      label: { zh: '参考图片', en: 'Reference Image' },
      maxCount: 1,
      showWhen: (params) => params.mode === 'text-image-to-video',
      uploadFormat: 'base64',
      base64WithPrefix: false,
      triggerSmartMatch: ['resolution.aspectRatio']
    },

    // 视频上传
    {
      id: 'videoUpload',
      type: 'video-upload',
      label: { zh: '参考视频', en: 'Reference Videos' },
      maxCount: 3,
      showWhen: (params) => params.mode === 'reference-to-video',
      uploadService: 'general',
      description: { zh: '支持上传 1-3 个参考视频', en: 'Upload 1-3 reference videos' }
    }
  ],

  // ========== 价格计算 ==========
  pricing: {
    currency: '¥',
    calculate: (params) => {
      const rates = { '720P': 0.6, '1080P': 1.0 }
      const quality = params.resolution?.quality || '720P'
      const duration = params.duration || 5
      return rates[quality] * duration
    }
  },

  // ========== API 配置 ==========
  api: {
    // 端点映射
    endpoints: {
      'text-to-video': '/async/wan2.6-t2v',
      'image-to-video': '/async/wan2.6-i2v',
      'reference-to-video': '/async/wan2.6-v2v'
    },

    // 根据参数确定使用哪个端点
    selectEndpoint: (params) => {
      if (params.mode === 'reference-to-video') {
        return 'reference-to-video'
      }
      if (params.uploadedImages?.length > 0) {
        return 'image-to-video'
      }
      return 'text-to-video'
    },

    // 构建请求体
    buildRequest: (params, context) => {
      const resolution = params.resolution || { aspectRatio: '16:9', quality: '720P' }
      const transformed = params._transforms.resolution  // 由 transform 函数生成

      const base = {
        prompt: params.prompt,
        duration: params.duration,
        shot_type: params.shotType,
        audio: params.audio,
        prompt_extend: params.promptExtend,
        watermark: false
      }

      // 根据端点添加不同参数
      const endpoint = context.selectedEndpoint

      if (endpoint === 'image-to-video') {
        return {
          ...base,
          img_url: context.uploadedImages[0],
          resolution: transformed.resolution
        }
      }

      if (endpoint === 'reference-to-video') {
        return {
          ...base,
          size: transformed.size,
          reference_video_urls: context.uploadedVideos.map(url => ({ url }))
        }
      }

      // text-to-video
      return {
        ...base,
        size: transformed.size
      }
    }
  }
})
```

---

## 四、新架构设计

### 4.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         Model Files                              │
│  📁 src/models/{provider}/{model}.model.ts                      │
│  • 每个模型一个文件，包含所有配置                                │
│  • 自动发现，无需手动注册                                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Model Registry                             │
│  📁 src/core/ModelRegistry.ts                                   │
│  • 自动扫描 *.model.ts 文件                                      │
│  • 提供模型查询接口                                              │
│  • 管理模型生命周期                                              │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Dynamic State System                        │
│  📁 src/hooks/useModelParams.ts                                 │
│  • 从 Schema 动态生成状态                                        │
│  • 处理参数联动                                                  │
│  • 管理默认值和重置                                              │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                       UI Components                              │
│  📁 src/components/params/                                      │
│  • 基础组件：TextInput, NumberInput, Dropdown, Switch...        │
│  • 复合组件：ResolutionPanel, ImageUpload, VideoUpload...       │
│  • 根据 Schema 自动渲染                                          │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Unified Adapter                             │
│  📁 src/adapters/UnifiedAdapter.ts                              │
│  • 统一的生成接口                                                │
│  • 根据 provider 分发到具体实现                                  │
│  • 使用模型定义中的 api.buildRequest                             │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Provider Implementations                      │
│  📁 src/adapters/providers/                                     │
│  • PPIOProvider: Axios + 轮询                                    │
│  • FalProvider: @fal-ai/client                                  │
│  • KIEProvider: Axios + KIE CDN                                 │
│  • ModelscopeProvider: Tauri invoke                             │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 核心模块

#### 4.2.1 Model Registry

```typescript
// src/core/ModelRegistry.ts
class ModelRegistry {
  private models: Map<string, ModelDefinition> = new Map()

  // 自动发现模型文件
  async autoDiscover() {
    const modules = import.meta.glob('@/models/**/*.model.ts')
    for (const path in modules) {
      const module = await modules[path]()
      this.register(module.default)
    }
  }

  // 注册模型
  register(model: ModelDefinition) {
    this.models.set(model.id, model)
    // 如果有别名，也注册
    model.aliases?.forEach(alias => {
      this.models.set(alias, model)
    })
  }

  // 获取模型
  getModel(id: string): ModelDefinition | undefined {
    return this.models.get(id)
  }

  // 获取参数 Schema
  getSchema(id: string): ParamDef[] {
    return this.models.get(id)?.parameters || []
  }

  // 计算价格
  getPrice(id: string, params: Params): number {
    const model = this.models.get(id)
    return model?.pricing.calculate(params) || 0
  }

  // 获取所有模型（按 provider 分组）
  getModelsByProvider(): Record<string, ModelDefinition[]> {
    // ...
  }
}

export const registry = new ModelRegistry()
```

#### 4.2.2 Dynamic State Hook

```typescript
// src/hooks/useModelParams.ts
function useModelParams(modelId: string) {
  const schema = registry.getSchema(modelId)

  // 从 Schema 提取默认值
  const defaults = useMemo(() =>
    extractDefaults(schema), [schema]
  )

  // 统一的参数状态
  const [params, setParams] = useState<Params>(defaults)

  // 设置单个参数（处理联动）
  const setParam = useCallback((key: string, value: any) => {
    setParams(prev => {
      const next = { ...prev, [key]: value }

      // 查找该参数的 onChange 处理器
      const paramDef = schema.find(p => p.id === key)
      if (paramDef?.onChange) {
        const changes = paramDef.onChange(value, next)
        if (changes) {
          Object.assign(next, changes)
        }
      }

      return next
    })
  }, [schema])

  // 重置为默认值
  const resetParams = useCallback(() => {
    setParams(defaults)
  }, [defaults])

  // 批量设置（用于预设加载）
  const setParamsBatch = useCallback((values: Partial<Params>) => {
    setParams(prev => ({ ...prev, ...values }))
  }, [])

  // 获取过滤后的选项（处理联动）
  const getFilteredOptions = useCallback((paramId: string) => {
    const paramDef = schema.find(p => p.id === paramId)
    if (!paramDef?.options) return []

    if (paramDef.filterOptions) {
      return paramDef.filterOptions(paramDef.options, params)
    }
    return paramDef.options
  }, [schema, params])

  return {
    params,
    setParam,
    setParamsBatch,
    resetParams,
    getFilteredOptions,
    schema
  }
}
```

#### 4.2.3 参数渲染器

```typescript
// src/components/params/ParamRenderer.tsx
function ParamRenderer({
  paramDef,
  value,
  onChange,
  allParams,
  getFilteredOptions
}: ParamRendererProps) {

  // 检查显示条件
  if (paramDef.showWhen && !paramDef.showWhen(allParams)) {
    return null
  }

  // 根据类型渲染不同组件
  switch (paramDef.type) {
    case 'text':
      return <TextInput {...paramDef} value={value} onChange={onChange} />

    case 'number':
      return <NumberInput {...paramDef} value={value} onChange={onChange} />

    case 'slider':
      return <SliderInput {...paramDef} value={value} onChange={onChange} />

    case 'dropdown':
      return (
        <DropdownInput
          {...paramDef}
          value={value}
          onChange={onChange}
          options={getFilteredOptions(paramDef.id)}
        />
      )

    case 'switch':
      return <SwitchInput {...paramDef} value={value} onChange={onChange} />

    case 'resolution':
      return (
        <ResolutionPanel
          {...paramDef}
          value={value}
          onChange={onChange}
          allParams={allParams}
        />
      )

    case 'image-upload':
      return (
        <ImageUploader
          {...paramDef}
          value={value}
          onChange={onChange}
          onSmartMatch={(ratio) => {
            // 触发智能匹配
          }}
        />
      )

    case 'video-upload':
      return <VideoUploader {...paramDef} value={value} onChange={onChange} />

    default:
      return null
  }
}

// 自动渲染所有参数
function ParamsPanel({ modelId }: { modelId: string }) {
  const { params, setParam, schema, getFilteredOptions } = useModelParams(modelId)

  return (
    <div className="params-panel">
      {schema.map(paramDef => (
        <ParamRenderer
          key={paramDef.id}
          paramDef={paramDef}
          value={params[paramDef.id]}
          onChange={(value) => setParam(paramDef.id, value)}
          allParams={params}
          getFilteredOptions={getFilteredOptions}
        />
      ))}
    </div>
  )
}
```

---

## 五、i18n 设计

### 5.1 文本类型

```typescript
// 所有用户可见文本都使用 I18nText
type I18nText = {
  zh: string
  en: string
  // 可扩展更多语言
}

// 或简写形式（仅中文）
type I18nText = string | { zh: string; en: string }
```

### 5.2 使用方式

```typescript
// 模型定义中
{
  name: { zh: '可灵 2.6', en: 'Kling 2.6' },
  label: { zh: '分辨率', en: 'Resolution' }
}

// Hook 使用
const { t } = useI18n()
const label = t(paramDef.label)  // 根据当前语言返回对应文本
```

---

## 六、SQLite 存储设计

### 6.1 表结构

```sql
-- 生成历史
CREATE TABLE history (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'image' | 'video' | 'audio'
  prompt TEXT,
  params TEXT,  -- JSON
  result_url TEXT,
  local_path TEXT,
  status TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 预设
CREATE TABLE presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  model_id TEXT NOT NULL,
  params TEXT NOT NULL,  -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 设置
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### 6.2 迁移策略

1. 读取现有 `history.json`
2. 解析并插入 SQLite
3. 删除 Base64 数据，只保留文件路径
4. 备份原文件后删除

---

## 七、节点系统设计（画布准备）

### 7.1 节点抽象

```typescript
interface ModelNode {
  id: string
  type: 'model'
  modelId: string

  // 输入端口（从参数 Schema 推导）
  inputs: InputPort[]

  // 输出端口
  outputs: OutputPort[]

  // 执行函数
  execute: (inputs: Record<string, any>) => Promise<Record<string, any>>
}

interface InputPort {
  id: string
  name: string
  type: 'string' | 'number' | 'boolean' | 'image' | 'video' | 'any'
  required: boolean
  default?: any
}

interface OutputPort {
  id: string
  name: string
  type: 'image' | 'video' | 'audio' | 'any'
}
```

### 7.2 自动生成节点

```typescript
function modelToNode(model: ModelDefinition): ModelNode {
  return {
    id: `node-${model.id}`,
    type: 'model',
    modelId: model.id,

    inputs: model.parameters.map(param => ({
      id: param.id,
      name: t(param.label),
      type: paramTypeToPortType(param.type),
      required: param.required ?? false,
      default: param.default
    })),

    outputs: [{
      id: 'output',
      name: model.type === 'image' ? 'Image' : model.type === 'video' ? 'Video' : 'Audio',
      type: model.type
    }],

    execute: async (inputs) => {
      const adapter = getAdapter(model.provider)
      const result = await adapter.generate(model.id, inputs)
      return { output: result }
    }
  }
}
```

---

## 八、实施计划

### Phase 1：核心重构（2-3 周）

- [ ] 设计并实现 `ModelDefinition` 接口
- [ ] 实现 `ModelRegistry` 自动发现
- [ ] 实现 `useModelParams` 动态状态
- [ ] 迁移 2-3 个模型作为试点
- [ ] 验证新架构可行性

### Phase 2：组件重构（2 周）

- [ ] 实现基础参数组件
- [ ] 实现 `ResolutionPanel` 复合组件
- [ ] 实现 `ImageUploader` / `VideoUploader`
- [ ] 实现 `ParamRenderer` 自动渲染
- [ ] 迁移剩余模型

### Phase 3：适配器统一（1 周）

- [ ] 重构 `UnifiedAdapter`
- [ ] 简化 Provider 实现
- [ ] 移除旧的路由系统

### Phase 4：i18n + SQLite（1 周）

- [ ] 集成 i18next
- [ ] 抽取文本到 locales
- [ ] 实现 SQLite 存储
- [ ] 数据迁移

### Phase 5：节点系统（4-6 周）

- [ ] 设计节点接口
- [ ] 实现节点执行器
- [ ] 集成 ReactFlow
- [ ] 实现画布 UI

---

## 九、风险和注意事项

### 9.1 风险

1. **大规模重构可能引入 Bug**
   - 建议：渐进式迁移，保持旧架构可用

2. **TypeScript 类型推导复杂**
   - 建议：使用 Zod 做运行时验证

3. **性能问题**
   - 建议：使用 React.memo 和 useMemo 优化渲染

### 9.2 注意事项

1. **保持向后兼容**：新旧模型可以共存
2. **充分测试**：每个阶段完成后进行回归测试
3. **文档更新**：同步更新开发文档

---

## 十、待讨论问题

1. 分辨率面板的具体 UI 设计？
2. 参数联动的优先级如何处理？（多个参数同时变化）
3. 预设系统如何与新架构集成？
4. 节点系统是否需要支持自定义节点？

---

## 十一、补充发现（深度分析后）

> 以下是对项目代码和文档深度分析后发现的遗漏点

### 11.1 参数命名冲突问题 ⚠️ 严重

**问题描述**：

当前存在两种参数命名方式混用：
1. **供应商前缀参数**：`ppioKling26AspectRatio`、`falVeo31Duration`
2. **通用共享参数**：`videoDuration`、`videoResolution`

**影响**：
- 不同供应商的相同模型会**共享状态**
- 切换供应商时参数值可能互相干扰
- 预设功能无法区分不同供应商的参数
- 价格计算可能使用错误的参数值

**当前状态分析**：
```typescript
// 问题示例：多个模型共享 videoDuration
// Hailuo 默认 6 秒，其他模型默认 5 秒
// 切换模型时可能导致使用错误的默认值

const [videoDuration, setVideoDuration] = useState(5)  // 共享
const [ppioHailuo23VideoDuration, setPpioHailuo23VideoDuration] = useState(6)  // 独立
```

**重构策略**：

| 策略 | 说明 | 优点 | 缺点 |
|------|------|------|------|
| A. 全面前缀化 | 所有参数都带供应商+模型前缀 | 完全隔离 | 代码量大增 |
| B. 智能共享 | 相同行为的参数共享，不同的独立 | 平衡 | 需要判断逻辑 |
| C. 动态参数 | 统一用 `params[modelId][paramId]` | 彻底解决 | 重构量大 |

**建议**：采用策略 C（动态参数），这也是新架构 `useModelParams` 的核心思想。

---

### 11.2 默认值重置逻辑 ⚠️ 重要

**问题**：切换模型时，某些参数需要重置为新模型的默认值。

**当前实现**（散落在各处）：
```typescript
// MediaGenerator/index.tsx 中的 useEffect
useEffect(() => {
  if (state.selectedModel === 'seedance-v1') {
    if (state.videoDuration !== 5 && state.videoDuration !== 10) {
      state.setVideoDuration(5)  // 仅在无效值时重置
    }
  }
}, [state.selectedModel, state.videoDuration])
```

**问题**：
- 重置逻辑分散，难以维护
- 容易遗漏新模型
- 逻辑复杂，可读性差

**重构方案**：

```typescript
// 在模型定义中声明重置规则
{
  id: 'duration',
  type: 'slider',
  default: 5,
  resetOnModelChange: true,  // 切换模型时重置
  validateValue: (value, params) => {
    // 验证当前值是否有效
    if (params.mode === 'reference') {
      return value <= 10  // 参考模式最大10秒
    }
    return true
  }
}
```

---

### 11.3 历史数据安全与 Base64 膨胀 ⚠️ 严重

**问题背景**：
- 历史记录保存在 `history.json`
- 如果保存了 Base64 图片数据，文件会急剧膨胀
- 可能导致应用启动缓慢或崩溃

**核心原则**：
```typescript
// ✅ 正确：只保存 filePath
result: {
  filePath: '/path/to/image.png',
  // 绝对不保存 url 字段（可能包含 base64）
}

// ❌ 错误：保存了完整 URL（可能是 base64）
result: {
  url: 'data:image/png;base64,iVBORw0KGgo...',  // 巨大的字符串
  filePath: '/path/to/image.png'
}
```

**需要验证的检查点**：
1. 所有 Adapter 的 `generateImage/Video/Audio` 是否都返回 `filePath`
2. `App.tsx` 保存历史时是否过滤了 `url` 字段
3. 多图场景是否使用 `|||` 分隔符正确处理
4. 加载历史时是否根据 `filePath` 重新生成 URL

**重构方案**：SQLite 存储（已在计划中）+ 媒体文件独立管理。

---

### 11.4 AutoSwitch 机制的高级特性

**当前实现发现**（`SchemaForm.tsx`）：

```typescript
// 支持 watchKeys 精确控制触发时机
autoSwitch: {
  condition: (values) => values.uploadedImages?.length > 0,
  value: 'smart',
  watchKeys: ['uploadedImages']  // 只在这些 key 变化时才检查
}

// 支持数组形式的多个规则
autoSwitch: [
  { condition: (v) => v.mode === 'a', value: 'x' },
  { condition: (v) => v.mode === 'b', value: 'y' }
]

// 支持动态值
autoSwitch: {
  condition: (v) => v.hasImage,
  value: (v) => calculateOptimalRatio(v.imageRatio)  // 函数
}

// 支持禁止自动恢复
autoSwitch: {
  condition: (v) => v.mode === 'fast',
  value: 'low',
  noRestore: true  // 条件不满足时不恢复默认值
}
```

**重构考虑**：
- 新架构需要完整支持这些高级特性
- 考虑简化 API，减少配置复杂度
- 需要良好的调试工具

---

### 11.5 硬编码逻辑排查 ⚠️ 关键

**问题位置**：

```typescript
// optionsBuilder.ts - 类型判断逻辑
if (currentModel?.type === 'image' &&
    selectedModel !== 'nano-banana' &&
    selectedModel !== 'nano-banana-pro') {
  // 处理分辨率
}

// 每添加一个需要排除的模型，都要修改这里
```

**需要排查的硬编码模式**：

| 模式 | 位置 | 影响 |
|------|------|------|
| `selectedModel === '...'` | 多处 | 新模型可能被遗漏 |
| `currentModel?.type === 'image'` | optionsBuilder | 某些图片模型需要特殊处理 |
| `provider === 'fal'` | 上传逻辑 | 新供应商需要修改 |
| 固定的轮询间隔 `3000` | 多处 | 无法针对模型调整 |

**重构方案**：

```typescript
// 使用模型标签系统替代硬编码
{
  id: 'nano-banana',
  tags: ['no-resolution-panel', 'special-upload'],
  // ...
}

// 使用标签判断
if (model.tags?.includes('no-resolution-panel')) {
  // 跳过分辨率面板
}
```

---

### 11.6 多处同步问题（适配新模型的完整链路）

**当前状态**：添加一个新参数需要修改 **7-10 个位置**：

```
1. src/models/{provider}/{model}.ts          # Schema 定义
2. src/models/index.ts                        # Schema 注册
3. useMediaGeneratorState.ts                  # useState 声明
4. useMediaGeneratorState.ts                  # 返回对象
5. MediaGenerator/index.tsx                   # handleSchemaChange setterMap
6. MediaGenerator/index.tsx                   # createPresetSetterMap 调用
7. presetStateMapping.ts                      # PresetSetters 接口
8. presetStateMapping.ts                      # createPresetSetterMap 实现
9. builders/configs/*.ts                      # OptionsBuilder 配置（可选）
10. pricing.ts                                 # 价格计算器（可选）
```

**这是重构的核心痛点！**

**新架构目标**：只需创建 1 个文件。

---

### 11.7 OptionsBuilder 双重架构

**发现**：项目中存在两套配置系统：

1. **旧系统**：`optionsBuilder.ts` - 硬编码逻辑
2. **新系统**：`builders/configs/*.ts` - 配置驱动

```typescript
// 新系统示例（builders/configs/ppio-models.ts）
export const wan26Config: ModelConfig = {
  id: 'wan-2.6',
  type: 'video',
  provider: 'ppio',
  paramMapping: {
    duration: {
      source: ['ppioWan26VideoDuration', 'videoDuration'],
      defaultValue: 5
    }
  },
  features: {
    smartMatch: { enabled: true, paramKey: 'aspect_ratio' },
    imageUpload: { enabled: true, mode: 'single' }
  }
}
```

**问题**：
- 两套系统并存，增加复杂度
- 不清楚哪些模型用哪套系统
- 迁移不完整

**重构建议**：
- 统一到新的配置系统
- 完全移除 `optionsBuilder.ts` 中的硬编码逻辑

---

### 11.8 上传服务架构

**发现的完整架构**：

```
src/services/upload/
├── UploadService.ts              # 主服务（单例）
└── providers/
    ├── BaseUploadProvider.ts     # 基类
    ├── FalUploadProvider.ts      # Fal CDN（使用 @fal-ai/client）
    ├── KieUploadProvider.ts      # KIE CDN
    └── BizyAirUploadProvider.ts  # BizyAir CDN
```

**上传格式差异**：

| 供应商 | 图片格式 | 视频格式 | 说明 |
|--------|----------|----------|------|
| PPIO | Base64（无前缀） | URL | 图片内嵌，视频需上传 |
| Fal | URL | URL | 都需要上传到 Fal CDN |
| KIE | URL | URL | 都需要上传到 KIE CDN |
| ModelScope | Base64（带前缀） | - | 不支持视频 |

**重构考虑**：
- 在模型定义中声明上传策略
- 统一处理格式转换

---

### 11.9 遗漏的功能模块

#### 11.9.1 图片编辑器

**位置**：`src/components/ImageEditor/`

**功能**：
- 裁剪、缩放
- 历史记录（撤销/重做）
- 用于图片上传前的预处理

**重构考虑**：
- 需要在新架构中集成
- 在模型定义中声明是否需要编辑器

#### 11.9.2 测试模式

**位置**：`TestModeIndicator.tsx`、`TestModePanel.tsx`

**功能**：
- 显示生成请求的实际参数
- 调试参数传递问题

**重构考虑**：
- 非常有用的调试工具
- 新架构需要保留并增强

#### 11.9.3 自定义模型管理

**位置**：`ModelscopeCustomModelManager.tsx`

**功能**：
- 允许用户添加魔搭平台的自定义模型

**重构考虑**：
- 自定义模型如何与新的 ModelRegistry 集成
- 运行时动态注册模型

#### 11.9.4 波形显示（音频）

**位置**：`Waveform.tsx`、`AudioPlayer.tsx`

**功能**：
- 音频生成结果的可视化

**重构考虑**：
- 作为音频模型的专用结果展示组件

---

### 11.10 代码质量问题

#### 11.10.1 PanelTrigger 代码重复

**问题**：位置计算逻辑重复了 4 次（行 62-195）

**建议**：提取为 `calculatePanelPosition()` 函数

#### 11.10.2 类型安全问题

```typescript
// 当前问题
const dropdownParam = param as any  // 使用 any
const ratio = config.extractRatio!(opt.value)  // ! 断言

// 建议改进
const dropdownParam = param as DropdownParamDef  // 明确类型
const ratio = config.extractRatio?.(opt.value) ?? null  // 安全访问
```

#### 11.10.3 错误处理不一致

**问题**：
- 某些地方使用 `try-catch`
- 某些地方直接抛出错误
- 某些地方静默失败

**建议**：
- 统一使用 `Result<T, E>` 模式
- 或统一使用错误日志工具

---

### 11.11 预设系统与新架构的集成

**当前预设系统**：

```typescript
// 集中式映射（presetStateMapping.ts）
export interface PresetSetters {
  setInput: (v: string) => void
  setVideoDuration: (v: number) => void
  // ... 数十个 setter
}

export function createPresetSetterMap(setters: PresetSetters) {
  return {
    input: setters.setInput,
    videoDuration: setters.setVideoDuration,
    // ...
  }
}
```

**新架构集成方案**：

```typescript
// 预设直接存储参数对象
interface Preset {
  id: string
  name: string
  modelId: string
  params: Record<string, any>  // 直接是参数对象
}

// 加载预设时直接设置
function loadPreset(preset: Preset) {
  const { setParams } = useModelParams(preset.modelId)
  setParams(preset.params)  // 一次性设置所有参数
}
```

**优势**：
- 无需维护 setter 映射
- 预设格式与模型无关
- 支持任意参数组合

---

### 11.12 Transform 转换系统

**当前实现**（Schema 中）：

```typescript
{
  id: 'fastMode',
  type: 'toggle',
  // UI 使用 boolean，API 使用 string
  toValue: (checked: boolean) => checked ? 'fast' : 'standard',
  fromValue: (value: string) => value === 'fast'
}
```

**重构考虑**：

```typescript
// 在模型定义中统一处理
{
  id: 'fastMode',
  type: 'switch',
  default: false,

  // 转换为 API 格式
  transform: (value: boolean) => value ? 'fast' : 'standard',

  // 或使用映射表
  apiMapping: {
    true: 'fast',
    false: 'standard'
  }
}
```

---

## 十二、更新后的实施计划

### Phase 0：验证与准备（1 周）

- [ ] **验证历史数据安全**
  - 检查所有 Adapter 返回 `filePath`
  - 确认不保存 `url` 字段
  - 运行现有数据检查脚本

- [ ] **排查硬编码逻辑**
  - 搜索所有 `selectedModel ===`
  - 搜索所有 `currentModel?.type ===`
  - 建立排除模型的配置机制

- [ ] **梳理参数命名**
  - 识别需要前缀化的参数
  - 制定迁移计划
  - 评估影响范围

### Phase 1：核心重构（2-3 周）

（保持原计划，增加以下内容）

- [ ] 设计统一的 Transform 系统
- [ ] 设计模型标签系统（替代硬编码判断）
- [ ] 实现 AutoSwitch 高级特性支持
- [ ] 集成测试模式功能

### Phase 2：组件重构（2 周）

（保持原计划，增加以下内容）

- [ ] 重构 PanelTrigger 代码重复
- [ ] 集成图片编辑器
- [ ] 统一上传服务接口

### Phase 3-5：保持原计划

---

## 十三、风险评估更新

### 13.1 新增风险

| 风险 | 严重性 | 可能性 | 缓解措施 |
|------|--------|--------|----------|
| 历史数据损坏 | 高 | 中 | 提前备份，增量迁移 |
| 参数命名迁移影响 | 中 | 高 | 保持旧参数兼容，渐进迁移 |
| 预设系统不兼容 | 中 | 中 | 设计格式转换器 |
| 硬编码遗漏 | 中 | 高 | 建立检查清单，自动化测试 |

### 13.2 验证检查清单

每个阶段完成后，需要验证：

- [ ] 所有现有模型仍能正常工作
- [ ] 预设保存和加载正常
- [ ] 历史记录显示正常
- [ ] 价格计算正确
- [ ] 上传功能正常
- [ ] AutoSwitch 行为正确
- [ ] 测试模式显示正确参数

---

## 十四、待讨论问题（已确定）

> 所有关键问题已讨论并确定方案

### 已确定方案汇总

1. ~~分辨率面板的具体 UI 设计？~~ ✅ 已设计

2. **参数联动的优先级**：✅ 已确定
   - 采用**方案 B（按类型自动排序）+ 可选 priority 覆盖**
   - 默认执行顺序：reset → setValue → autoSwitch → filterOptions → filterRange → disable → hide → custom
   - 特殊需求可设置 `priority` 字段微调

3. **预设系统集成**：✅ 已确定
   - **保存时机**：手动保存
   - **预设范围**：混合（用户可选择是否指定模型）
     - 指定模型：只适用于该模型
     - 不指定模型：全局预设，只保存通用参数（如 prompt）
   - **版本兼容**：忽略无效参数（无需迁移工具）
   - **存储方式**：SQLite（与历史记录统一）

4. **节点系统支持范围**：✅ 已确定
   - **Phase 1（优先）**：只支持模型节点
   - **Phase 2（按需）**：添加常用工具节点（裁剪、缩放、提示词模板等）
   - **Phase 3（预留）**：自定义节点扩展接口
   - **当前目标**：确保模型配置支持节点化调用，无需后续重新适配

5. **参数命名迁移策略**：✅ 已确定
   - 采用**策略 C（动态参数）+ 渐进式迁移**
   - 实施计划：
     1. 实现新的 `useModelParams` Hook
     2. 试点模型使用新架构验证
     3. 后续新模型全部使用新架构
     4. 旧模型按需迁移（3-6个月内完成）
     5. 最终完全清理旧架构

6. **OptionsBuilder 系统**：✅ 已确定
   - 采用**方案 C（统一入口，双引擎）**
   - 建立 `RequestBuilder` 统一入口
   - 优先使用新配置，降级到旧系统
   - 渐进式迁移，最终删除旧系统

7. **自定义模型集成**：✅ 已确定
   - 采用**混合方案（分阶段实施）**
   - **Phase 1（MVP）**：
     - 简化版（固定模板）
     - 存储到 localStorage
     - 只支持 ModelScope
   - **Phase 2（中期）**：
     - 可视化参数配置 UI
     - 迁移到 SQLite
     - 支持更多供应商
   - **Phase 3（远期）**：
     - 支持 YAML/JSON 导入
     - 完整的配置能力

8. **测试模式增强**：✅ 已确定
   - 采用**方案 B（基础增强）**
   - **优先实现**：
     1. 参数流转追踪（UI 参数 → 联动 → 转换 → API 请求）
     2. 导出配置功能（JSON 格式）
   - **按需添加**：
     - Schema 验证器
     - 实时预览
     - 新旧架构对比

---

## 十五、最终实施路线图

基于以上所有讨论和决策，最终的实施路线图如下：

### Phase 0：验证与准备（1 周）

- [ ] **验证历史数据安全**
  - 检查所有 Adapter 返回 `filePath`
  - 确认不保存 `url` 字段

- [ ] **排查硬编码逻辑**
  - 搜索所有 `selectedModel ===`
  - 搜索所有 `currentModel?.type ===`
  - 建立模型标签系统

- [ ] **梳理参数命名**
  - 识别需要迁移的参数
  - 制定迁移计划

### Phase 1：核心架构（2-3 周）

- [ ] **ModelRegistry 系统**
  - 实现模型注册中心
  - 支持自动发现 `*.model.ts` 文件

- [ ] **动态参数系统**
  - 实现 `useModelParams` Hook
  - 支持参数联动（按类型自动排序）

- [ ] **统一请求构建**
  - 实现 `RequestBuilder` 统一入口
  - 支持新旧系统双引擎

- [ ] **试点模型迁移**
  - 选择 2-3 个模型试点
  - 验证新架构可行性

### Phase 2：组件与 UI（2 周）

- [ ] **基础参数组件**
  - 实现所有基础组件类型
  - 支持 i18n

- [ ] **特殊面板系统**
  - 实现 `PanelRegistry`
  - 重构 `ResolutionPanel` 为可组合面板

- [ ] **参数渲染器**
  - 实现 `ParamRenderer` 自动渲染
  - 支持条件显示和联动

### Phase 3：数据与存储（1 周）

- [ ] **SQLite 集成**
  - 设计数据库表结构
  - 实现历史记录迁移

- [ ] **预设系统重构**
  - 支持模型级和全局预设
  - 实现忽略无效参数逻辑

- [ ] **自定义模型（MVP）**
  - 实现简化版配置
  - 支持 ModelScope 自定义模型

### Phase 4：i18n 与调试（1 周）

- [ ] **国际化支持**
  - 集成 i18next
  - 抽取所有文本到 locales

- [ ] **测试模式增强**
  - 实现参数流转追踪
  - 实现导出配置功能

### Phase 5：节点系统准备（1 周）

- [ ] **模型节点接口**
  - 设计 `ModelNode` 接口
  - 实现从 `ModelDefinition` 自动生成节点

- [ ] **预留扩展点**
  - 设计工具节点接口
  - 预留自定义节点扩展

### Phase 6：全面迁移（3-6 个月）

- [ ] **逐步迁移旧模型**
  - 优先迁移常用模型
  - 按需迁移其他模型

- [ ] **清理旧架构**
  - 删除 `useMediaGeneratorState`
  - 删除旧的 `optionsBuilder`

- [ ] **文档完善**
  - 更新开发文档
  - 编写迁移指南

---

## 十六、成功标准

重构成功的标志：

### 核心指标

1. **适配效率**：
   - ✅ 新模型适配只需创建 1 个 `.model.ts` 文件
   - ✅ 平均适配时间从 2-3 小时降至 30 分钟

2. **代码质量**：
   - ✅ 消除 640 行的 `useMediaGeneratorState`
   - ✅ 消除 588 行的手动映射代码
   - ✅ 消除硬编码的模型判断逻辑

3. **功能完整性**：
   - ✅ 所有现有功能正常工作
   - ✅ 预设系统兼容新旧模型
   - ✅ 测试模式可追踪参数流转

4. **可维护性**：
   - ✅ 新人可在 1 天内理解架构
   - ✅ 修改参数无需同步 7-10 个位置
   - ✅ 配置驱动，减少代码重复

5. **扩展性**：
   - ✅ 支持节点化调用
   - ✅ 支持自定义模型
   - ✅ 预留画布模式接口

---

> 最后更新：2025-01-21（所有决策已确定）
