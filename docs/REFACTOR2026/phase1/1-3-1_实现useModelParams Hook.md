# 1-3-1 实现useModelParams Hook

## 目标

实现动态参数管理 Hook，替代当前 640 行、160+ useState 的状态管理

## 背景

当前问题（`useMediaGeneratorState.ts`）：
- 640 行代码，160+ 个 useState
- 每个模型添加 5-10 个状态变量
- 同一参数因供应商不同重复定义
- 预设加载需要手动映射每个参数

新架构目标：
- 统一的参数状态 `params: Record<string, any>`
- 从 Schema 自动生成默认值
- 自动处理参数联动
- 简化预设加载和保存

## 前置依赖

- [x] 1-1-2：定义参数类型系统
- [x] 1-2-1：实现ModelRegistry核心

## 实施步骤

1. [ ] 创建 Hook 基础结构
   - 创建 `src/hooks/useModelParams.ts`
   - 定义返回值接口
   - 实现基础状态管理

2. [ ] 实现默认值提取
   - 创建 `extractDefaults(schema: ParamDef[])` 函数
   - 遍历 Schema 提取 default 字段
   - 处理嵌套参数（如 resolution.aspectRatio）
   - 缓存默认值避免重复计算

3. [ ] 实现参数设置
   - `setParam(key: string, value: any)` 方法
   - 支持嵌套路径（如 'resolution.quality'）
   - 触发联动规则（后续任务）
   - 验证参数值有效性

4. [ ] 实现批量设置
   - `setParams(values: Partial<Params>)` 方法
   - 用于预设加载
   - 合并多个参数更新
   - 触发一次联动检查

5. [ ] 实现重置功能
   - `resetParams()` - 重置所有参数
   - `resetParam(key: string)` - 重置单个参数
   - 恢复为 Schema 默认值

6. [ ] 实现选项过滤
   - `getFilteredOptions(paramId: string)` 方法
   - 应用 filterOptions 函数
   - 缓存过滤结果

7. [ ] 添加调试支持
   - `getParamInfo(key: string)` - 获取参数详情
   - `validateParams()` - 验证所有参数
   - 集成测试模式

8. [ ] 优化性能
   - 使用 useMemo 缓存计算
   - 使用 useCallback 缓存函数
   - 避免不必要的重渲染

## 涉及文件

### 新建文件
- `src/hooks/useModelParams.ts` - 主 Hook
- `src/hooks/utils/paramUtils.ts` - 参数工具函数
- `src/hooks/utils/defaultExtractor.ts` - 默认值提取器

### 修改文件
- 无（纯新增功能，暂不删除旧代码）

## 验收标准

- [ ] Hook 正确提取 Schema 默认值
- [ ] setParam 和 setParams 正常工作
- [ ] resetParams 恢复默认值
- [ ] getFilteredOptions 返回正确选项
- [ ] 性能良好（参数变化 < 10ms）
- [ ] TypeScript 类型完整
- [ ] 包含完整的 JSDoc 注释

## 测试方法

1. 创建测试用例
```typescript
import { renderHook, act } from '@testing-library/react'
import { useModelParams } from '@/hooks/useModelParams'
import { registry } from '@/core'

// 注册测试模型
registry.register({
  meta: {
    id: 'test-model',
    provider: 'test',
    type: 'image',
    name: { zh: '测试', en: 'Test' }
  },
  params: [
    {
      id: 'quality',
      component: 'dropdown',
      name: { zh: '质量', en: 'Quality' },
      order: 1,
      valueType: 'string',
      default: 'standard',
      options: [
        { value: 'standard', label: { zh: '标准', en: 'Standard' } },
        { value: 'hd', label: { zh: '高清', en: 'HD' } }
      ],
      apiField: 'quality'
    },
    {
      id: 'size',
      component: 'number',
      name: { zh: '尺寸', en: 'Size' },
      order: 2,
      valueType: 'number',
      default: 1024,
      min: 512,
      max: 2048,
      apiField: 'size'
    }
  ],
  endpoints: { default: '/test' },
  pricing: { currency: '¥', fixed: 0.1 }
})

test('提取默认值', () => {
  const { result } = renderHook(() => useModelParams('test-model'))

  expect(result.current.params).toEqual({
    quality: 'standard',
    size: 1024
  })
})

test('设置单个参数', () => {
  const { result } = renderHook(() => useModelParams('test-model'))

  act(() => {
    result.current.setParam('quality', 'hd')
  })

  expect(result.current.params.quality).toBe('hd')
})

test('批量设置参数', () => {
  const { result } = renderHook(() => useModelParams('test-model'))

  act(() => {
    result.current.setParams({
      quality: 'hd',
      size: 2048
    })
  })

  expect(result.current.params).toEqual({
    quality: 'hd',
    size: 2048
  })
})

test('重置参数', () => {
  const { result } = renderHook(() => useModelParams('test-model'))

  act(() => {
    result.current.setParam('quality', 'hd')
  })

  expect(result.current.params.quality).toBe('hd')

  act(() => {
    result.current.resetParams()
  })

  expect(result.current.params.quality).toBe('standard')
})

test('获取过滤选项', () => {
  const { result } = renderHook(() => useModelParams('test-model'))

  const options = result.current.getFilteredOptions('quality')

  expect(options).toHaveLength(2)
  expect(options[0].value).toBe('standard')
})
```

2. 性能测试
```typescript
test('参数更新性能', () => {
  const { result } = renderHook(() => useModelParams('test-model'))

  const start = performance.now()

  act(() => {
    for (let i = 0; i < 100; i++) {
      result.current.setParam('size', 512 + i)
    }
  })

  const duration = performance.now() - start
  expect(duration).toBeLessThan(100) // 100 次更新 < 100ms
})
```

3. 手动测试
```typescript
// 在实际组件中使用
function TestComponent() {
  const { params, setParam, resetParams } = useModelParams('test-model')

  return (
    <div>
      <div>Quality: {params.quality}</div>
      <div>Size: {params.size}</div>

      <button onClick={() => setParam('quality', 'hd')}>
        Set HD
      </button>

      <button onClick={resetParams}>
        Reset
      </button>
    </div>
  )
}
```

## 风险与注意事项

### 风险
- 嵌套参数路径解析可能出错
- 性能可能不如原生 useState
- 类型推导可能不够精确

### 注意事项
- 使用 immer 或 immutability-helper 确保不可变更新
- setParam 应该是异步安全的
- 避免在 render 中调用 setParam
- 使用 useEffect 监听外部参数变化
- 嵌套路径使用 lodash.get/set 或自实现
- 考虑使用 Zustand 或 Jotai 替代 useState
- 添加参数变化监听器支持

## 实现参考

```typescript
// src/hooks/useModelParams.ts

import { useState, useMemo, useCallback, useEffect } from 'react'
import { registry } from '@/core'
import type { ParamDef } from '@/core/types'

interface UseModelParamsReturn {
  params: Record<string, any>
  setParam: (key: string, value: any) => void
  setParams: (values: Record<string, any>) => void
  resetParams: () => void
  resetParam: (key: string) => void
  getFilteredOptions: (paramId: string) => any[]
  schema: ParamDef[]
}

/**
 * 从参数 Schema 提取默认值
 */
function extractDefaults(schema: ParamDef[]): Record<string, any> {
  const defaults: Record<string, any> = {}

  for (const param of schema) {
    if (param.default !== undefined) {
      defaults[param.id] = param.default
    }
  }

  return defaults
}

/**
 * 动态参数管理 Hook
 *
 * @example
 * ```tsx
 * const { params, setParam } = useModelParams('wan-2.6')
 *
 * <input
 *   value={params.duration}
 *   onChange={(e) => setParam('duration', Number(e.target.value))}
 * />
 * ```
 */
export function useModelParams(modelId: string): UseModelParamsReturn {
  // 获取 Schema
  const schema = useMemo(() => {
    return registry.getSchema(modelId)
  }, [modelId])

  // 提取默认值
  const defaults = useMemo(() => {
    return extractDefaults(schema)
  }, [schema])

  // 参数状态
  const [params, setParamsState] = useState<Record<string, any>>(defaults)

  // 模型切换时重置参数
  useEffect(() => {
    setParamsState(defaults)
  }, [modelId, defaults])

  // 设置单个参数
  const setParam = useCallback((key: string, value: any) => {
    setParamsState(prev => ({
      ...prev,
      [key]: value
    }))
  }, [])

  // 批量设置参数
  const setParams = useCallback((values: Record<string, any>) => {
    setParamsState(prev => ({
      ...prev,
      ...values
    }))
  }, [])

  // 重置所有参数
  const resetParams = useCallback(() => {
    setParamsState(defaults)
  }, [defaults])

  // 重置单个参数
  const resetParam = useCallback((key: string) => {
    if (defaults[key] !== undefined) {
      setParam(key, defaults[key])
    }
  }, [defaults, setParam])

  // 获取过滤后的选项
  const getFilteredOptions = useCallback((paramId: string) => {
    const paramDef = schema.find(p => p.id === paramId)

    if (!paramDef || !('options' in paramDef)) {
      return []
    }

    const options = paramDef.options || []

    // 应用过滤函数
    if ('filterOptions' in paramDef && paramDef.filterOptions) {
      return paramDef.filterOptions(options, params)
    }

    return options
  }, [schema, params])

  return {
    params,
    setParam,
    setParams,
    resetParams,
    resetParam,
    getFilteredOptions,
    schema
  }
}
```

```typescript
// src/hooks/utils/paramUtils.ts

/**
 * 设置嵌套参数值
 * @example setNestedValue({ a: { b: 1 } }, 'a.b', 2) => { a: { b: 2 } }
 */
export function setNestedValue(
  obj: Record<string, any>,
  path: string,
  value: any
): Record<string, any> {
  const keys = path.split('.')
  const result = { ...obj }
  let current: any = result

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    current[key] = { ...current[key] }
    current = current[key]
  }

  current[keys[keys.length - 1]] = value
  return result
}

/**
 * 获取嵌套参数值
 */
export function getNestedValue(
  obj: Record<string, any>,
  path: string
): any {
  const keys = path.split('.')
  let current = obj

  for (const key of keys) {
    if (current === undefined || current === null) {
      return undefined
    }
    current = current[key]
  }

  return current
}
```

## 回滚方案

1. 删除新建文件
   - 删除 `src/hooks/useModelParams.ts`
   - 删除 `src/hooks/utils/` 目录

2. 继续使用旧的状态管理
   - 保持 `useMediaGeneratorState.ts` 不变

3. Git 回滚
   ```bash
   git checkout HEAD -- src/hooks/
   ```
