import { describe, expect, it } from 'vitest'
import { isLocalModelId, LOCAL_MODEL_IDS } from '../../../../src/platform/contracts/localModels'
import { LOCAL_MODEL_MANIFEST } from './manifest'

describe('图片修补模型的固定下载契约', () => {
  it('闭合 ID 与清单一致，新模型经现有实体列表自动被发现', () => {
    expect(new Set(LOCAL_MODEL_MANIFEST.map(model => model.id))).toEqual(new Set(LOCAL_MODEL_IDS))
    for (const id of ['image_inpainting_migan', 'image_inpainting_lama']) expect(isLocalModelId(id)).toBe(true)
    expect(isLocalModelId('tensor')).toBe(false)
  })
  it.each([
    ['image_inpainting_migan', 29_546_882, '406830d0fa60666da0071c342ad2fbc8f30c5c64', 'MIT'],
    ['image_inpainting_lama', 208_044_816, 'c3c0c9e468934d62e79c329e35d82dd09ff8c444', 'Apache-2.0'],
  ])('%s 有大小、完整哈希、固定上游 revision 和许可来源', (id, size, revision, license) => {
    const model = LOCAL_MODEL_MANIFEST.find(model => model.id === id)!
    expect(model.availability).toBe('available'); expect(model.license.spdx).toBe(license)
    expect(model.files).toHaveLength(1)
    expect(model.files[0].sizeBytes).toBe(size)
    expect(model.files[0].sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(model.files[0].sources.find(source => source.region === 'global')?.url).toContain(`/resolve/${revision}/`)
  })
})
