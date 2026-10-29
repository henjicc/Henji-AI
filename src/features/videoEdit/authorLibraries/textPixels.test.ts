import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'
import { BLACK_HEX, WHITE_HEX, VIDEO_EDIT_ANNOTATION_COLORS, STYLE_SAMPLE_COLORS } from '../../../core/theme/colorTokens'
import type * as TextLibrary from './text'
import type * as PlanLibrary from '../../../core/imaging/vectorContent/textDrawPlan'
import type * as CanvasLibrary from '../../../core/imaging/vectorContent/textDrawPlanCanvas'
import type * as AppearanceLibrary from '../../../services/vectorContent/appearance'
import type * as RecorderLibrary from '../engine/videoEditAuthorCanvasRecorder'

interface Difference { changed: number; maximum: number; mean: number }
interface StrokeLayerResult { position: 'outside' | 'inside' | 'center'; fill: boolean; difference: Difference; strokePixels: number; damagedStrokePixels: number }
let results: { resting: Difference; background: Difference; firstBackground: Difference; hiddenBackground: number; overlap: Difference; italic: Difference; sharpness: { static: number; graphemes: number }; fillDamage: number; strokeLayers: StrokeLayerResult[]; settling: Array<{ raster: number; scale: number; difference: Difference }> }

// 指令替身不能发现字素之间的覆盖或二次采样；独立无界面 Chromium 使用真实 OffscreenCanvas 读回像素。
beforeAll(async () => {
  const bundle = await build({ stdin: { contents: `export * from './src/features/videoEdit/authorLibraries/text'; export * from './src/core/imaging/vectorContent/textDrawPlan'; export * from './src/core/imaging/vectorContent/textDrawPlanCanvas'; export * from './src/services/vectorContent/appearance'; export * from './src/features/videoEdit/engine/videoEditAuthorCanvasRecorder'`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'textPixels', platform: 'browser' })
  const browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) })
  try {
    const page = await browser.newPage()
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    results = await page.evaluate(colors => {
      const { layoutText, drawText, createTextDrawPlan, canvasTextPlanMeasure, paintTextDrawPlan, paintVectorAppearance, recordAuthorCanvas, replayAuthorCanvas } = (globalThis as unknown as { textPixels: typeof TextLibrary & typeof PlanLibrary & typeof CanvasLibrary & typeof AppearanceLibrary & typeof RecorderLibrary }).textPixels
      const width = 512, height = 192
      const surface = () => new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!
      const read = (ctx: OffscreenCanvasRenderingContext2D) => ctx.getImageData(0, 0, width, height).data
      const difference = (a: Uint8ClampedArray, b: Uint8ClampedArray): Difference => {
        let changed = 0, maximum = 0, sum = 0
        for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d) changed++; maximum = Math.max(maximum, d); sum += d }
        return { changed, maximum, mean: sum / a.length }
      }
      const style = { fontFamily: 'monospace', fontSize: 64, align: 'left' as const, fill: { color: colors.white }, strokes: [{ color: colors.red, width: 2, position: 'outside' as const }], shadows: [{ color: colors.blue, opacity: .9, angle: 0, size: 0, distance: 0, blur: 16 }], background: { enabled: true, color: colors.background, opacity: .6, padding: 9, radius: 8 }, underline: true }
      const options = { forceGraphemes: true, anchor: { x: 80, y: 48, horizontal: 0, vertical: 0 } }
      const layout = layoutText('HMMH', style, options)
      const staticContext = surface(), restingContext = surface()
      drawText(staticContext, layout, { graphemes: () => ({ x: 1e-10 }) }); drawText(restingContext, layout, { graphemes: () => ({ x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 }) })
      const staticPixels = read(staticContext), restingPixels = read(restingContext)

      // 隐藏正文但显式显示整段层，与各自采样的完整底板/装饰计划逐像素核对。
      const background = surface(), expectedBackground = surface()
      drawText(background, layout, { graphemes: () => null, backgroundAndDecorationOpacity: 1 })
      const plan = createTextDrawPlan('HMMH', { ...layout.style, strokes: layout.style.strokes.map(stroke => ({ ...stroke })), shadows: layout.style.shadows.map(shadow => ({ ...shadow })) }, options, canvasTextPlanMeasure(surface()))
      const blockSurface = { width: plan.rasterBounds.width, height: plan.rasterBounds.height, resolution: 2, x: -plan.rasterBounds.x, y: -plan.rasterBounds.y }
      for (const part of ['background', 'decoration'] as const) {
        const expectedBlock = new OffscreenCanvas(plan.rasterBounds.width * 2, plan.rasterBounds.height * 2).getContext('2d')!
        expectedBlock.scale(2, 2)
        paintTextDrawPlan(expectedBlock, plan, blockSurface, paintVectorAppearance, part)
        expectedBackground.drawImage(expectedBlock.canvas, plan.rasterBounds.x, plan.rasterBounds.y, plan.rasterBounds.width, plan.rasterBounds.height)
      }
      const backgroundOnly = layoutText('HMMH', { ...style, fill: { enabled: false }, strokes: [], shadows: [], underline: false }, options)
      const firstBackground = surface(), fullBackground = surface(), hiddenBackground = surface()
      drawText(firstBackground, backgroundOnly, { graphemes: 1 })
      drawText(fullBackground, backgroundOnly, { graphemes: 0, backgroundAndDecorationOpacity: 1 })
      drawText(hiddenBackground, backgroundOnly, { graphemes: 0 })

      // 有负字距且保留极小位移，强制走图集；完整填色不能被相邻字的红描边污染。
      const overlapStyle = { ...style, tracking: -200, underline: false, background: { ...style.background, enabled: false } }
      const overlapLayout = layoutText('HMMH', overlapStyle, options)
      const overlapStatic = surface(), overlapAnimated = surface()
      for (const target of [overlapStatic, overlapAnimated]) { target.fillStyle = colors.black; target.fillRect(0, 0, width, height) }
      drawText(overlapStatic, overlapLayout)
      drawText(overlapAnimated, overlapLayout, { graphemes: () => ({ x: 1e-10 }) })
      const reference = read(overlapStatic), actual = read(overlapAnimated)
      let fillDamage = 0
      // 只选填色内部（四邻域也纯白），边缘抗锯齿差异另用整图平均误差记录。
      for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
        const at = (y * width + x) * 4
        const white = (i: number) => reference[i] === 255 && reference[i + 1] === 255 && reference[i + 2] === 255 && reference[i + 3] === 255
        if ([at, at - 4, at + 4, at - width * 4, at + width * 4].every(white) && Math.min(actual[at], actual[at + 1], actual[at + 2]) < 250) fillDamage++
      }
      overlapAnimated.clearRect(0, 0, width, height)
      overlapAnimated.fillStyle = colors.black; overlapAnimated.fillRect(0, 0, width, height)
      drawText(overlapAnimated, overlapLayout, { graphemes: () => ({}) })
      overlapStatic.clearRect(0, 0, width, height)
      overlapStatic.fillStyle = colors.black; overlapStatic.fillRect(0, 0, width, height)
      drawText(overlapStatic, overlapLayout, { graphemes: () => ({ x: 1e-10 }) })

      // 只画第一个斜体字，改变紧邻字符不应改变任何像素（不能从整行裁片）。
      const italicStyle = { fontFamily: 'monospace', fontSize: 64, fauxItalic: true, tracking: -500, align: 'left' as const }
      const italicA = surface(), italicB = surface()
      drawText(italicA, layoutText('fW', italicStyle, options), { graphemes: [0] })
      drawText(italicB, layoutText('fi', italicStyle, options), { graphemes: [0] })
      const edgeEnergy = (pixels: Uint8ClampedArray) => {
        let energy = 0
        for (let y = 0; y < height - 1; y++) for (let x = 0; x < width - 1; x++) { const i = (y * width + x) * 4 + 3; energy += (pixels[i] - pixels[i + 4]) ** 2 + (pixels[i] - pixels[i + width * 4]) ** 2 }
        return energy
      }
      const strokeLayers: StrokeLayerResult[] = []
      for (const [position, fill] of [['outside', true], ['inside', true], ['center', true], ['inside', false], ['center', false]] as const) {
        const strokeStyle = { fontFamily: 'monospace', fontSize: 32, leading: 40, align: 'left' as const, fill: { enabled: fill, color: colors.white }, strokes: [{ color: colors.red, width: position === 'outside' ? 2 : 6, position }], shadows: position === 'outside' ? style.shadows : [] }
        // 两行共用整数锚点，2× 对照排除字偶距与重采样差异；非默认透明度强制走图集。
        const laidOut = layoutText('H\nH', strokeStyle, { forceGraphemes: true, anchor: { x: 40, y: 8, horizontal: 0, vertical: 0 } })
        const whole = surface(), animated = surface()
        // 在同一黑底上比较可见 RGB，透明边缘的未预乘 RGB 误差不代表画面差异。
        for (const target of [whole, animated]) { target.fillStyle = colors.black; target.fillRect(0, 0, width, height) }
        whole.scale(2, 2); whole.globalAlpha = .999; drawText(whole, laidOut)
        animated.scale(2, 2); drawText(animated, laidOut, { graphemes: () => ({ opacity: .999 }) })
        const expected = read(whole), actual = read(animated)
        let strokePixels = 0, damagedStrokePixels = 0
        // 红色实心区域向内缩一个设备像素，避免把抗锯齿边缘当成描边丢失。
        const colored = (i: number) => expected[i] > expected[i + 1] + 100 && expected[i] > expected[i + 2] + 100 && expected[i + 3] > 250
        for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
          const at = (y * width + x) * 4
          if (![at, at - 4, at + 4, at - width * 4, at + width * 4].every(colored)) continue
          strokePixels++
          if (actual[at] <= actual[at + 1] + 100 || actual[at] <= actual[at + 2] + 100 || actual[at + 3] < 250) damagedStrokePixels++
        }
        strokeLayers.push({ position, fill, difference: difference(expected, actual), strokePixels, damagedStrokePixels })
      }
      const settling = []
      const title = layoutText('信息越多，越难判断\nAI 帮你做减法 2026', { fontFamily: 'HarmonyOS Sans SC', fontWeight: 700, fontSize: 104, leading: 136, align: 'center', fill: { color: colors.white }, strokes: [{ color: colors.red, width: 3, position: 'outside' }], background: { enabled: true, color: colors.background, opacity: .92, padding: 56, radius: 18 } }, { maxWidth: 1560, maxLines: 3, anchor: { x: 960, y: 500, horizontal: .5, vertical: .5 } })
      for (const raster of [1, 2]) for (const scale of [.5, .73, 1.125]) {
        const frames = [1e-10, 0].map(offset => {
          const matrix: [number, number, number, number, number, number] = [raster, 0, 0, raster, .25, .375]
          const recording = recordAuthorCanvas({ width: 1920, height: 1080 }, surface(), matrix, ctx => {
            ctx.scale(scale, scale)
            drawText(ctx, title, { graphemes: (_g, i) => ({ y: i === title.graphemes.length - 1 ? offset : 0 }) })
          })
          const target = new OffscreenCanvas(1920, 1080).getContext('2d')!
          replayAuthorCanvas(recording, target, () => { throw new Error('无外部素材') }, matrix)
          return target.getImageData(0, 0, 1920, 1080).data
        })
        settling.push({ raster, scale, difference: difference(frames[0], frames[1]) })
      }
      return { resting: difference(staticPixels, restingPixels), background: difference(read(background), read(expectedBackground)), firstBackground: difference(read(firstBackground), read(fullBackground)), hiddenBackground: read(hiddenBackground).reduce((sum, value) => sum + value, 0), overlap: difference(read(overlapStatic), read(overlapAnimated)), italic: difference(read(italicA), read(italicB)), sharpness: { static: edgeEnergy(staticPixels), graphemes: edgeEnergy(restingPixels) }, fillDamage, strokeLayers, settling }
    }, { white: WHITE_HEX, black: BLACK_HEX, red: VIDEO_EDIT_ANNOTATION_COLORS.red, blue: VIDEO_EDIT_ANNOTATION_COLORS.blue, background: STYLE_SAMPLE_COLORS.text })
    process.stdout.write(`文字真实 Canvas 像素指标 ${JSON.stringify(results)}\n`)
  } finally { await browser.close() }
}, 30000)

describe('逐字分层真实 Canvas 像素', () => {
  it('底板、描边、发光全开时接近落定与落定逐像素一致', () => expect(results.resting.changed).toBe(0))
  it('底板和装饰线只保留整段层，首字出现时完整显示底板', () => { expect(results.background.changed).toBe(0); expect(results.firstBackground.changed).toBe(0); expect(results.hiddenBackground).toBe(0) })
  it('揭示完成且落定时描边发光零像素差，动画期间相邻字填色内部零污染', () => { expect(results.fillDamage).toBe(0); expect(results.overlap.maximum).toBe(0) })
  it('斜体负字距隐藏邻字后无串像素', () => expect(results.italic.changed).toBe(0))
  it('1× 逐字落定的边缘能量无跳变', () => { expect(results.sharpness.static).toBeGreaterThan(0); expect(results.sharpness.graphemes / results.sharpness.static).toBe(1) })
  it('作者录制重放的运动栅格与非整数缩放下，最后字素落定不改变抗锯齿', () => {
    expect(results.settling).toHaveLength(6)
    for (const sample of results.settling) expect(sample.difference.changed, JSON.stringify(sample)).toBe(0)
  })
  it.each([['outside', true], ['inside', true], ['center', true], ['inside', false], ['center', false]] as const)('非默认透明度的 %s 描边保留整段外观顺序，填色=%s', (position, fill) => {
    const row = results.strokeLayers.find(row => row.position === position && row.fill === fill)!
    expect(row.strokePixels).toBeGreaterThan(0)
    expect(row.damagedStrokePixels).toBe(0)
    // 逐字发光的遮罩独立合成，允许黑底全图每通道平均不足一个 8 位色阶；描边实心区仍要求零缺失。
    expect(row.difference.mean).toBeLessThan(1)
  })
})
