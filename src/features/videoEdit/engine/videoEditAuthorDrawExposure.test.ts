import { expect, it } from 'vitest'
import { AuthorCanvasAsset, recordAuthorCanvas } from './videoEditAuthorCanvasRecorder'
import { authorDrawExposure, authorFrameExposure, authorLayerSamples } from './videoEditAuthorLayers'
import { authorInterpolateRecording, authorMotionRuns, authorPaintMotion, authorSampleRecording } from './videoEditAuthorMotionOps'
import type { AuthorFrameInfo, AuthorLayer, AuthorModule } from './videoEditAuthorModule'

const measure = { reset() {}, globalCompositeOperation: 'source-over', globalAlpha: 1, measureText: () => ({ width: 10, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 10, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 0 }) } as unknown as OffscreenCanvasRenderingContext2D
const record = (draw: (ctx: OffscreenCanvasRenderingContext2D) => void) => recordAuthorCanvas({ width: 100, height: 100 }, measure, [1, 0, 0, 1, 0, 0], draw, true)
const rect = (x: number, y = 0) => record(ctx => ctx.fillRect(x, y, 10, 10))

it('比前一帧和这一帧的指令得出每个绘制动作这次曝光走的路', () => {
  const motion = authorPaintMotion(rect(50), rect(30), rect(10), .5)
  expect([...motion.moves.values()]).toEqual([[3.5, 0]])
  expect(motion.longest).toBe(3.5)
  expect(motion.deforming).toBe(false)
  expect(authorPaintMotion(rect(50), rect(50), rect(50), .5).moves.size).toBe(0)
})

it('速度不连续的不算运动：文字折行时字跳到别处不拖影，缓动减速仍然拖影', () => {
  const jump = authorPaintMotion(rect(300), rect(50), rect(50), .5)
  expect(jump.moves.size).toBe(0)
  expect([...jump.scales.values()]).toEqual([0])
  expect(authorPaintMotion(rect(0, 40), rect(90), rect(80), .5).moves.size).toBe(0)
  expect(authorPaintMotion(rect(150), rect(100), rect(30), .5).moves.size).toBe(1)
})

it('拖影不超过内容自身大小太多：字飞得再快也不拖成长线，大块内容照样长', () => {
  const small = authorPaintMotion(rect(400), rect(200), rect(0), .5)
  expect(small.longest).toBeLessThanOrEqual(5)
  const big = (x: number) => record(ctx => ctx.fillRect(x, 0, 500, 500))
  expect(authorPaintMotion(big(400), big(200), big(0), .5).longest).toBe(100)
})

it('片段开头之前算出 NaN 不影响这一帧，静止的小点不压缩别人的拖影', () => {
  const nan = authorPaintMotion(rect(50), rect(Number.NaN), undefined, .5)
  expect(nan.moves.size).toBe(0)
  expect(nan.reach).toBe(0)
  const two = (x: number) => record(ctx => { ctx.fillRect(0, 0, 2, 2); ctx.fillRect(x, 0, 100, 100) })
  expect(authorPaintMotion(two(40), two(30), undefined, .5).scales.size).toBe(0)
})

it('外插出的几何不会让重放抛错，颜色和渐变不插值', () => {
  const ring = (r: number) => record(ctx => { ctx.beginPath(); ctx.arc(0, 0, r, 0, 1); ctx.fill() })
  expect(authorInterpolateRecording(ring(10), ring(0), 2)?.ops.find(op => op[0] === 'arc')?.[3]).toBe(0)
  const tint = (color: string, x: number) => record(ctx => { ctx.fillStyle = color; ctx.fillRect(x, 0, 1, 1) })
  const mixed = authorInterpolateRecording(tint('red', 0), tint('blue', 10), .5)!
  expect(mixed.ops.find(op => op[0] === 'set')?.[2]).toBe('blue')
  expect(mixed.ops.find(op => op[0] === 'fillRect')?.[1]).toBe(5)
})

it('带阴影的内容动起来不能只糊本体', () => {
  const glow = (x: number) => record(ctx => { ctx.shadowColor = 'red'; ctx.shadowBlur = 8; ctx.fillRect(x, 0, 50, 50) })
  expect(authorPaintMotion(glow(40), glow(20), undefined, .5).deforming).toBe(true)
})

it('滚动的数字换了字形也认得出是同一个，照样拖影', () => {
  const digit = (char: string, x: number) => record(ctx => { ctx.font = '40px serif'; ctx.fillText(char, x, 0); ctx.fillText('px', x + 30, 0) })
  const motion = authorPaintMotion(digit('5', 100), digit('4', 80), digit('3', 60), .5)
  expect(motion.moves.size).toBe(2)
  expect(new Set([...motion.moves.values()].map(move => move[0])).size).toBe(1)
  const number = (text: string, x: number) => record(ctx => { ctx.font = '40px serif'; [...text].forEach((char, index) => ctx.fillText(char, x + index * 20, 0)) })
  expect(new Set([...authorPaintMotion(number('794', 100), number('789', 80), number('784', 60), .5).moves.values()].map(move => move[0]))).toEqual(new Set([10]))
})

it('同一层里字折行不动、字限长、大块内容照样走满：取样按各自的比例', () => {
  const scene = (card: number, word: number) => record(ctx => { ctx.fillRect(card, 0, 500, 500); ctx.fillRect(word, 600, 20, 20) })
  const center = scene(200, 300), previous = scene(100, 200), motion = authorPaintMotion(center, previous, undefined, .5)
  const sample = authorSampleRecording(previous, center, motion, -.5, 1)!
  expect(sample.ops[0][1]).toBe(150)
  expect(sample.ops[1][1]).toBeCloseTo(300 - 7)
  const jumped = authorSampleRecording(previous, center, { paints: motion.paints, scales: new Map([[1, 0]]) }, -.5, 1)!
  expect(jumped.ops[1][1]).toBe(300)
})

it('隔几帧或者倒放时按帧数折算成每帧的速度', () => {
  expect([...authorPaintMotion(rect(50), rect(30), undefined, .5, 2).moves.values()]).toEqual([[3.5, 0]])
  const fast = (x: number) => record(ctx => ctx.fillRect(x, 0, 500, 500))
  expect([...authorPaintMotion(fast(100), fast(0), undefined, .5, 2).moves.values()]).toEqual([[25, 0]])
  expect([...authorPaintMotion(fast(100), fast(200), undefined, .5, -2).moves.values()][0][0]).toBe(25)
  expect(authorPaintMotion(fast(100), fast(50), fast(0), .5, 1, 2).moves.size).toBe(1)
  expect(authorPaintMotion(fast(100), fast(0), fast(-40), .5, 2, 3).moves.size).toBe(1)
})

it('换一张大小悬殊的图是换画面，不拖影也不算变形', () => {
  const image = (size: number) => record(ctx => { ctx.fillStyle = 'red'; ctx.beginPath(); ctx.rect(50 - size / 2, 50 - size / 2, size, size); ctx.fill() })
  const swapped = authorPaintMotion(image(800), image(100), image(100), .5)
  expect(swapped.deforming).toBe(true)
  const picture = (key: string, size: number) => record(ctx => ctx.drawImage(new AuthorCanvasAsset(key, size, size) as unknown as CanvasImageSource, 50 - size / 2, 50 - size / 2, size, size))
  const slide = authorPaintMotion(picture('b', 800), picture('a', 100), picture('a', 100), .5)
  expect(slide.moves.size).toBe(0)
  expect(slide.deforming).toBe(false)
})

it('带位姿的图层拖影在身后：这一刻出现的要画，这一刻消失的不画', () => {
  const module: AuthorModule = { name: 'x', layers: () => [] }
  const info = { time: 1, frameDuration: .1, clip: { time: 1, duration: 9 } } as AuthorFrameInfo
  const appear: AuthorLayer = { bounds: [0, 0, 10, 10], draw() {}, pose: t => t < 1 ? null : { x: 0 } }
  expect(authorLayerSamples(appear, module, info, { x: 0, y: 0, width: 10, height: 10 }, undefined, true, 18).some(sample => sample.pose)).toBe(true)
  const leave: AuthorLayer = { bounds: [0, 0, 10, 10], draw() {}, pose: t => t >= 1 ? null : { x: 0 } }
  expect(authorLayerSamples(leave, module, info, { x: 0, y: 0, width: 10, height: 10 }, undefined, true, 18).some(sample => sample.pose)).toBe(false)
  const move: AuthorLayer = { bounds: [0, 0, 10, 10], draw() {}, pose: t => ({ x: t * 1000 }) }
  const samples = authorLayerSamples(move, module, info, { x: 0, y: 0, width: 10, height: 10 }, undefined, true, 18)
  expect(samples.length).toBeGreaterThan(1)
  expect(samples.every(sample => sample.offset.numerator / sample.offset.denominator < 0)).toBe(true)
})

it('只变颜色、走得太短都不拖影', () => {
  const faded = (alpha: number) => record(ctx => { ctx.globalAlpha = alpha; ctx.fillRect(0, 0, 10, 10) })
  expect(authorPaintMotion(faded(.9), faded(.5), faded(.2), .5).moves.size).toBe(0)
  expect(authorPaintMotion(rect(51), rect(50), rect(49), .5).moves.size).toBe(0)
})

it('错峰出现的动作也能对上：多出来的不影响后面', () => {
  const list = (first: boolean, x: number) => record(ctx => { if (first) ctx.strokeRect(0, 0, 5, 5); ctx.fillRect(x, 0, 10, 10) })
  expect([...authorPaintMotion(list(true, 50), list(false, 30), undefined, .5).moves.values()]).toEqual([[3.5, 0]])
})

it('形状尺寸变化比位移还大、绕自身旋转或动的内容被裁剪时，不能当整块平移', () => {
  const box = (w: number) => record(ctx => { ctx.beginPath(); ctx.rect(50 - w / 2, 0, w, 10); ctx.fill() })
  expect(authorPaintMotion(box(140), box(60), undefined, .5).deforming).toBe(true)
  const spun = (angle: number) => record(ctx => { ctx.translate(50, 50); ctx.rotate(angle); ctx.fillRect(-40, -40, 80, 80) })
  expect(authorPaintMotion(spun(.4), spun(0), undefined, .5).deforming).toBe(true)
  const masked = (y: number) => record(ctx => { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 100, 50); ctx.clip(); ctx.fillRect(0, y, 10, 10); ctx.restore() })
  expect(authorPaintMotion(masked(40), masked(20), undefined, .5).deforming).toBe(true)
})

it('运动段和静止段按绘制顺序切开，超过上限并进最后一段', () => {
  const moves = new Map<number, readonly [number, number]>([[1, [5, 0]], [3, [5, 0]]])
  expect(authorMotionRuns({ moves, paints: [0, 1, 2, 3] }, 8).map(run => run.moving)).toEqual([false, true, false, true])
  expect(authorMotionRuns({ moves, paints: [0, 1, 2, 3] }, 2)).toHaveLength(2)
})

it('两次录制形状相同时可以插值出中间时刻，不用再跑作者代码', () => {
  expect(authorInterpolateRecording(rect(0), rect(40), .25)?.ops[0]).toEqual(['fillRect', 10, 0, 10, 10])
  expect(authorInterpolateRecording(rect(0), rect(40), 1.25)?.ops[0]).toEqual(['fillRect', 50, 0, 10, 10])
  expect(authorInterpolateRecording(rect(0), record(ctx => { ctx.fillRect(0, 0, 1, 1); ctx.fillRect(0, 0, 1, 1) }), .5)).toBeUndefined()
})

it('运动模糊只在新作者接口、动态模块和总开关打开时启用；旧版本的画面不变', () => {
  const module: AuthorModule = { name: 'x', draw() {} }
  expect(authorDrawExposure(module, true, 18)).toMatchObject({ fraction: .5, trailing: true })
  expect(authorDrawExposure(module, true, 17)).toBeUndefined()
  expect(authorDrawExposure(module, false, 18)).toBeUndefined()
  expect(authorDrawExposure({ ...module, mode: 'static' }, true, 18)).toBeUndefined()
  expect(authorDrawExposure({ ...module, motionBlur: { shutter: 0 } }, true, 18)).toBeUndefined()
  const info = { time: 1, frameDuration: .1 } as AuthorFrameInfo
  expect(authorFrameExposure(module, info, true, 17).shutter).toBe(0)
  expect(authorFrameExposure(module, info, true, 18).shutter).toBe(180)
  expect(authorFrameExposure(module, info, true, 18).start).toBeCloseTo(.8)
})
