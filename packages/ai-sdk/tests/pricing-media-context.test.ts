import { describe, expect, it, vi } from 'vitest'

import {
  resolvePricingMediaContext,
  resolvePricingMediaSources,
  type PricingMediaMetadataReaders,
  type RuntimePricingMediaContextRequirement,
} from '../src'

function createReaders(): PricingMediaMetadataReaders {
  return {
    image: vi.fn(async () => ({ width: 2000, height: 1000, fileSizeBytes: 3_000_000 })),
    video: vi.fn(async () => ({ width: 1920, height: 1080, durationSeconds: 6 })),
  }
}

describe('resolvePricingMediaContext', () => {
  it('按统一媒体来源优先级读取图片，并用参数倍率计算输出面积', async () => {
    const requirements: RuntimePricingMediaContextRequirement[] = [
      { targetParam: '__inputMp', mediaType: 'image', metric: 'megapixels' },
      {
        targetParam: '__outputMp',
        mediaType: 'image',
        metric: 'megapixels',
        multiplier: { kind: 'parameter', paramId: 'factor', fallback: 2, exponent: 2 },
      },
    ]
    const readers = createReaders()
    const params = {
      uploadedFilePaths: ['source.png'],
      images: ['preview.png'],
      factor: 4,
    }

    expect(resolvePricingMediaSources('image', params)).toEqual(['source.png'])
    const resolved = await resolvePricingMediaContext(requirements, params, readers)

    expect(resolved).toMatchObject({ complete: true, missingTargets: [] })
    expect(resolved.params.__inputMp).toBe(2)
    expect(resolved.params.__outputMp).toBe(32)
    expect(readers.image).toHaveBeenCalledTimes(1)
    expect(readers.image).toHaveBeenCalledWith('source.png')
  })

  it('支持固定倍率和多视频指标求和，供后续像素/时长计费复用', async () => {
    const requirements: RuntimePricingMediaContextRequirement[] = [
      {
        targetParam: '__fixedOutputMp',
        mediaType: 'image',
        metric: 'megapixels',
        multiplier: { kind: 'fixed', value: 4, exponent: 2 },
      },
      {
        targetParam: '__totalDuration',
        mediaType: 'video',
        metric: 'durationSeconds',
        aggregation: 'sum',
      },
    ]
    const readers = createReaders()
    const resolved = await resolvePricingMediaContext(requirements, {
      images: ['source.png'],
      videos: ['a.mp4', 'b.mp4'],
    }, readers)

    expect(resolved.params.__fixedOutputMp).toBe(32)
    expect(resolved.params.__totalDuration).toBe(12)
    expect(resolved.complete).toBe(true)
  })

  it('媒体缺失时不返回伪造兜底值，并保留宿主已经注入的指标', async () => {
    const requirements: RuntimePricingMediaContextRequirement[] = [
      { targetParam: '__mp', mediaType: 'image', metric: 'megapixels' },
    ]
    const readers = createReaders()
    await expect(resolvePricingMediaContext(requirements, {}, readers)).resolves.toEqual({
      params: {},
      complete: false,
      missingTargets: ['__mp'],
    })

    const existing = await resolvePricingMediaContext(requirements, { __mp: 9 }, readers)
    expect(existing).toEqual({ params: { __mp: 9 }, complete: true, missingTargets: [] })
    expect(readers.image).not.toHaveBeenCalled()
  })
})
