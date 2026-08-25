# Tooltip 修复报告

## 问题描述

在新架构中，`tooltip` 字段定义了但没有被使用，导致：
1. 模型定义中的 `tooltip` 内容无法显示
2. 提示信息被错误地显示在组件下方，而不是鼠标悬停时显示

## 根本原因

### 设计意图 vs 实际实现

**ParamDef 类型定义**：
```typescript
/**
 * 参数说明（可选，支持国际化）
 * 鼠标悬停时显示
 */
tooltip?: I18nText
```

**实际实现问题**：
1. **ParamRenderer.tsx**：
   - 只在 composite 类型参数上使用了 `description` 字段作为 tooltip（错误）
   - 普通组件完全没有 tooltip 包装
   - `tooltip` 字段被完全忽略

2. **基础组件**（NumberInput, SliderInput 等）：
   - 读取 `description` 字段并显示在组件下方（不符合需求）
   - 不处理 `tooltip` 字段

## 修复方案

### 修改文件列表

1. `src/components/params/ParamRenderer.tsx` - 添加 tooltip 支持
2. `src/components/params/base/NumberInput.tsx` - 移除 description 显示
3. `src/components/params/base/SliderInput.tsx` - 移除 description 显示
4. `src/components/params/base/TextInput.tsx` - 移除 description 显示
5. `src/components/params/base/SwitchInput.tsx` - 移除 description 显示
6. `src/components/params/base/DropdownInput.tsx` - 移除 description 显示
7. `src/components/params/base/RadioInput.tsx` - 移除 description 显示

### 详细修改

#### 1. ParamRenderer.tsx

**导入必要工具**：
```typescript
import { useTranslation } from 'react-i18next'
import { getI18nText } from '@/core/types/I18nText'
```

**获取当前语言**：
```typescript
export const ParamRenderer: React.FC<ParamRendererProps> = React.memo((({
  // ... props
}) => {
  const { i18n } = useTranslation()
  // ...
```

**修复 composite 类型的 tooltip**：
```typescript
// 修改前：使用 description 字段（错误）
if (param.description) {
  return (
    <Tooltip
      content={param.description.zh || param.description.en || ''}
      delay={500}
    >
      {panelContent}
    </Tooltip>
  )
}

// 修改后：使用 tooltip 字段（正确）
if (param.tooltip) {
  return (
    <Tooltip
      content={getI18nText(param.tooltip, i18n.language)}
      delay={500}
    >
      {panelContent}
    </Tooltip>
  )
}
```

**为普通组件添加 tooltip 支持**：
```typescript
// 修改前：直接返回组件，没有 tooltip 包装
return (
  <Component
    param={param as any}
    value={value}
    onChange={onChange}
    disabled={externalDisabled}
  />
)

// 修改后：添加 tooltip 包装
const renderedComponent = (
  <Component
    param={param as any}
    value={value}
    onChange={onChange}
    disabled={externalDisabled}
  />
)

// 如果有 tooltip，包装 Tooltip
if (param.tooltip) {
  return (
    <Tooltip
      content={getI18nText(param.tooltip, i18n.language)}
      delay={500}
    >
      {renderedComponent}
    </Tooltip>
  )
}

return renderedComponent
```

#### 2. 基础组件（所有6个组件）

**移除 description 变量**：
```typescript
// 修改前
const displayName = getI18nText(param.name, i18n.language)
const description = param.description ? getI18nText(param.description, i18n.language) : ''

// 修改后
const displayName = getI18nText(param.name, i18n.language)
```

**移除 description 显示**：
```typescript
// 修改前
{description && (
  <p className="text-xs text-zinc-500 mt-1">{description}</p>
)}

// 修改后
// 完全移除
```

## 使用指南

### Tooltip 使用方式

现在只有一个字段用于提示信息：

```typescript
{
  id: 'myParam',
  type: 'number',
  name: { zh: '参数名', en: 'Param Name' },

  // 鼠标悬停时显示（浮动提示框，500ms 延迟）
  tooltip: {
    zh: '这是参数的说明，鼠标悬停时显示',
    en: 'This is the parameter description shown on hover'
  },

  default: 1
}
```

### 实际示例

**简短说明**：
```typescript
{
  id: 'ppioSeedream45MaxImages',
  type: 'number',
  name: { zh: '数量', en: 'Quantity' },
  tooltip: {
    zh: '设置为1时仅生成单张图片；大于1时，会根据该数值生成多张图片。',
    en: 'Set to 1 to generate a single image; greater than 1 will generate multiple images.'
  },
  default: 1,
  min: 1,
  max: 15
}
```

**详细说明**：
```typescript
{
  id: 'ppioKling26CharacterOrientation',
  type: 'dropdown',
  name: { zh: '人物朝向', en: 'Character Orientation' },
  tooltip: {
    zh: '默认为人物朝向与视频一致，此时角色动作/表情/运镜/朝向都会按照动作视频生成。可以通过提示词控制其他信息。最长支持30s生成时长。\n\n选择人物朝向与图片一致，此时角色动作/表情都会按照动作视频生成，朝向与图片中人物朝向一致，运镜及其他信息可以通过提示词自定义。最长支持5s生成时长。',
    en: 'Default is character orientation consistent with video...'
  },
  default: 'video',
  options: [...]
}
```

## 验证清单

- [x] ParamRenderer 导入 `useTranslation` 和 `getI18nText`
- [x] Composite 类型参数使用 `tooltip` 字段
- [x] 普通组件添加 tooltip 包装
- [x] 支持国际化（通过 `getI18nText`）
- [x] 从所有基础组件中移除 `description` 显示
- [x] TypeScript 编译无错误

## 影响范围

### 修改的文件
- `src/components/params/ParamRenderer.tsx`
- `src/components/params/base/NumberInput.tsx`
- `src/components/params/base/SliderInput.tsx`
- `src/components/params/base/TextInput.tsx`
- `src/components/params/base/SwitchInput.tsx`
- `src/components/params/base/DropdownInput.tsx`
- `src/components/params/base/RadioInput.tsx`

### 不需要修改的文件
- 模型定义文件：已经使用了 `tooltip` 字段，无需修改

### 受益的模型
所有在参数定义中使用了 `tooltip` 字段的模型，例如：
- `seedream-4.5.model.ts`
- `kling-2.6-pro.model.ts`
- `seedance-1.5-pro.model.ts`
- 等等

## 测试建议

1. **基本功能测试**：
   - 鼠标悬停在有 `tooltip` 的参数上，应该显示提示框
   - 提示框应该在 500ms 后显示
   - 移开鼠标后提示框应该消失

2. **国际化测试**：
   - 切换语言后，tooltip 内容应该相应变化
   - 如果某个语言缺失，应该降级到其他语言

3. **无 tooltip 参数测试**：
   - 没有 `tooltip` 字段的参数不应该有任何悬停效果
   - 参数下方不应该显示任何说明文字

## 与旧系统的对比

### 旧系统
- 字段：`tooltip` (string)
- 显示方式：鼠标悬停，浮动提示框
- 国际化：不支持

### 新系统（修复后）
- 字段：`tooltip` (I18nText)
- 显示方式：鼠标悬停，浮动提示框
- 国际化：完全支持（zh/en）
- 延迟：500ms

## 相关文档

- [UI Pattern Analysis - PanelTrigger Tooltip](./UI-Pattern-Analysis-PanelTrigger-Tooltip.md)
- [开发规范与架构指南](./开发规范与架构指南.md)
- [模型与供应商适配规范](./rules/model-adaptation.md)

