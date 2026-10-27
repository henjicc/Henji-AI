import { describe, expect, it } from 'vitest'
import { authorCanvasContent, scaleAuthorCanvasEffect } from './videoEditAuthorCanvasBounds'
import { AuthorCanvasAsset, recordAuthorCanvas, replayAuthorCanvas } from './videoEditAuthorCanvasRecorder'

/** 只用来量字的 2D 上下文替身：默认状态与真实画布相同，字宽 = 字数 × 字号 / 2，上 0.8、下 0.2 字号。 */
function measureContext(): OffscreenCanvasRenderingContext2D {
  const defaults = { fillStyle: 'black', strokeStyle: 'black', globalAlpha: 1, globalCompositeOperation: 'source-over', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0, shadowBlur: 0, shadowColor: 'rgba(0, 0, 0, 0)', shadowOffsetX: 0, shadowOffsetY: 0, font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', direction: 'ltr', filter: 'none', imageSmoothingEnabled: true, imageSmoothingQuality: 'low', letterSpacing: '0px', wordSpacing: '0px', fontKerning: 'auto', fontStretch: 'normal', fontVariantCaps: 'normal', textRendering: 'auto', lang: 'inherit' }
  const context = { ...defaults } as Record<string, unknown>
  context.reset = () => Object.assign(context, defaults)
  context.measureText = (text: string) => {
    const size = Number(/(\d+)px/.exec(String(context.font))?.[1] ?? 10), width = text.length * size / 2
    const left = context.textAlign === 'center' ? width / 2 : context.textAlign === 'right' ? width : 0
    return { width, actualBoundingBoxLeft: left, actualBoundingBoxRight: width - left, actualBoundingBoxAscent: size * .8, actualBoundingBoxDescent: size * .2 }
  }
  return context as unknown as OffscreenCanvasRenderingContext2D
}
const content = (draw: (ctx: OffscreenCanvasRenderingContext2D) => void, assetSize?: (key: string) => readonly [number, number] | undefined) => {
  const measure = measureContext()
  return authorCanvasContent(recordAuthorCanvas({ width: 1920, height: 1080 }, measure, [1, 0, 0, 1, 0, 0], draw), measure, assetSize)
}
const contains = (outer: readonly number[], inner: readonly number[]): boolean => outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3]

describe('Canvas 录制的内容范围', () => {
  it('按变换、线宽、阴影和裁剪保守外扩，只偏大不偏小', () => {
    const rect = content(ctx => { ctx.translate(100, 50); ctx.scale(2, 2); ctx.fillStyle = 'red'; ctx.fillRect(10, 10, 20, 5) })
    expect(rect.bounds).toBeDefined()
    expect(contains(rect.bounds!, [120, 70, 160, 80])).toBe(true)
    expect(contains([116, 66, 164, 84], rect.bounds!)).toBe(true)
    const stroke = content(ctx => { ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(100, 100); ctx.lineTo(300, 100); ctx.stroke() })
    expect(contains(stroke.bounds!, [97, 97, 303, 103])).toBe(true)
    expect(stroke.bounds![3] - stroke.bounds![1]).toBeLessThan(20)
    const shadow = content(ctx => { ctx.shadowColor = 'black'; ctx.shadowBlur = 10; ctx.shadowOffsetX = 30; ctx.fillRect(0, 0, 10, 10) })
    expect(contains(shadow.bounds!, [0, 0, 55, 25])).toBe(true)
    const clipped = content(ctx => { ctx.save(); ctx.beginPath(); ctx.rect(50, 50, 10, 10); ctx.clip(); ctx.fillRect(0, 0, 1920, 1080); ctx.restore() })
    expect(contains([48, 48, 62, 62], clipped.bounds!)).toBe(true)
    // 裁剪随 restore 结束：之后的绘制照常计入
    const restored = content(ctx => { ctx.save(); ctx.beginPath(); ctx.rect(50, 50, 10, 10); ctx.clip(); ctx.restore(); ctx.fillRect(500, 500, 10, 10) })
    expect(contains(restored.bounds!, [500, 500, 510, 510])).toBe(true)
  })

  it('圆弧、曲线、圆角折线与文字都在范围内', () => {
    const shapes = content(ctx => {
      ctx.beginPath(); ctx.arc(400, 300, 50, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.moveTo(0, 600); ctx.bezierCurveTo(100, 500, 200, 700, 300, 600); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(1000, 100); ctx.arcTo(1100, 100, 1100, 200, 40); ctx.lineTo(1100, 200); ctx.stroke()
      ctx.beginPath(); ctx.ellipse(1500, 800, 100, 20, Math.PI / 2, 0, Math.PI * 2); ctx.fill()
      ctx.font = '40px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('标题文字', 960, 1000)
    })
    for (const inner of [[350, 250, 450, 350], [0, 500, 300, 700], [1000, 100, 1100, 200], [1480, 700, 1520, 900], [880, 968, 1040, 1008]]) expect(contains(shapes.bounds!, inner)).toBe(true)
  })

  it('图片按目标矩形或素材尺寸计入；推不出的写法整幅处理', () => {
    const image = content(ctx => ctx.drawImage(new AuthorCanvasAsset('logo', 64, 32) as unknown as CanvasImageSource, 100, 200), key => key === 'logo' ? [64, 32] : undefined)
    expect(contains(image.bounds!, [100, 200, 164, 232])).toBe(true)
    expect(contains([96, 196, 168, 236], image.bounds!)).toBe(true)
    // Path2D 的内容看不见、url() 滤镜换算不了：整幅，且不能缩小栅格
    expect(content(ctx => ctx.fill({} as Path2D)).bounds).toBeUndefined()
    const unknown = content(ctx => { ctx.filter = 'url(#glow)'; ctx.fillRect(0, 0, 10, 10) })
    expect(unknown).toMatchObject({ bounds: undefined, scalable: false })
    expect(content(ctx => { ctx.filter = 'blur(4px)'; ctx.fillRect(100, 100, 10, 10) })).toMatchObject({ scalable: true })
    // 什么也没画：null（不占纹理）；读画布本身：标记出来
    expect(content(ctx => { ctx.fillStyle = 'red' }).bounds).toBeNull()
    expect(content(ctx => ctx.drawImage(ctx.canvas, 0, 0)).readsCanvas).toBe(true)
  })
})

describe('缩小栅格时换算阴影与滤镜', () => {
  it('阴影与 filter 的长度按比例换算，颜色函数与颜色原样保留', () => {
    expect(scaleAuthorCanvasEffect('shadowBlur', 10, .5, .5)).toBe(5)
    expect(scaleAuthorCanvasEffect('shadowOffsetY', -8, .5, .25)).toBe(-2)
    expect(scaleAuthorCanvasEffect('filter', 'blur(4px) drop-shadow(2px 4px 6px rgba(0, 0, 0, .5)) saturate(1.2)', .5, .5)).toBe('blur(2px) drop-shadow(1px 2px 3px rgba(0, 0, 0, .5)) saturate(1.2)')
    expect(scaleAuthorCanvasEffect('filter', 'none', .5, .5)).toBe('none')
    expect(scaleAuthorCanvasEffect('lineWidth', 4, .5, .5)).toBe(4)
    expect(scaleAuthorCanvasEffect('filter', 'blur(1em)', .5, .5)).toBeUndefined()
  })

  it('重放时只在给了比例时换算，完整分辨率原样重放', () => {
    const measure = measureContext()
    const recording = recordAuthorCanvas({ width: 100, height: 100 }, measure, [1, 0, 0, 1, 0, 0], ctx => { ctx.shadowBlur = 12; ctx.filter = 'blur(6px)'; ctx.fillRect(0, 0, 10, 10) })
    const replay = (effects?: { sx: number; sy: number }) => {
      const target = { setTransform() {}, fillRect() {} } as Record<string, unknown>
      replayAuthorCanvas(recording, target as unknown as OffscreenCanvasRenderingContext2D, () => ({}) as CanvasImageSource, [1, 0, 0, 1, 0, 0], effects)
      return [target.shadowBlur, target.filter]
    }
    expect(replay()).toEqual([12, 'blur(6px)'])
    expect(replay({ sx: .5, sy: .5 })).toEqual([6, 'blur(3px)'])
  })
})
