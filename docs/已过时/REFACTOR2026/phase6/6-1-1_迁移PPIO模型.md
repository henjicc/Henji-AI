# 6-1-1 迁移PPIO模型

## 目标

将所有 PPIO 供应商的模型从旧架构迁移到新的单文件配置系统（.model.ts），验证新架构的完整性。

## 背景

PPIO 是项目中最重要的供应商之一，包含多个主流模型：
- **Wan 2.6** - 视频生成（文生视频、图生视频、参考生视频）
- **Kling 2.6** - 视频生成
- **Hailuo 2.3** - 视频生成
- **其他模型** - 根据实际情况迁移

迁移这些模型将验证新架构的：
- 参数定义系统
- 联动规则
- 端点路由
- 价格计算
- 节点转换

## 前置依赖

- [x] 1-2-1：实现ModelRegistry核心
- [x] 1-3-1：实现useModelParams Hook
- [x] 1-4-1：实现RequestBuilder
- [x] 2-3-1：实现ParamRenderer
- [x] 5-1-2：实现模型到节点转换

## 实施步骤

### 1. 分析现有 PPIO 模型配置

- [ ] 查看 `src/models/ppio/` 目录下的所有模型文件
- [ ] 查看 `src/adapters/ppio/models/` 目录下的路由定义
- [ ] 查看 `src/config/pricing.ts` 中的价格配置
- [ ] 整理每个模型的完整参数列表

### 2. 创建 Wan 2.6 配置文件

- [ ] 创建 `src/models/ppio/wan-2.6.model.ts`
- [ ] 定义完整的模型配置

```typescript
import { defineModel } from '@/core/defineModel'

export default defineModel({
  // ========== 元数据 ==========
  meta: {
    id: 'wan-2.6',
    provider: 'ppio',
    type: 'video',
    name: { zh: 'Wan 2.6', en: 'Wan 2.6' },
    description: {
      zh: '万象视频模型 2.6，支持文生视频、图生视频、参考生视频',
      en: 'Wan Video Model 2.6, supports text/image/reference to video'
    },
    tags: ['video', 'text-to-video', 'image-to-video', 'reference-to-video'],
    icon: 'video-camera',
    aliases: ['ppio-wan-2.6', 'ppio/wan-2.6'],

    polling: {
      interval: 3000,
      maxAttempts: 40
    }
  },

  // ========== 参数定义 ==========
  params: [
    // 生成模式
    {
      order: 1,
      id: 'mode',
      component: 'dropdown',
      name: { zh: '生成模式', en: 'Generation Mode' },
      valueType: 'string',
      default: 'text-image-to-video',
      options: [
        {
          value: 'text-image-to-video',
          label: { zh: '文/图生视频', en: 'Text/Image to Video' }
        },
        {
          value: 'reference-to-video',
          label: { zh: '参考生视频', en: 'Reference to Video' }
        }
      ],
      apiField: 'mode'
    },

    // 分辨率（使用面板）
    {
      order: 2,
      id: 'resolution',
      component: 'panel',
      panelType: 'resolution',
      name: { zh: '分辨率', en: 'Resolution' },
      panelConfig: {
        mode: 'aspect-quality',
        aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
        qualityTiers: ['720P', '1080P'],
        defaultAspectRatio: '16:9',
        defaultQuality: '720P',
        smartMatch: true
      },
      default: {
        aspectRatio: '16:9',
        quality: '720P'
      },

      // 端点相关映射
      apiMapping: {
        'text-to-video': {
          transform: (value) => ({
            size: this.resolutionToSize(value.aspectRatio, value.quality)
          })
        },
        'image-to-video': {
          transform: (value) => ({
            resolution: value.quality
          })
        },
        'reference-to-video': {
          transform: (value) => ({
            size: this.resolutionToSize(value.aspectRatio, value.quality)
          })
        }
      }
    },

    // 时长
    {
      order: 3,
      id: 'duration',
      component: 'dropdown',
      name: { zh: '时长', en: 'Duration' },
      valueType: 'number',
      default: 5,
      options: [
        { value: 5, label: '5s' },
        { value: 10, label: '10s' },
        { value: 15, label: '15s' }
      ],
      apiField: 'duration'
    },

    // 镜头类型
    {
      order: 4,
      id: 'shotType',
      component: 'dropdown',
      name: { zh: '镜头类型', en: 'Shot Type' },
      valueType: 'string',
      default: 'multi',
      options: [
        { value: 'single', label: { zh: '单镜头', en: 'Single Shot' } },
        { value: 'multi', label: { zh: '多镜头', en: 'Multi Shot' } }
      ],
      apiField: 'shot_type'
    },

    // 音频开关
    {
      order: 5,
      id: 'audio',
      component: 'switch',
      name: { zh: '生成音频', en: 'Generate Audio' },
      valueType: 'boolean',
      default: true,
      apiField: 'audio'
    },

    // 提示词扩展
    {
      order: 6,
      id: 'promptExtend',
      component: 'switch',
      name: { zh: '提示词扩展', en: 'Prompt Extend' },
      tooltip: { zh: '自动扩展优化提示词', en: 'Automatically expand and optimize prompt' },
      valueType: 'boolean',
      default: false,
      apiField: 'prompt_extend'
    },

    // 图片上传
    {
      order: 10,
      id: 'images',
      component: 'image-upload',
      name: { zh: '参考图片', en: 'Reference Image' },
      maxCount: 1,
      format: 'base64',
      base64Prefix: false,

      visible: {
        condition: (params) => params.mode === 'text-image-to-video'
      },

      onUpload: {
        smartMatch: ['resolution']
      },

      apiField: 'img_url'
    },

    // 视频上传
    {
      order: 11,
      id: 'videos',
      component: 'video-upload',
      name: { zh: '参考视频', en: 'Reference Videos' },
      maxCount: 3,
      uploadService: 'general',

      visible: {
        condition: (params) => params.mode === 'reference-to-video'
      },

      apiTransform: (urls) => ({
        reference_video_urls: urls.map(url => ({ url }))
      })
    }
  ],

  // ========== 联动规则 ==========
  linkages: [
    // 切换模式时清空上传
    {
      trigger: 'mode',
      effect: 'reset',
      targets: ['images', 'videos']
    },

    // 参考模式限制时长
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

    // 1080P 限制时长
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

    // 图片上传自动匹配分辨率
    {
      trigger: 'images',
      effect: 'autoSwitch',
      target: 'resolution.aspectRatio',
      condition: (images) => images?.length > 0,
      value: 'smart',
      noRestore: false
    }
  ],

  // ========== 端点路由 ==========
  endpoints: {
    select: (params, context) => {
      if (params.mode === 'reference-to-video') {
        return 'reference-to-video'
      }
      if (context.uploadedImages?.length > 0) {
        return 'image-to-video'
      }
      return 'text-to-video'
    },

    routes: {
      'text-to-video': {
        path: '/async/wan2.6-t2v',
        method: 'POST'
      },
      'image-to-video': {
        path: '/async/wan2.6-i2v',
        method: 'POST'
      },
      'reference-to-video': {
        path: '/async/wan2.6-v2v',
        method: 'POST'
      }
    }
  },

  // ========== 请求构建 ==========
  request: {
    base: {
      watermark: false
    }
  },

  // ========== 价格计算 ==========
  pricing: {
    currency: '¥',
    rates: {
      '720P': 0.6,
      '1080P': 1.0
    },
    calculate: (params, rates) => {
      const quality = params.resolution?.quality || '720P'
      const duration = params.duration || 5
      return rates[quality] * duration
    }
  }
})

// 辅助函数
function resolutionToSize(aspectRatio: string, quality: string): string {
  const sizeMap = {
    '16:9': { '720P': '1280*720', '1080P': '1920*1080' },
    '9:16': { '720P': '720*1280', '1080P': '1080*1920' },
    '1:1': { '720P': '960*960', '1080P': '1440*1440' },
    '4:3': { '720P': '1088*832', '1080P': '1632*1248' },
    '3:4': { '720P': '832*1088', '1080P': '1248*1632' }
  }
  return sizeMap[aspectRatio]?.[quality] || '1280*720'
}
```

### 3. 创建其他 PPIO 模型配置

使用相同的模式，创建以下文件：

- [ ] `src/models/ppio/kling-2.6.model.ts`
- [ ] `src/models/ppio/hailuo-2.3.model.ts`
- [ ] 其他 PPIO 模型...

### 4. 创建 defineModel 辅助函数

- [ ] 创建 `src/core/defineModel.ts`
- [ ] 提供模型定义的验证和注册

```typescript
import { ModelRegistry } from './ModelRegistry'
import { validateModel } from './validators/modelValidator'

export function defineModel(definition: ModelDefinition): ModelDefinition {
  // 验证模型定义
  const validation = validateModel(definition)
  if (!validation.valid) {
    console.error(`Model validation failed for ${definition.meta.id}:`, validation.errors)
    throw new Error(`Invalid model definition: ${definition.meta.id}`)
  }

  // 自动注册到 ModelRegistry
  const registry = ModelRegistry.getInstance()
  registry.register(definition)

  return definition
}
```

### 5. 更新模型索引文件

- [ ] 创建 `src/models/ppio/index.ts`
- [ ] 自动导入所有模型

```typescript
// 自动导入所有 .model.ts 文件
const modelFiles = import.meta.glob('./*.model.ts', { eager: true })

export const ppioModels = Object.values(modelFiles).map(
  (module: any) => module.default
)
```

### 6. 测试模型配置

为每个迁移的模型创建测试：

- [ ] 测试模型注册
- [ ] 测试参数默认值
- [ ] 测试联动规则
- [ ] 测试端点选择
- [ ] 测试价格计算
- [ ] 测试节点转换

```typescript
import { registry, nodeConverter } from '@/core'

// 测试 Wan 2.6
const wan26 = registry.getModel('wan-2.6')
console.assert(wan26 !== undefined, 'Wan 2.6 未注册')

// 测试默认值
const schema = registry.getSchema('wan-2.6')
const defaults = schema.reduce((acc, param) => {
  acc[param.id] = param.default
  return acc
}, {})
console.log('Wan 2.6 defaults:', defaults)

// 测试价格计算
const price720p = registry.calculatePrice('wan-2.6', {
  resolution: { quality: '720P' },
  duration: 5
})
console.assert(price720p === 3.0, '价格计算错误')

const price1080p = registry.calculatePrice('wan-2.6', {
  resolution: { quality: '1080P' },
  duration: 10
})
console.assert(price1080p === 10.0, '价格计算错误')

// 测试节点转换
const node = nodeConverter.modelToNode(wan26)
console.log('Wan 2.6 node:', node)
console.log('Inputs:', node.inputs.map(i => i.id))
console.log('Outputs:', node.outputs.map(o => o.id))
```

### 7. 集成到现有 UI

- [ ] 在 MediaGenerator 中使用新模型配置
- [ ] 确保与旧模型共存（兼容期）
- [ ] 验证所有功能正常

### 8. 删除旧配置（可选）

在验证新配置完全正常后：

- [ ] 删除 `src/models/ppio/` 下的旧文件（非 .model.ts）
- [ ] 删除 `src/adapters/ppio/models/` 下的路由定义
- [ ] 从 `src/config/pricing.ts` 删除相关价格配置
- [ ] 从 `useMediaGeneratorState.ts` 删除相关状态

## 涉及文件

### 新建文件
- `src/models/ppio/wan-2.6.model.ts` - Wan 2.6 配置
- `src/models/ppio/kling-2.6.model.ts` - Kling 2.6 配置
- `src/models/ppio/hailuo-2.3.model.ts` - Hailuo 2.3 配置
- `src/models/ppio/index.ts` - PPIO 模型索引
- `src/core/defineModel.ts` - 模型定义辅助函数

### 修改文件
- `src/core/index.ts` - 导出 defineModel

### 待删除文件（验证后）
- `src/models/ppio/wan-2.6.ts` - 旧配置
- `src/adapters/ppio/models/wan-2.6.ts` - 旧路由
- 其他旧文件...

## 验收标准

- [ ] 所有 PPIO 模型成功迁移到 .model.ts 格式
- [ ] 新配置文件通过 ModelRegistry 验证
- [ ] 所有参数定义完整，包含 i18n
- [ ] 联动规则正确实现
- [ ] 端点路由正确
- [ ] 价格计算与旧系统一致
- [ ] 节点转换成功
- [ ] 在 UI 中测试通过，功能与旧版本一致
- [ ] 无 TypeScript 类型错误

## 测试清单

### 功能测试
- [ ] Wan 2.6 文生视频
- [ ] Wan 2.6 图生视频
- [ ] Wan 2.6 参考生视频
- [ ] Kling 2.6 所有模式
- [ ] Hailuo 2.3 所有模式

### 参数测试
- [ ] 切换模式时清空上传
- [ ] 参考模式限制时长选项
- [ ] 1080P 限制时长选项
- [ ] 图片上传自动匹配分辨率
- [ ] 价格计算正确

### 集成测试
- [ ] 与现有 UI 兼容
- [ ] 历史记录加载正常
- [ ] 预设保存和加载正常
- [ ] 测试模式显示正确参数

## 风险与注意事项

### 风险
- 迁移过程中可能遗漏某些参数或配置
- 旧系统和新系统并存可能导致冲突
- 用户数据（历史记录、预设）可能不兼容

### 注意事项
- 在删除旧配置前务必充分测试
- 保留旧配置的备份
- 逐个模型迁移，而非一次性全部迁移
- 迁移后运行完整的回归测试
- 注意参数命名的一致性（新旧系统）
- 确保价格计算逻辑完全一致

## 迁移检查清单

对于每个模型，确保：

- [ ] 元数据完整（id, provider, type, name, description, tags）
- [ ] 所有参数定义（检查旧 Schema 文件）
- [ ] 参数顺序正确（order 字段）
- [ ] 默认值正确（检查旧 useMediaGeneratorState）
- [ ] API 字段名正确（检查旧 optionsBuilder）
- [ ] 联动规则完整（检查旧 autoSwitch 逻辑）
- [ ] 端点路由正确（检查旧 adapter routes）
- [ ] 价格计算正确（检查旧 pricing.ts）
- [ ] 上传参数配置正确（format, base64Prefix 等）

## 后续任务

完成 PPIO 模型迁移后：
- 6-1-2：迁移 Fal 模型
- 6-1-3：迁移 KIE 和 ModelScope 模型

## 回滚方案

如果迁移出现重大问题：

1. 保留旧配置文件不删除
2. 从 ModelRegistry 注销新模型
3. 在 UI 中切换回旧系统
4. Git revert 相关提交
5. 分析问题，修复后重新迁移
