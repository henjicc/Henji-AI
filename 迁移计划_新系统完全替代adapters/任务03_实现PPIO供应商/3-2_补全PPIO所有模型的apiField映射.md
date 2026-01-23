# 3-2 补全PPIO所有模型的apiField映射

## 目标
为所有PPIO模型添加完整的 apiField 映射，确保参数正确传递到 API。

## 检查和修复流程

### 1. 模型清单

PPIO 模型列表：
- `kling-2.6-pro` ✅ 已修复（参考）
- `kling-o1`
- `kling-2.5-turbo`
- `vidu-q1`
- `wan-2.5-preview`
- `wan-2.6`
- `seedance-v1`
- `seedance-v1-lite`
- `seedance-v1-pro`
- `seedance-v1.5-pro`
- `seedream-4.0`
- `seedream-4.5`
- `minimax-hailuo-2.3`
- `minimax-hailuo-02`
- `pixverse-v4.5`
- `minimax-speech-2.6`

### 2. 检查方法

对每个模型执行：

```typescript
// 1. 打开模型文件
// src/models/ppio/xxx.model.ts

// 2. 检查每个 param
params: [
  {
    id: 'paramName',
    // 必须有以下之一：
    apiField: 'api_name',  // ✅ 简单映射
    // 或
    apiTransform: (value, allParams) => ({ api_key: value }),  // ✅ 转换映射
    // 或
    apiMapping: { endpointKey: { transform: ... } }  // ✅ 端点映射
  }
]
```

### 3. 参考旧配置

对照旧系统的 paramMapping 确定正确的映射：

```typescript
// old-Henji-AI/src/components/MediaGenerator/builders/configs/ppio-models.ts

// 例如 Kling O1
paramMapping: {
  mode: {
    source: 'ppioKlingO1Mode',
    defaultValue: 'text-image-to-video'
  },
  duration: {
    source: ['ppioKlingO1VideoDuration', 'videoDuration'],
    defaultValue: 5
  },
  aspectRatio: {
    source: 'ppioKlingO1AspectRatio',
    defaultValue: '16:9'
  }
}
```

转换为新系统：

```typescript
// src/models/ppio/kling-o1.model.ts
params: [
  {
    id: 'ppioKlingO1Mode',
    apiField: 'mode'  // ← 添加映射
  },
  {
    id: 'ppioKlingO1VideoDuration',
    apiField: 'duration'  // ← 添加映射
  },
  {
    id: 'ppioKlingO1AspectRatio',
    apiField: 'aspectRatio'  // ← 添加映射
  }
]
```

## 具体修复清单

### Kling O1
文件：`src/models/ppio/kling-o1.model.ts`

需要添加的映射：
- [ ] ppioKlingO1Mode → mode
- [ ] ppioKlingO1VideoDuration → duration
- [ ] ppioKlingO1AspectRatio → aspectRatio
- [ ] ppioKlingO1KeepAudio → keepAudio
- [ ] ppioKlingO1FastMode → fastMode

### Kling 2.5 Turbo
文件：`src/models/ppio/kling-2.5-turbo.model.ts`

需要添加的映射：
- [ ] ppioKling25VideoDuration → duration
- [ ] ppioKling25CfgScale → cfgScale
- [ ] ppioKling25AspectRatio → aspectRatio
- [ ] videoNegativePrompt → modelscopeNegativePrompt

### Vidu Q1
文件：`src/models/ppio/vidu-q1.model.ts`

需要添加的映射：
- [ ] ppioViduQ1Mode → mode
- [ ] ppioViduQ1AspectRatio → aspectRatio
- [ ] ppioViduQ1Style → style
- [ ] ppioViduQ1MovementAmplitude → movementAmplitude
- [ ] ppioViduQ1Bgm → bgm

### Seedream 4.0 & 4.5
文件：`src/models/ppio/seedream-4.0.model.ts`, `seedream-4.5.model.ts`

特殊处理（需要 apiTransform）：
- [ ] resolutionQuality → 计算 size 参数
- [ ] customWidth → 计算 size 参数
- [ ] customHeight → 计算 size 参数
- [ ] maxImages → sequential_image_generation + max_images
- [ ] seed → seed
- [ ] guidanceScale → guidanceScale

参考旧系统：
```typescript
// old-Henji-AI/src/components/MediaGenerator/builders/configs/ppio-models.ts
// 第534-601行 (Seedream 4.0 customHandlers)
```

### Minimax Speech 2.6
文件：`src/models/ppio/minimax-speech-2.6.model.ts`

需要添加的映射：
- [ ] minimaxVoiceId → voice_id
- [ ] minimaxAudioSpeed → speed
- [ ] minimaxAudioEmotion → emotion
- [ ] minimaxAudioVol → vol
- [ ] minimaxAudioPitch → pitch
- [ ] ...（所有音频参数）

## 批量修复脚本（可选）

如果模型较多，可以创建脚本辅助检查：

```typescript
// scripts/check-ppio-apifield.ts
import { ModelRegistry } from '@/core/ModelRegistry'

const ppioModels = ModelRegistry.getModelsByProvider('ppio')

ppioModels.forEach(model => {
  console.log(`\n检查模型: ${model.meta.id}`)

  model.params.forEach(param => {
    const hasMapping = param.apiField || param.apiTransform || param.apiMapping

    if (!hasMapping) {
      console.log(`  ❌ ${param.id} - 缺少映射`)
    } else {
      console.log(`  ✅ ${param.id}`)
    }
  })
})
```

## 验证方法

### 1. 编译验证
```bash
npm run build
```

### 2. 运行时验证
在浏览器控制台查看 RequestBuilder 的日志：

```
🚀 API Request: kling-o1
📦 Request Body: {
  "prompt": "...",
  "mode": "text-image-to-video",  // ✅ 有值
  "duration": 5,                   // ✅ 有值
  "aspectRatio": "16:9"            // ✅ 有值
}
```

如果某个参数缺失，说明映射有问题。

### 3. 对比测试
使用相同参数在旧系统和新系统中生成，对比 API 请求体：

旧系统日志：
```
🚀 PPIO API Request: kling-o1
📦 Request Data: { ... }
```

新系统日志：
```
🚀 API Request: kling-o1
📦 Request Body: { ... }
```

两者应该完全一致。

## 实现步骤

1. 打开旧系统配置文件作为参考
2. 逐个打开 PPIO 模型定义文件
3. 检查每个参数是否有映射
4. 添加缺失的 apiField
5. 对于复杂映射（如 Seedream），使用 apiTransform
6. 提交每个模型的修改
7. 全部完成后统一验证

## 验证标准
- [ ] 所有 PPIO 模型都已检查
- [ ] 所有参数都有映射（除了 UI 专用参数）
- [ ] TypeScript 编译无错误
- [ ] 至少测试 3 个代表性模型

## 预计工时
3-4小时

## 注意事项

1. **UI 专用参数无需映射**
   - 如模型筛选、收藏等
   - 这些参数不发送到 API

2. **复杂映射使用 apiTransform**
   - 如 Seedream 的 size 计算
   - 如多个参数合并为一个

3. **参考旧系统**
   - 旧配置在 `old-Henji-AI/src/components/MediaGenerator/builders/configs/ppio-models.ts`
   - paramMapping 是关键参考

4. **优先级**
   - 先修复常用模型（Kling 系列、Seedream）
   - 再修复次要模型

## 完成标志
所有 PPIO 模型的参数都能正确映射到 API 请求，没有缺失参数。

创建检查清单文件：`任务03_实现PPIO供应商/PPIO模型映射检查清单.md`

格式：
```markdown
## Kling 2.6 Pro ✅
- [x] ppioKling26Mode → mode
- [x] ppioKling26VideoDuration → duration
...

## Kling O1
- [ ] ppioKlingO1Mode → mode
- [ ] ppioKlingO1VideoDuration → duration
...
```
