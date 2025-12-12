# 新模型参数 - 同步更新清单

当为新模型添加参数时，需要在多个位置同步更新，否则会导致 TypeScript 类型错误或功能不完整。

## 常见错误

### TypeScript 类型错误：缺少 setter 属性

**错误信息示例**：
```
类型"{ setInput: Dispatch<SetStateAction<string>>; ... }"的参数不能赋给类型"PresetSetters"的参数。
类型缺少以下属性: setKieSora2Mode, setKieSora2AspectRatio, setKieSora2Duration, setKieSora2Quality
```

**原因**：在 `createPresetSetterMap` 调用中缺少新模型的 setter 函数。

## 完整的同步更新清单

添加新模型参数时，必须按以下顺序更新所有相关位置：

### 1. 定义 State 和 Setter

**位置**：`src/components/MediaGenerator/hooks/useMediaGeneratorState.ts`

```typescript
export function useMediaGeneratorState() {
  // 添加新模型的 state
  const [kieSora2Mode, setKieSora2Mode] = useState<string>('standard')
  const [kieSora2AspectRatio, setKieSora2AspectRatio] = useState<string>('16:9')
  const [kieSora2Duration, setKieSora2Duration] = useState<string>('10')
  const [kieSora2Quality, setKieSora2Quality] = useState<string>('standard')

  return {
    // ... 其他 state
    kieSora2Mode,
    setKieSora2Mode,
    kieSora2AspectRatio,
    setKieSora2AspectRatio,
    kieSora2Duration,
    setKieSora2Duration,
    kieSora2Quality,
    setKieSora2Quality,
  }
}
```

### 2. 添加到 PresetSetterMap

**位置**：`src/components/MediaGenerator/index.tsx`

在 `createPresetSetterMap` 调用中添加 setter：

```typescript
const setterMap = useMemo(() => createPresetSetterMap({
  // ... 其他 setter

  // KIE Sora 2 参数
  setKieSora2Mode: state.setKieSora2Mode,
  setKieSora2AspectRatio: state.setKieSora2AspectRatio,
  setKieSora2Duration: state.setKieSora2Duration,
  setKieSora2Quality: state.setKieSora2Quality,
}), [])
```

**⚠️ 重要**：这一步经常被遗漏，导致 TypeScript 报错。

### 3. 添加到 SchemaForm 的 setterMap

**位置**：`src/components/MediaGenerator/index.tsx` 的 `handleSchemaChange` 函数

```typescript
const handleSchemaChange = (id: string, value: any) => {
  const setterMap: Record<string, (v: any) => void> = {
    // ... 其他 setter

    // KIE Sora 2
    kieSora2Mode: state.setKieSora2Mode,
    kieSora2AspectRatio: state.setKieSora2AspectRatio,
    kieSora2Duration: state.setKieSora2Duration,
    kieSora2Quality: state.setKieSora2Quality,
  }

  const setter = setterMap[id]
  if (setter) {
    setter(value)
  }
}
```

### 4. 传递给 buildGenerateOptions

**位置**：`src/components/MediaGenerator/index.tsx` 的 `handleGenerate` 函数

```typescript
const options = await buildGenerateOptions({
  // ... 其他参数

  // KIE Sora 2 参数
  kieSora2Mode: state.kieSora2Mode,
  kieSora2AspectRatio: state.kieSora2AspectRatio,
  kieSora2Duration: state.kieSora2Duration,
  kieSora2Quality: state.kieSora2Quality,
})
```

### 5. 添加 TypeScript 类型定义

**位置**：`src/components/MediaGenerator/builders/core/types.ts`

```typescript
export interface BuildOptionsParams {
  // ... 其他参数

  // KIE Sora 2 参数
  kieSora2Mode?: string
  kieSora2AspectRatio?: string
  kieSora2Duration?: string
  kieSora2Quality?: string
}
```

### 6. 传递给 PriceEstimate（如果影响价格）

**位置**：`src/components/MediaGenerator/index.tsx`

```typescript
<PriceEstimate
  providerId={state.selectedProvider}
  modelId={state.selectedModel}
  params={{
    // ... 其他参数

    // KIE Sora 2 参数
    kieSora2Mode: state.kieSora2Mode,
    kieSora2Duration: state.kieSora2Duration,
    kieSora2Quality: state.kieSora2Quality,
  }}
/>
```

## 快速检查方法

### 方法 1：搜索现有模型参数

以现有模型（如 KIE Seedance V3）为参考，搜索其参数名（如 `kieSeedanceV3Mode`），查看它在哪些文件中出现，然后在相同位置添加新模型的参数。

### 方法 2：TypeScript 类型检查

添加参数后，运行 TypeScript 类型检查：
```bash
npm run type-check
```

或在 VS Code 中查看"问题"面板，TypeScript 会提示缺少哪些属性。

### 方法 3：功能测试

测试以下功能是否正常：
- ✅ 参数修改后 UI 正确更新
- ✅ 生成时参数正确传递到 API
- ✅ 预设功能可以保存和加载参数
- ✅ 重新编辑功能可以恢复参数
- ✅ 价格估算正确更新（如果参数影响价格）

## 常见遗漏位置

根据经验，最容易遗漏的位置（按频率排序）：

1. **createPresetSetterMap 调用**（最常见）
   - 症状：TypeScript 报错 "类型缺少以下属性"
   - 影响：预设功能和重新编辑功能无法保存/恢复新参数

2. **BuildOptionsParams 类型定义**
   - 症状：参数在测试模式中显示，但实际请求中缺失
   - 影响：参数被 TypeScript 忽略，不会传递到 API

3. **PriceEstimate params**
   - 症状：修改参数后价格不更新
   - 影响：价格估算不准确

4. **handleSchemaChange 的 setterMap**
   - 症状：UI 上修改参数无效
   - 影响：用户无法通过 UI 修改参数

## 自动化检查脚本（可选）

可以编写脚本检查参数是否在所有必要位置都有定义：

```typescript
// scripts/check-params-sync.ts
// 检查模型参数是否在所有必要位置都有定义
// 运行：npx ts-node scripts/check-params-sync.ts

const modelParams = ['kieSora2Mode', 'kieSora2AspectRatio', 'kieSora2Duration', 'kieSora2Quality']

const requiredFiles = [
  'src/components/MediaGenerator/hooks/useMediaGeneratorState.ts',
  'src/components/MediaGenerator/index.tsx',
  'src/components/MediaGenerator/builders/core/types.ts',
]

// 检查每个文件是否包含所有参数...
```

## 最佳实践

1. **使用参考模型**：以现有模型为模板，确保不遗漏任何位置
2. **逐步添加**：先添加一个参数，确保所有位置都更新，再添加下一个
3. **立即测试**：添加参数后立即运行类型检查和功能测试
4. **代码审查**：提交前检查是否所有位置都已更新

## 总结

添加新模型参数时，需要在 **6 个位置** 同步更新：

1. ✅ useMediaGeneratorState - 定义 state 和 setter
2. ✅ createPresetSetterMap - 添加到预设映射（最容易遗漏）
3. ✅ handleSchemaChange - 添加到 schema 处理
4. ✅ buildGenerateOptions - 传递给构建器
5. ✅ BuildOptionsParams - 添加类型定义
6. ✅ PriceEstimate - 传递给价格估算（如果影响价格）

遗漏任何一个位置都会导致功能不完整或 TypeScript 报错。建议使用现有模型作为参考，确保所有位置都已更新。
