import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  probeSharpDiffusionFallback,
  renderSharpDiffusionFallback,
  UnsupportedSharpDiffusionParametersError,
} from './diffusion-fallback'
import { createDefaultDiffusionOperationParams } from '../../../../src/core/imageEdit/diffusionParams'

async function createTestSource(width: number, height: number): Promise<string> {
  const bytes = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 32, g: 64, b: 128 },
    },
  }).png().toBuffer()
  return `data:image/png;base64,${bytes.toString('base64')}`
}

describe('Sharp 柔光降级原型', () => {
  it('声明能力与不可硬取消边界', async () => {
    await expect(probeSharpDiffusionFallback()).resolves.toMatchObject({
      available: true,
      maxPreviewPixels: 1_000_000,
      hardCancellationSupported: false,
      supportedFormats: ['png', 'jpeg', 'webp'],
    })
  })

  it('将预览限制在约 1MP，并支持 PNG/JPEG/WebP 编码', async () => {
    const source = await createTestSource(1600, 1200)
    for (const format of ['png', 'jpeg', 'webp'] as const) {
      const result = await renderSharpDiffusionFallback({
        requestId: `fallback-${format}`,
        source,
        purpose: 'preview',
        format,
        params: {
          mode: 'black-diffusion',
          strength: 0.25,
          radiusPixels: 8,
        },
      })
      expect(result.width * result.height).toBeLessThanOrEqual(1_000_000)
      expect(result.bytes.byteLength).toBeGreaterThan(0)
      expect(result.hardCancellationSupported).toBe(false)
    }
  }, 30_000)

  it('对不支持参数返回可识别错误而不是静默忽略', async () => {
    const source = await createTestSource(64, 64)
    await expect(renderSharpDiffusionFallback({
      requestId: 'fallback-unsupported',
      source,
      purpose: 'preview',
      format: 'png',
      params: {
        mode: 'glow',
        strength: 0.3,
        radiusPixels: 4,
        chromaticSpread: 0.2,
      },
    })).rejects.toBeInstanceOf(UnsupportedSharpDiffusionParametersError)
  })

  it('完整公共参数通过共享配方降级，并显式返回能力限制', async () => {
    const source = await createTestSource(320, 180)
    const result = await renderSharpDiffusionFallback({
      requestId: 'fallback-shared-recipe',
      source,
      purpose: 'export',
      format: 'png',
      params: createDefaultDiffusionOperationParams(),
    })
    expect(result.bytes.byteLength).toBeGreaterThan(0)
    expect(result.unsupportedParameters).toContain('scaleWeights')
    expect(result.hardCancellationSupported).toBe(false)
  })
})
