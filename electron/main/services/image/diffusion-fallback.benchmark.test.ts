import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { renderSharpDiffusionFallback } from './diffusion-fallback'

const runBenchmark = process.env.HENJI_IMAGE_EDIT_BENCHMARK === '1'

describe('Sharp 柔光降级 24MP 基准', () => {
  it.runIf(runBenchmark)('完成三种格式兼容导出并可重新解码', async () => {
    const sourceBytes = await sharp({
      create: {
        width: 6000,
        height: 4000,
        channels: 3,
        background: { r: 48, g: 96, b: 160 },
      },
    }).png().toBuffer()
    const source = `data:image/png;base64,${sourceBytes.toString('base64')}`
    const results: Array<{
      format: string
      durationMs: number
      byteLength: number
      rssBytes: number
    }> = []

    for (const format of ['png', 'jpeg', 'webp'] as const) {
      const result = await renderSharpDiffusionFallback({
        requestId: `sharp-24mp-${format}`,
        source,
        purpose: 'export',
        format,
        quality: 90,
        params: {
          mode: 'black-diffusion',
          strength: 0.25,
          radiusPixels: 12,
        },
      })
      const metadata = await sharp(result.bytes).metadata()
      expect(metadata.width).toBe(6000)
      expect(metadata.height).toBe(4000)
      results.push({
        format,
        durationMs: result.durationMs,
        byteLength: result.bytes.byteLength,
        rssBytes: process.memoryUsage().rss,
      })
    }

    // eslint-disable-next-line no-console -- 基准命令需要把实测指标输出到任务记录。
    console.log(`SHARP_24MP_METRICS=${JSON.stringify(results)}`)
  }, 120_000)
})
