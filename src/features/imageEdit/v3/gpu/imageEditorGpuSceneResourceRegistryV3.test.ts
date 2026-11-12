import { describe, expect, it, vi } from 'vitest'

import type { ImageEditorV3ResourceRef } from '@/platform/contracts/imageEditorV3'
import { ImageEditorGpuSceneResourceRegistryV3 } from './imageEditorGpuSceneResourceRegistryV3'

const resourceRef = (value: string): ImageEditorV3ResourceRef => `sha256:${value}`
const key = (value: string) => ({
  resourceRef: resourceRef(value),
  mip: 0,
  tileX: 0,
  tileY: 0,
  contentVersion: value,
})

describe('ImageEditorGpuSceneResourceRegistryV3', () => {
  it('超过预算时按 LRU 淘汰未保护资源', () => {
    const disposePayload = vi.fn()
    const registry = new ImageEditorGpuSceneResourceRegistryV3<string>({
      memoryBudgetBytes: 10,
      disposePayload,
    })

    registry.register(key('a'), 'a', 6)
    const second = registry.register(key('b'), 'b', 6)

    expect(second).toMatchObject({ reused: false, evicted: [key('a')] })
    expect(registry.get(key('a'))).toBeNull()
    expect(registry.get(key('b'))).toBe('b')
    expect(disposePayload).toHaveBeenCalledWith('a')
    registry.dispose()
  })

  it('受保护资源不被淘汰，超出预算的新资源照样登记，解除保护后才让位', () => {
    const registry = new ImageEditorGpuSceneResourceRegistryV3<string>({ memoryBudgetBytes: 10 })
    registry.register(key('protected'), 'protected', 8, ['viewport', 'interaction', 'stable-frame'])

    expect(registry.register(key('candidate'), 'candidate', 8)).toMatchObject({ evicted: [] })
    expect(registry.get(key('candidate'))).toBe('candidate')
    expect(registry.get(key('protected'))).toBe('protected')
    registry.releaseProtection('viewport')
    registry.releaseProtection('interaction')
    registry.releaseProtection('stable-frame')
    expect(registry.register(key('next'), 'next', 8).evicted).toHaveLength(2)
    registry.dispose()
  })

  it('相同资源身份只复用账本且不重复占用显存', () => {
    const disposePayload = vi.fn()
    const registry = new ImageEditorGpuSceneResourceRegistryV3<string>({
      memoryBudgetBytes: 10,
      disposePayload,
    })
    registry.register(key('same'), 'first', 6)

    expect(registry.register(key('same'), 'duplicate', 6)).toMatchObject({
      reused: true,
      evicted: [],
    })
    expect(registry.snapshot()).toMatchObject({ entries: 1, bytes: 6, budgetBytes: 10 })
    expect(disposePayload).toHaveBeenCalledWith('duplicate')
    registry.dispose()
  })

  it('预淘汰跳过当前mip、交互层和最后稳定帧，按LRU先清旧revision', () => {
    const disposePayload = vi.fn()
    const registry = new ImageEditorGpuSceneResourceRegistryV3<string>({
      memoryBudgetBytes: 20,
      disposePayload,
    })
    registry.register(key('viewport'), 'viewport', 4, ['viewport'])
    registry.register(key('interaction'), 'interaction', 4, ['interaction'])
    registry.register(key('stable'), 'stable', 4, ['stable-frame'])
    registry.register(key('old-revision'), 'old-revision', 4)
    registry.register(key('offscreen'), 'offscreen', 4)

    expect(registry.prepareAdmission(4)).toEqual({ evicted: [key('old-revision')] })
    expect(registry.get(key('viewport'))).toBe('viewport')
    expect(registry.get(key('interaction'))).toBe('interaction')
    expect(registry.get(key('stable'))).toBe('stable')
    expect(registry.get(key('offscreen'))).toBe('offscreen')
    expect(disposePayload).toHaveBeenCalledWith('old-revision')
    registry.dispose()
  })
})
