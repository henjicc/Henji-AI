# 智能宽高比系统设计方案

## 1. 概述

设计一个通用的智能宽高比匹配系统，能够：
- 自动识别参数类型（宽高比 vs 分辨率）
- 根据上传图片自动匹配最接近的预设值
- 提供统一的可视化选择界面
- 完全遵循 Schema-Driven 架构

## 2. 参数分类

### 2.1 宽高比类参数（Aspect Ratio）
**特征**：表示图片/视频的宽高比例关系
**格式**：`16:9`, `9:16`, `1:1`, `21:9` 等
**示例**：
- `aspect_ratio` (Nano Banana)
- `videoAspectRatio` (Kling, PixVerse, Vidu)
- `veoAspectRatio` (Veo 3.1)
- `seedanceAspectRatio` (Seedance)
- `viduAspectRatio` (Vidu Q1)

### 2.2 尺寸类参数（Size）
**特征**：表示具体的像素尺寸
**格式**：`1920*1080`, `832*480` 等
**示例**：
- `wanSize` (Wan 2.5)
- 即梦 4.0 的自定义尺寸

### 2.3 分辨率类参数（Resolution）
**特征**：表示视频/图片的清晰度等级
**格式**：`720p`, `1080p`, `768P`, `1K`, `2K`, `4K` 等
**示例**：
- `videoResolution` (Hailuo, PixVerse)
- `veoResolution` (Veo 3.1)
- `seedanceResolution` (Seedance)
- `wanResolution` (Wan 2.5 图生图)
- `resolution` (Nano Banana Pro)

**注意**：分辨率参数不参与智能匹配，因为它表示的是清晰度而非比例。

## 3. Schema 扩展设计

### 3.1 新增 `aspectRatioConfig` 字段

```typescript
export interface AspectRatioConfig {
  type: 'aspect_ratio' | 'size'  // 参数类型
  smartMatch: boolean             // 是否启用智能匹配
  visualize: boolean              // 是否使用可视化选择器
  extractRatio?: (value: any) => number  // 从参数值提取宽高比的函数
}

export interface BaseParam {
  id: string
  label?: string
  type: ParamType
  defaultValue?: any
  autoSwitch?: { ... }
  aspectRatioConfig?: AspectRatioConfig  // 新增
  // ...
}
```

### 3.2 配置示例

#### 示例 1: Nano Banana 的 aspect_ratio
```typescript
{
  id: 'aspect_ratio',
  type: 'dropdown',
  label: '宽高比',
  defaultValue: '1:1',
  aspectRatioConfig: {
    type: 'aspect_ratio',
    smartMatch: true,
    visualize: true,
    extractRatio: (value) => {
      if (value === 'auto') return null
      const [w, h] = value.split(':').map(Number)
      return w / h
    }
  },
  options: (values) => {
    const baseOptions = [
      { value: '1:1', label: '1:1' },
      { value: '16:9', label: '16:9' },
      // ...
    ]
    if (values.uploadedImages?.length > 0) {
      return [{ value: 'auto', label: '智能' }, ...baseOptions]
    }
    return baseOptions
  }
}
```

#### 示例 2: Wan 2.5 的 wanSize
```typescript
{
  id: 'wanSize',
  type: 'dropdown',
  label: '尺寸',
  aspectRatioConfig: {
    type: 'size',
    smartMatch: true,
    visualize: true,
    extractRatio: (value) => {
      const [w, h] = value.split('*').map(Number)
      return w / h
    }
  },
  options: [
    { value: '832*480', label: '832*480' },
    { value: '1920*1080', label: '1920*1080' },
    // ...
  ],
  hidden: (values) => values.uploadedImages.length > 0
}
```

#### 示例 3: PixVerse 的 videoResolution（不启用智能匹配）
```typescript
{
  id: 'videoResolution',
  type: 'dropdown',
  label: '分辨率',
  defaultValue: '540p',
  // 不添加 aspectRatioConfig，因为这是分辨率而非宽高比
  options: [
    { value: '360p', label: '360p' },
    { value: '540p', label: '540p' },
    { value: '720p', label: '720p' },
    { value: '1080p', label: '1080p' }
  ]
}
```

## 4. 智能匹配算法

### 4.1 核心算法

```typescript
/**
 * 根据图片宽高比，匹配最接近的预设值
 * @param imageRatio 图片的宽高比
 * @param options 可选的预设值列表
 * @param extractRatio 从预设值提取宽高比的函数
 * @returns 最接近的预设值
 */
function matchClosestAspectRatio(
  imageRatio: number,
  options: Array<{ value: any, label: string }>,
  extractRatio: (value: any) => number | null
): any {
  let closestValue = options[0].value
  let minDiff = Infinity

  for (const option of options) {
    const optionRatio = extractRatio(option.value)
    if (optionRatio === null) continue  // 跳过 'auto' 等特殊值

    const diff = Math.abs(imageRatio - optionRatio)
    if (diff < minDiff) {
      minDiff = diff
      closestValue = option.value
    }
  }

  return closestValue
}
```

### 4.2 使用示例

```typescript
// 假设上传的图片是 1920x1080
const imageRatio = 1920 / 1080  // 1.777...

// Nano Banana 的选项
const options = [
  { value: '1:1', label: '1:1' },      // ratio = 1.0
  { value: '16:9', label: '16:9' },    // ratio = 1.777...
  { value: '9:16', label: '9:16' },    // ratio = 0.5625
  { value: '21:9', label: '21:9' }     // ratio = 2.333...
]

const matched = matchClosestAspectRatio(
  imageRatio,
  options,
  (value) => {
    const [w, h] = value.split(':').map(Number)
    return w / h
  }
)
// 结果: '16:9'
```

## 5. 通用可视化组件设计

### 5.1 组件结构

```
AspectRatioSelector
├── 智能模式按钮（如果启用）
├── 比例网格
│   ├── 比例卡片（带可视化图标）
│   └── ...
└── 自定义输入（如果支持）
```

### 5.2 组件接口

```typescript
interface AspectRatioSelectorProps {
  value: any
  options: Array<{ value: any, label: string }>
  config: AspectRatioConfig
  uploadedImages: string[]
  onChange: (value: any) => void
}
```

### 5.3 可视化图标

根据宽高比自动生成矩形图标：
- `21:9` → 宽扁矩形
- `16:9` → 标准宽屏矩形
- `1:1` → 正方形
- `9:16` → 竖屏矩形
- `9:21` → 窄长矩形

## 6. 实现步骤

### 步骤 1: 扩展 Schema 类型定义
- 在 `src/types/schema.ts` 中添加 `AspectRatioConfig` 接口
- 在 `BaseParam` 中添加 `aspectRatioConfig` 字段

### 步骤 2: 实现智能匹配算法
- 在 `src/utils/aspectRatio.ts` 中实现匹配算法
- 添加从图片 URL 获取宽高比的工具函数

### 步骤 3: 创建通用组件
- 创建 `src/components/ui/AspectRatioSelector.tsx`
- 支持可视化显示和智能匹配

### 步骤 4: 集成到 SchemaForm
- 修改 `SchemaForm` 组件，识别 `aspectRatioConfig`
- 当检测到该配置时，使用 `AspectRatioSelector` 而非普通 dropdown

### 步骤 5: 更新所有模型 Schema
- 为所有宽高比类参数添加 `aspectRatioConfig`
- 为尺寸类参数添加 `aspectRatioConfig`
- 分辨率类参数不添加配置

### 步骤 6: 实现自动切换逻辑
- 在 `MediaGenerator/index.tsx` 中监听图片上传
- 调用智能匹配算法
- 自动切换到匹配的值

## 7. 优势

1. **完全 Schema-Driven**：所有配置都在 Schema 中声明
2. **零硬编码**：不针对特定模型编写逻辑
3. **高度可扩展**：新增模型只需配置 Schema
4. **用户体验优秀**：可视化选择 + 智能匹配
5. **向后兼容**：不影响现有功能

## 8. 注意事项

### 8.1 区分宽高比和分辨率
- **宽高比**：表示比例关系，可以智能匹配
- **分辨率**：表示清晰度等级，不应智能匹配

### 8.2 特殊情况处理
- 某些模型的 API 本身支持 `auto` 参数（如 Nano Banana）
- 某些模型需要具体尺寸而非比例（如 Wan 2.5）
- 通过 `extractRatio` 函数统一处理

### 8.3 性能考虑
- 图片宽高比获取应该缓存
- 避免重复计算

## 9. 未来扩展

1. **智能裁剪建议**：当图片比例与选择的比例不匹配时，提示用户
2. **批量处理**：多张图片时，选择最常见的比例
3. **自定义比例**：允许用户输入自定义比例
4. **预览功能**：显示不同比例下的预览效果
