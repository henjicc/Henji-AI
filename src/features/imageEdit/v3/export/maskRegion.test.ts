import { describe, expect, it } from 'vitest'
import { ImageEditResourceBudget } from '@/core/imageEdit/v3/resourceBudget'
import { createFloat32MaskTile } from '@/core/imageEdit/v3/effects/contracts'
import type { ImageEditSparseMaskReferenceV3 } from '@/core/imageEdit/v3/layerTypes'
import { createImageEditorSparseMaskReferencePlanV3 } from '../execution/sparseMaskResourcesV3'
import { loadImageEditorV3SparseMaskRegion } from './maskRegion'

const RESOURCE = `sha256:${'3'.repeat(64)}` as const
describe('稀疏蒙版区域读取', () => {
  it.each([0, 1] as const)('mip0 行复制在跨块、画布边缘与空块保留 defaultValue=%s', async defaultValue => {
    const mask: ImageEditSparseMaskReferenceV3 = { kind: 'sparse-mask', storage: 'mask-float32', maskId: 'mask', tileSize: 512, defaultValue, tiles: { '0/1/0': RESOURCE }, inverted: false }
    const tile = createFloat32MaskTile(3, 2, new Float32Array([0, 0.25, 0.5, 0.75, 1, 0]))
    const plan = createImageEditorSparseMaskReferencePlanV3(mask, { width: 515, height: 2 }, [{ resourceRef: RESOURCE, byteLength: 128, mediaType: 'application/x-henji-brush-tile-v3' }])
    const budget = new ImageEditResourceBudget()
    const result = await loadImageEditorV3SparseMaskRegion(mask, { x: 511, y: 0, width: 5, height: 2 }, 0, { byMaskId: new Map([['mask', plan]]) }, new AbortController().signal,
      { readBrushTiles: async () => ({ tiles: [{ tileKey: '0/1/0', tile }] }) }, budget)
    expect([...result.data]).toEqual([defaultValue, 0, 0.25, 0.5, defaultValue, defaultValue, 0.75, 1, 0, defaultValue])
    expect(budget.snapshot().leaseCount).toBe(0)
  })
})
