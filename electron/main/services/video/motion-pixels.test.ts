import { beforeAll, expect, it } from 'vitest'
import { loadTrackingOpenCv } from '../local-inference/tracking/openCvTracking'
import { VideoMotionAccumulator } from './motion-pixels'
import { reviewMotionSamples } from '../../../../src/core/media/motionReview'

let cv: Awaited<ReturnType<typeof loadTrackingOpenCv>>['cv']
beforeAll(async () => { cv = (await loadTrackingOpenCv()).cv })
const width = 320, height = 180, fps = 15
function frame(tx = 0, zoom = 1): Uint8Array {
  const result = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = (x - width / 2 - tx) / zoom + width / 2, py = (y - height / 2) / zoom + height / 2
    result[y * width + x] = Math.round(128 + 40 * Math.sin(px * .19) + 40 * Math.cos(py * .23) + 20 * Math.sin((px + py) * .37))
  }
  return result
}
function analyze(frames: Uint8Array[]) {
  const analyzer = new VideoMotionAccumulator(cv, { analysis: 'motion', width, height, channels: 1, fps, startSeconds: 2, endSeconds: 2 + frames.length / fps })
  try { for (const value of frames) analyzer.push(value); return analyzer.finish() }
  finally { analyzer.dispose() }
}

it('real OpenCV estimates pan, push and a hard stop without turning compensated camera motion into local changes', () => {
  const scan = analyze(Array.from({ length: 35 }, (_, i) => frame(Math.min(i, 20) * 2)))
  const measured = scan.samples.slice(2, 19).map(sample => sample.speed!)
  expect(measured.every(value => Math.abs(value - 2 / width * fps * 100) < .6)).toBe(true)
  const report = reviewMotionSamples(scan.samples)
  expect(report.events.filter(event => event.kind === 'move')).toMatchObject([{ motion: 'pan', hardStop: true }])
  expect(report.events.filter(event => event.kind === 'change')).toEqual([])
  const pushed = analyze(Array.from({ length: 18 }, (_, i) => frame(0, 1 + i * .012)))
  expect(pushed.samples.slice(2).every(sample => sample.zoom !== null && sample.zoom > 10)).toBe(true)
  expect(reviewMotionSamples(pushed.samples).events.some(event => event.motion === 'push')).toBe(true)
})

it('distinguishes carrying drift, static reading holds and periodic movement returning to the same frame', () => {
  const carrier = analyze(Array.from({ length: 24 }, (_, i) => frame(i * .18)))
  expect(reviewMotionSamples(carrier.samples).events).toEqual([])
  expect(reviewMotionSamples(carrier.samples).stillness).toEqual([])
  const held = analyze(Array.from({ length: 35 }, () => new Uint8Array(width * height).fill(70)))
  expect(reviewMotionSamples(held.samples).stillness).toHaveLength(1)
  const periodic = analyze(Array.from({ length: 35 }, (_, i) => frame(i % 2 * 3)))
  expect(reviewMotionSamples(periodic.samples).stillness).toEqual([])
  expect(reviewMotionSamples(periodic.samples).events.some(event => event.kind === 'move')).toBe(true)
})

it('reports local popup evidence and keeps untrackable brightness changes unknown', () => {
  const popup = Array.from({ length: 24 }, (_, i) => {
    const result = frame()
    if (i >= 5 && i < 9) for (let y = 40; y < 60; y++) result.fill(255, y * width + 110, y * width + 135)
    return result
  })
  const report = reviewMotionSamples(analyze(popup).samples)
  expect(report.events.some(event => event.kind === 'change')).toBe(true)
  expect(report.events.some(event => event.kind === 'move')).toBe(false)
  const unknown = analyze(Array.from({ length: 24 }, (_, i) => new Uint8Array(width * height).fill(70 + i)))
  expect(reviewMotionSamples(unknown.samples).unknown.length).toBeGreaterThan(0)
  expect(reviewMotionSamples(unknown.samples).stillness).toEqual([])
})

it('rejects incomplete frames, incomplete source coverage and use after disposal', () => {
  const options = { analysis: 'motion' as const, width, height, channels: 1 as const, fps, startSeconds: 0, endSeconds: 1 }
  const analyzer = new VideoMotionAccumulator(cv, options)
  try { expect(() => analyzer.push(new Uint8Array(10))).toThrow('不完整'); analyzer.push(frame()); expect(() => analyzer.finish()).toThrow('完整覆盖') }
  finally { analyzer.dispose() }
  expect(() => analyzer.push(frame())).toThrow('结束')
})
