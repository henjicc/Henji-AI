# 参数系统重构总结

## 概述

本次重构的核心目标是将通用参数系统迁移到模型特定参数系统，解决参数命名冲突、价格计算错误、参数缺失等问题。

## 重构背景

### 原有问题

1. **参数命名冲突**：多个模型共用通用参数名（如 `videoDuration`、`videoResolution`），导致：
   - 不同模型的参数相互覆盖
   - 价格计算使用错误的参数值
   - 预设功能无法正确保存/恢复模型特定参数

2. **参数缺失**：部分模型缺少必要的参数定义，如：
   - Vidu Q1 缺少时长参数
   - 参数未在所有必要的层级中定义（状态管理、UI、预设系统、选项构建器）

3. **价格计算错误**：价格计算器使用通用参数名，但实际传入的是模型特定参数，导致价格始终为 0

4. **参数约束缺失**：部分模型的参数约束规则未实现，如：
   - Hailuo 2.3 的分辨率-时长联动规则
   - PixVerse V4.5 的快速模式-分辨率限制

## 重构方案

### 1. 参数命名规范

建立统一的参数命名规范：

```
{providerId}{ModelName}{ParameterName}
```

**示例**：
- 派欧云 Vidu Q1 时长：`ppioViduQ1VideoDuration`
- 派欧云 Hailuo 2.3 分辨率：`ppioHailuo23VideoResolution`
- Fal Veo 3.1 模式：`falVeo31Mode`

**命名规则**：
- `ppio` = 派欧云 (PPIO)
- `fal` = Fal.ai
- 模型名使用驼峰命名法
- 参数名保持语义清晰

### 2. 参数定义层级

每个参数需要在以下层级完整定义：

#### 2.1 模型定义层 (`src/models/*.ts`)

```typescript
export const viduParams: ParamDef[] = [
    {
        id: 'ppioViduQ1VideoDuration',
        type: 'dropdown',
        label: '时长',
        defaultValue: 4,
        options: [
            { value: 4, label: '4秒' },
            { value: 8, label: '8秒' }
        ]
    }
]
```

#### 2.2 状态管理层 (`src/components/MediaGenerator/hooks/useMediaGeneratorState.ts`)

```typescript
// 定义状态
const [ppioViduQ1VideoDuration, setPpioViduQ1VideoDuration] = useState(4)

// 导出状态
return {
    ppioViduQ1VideoDuration,
    setPpioViduQ1VideoDuration,
    // ...
}
```

#### 2.3 UI 渲染层 (`src/components/MediaGenerator/components/ParameterPanel.tsx`)

```typescript
<SchemaForm
    schema={viduParams}
    values={{
        ppioViduQ1VideoDuration: values.ppioViduQ1VideoDuration,
        // ...
    }}
    onChange={onChange}
/>
```

#### 2.4 主组件层 (`src/components/MediaGenerator/index.tsx`)

```typescript
// 在 setterMap 中添加
const setterMap = useMemo(() => createPresetSetterMap({
    setPpioViduQ1VideoDuration: state.setPpioViduQ1VideoDuration,
    // ...
}), [])

// 在 handleSchemaChange 中添加
const setterMap: Record<string, (v: any) => void> = {
    ppioViduQ1VideoDuration: state.setPpioViduQ1VideoDuration,
    // ...
}

// 在 handleGenerate 中传递参数
const options = await buildGenerateOptions({
    ppioViduQ1VideoDuration: state.ppioViduQ1VideoDuration,
    // ...
})
```

#### 2.5 预设映射层 (`src/config/presetStateMapping.ts`)

```typescript
export function createPresetSetterMap(setters: PresetSetters): PresetSetterMap {
    return {
        ppioViduQ1VideoDuration: setters.setPpioViduQ1VideoDuration,
        // ...
    }
}
```

#### 2.6 选项构建层 (`src/components/MediaGenerator/builders/optionsBuilder.ts`)

```typescript
export async function buildGenerateOptions(params: BuildOptionsParams): Promise<any> {
    // 处理模型特定参数
    if (params.selectedModel === 'vidu-q1') {
        return {
            duration: params.ppioViduQ1VideoDuration,
            // ...
        }
    }
}
```

#### 2.7 价格计算层 (`src/config/pricing.ts`)

```typescript
{
    providerId: 'ppio',
    modelId: 'vidu-q1',
    currency: '¥',
    type: 'calculated',
    calculator: (params) => {
        const duration = params.ppioViduQ1VideoDuration || params.videoDuration || 4
        // 使用模型特定参数，带通用参数回退
        return calculatePrice(duration)
    }
}
```

### 3. 参数回退机制

为保证向后兼容，所有价格计算器和选项构建器都应使用参数回退机制：

```typescript
// ✅ 正确：模型特定参数优先，通用参数回退
const duration = params.ppioHailuo23VideoDuration || params.videoDuration || 6

// ❌ 错误：只使用通用参数
const duration = params.videoDuration || 6
```

**回退顺序**：
1. 模型特定参数（如 `ppioHailuo23VideoDuration`）
2. 通用参数（如 `videoDuration`）
3. 默认值（如 `6`）

## 具体修改案例

### 案例 1：Vidu Q1 添加时长参数

**问题**：Vidu Q1 模型缺少时长参数

**解决方案**：在所有 7 个层级添加 `ppioViduQ1VideoDuration` 参数

**修改文件**：
1. `src/models/vidu-q1.ts` - 添加参数定义
2. `src/components/MediaGenerator/hooks/useMediaGeneratorState.ts` - 添加状态
3. `src/components/MediaGenerator/components/ParameterPanel.tsx` - 传递参数值
4. `src/components/MediaGenerator/index.tsx` - 添加 setter 和参数传递
5. `src/config/presetStateMapping.ts` - 添加预设映射
6. `src/components/MediaGenerator/builders/optionsBuilder.ts` - 处理参数
7. `src/config/pricing.ts` - 更新价格计算（如需要）

**关键修复**：ParameterPanel.tsx 中必须传递参数值，否则下拉框无法选择：

```typescript
// ❌ 错误：缺少参数值传递
<SchemaForm
    schema={viduParams}
    values={{
        ppioViduQ1Mode: values.ppioViduQ1Mode,
        // 缺少 ppioViduQ1VideoDuration
    }}
/>

// ✅ 正确：完整传递所有参数值
<SchemaForm
    schema={viduParams}
    values={{
        ppioViduQ1VideoDuration: values.ppioViduQ1VideoDuration,
        ppioViduQ1Mode: values.ppioViduQ1Mode,
    }}
/>
```

### 案例 2：Hailuo 2.3 价格计算修复

**问题**：价格计算器使用通用参数名，但实际传入的是模型特定参数，导致价格始终为 0

**原代码**：
```typescript
calculator: (params) => {
    const duration = params.videoDuration || 6
    const resolution = params.videoResolution || '768P'
    // ...
}
```

**修复后**：
```typescript
calculator: (params) => {
    const duration = params.ppioHailuo23VideoDuration || params.videoDuration || 6
    const resolution = params.ppioHailuo23VideoResolution || params.videoResolution || '768P'
    // ...
}
```

**影响模型**：
- Hailuo 2.3
- Hailuo-02
- PixVerse V4.5
- Kling 2.5 Turbo
- Wan 2.5 Preview
- Seedance V1

### 案例 3：Hailuo 2.3 分辨率约束实现

**需求**：
- 6秒视频支持：768P、1080P
- 10秒视频仅支持：768P

**实现方案**：

#### 3.1 添加 disabled 支持到 UniversalResolutionSelector

```typescript
// src/components/ui/UniversalResolutionSelector.tsx
interface UniversalResolutionSelectorProps {
    options: Array<{ value: any; label: string; disabled?: boolean }>
    // ...
}

// 渲染时处理 disabled 状态
<button
    onClick={() => {
        if (option.disabled) return
        onChange(option.value)
    }}
    disabled={option.disabled}
    className={`${
        option.disabled
            ? 'opacity-50 cursor-not-allowed bg-zinc-700/30'
            : '...'
    }`}
>
```

#### 3.2 在模型定义中使用 disabled

```typescript
// src/models/minimax-hailuo-2.3.ts
{
    id: 'ppioHailuo23VideoResolution',
    type: 'dropdown',
    options: (values) => [
        { value: '768P', label: '768P' },
        {
            value: '1080P',
            label: '1080P',
            disabled: values.ppioHailuo23VideoDuration !== 6
        }
    ]
}
```

#### 3.3 添加自动切换规则

```typescript
{
    id: 'ppioHailuo23VideoResolution',
    autoSwitch: {
        condition: (values) => {
            return values.ppioHailuo23VideoDuration === 10 &&
                   values.ppioHailuo23VideoResolution === '1080P'
        },
        value: () => '768P'
    }
}
```

### 案例 4：PixVerse V4.5 参数合并

**需求**：将比例和分辨率合并为一个特殊面板，图生视频时不显示比例

**实现方案**：使用 `qualityKey` 模式

```typescript
// src/models/pixverse-v4.5.ts
{
    id: 'ppioPixverse45VideoAspectRatio',  // 主参数存储比例
    type: 'dropdown',
    label: '分辨率',
    defaultValue: '16:9',
    resolutionConfig: {
        type: 'aspect_ratio',
        smartMatch: true,
        visualize: true,
        extractRatio: (value) => {
            if (value === 'smart') return null
            const [w, h] = value.split(':').map(Number)
            return w / h
        },
        // 指定分辨率参数的 key
        qualityKey: 'ppioPixverse45VideoResolution',
        // 分辨率选项（作为质量选项显示）
        qualityOptions: (values: any) => [
            { value: '360p', label: '360P' },
            { value: '540p', label: '540P' },
            { value: '720p', label: '720P' },
            { value: '1080p', label: '1080P', disabled: values.ppioPixverse45FastMode }
        ]
    },
    // 图生视频时不显示比例选项
    options: (values) => {
        if (values.uploadedImages.length > 0) {
            return []  // 返回空数组隐藏比例选项
        }
        return [
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
            { value: '1:1', label: '1:1' }
        ]
    }
}
```

**关键点**：
- `qualityKey` 指定质量选项存储到哪个参数
- `qualityOptions` 定义质量选项（如分辨率）
- `options` 返回空数组可以隐藏主选项（如比例）
- 两个参数合并显示在一个面板中

### 案例 5：Wan 2.5 Preview 双分辨率参数处理

**问题**：Wan 2.5 Preview 有两种分辨率参数：
- `ppioWan25Size`：文生视频模式，格式为 "1280*720"
- `falWan25Resolution`：图生视频模式，格式为 "720P"

**解决方案**：价格计算器同时处理两种参数

```typescript
calculator: (params) => {
    const duration = params.ppioWan25VideoDuration || params.videoDuration || 5

    let resolution: '480p' | '720p' | '1080p' = '720p'

    if (params.falWan25Resolution) {
        // 图生视频：直接使用分辨率参数
        resolution = params.falWan25Resolution.toLowerCase()
    } else if (params.ppioWan25Size) {
        // 文生视频：根据尺寸计算分辨率等级
        const [w, h] = params.ppioWan25Size.split('*').map(Number)
        const pixels = w * h
        if (pixels <= 400000) {
            resolution = '480p'
        } else if (pixels <= 1000000) {
            resolution = '720p'
        } else {
            resolution = '1080p'
        }
    }

    return PRICES.WAN[resolution]?.[duration as 5 | 10] || 0
}
```

**像素阈值映射**：
- ≤ 400,000 像素 → 480p
- ≤ 1,000,000 像素 → 720p
- \> 1,000,000 像素 → 1080p

## 技术模式总结

### 1. UniversalResolutionSelector 组件

这是一个特殊的分辨率选择面板，支持：

**功能特性**：
- 显示多个选项组（比例选项 + 质量选项）
- 可视化图标显示（宽高比矩形）
- 智能匹配模式（根据上传图片自动匹配比例）
- 自定义尺寸输入
- 选项禁用支持

**配置项**：
```typescript
resolutionConfig: {
    type: 'aspect_ratio' | 'size' | 'resolution',
    smartMatch: boolean,
    visualize: boolean,
    extractRatio: (value) => number | null,
    qualityKey?: string,  // 质量选项存储的参数 key
    qualityOptions?: Array<{value: any, label: string, disabled?: boolean}>,
    customInput?: boolean,
    baseSize?: number,
    baseSizeEditable?: boolean
}
```

### 2. autoSwitch 自动切换机制

当满足特定条件时自动切换参数值：

```typescript
{
    id: 'paramId',
    autoSwitch: {
        condition: (values) => boolean,  // 触发条件
        value: any | ((values) => any)   // 切换到的值
    }
}
```

**应用场景**：
- 图片上传时自动切换到智能模式
- 时长变化时自动调整分辨率
- 模式切换时自动调整其他参数

### 3. 动态选项函数

选项可以是静态数组或动态函数：

```typescript
// 静态选项
options: [
    { value: '16:9', label: '16:9' },
    { value: '9:16', label: '9:16' }
]

// 动态选项（根据当前状态）
options: (values) => {
    if (values.uploadedImages.length > 0) {
        return []  // 隐藏选项
    }
    return [
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16', disabled: values.someCondition }
    ]
}
```

### 4. hidden 隐藏规则

参数可以根据条件动态隐藏：

```typescript
{
    id: 'paramId',
    hidden: (values) => {
        // 返回 true 时隐藏参数
        return values.uploadedImages.length === 0
    }
}
```

## 修改文件清单

### 核心文件

1. **模型定义** (`src/models/*.ts`)
   - `vidu-q1.ts` - 添加时长参数
   - `minimax-hailuo-2.3.ts` - 添加约束规则和 autoSwitch
   - `pixverse-v4.5.ts` - 合并比例和分辨率参数
   - `kling-2.5-turbo.ts` - 已有模型特定参数
   - `wan-2.5-preview.ts` - 已有模型特定参数
   - `seedance-v1.ts` - 已有模型特定参数

2. **状态管理**
   - `src/components/MediaGenerator/hooks/useMediaGeneratorState.ts` - 添加所有模型特定参数状态

3. **UI 组件**
   - `src/components/MediaGenerator/components/ParameterPanel.tsx` - 修复参数值传递
   - `src/components/ui/UniversalResolutionSelector.tsx` - 添加 disabled 支持

4. **主组件**
   - `src/components/MediaGenerator/index.tsx` - 添加 setter 映射和参数传递

5. **配置文件**
   - `src/config/presetStateMapping.ts` - 添加预设映射
   - `src/config/pricing.ts` - 修复所有价格计算器

6. **构建器**
   - `src/components/MediaGenerator/builders/optionsBuilder.ts` - 处理模型特定参数

## 价格计算器修复清单

所有派欧云模型的价格计算器都已修复为使用模型特定参数：

| 模型 | 修复前 | 修复后 |
|------|--------|--------|
| Vidu Q1 | 固定价格（无需修复） | - |
| Kling 2.5 Turbo | `videoDuration` | `ppioKling25VideoDuration \|\| videoDuration` |
| Hailuo 2.3 | `videoDuration`, `videoResolution` | `ppioHailuo23VideoDuration \|\| videoDuration`, `ppioHailuo23VideoResolution \|\| videoResolution` |
| Hailuo-02 | `videoDuration`, `videoResolution` | `ppioHailuo23VideoDuration \|\| videoDuration`, `ppioHailuo23VideoResolution \|\| videoResolution` |
| PixVerse V4.5 | `videoResolution` | `ppioPixverse45VideoResolution \|\| videoResolution` |
| Wan 2.5 Preview | `videoDuration`, `falWan25Resolution` | `ppioWan25VideoDuration \|\| videoDuration`, 处理 `ppioWan25Size` 和 `falWan25Resolution` |
| Seedance V1 | `videoDuration` | `ppioSeedanceV1VideoDuration \|\| videoDuration` |

## 测试要点

### 1. 参数功能测试

- [ ] 所有模型的参数下拉框可以正常选择
- [ ] 参数值变化时 UI 正确更新
- [ ] 参数约束规则正确生效（如 Hailuo 的分辨率限制）
- [ ] autoSwitch 规则正确触发

### 2. 价格计算测试

- [ ] 所有模型的价格估算显示正确
- [ ] 参数变化时价格实时更新
- [ ] 不同参数组合的价格计算正确

### 3. 预设功能测试

- [ ] 保存预设时包含所有模型特定参数
- [ ] 加载预设时正确恢复所有参数
- [ ] 跨模型预设不会相互干扰

### 4. 重新编辑测试

- [ ] 从历史记录重新编辑时正确恢复所有参数
- [ ] 包括图片、视频等附件的恢复

### 5. 生成功能测试

- [ ] 生成时使用正确的参数值
- [ ] API 请求包含所有必要的参数
- [ ] 参数格式符合 API 要求

## 最佳实践

### 1. 添加新模型参数

当需要为模型添加新参数时，按以下顺序操作：

1. 在模型定义文件中添加参数定义
2. 在 useMediaGeneratorState.ts 中添加状态
3. 在 ParameterPanel.tsx 中传递参数值
4. 在 MediaGenerator/index.tsx 中添加 setter 和参数传递
5. 在 presetStateMapping.ts 中添加预设映射
6. 在 optionsBuilder.ts 中处理参数
7. 在 pricing.ts 中更新价格计算（如需要）

### 2. 参数命名

- 使用 `{providerId}{ModelName}{ParameterName}` 格式
- 保持语义清晰，避免缩写
- 与 API 参数名保持一致（如果可能）

### 3. 价格计算器

- 始终使用参数回退机制
- 模型特定参数优先，通用参数回退
- 提供合理的默认值

### 4. UI 组件

- 确保所有参数值都传递给 SchemaForm
- 使用 UniversalResolutionSelector 处理复杂的分辨率选择
- 利用 disabled、hidden、autoSwitch 等机制实现参数约束

### 5. 向后兼容

- 保留通用参数作为回退
- 不要删除旧的参数处理逻辑
- 确保旧的历史记录可以正常加载

## 未来改进方向

1. **参数验证**：添加参数值验证机制，防止无效值
2. **参数依赖**：更完善的参数依赖关系管理
3. **参数文档**：为每个参数添加详细的文档和说明
4. **参数迁移**：提供旧参数到新参数的自动迁移工具
5. **类型安全**：使用 TypeScript 类型系统增强参数类型安全

## 总结

本次重构成功解决了参数系统的核心问题：

✅ **参数隔离**：每个模型使用独立的参数，避免冲突
✅ **价格准确**：所有价格计算器使用正确的参数
✅ **约束完整**：实现了所有必要的参数约束规则
✅ **向后兼容**：保留了通用参数作为回退机制
✅ **代码规范**：建立了清晰的参数定义和使用规范

重构后的系统更加健壮、可维护，为未来添加新模型和功能奠定了良好的基础。
