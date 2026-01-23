# 1-3-3 实现AutoSwitch机制

## 目标

实现 AutoSwitch 高级特性，支持条件自动切换、智能匹配、watchKeys 精确触发等功能

## 背景

AutoSwitch 是联动系统中最复杂的功能，用于：
- 上传图片后自动匹配最接近的比例
- 切换模式后自动调整相关参数
- 条件满足时自动切换，条件不满足时可选择是否恢复

当前发现（SchemaForm.tsx）：
- 支持 watchKeys 精确控制触发时机
- 支持数组形式的多个规则
- 支持动态值函数
- 支持 noRestore 禁止自动恢复

需要将这些特性标准化并集成到新架构。

## 前置依赖

- [x] 1-3-2：实现参数联动引擎

## 实施步骤

1. [ ] 完善 AutoSwitch 接口定义
   - 扩展 AutoSwitchLinkage 类型
   - 添加 watchKeys 支持
   - 添加 noRestore 支持
   - 支持数组形式的多规则

2. [ ] 实现 watchKeys 机制
   - 创建 `src/core/linkage/watchKeyManager.ts`
   - 只在指定 key 变化时触发
   - 优化性能，避免不必要的检查

3. [ ] 实现动态值计算
   - 支持函数形式的 value
   - 支持访问所有参数
   - 缓存计算结果

4. [ ] 实现智能匹配算法
   - 创建 `src/core/linkage/smartMatch.ts`
   - 实现图片比例匹配
   - 实现最近值查找
   - 支持自定义匹配器

5. [ ] 实现原始值记录
   - 记录 autoSwitch 前的值
   - noRestore: false 时恢复原始值
   - 处理多次 autoSwitch 的情况

6. [ ] 实现多规则支持
   - 支持 autoSwitch 数组形式
   - 按顺序检查条件
   - 第一个满足的规则生效

7. [ ] 集成到联动引擎
   - 修改 LinkageEngine 支持 AutoSwitch
   - 处理 watchKeys 过滤
   - 管理原始值状态

8. [ ] 添加调试工具
   - 记录 autoSwitch 执行历史
   - 显示原始值和当前值
   - 可视化匹配过程

## 涉及文件

### 新建文件
- `src/core/linkage/AutoSwitchManager.ts` - AutoSwitch 管理器
- `src/core/linkage/smartMatch.ts` - 智能匹配算法
- `src/core/linkage/watchKeyManager.ts` - WatchKey 管理器

### 修改文件
- `src/core/linkage/LinkageEngine.ts` - 集成 AutoSwitch
- `src/core/linkage/effects/AutoSwitchEffect.ts` - 完善实现
- `src/core/types/Linkage.ts` - 扩展接口定义
- `src/hooks/useModelParams.ts` - 集成原始值管理

## 验收标准

- [ ] 支持 watchKeys 精确触发
- [ ] 支持动态值函数
- [ ] 支持 noRestore 选项
- [ ] 支持多规则数组形式
- [ ] 智能匹配算法正确
- [ ] 原始值恢复机制正确
- [ ] 性能良好（单次匹配 < 10ms）
- [ ] 包含完整的调试日志

## 测试方法

1. 测试 watchKeys
```typescript
const linkages: Linkage[] = [
  {
    trigger: 'images',
    effect: 'autoSwitch',
    target: 'aspectRatio',
    condition: (images) => images?.length > 0,
    value: 'smart',
    watchKeys: ['images'] // 只在 images 变化时触发
  }
]

const { result } = renderHook(() => useModelParams('test-model'))

// 修改其他参数不应触发
act(() => {
  result.current.setParam('mode', 'fast')
})
expect(result.current.params.aspectRatio).toBe('16:9') // 未改变

// 修改 watchKeys 中的参数才触发
act(() => {
  result.current.setParam('images', ['image1.jpg'])
})
expect(result.current.params.aspectRatio).toBe('smart')
```

2. 测试动态值函数
```typescript
const linkages: Linkage[] = [
  {
    trigger: 'imageRatio',
    effect: 'autoSwitch',
    target: 'aspectRatio',
    condition: (ratio) => ratio !== null,
    value: (ratio, params) => {
      // 动态计算最接近的比例
      const ratios = ['16:9', '9:16', '1:1', '4:3', '3:4']
      return findClosestRatio(ratio, ratios)
    }
  }
]

act(() => {
  result.current.setParam('imageRatio', 1.77) // 接近 16:9
})
expect(result.current.params.aspectRatio).toBe('16:9')

act(() => {
  result.current.setParam('imageRatio', 0.56) // 接近 9:16
})
expect(result.current.params.aspectRatio).toBe('9:16')
```

3. 测试 noRestore
```typescript
const linkages: Linkage[] = [
  {
    trigger: 'fastMode',
    effect: 'autoSwitch',
    target: 'quality',
    condition: (fast) => fast === true,
    value: 'low',
    noRestore: true // 不恢复
  }
]

act(() => {
  result.current.setParam('quality', 'high')
})

act(() => {
  result.current.setParam('fastMode', true)
})
expect(result.current.params.quality).toBe('low')

act(() => {
  result.current.setParam('fastMode', false)
})
// noRestore: true，不恢复为 high
expect(result.current.params.quality).toBe('low')
```

4. 测试多规则
```typescript
const linkages: Linkage[] = [
  {
    trigger: 'mode',
    effect: 'autoSwitch',
    target: 'quality',
    rules: [
      {
        condition: (mode) => mode === 'fast',
        value: 'low'
      },
      {
        condition: (mode) => mode === 'balanced',
        value: 'medium'
      },
      {
        condition: (mode) => mode === 'quality',
        value: 'high'
      }
    ]
  }
]

act(() => {
  result.current.setParam('mode', 'fast')
})
expect(result.current.params.quality).toBe('low')

act(() => {
  result.current.setParam('mode', 'balanced')
})
expect(result.current.params.quality).toBe('medium')
```

5. 测试智能匹配
```typescript
import { findClosestRatio, findClosestAspectRatio } from '@/core/linkage/smartMatch'

// 测试比例匹配
const ratio = findClosestRatio(1.77, ['16:9', '9:16', '1:1'])
expect(ratio).toBe('16:9') // 1.77 最接近 16:9 (1.777...)

const ratio2 = findClosestRatio(0.56, ['16:9', '9:16', '1:1'])
expect(ratio2).toBe('9:16') // 0.56 最接近 9:16 (0.5625)

// 测试图片尺寸匹配
const result = findClosestAspectRatio(
  { width: 1920, height: 1080 },
  ['16:9', '4:3', '1:1']
)
expect(result).toBe('16:9')
```

## 风险与注意事项

### 风险
- 复杂的动态值计算可能影响性能
- 原始值管理可能出现内存泄漏
- 多规则可能导致逻辑混乱

### 注意事项
- watchKeys 应该是数组，即使只有一个
- 动态值函数应该是纯函数，避免副作用
- 原始值应该在条件不满足时立即恢复
- 多规则应该明确优先级
- 智能匹配算法应该处理边界情况（如空数组）
- 考虑添加 debounce 避免频繁触发
- 记录详细的执行日志便于调试
- 提供禁用 autoSwitch 的开关（测试用）

## 实现参考

```typescript
// src/core/linkage/AutoSwitchManager.ts

interface AutoSwitchState {
  originalValue: any
  isActive: boolean
}

export class AutoSwitchManager {
  // 记录每个参数的原始值
  private originalValues: Map<string, AutoSwitchState> = new Map()

  /**
   * 执行 AutoSwitch
   */
  execute(
    linkage: AutoSwitchLinkage,
    triggerValue: any,
    params: Record<string, any>,
    changedKey: string
  ): Record<string, any> | null {
    // 检查 watchKeys
    if (linkage.watchKeys && !linkage.watchKeys.includes(changedKey)) {
      return null
    }

    const target = linkage.target
    if (!target) return null

    // 处理多规则
    if (Array.isArray(linkage.rules)) {
      for (const rule of linkage.rules) {
        if (rule.condition(triggerValue, params)) {
          return this.applySwitch(target, rule.value, params, linkage.noRestore)
        }
      }
      // 所有规则都不满足
      if (!linkage.noRestore) {
        return this.restoreOriginal(target)
      }
      return null
    }

    // 单规则
    const shouldSwitch = linkage.condition
      ? linkage.condition(triggerValue, params)
      : true

    if (shouldSwitch) {
      return this.applySwitch(target, linkage.value, params, linkage.noRestore)
    } else if (!linkage.noRestore) {
      return this.restoreOriginal(target)
    }

    return null
  }

  /**
   * 应用切换
   */
  private applySwitch(
    target: string,
    value: any,
    params: Record<string, any>,
    noRestore?: boolean
  ): Record<string, any> {
    // 记录原始值
    if (!this.originalValues.has(target)) {
      this.originalValues.set(target, {
        originalValue: params[target],
        isActive: true
      })
    }

    // 计算新值
    const newValue = typeof value === 'function'
      ? value(params[target], params)
      : value

    return { [target]: newValue }
  }

  /**
   * 恢复原始值
   */
  private restoreOriginal(target: string): Record<string, any> | null {
    const state = this.originalValues.get(target)
    if (!state || !state.isActive) {
      return null
    }

    const result = { [target]: state.originalValue }

    // 清理记录
    this.originalValues.delete(target)

    return result
  }

  /**
   * 清理状态
   */
  reset(): void {
    this.originalValues.clear()
  }
}
```

```typescript
// src/core/linkage/smartMatch.ts

/**
 * 查找最接近的比例
 */
export function findClosestRatio(
  targetRatio: number,
  ratios: string[]
): string {
  if (ratios.length === 0) {
    throw new Error('Ratios array cannot be empty')
  }

  let closestRatio = ratios[0]
  let minDiff = Infinity

  for (const ratio of ratios) {
    const [w, h] = ratio.split(':').map(Number)
    const r = w / h
    const diff = Math.abs(r - targetRatio)

    if (diff < minDiff) {
      minDiff = diff
      closestRatio = ratio
    }
  }

  return closestRatio
}

/**
 * 从图片尺寸查找最接近的比例
 */
export function findClosestAspectRatio(
  imageSize: { width: number; height: number },
  ratios: string[]
): string {
  const targetRatio = imageSize.width / imageSize.height
  return findClosestRatio(targetRatio, ratios)
}

/**
 * 从 Base64 图片数据获取尺寸
 */
export async function getImageSize(
  dataUrl: string
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.width, height: img.height })
    }
    img.onerror = reject
    img.src = dataUrl
  })
}

/**
 * 智能匹配图片比例
 * @example
 * const ratio = await smartMatchImageRatio(
 *   'data:image/png;base64,...',
 *   ['16:9', '9:16', '1:1']
 * )
 */
export async function smartMatchImageRatio(
  imageDataUrl: string,
  availableRatios: string[]
): Promise<string> {
  const size = await getImageSize(imageDataUrl)
  return findClosestAspectRatio(size, availableRatios)
}
```

```typescript
// src/core/types/Linkage.ts 扩展

interface AutoSwitchLinkage extends BaseLinkage {
  effect: 'autoSwitch'
  target: string

  // 单规则形式
  condition?: (triggerValue: any, params: any) => boolean
  value?: any | ((triggerValue: any, params: any) => any)

  // 多规则形式
  rules?: Array<{
    condition: (triggerValue: any, params: any) => boolean
    value: any | ((triggerValue: any, params: any) => any)
  }>

  // 高级选项
  watchKeys?: string[] // 只在这些 key 变化时触发
  noRestore?: boolean  // 条件不满足时是否恢复
  debounce?: number    // 防抖延迟（ms）
}
```

## 使用示例

```typescript
// 示例1：图片上传智能匹配比例
{
  trigger: 'images',
  effect: 'autoSwitch',
  target: 'aspectRatio',
  watchKeys: ['images'],
  condition: (images) => images?.length > 0,
  value: async (images, params) => {
    const ratio = await smartMatchImageRatio(
      images[0],
      ['16:9', '9:16', '1:1', '4:3', '3:4']
    )
    return ratio
  },
  noRestore: false
}

// 示例2：模式切换多规则
{
  trigger: 'mode',
  effect: 'autoSwitch',
  target: 'endpoint',
  rules: [
    {
      condition: (mode) => mode === 'text-to-video',
      value: 't2v'
    },
    {
      condition: (mode) => mode === 'image-to-video',
      value: 'i2v'
    },
    {
      condition: (mode) => mode === 'reference-to-video',
      value: 'v2v'
    }
  ]
}

// 示例3：快速模式自动降低质量（不恢复）
{
  trigger: 'fastMode',
  effect: 'autoSwitch',
  target: 'quality',
  condition: (fast) => fast === true,
  value: 'low',
  noRestore: true
}
```

## 回滚方案

1. 删除 AutoSwitch 增强文件
   - 删除 `src/core/linkage/AutoSwitchManager.ts`
   - 删除 `src/core/linkage/smartMatch.ts`
   - 删除 `src/core/linkage/watchKeyManager.ts`

2. 恢复基础 AutoSwitch 实现
   - 保留简单版本，移除高级特性

3. Git 回滚
   ```bash
   git checkout HEAD -- src/core/linkage/
   ```

4. 验证基础联动仍然工作
