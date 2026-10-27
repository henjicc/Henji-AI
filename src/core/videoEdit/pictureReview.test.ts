import { describe, expect, it } from 'vitest'
import { videoEditJitterFacts, videoEditMotionSpeedFacts, videoEditPictureRole, videoEditSafeAreaFacts, videoEditSampleSegments, type VideoEditPictureSample } from './pictureReview'
import type { VideoEditMotionStructureFact } from './motionStructure'
import type { VideoEditClip } from './document'

const fps = 30, frame = { width: 1920, height: 1080 }
const base = { sequenceId: 'root', path: [], subjectId: 'code', basis: 'code_structure' as const, elementPath: ['title'], label: '片头 · 标题' }
const box = (x: number, y = 500, width = 400, height = 80) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
const trace = (positions: readonly number[], options: { y?: number; width?: number; height?: number } = {}): VideoEditPictureSample[] =>
  positions.map((x, frame) => ({ frame, quad: box(x, options.y, options.width, options.height), opacity: 1 }))
const hold = (x: number, frames: number): number[] => Array.from({ length: frames }, () => x)

describe('停稳文字与细线的抖动', () => {
  it('抓到指数逼近的缓动尾巴：看似停稳但每帧仍有小数像素爬动', () => {
    const positions = Array.from({ length: 90 }, (_, n) => 900 - 800 * .85 ** n)
    const facts = videoEditJitterFacts(trace(positions), fps, base, 'text')
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ kind: 'settled_jitter', elementPath: ['title'] })
    expect(facts[0].jitterPixels).toBeLessThan(.5)
    expect(facts[0].detail).toContain('爬动'); expect(facts[0].detail).toContain('“片头 · 标题”')
    expect(facts[0].timeline.from).toBeGreaterThan(10)
  })
  it('抓到停稳时在两个整像素之间来回取整的闪跳', () => {
    const positions = [...hold(600, 20), ...Array.from({ length: 30 }, (_, n) => 600 + n % 2), ...hold(600, 20)]
    const facts = videoEditJitterFacts(trace(positions), fps, base, 'line')
    expect(facts).toEqual([expect.objectContaining({ kind: 'settled_jitter', timeline: { from: 20, to: 51 }, jitterPixels: 1 })])
    expect(facts[0].detail).toContain('来回跳动')
  })
  it('正常样例不误报：精确落点的缓出、完全静止、有意的慢速漂移和看得见的浮动', () => {
    const easeOut = Array.from({ length: 20 }, (_, n) => 100 + 500 * (1 - (1 - (n + 1) / 20) ** 3))
    const samples = [
      trace([...easeOut, ...hold(600, 60)]),
      trace(hold(600, 90)),
      trace(Array.from({ length: 90 }, (_, n) => 600 + n * .3)),
      trace(Array.from({ length: 120 }, (_, n) => 600 + 6 * Math.sin(n / fps * Math.PI))),
    ]
    for (const value of samples) expect(videoEditJitterFacts(value, fps, base, 'text')).toEqual([])
  })
  it('只检查文字与细线；隐藏期间不计入', () => {
    const positions = Array.from({ length: 30 }, (_, n) => 600 + n % 2)
    expect(videoEditJitterFacts(trace(positions), fps, base, 'element')).toEqual([])
    expect(videoEditJitterFacts(trace(positions).map(sample => ({ ...sample, opacity: 0 })), fps, base, 'text')).toEqual([])
  })
  it('按文字参数或名称识别文字，按渲染后的短边识别细线', () => {
    expect(videoEditPictureRole({ id: 'node-1', name: '卡片', textParameterKeys: ['headline'] }, box(0))).toBe('text')
    expect(videoEditPictureRole({ id: 'node-2', name: '副标题', textParameterKeys: [] }, box(0))).toBe('text')
    expect(videoEditPictureRole({ id: 'node-3', name: '分隔', textParameterKeys: [] }, box(0, 0, 800, 2))).toBe('line')
    expect(videoEditPictureRole({ id: 'node-4', name: '图标', textParameterKeys: [] }, box(0, 0, 100, 100))).toBe('element')
  })
})

describe('标题与动作安全框', () => {
  const segments = (samples: VideoEditPictureSample[]) => videoEditSampleSegments(samples, frame.width, fps)
  it('停稳文字左侧越过标题安全线时报告边与越界比例', () => {
    const facts = videoEditSafeAreaFacts(segments(trace(hold(38.4, 30))), frame, fps, base, 'text')
    expect(facts).toEqual([expect.objectContaining({ kind: 'safe_area', timeline: { from: 0, to: 30 }, safeArea: { zone: 'title', edges: ['left'], overflowPercent: 3 } })])
    expect(facts[0].detail).toContain('标题安全框')
  })
  it('只看停稳时刻：从画外飞入并停在安全区内不报，停在安全区外只报停稳的那段', () => {
    const inside = [...Array.from({ length: 15 }, (_, n) => -400 + n * 40), ...hold(200, 30)]
    expect(videoEditSafeAreaFacts(segments(trace(inside)), frame, fps, base, 'text')).toEqual([])
    const outside = [...Array.from({ length: 15 }, (_, n) => -400 + n * 28), ...hold(20, 30)]
    const facts = videoEditSafeAreaFacts(segments(trace(outside)), frame, fps, base, 'text')
    expect(facts).toHaveLength(1); expect(facts[0].timeline.from).toBeGreaterThanOrEqual(14); expect(facts[0].timeline.to).toBe(45)
  })
  it('关键元素只守动作安全框；背景、出血装饰和安全区内元素不误报', () => {
    const icon = trace(hold(20, 30), { y: 900, width: 120, height: 120 })
    expect(videoEditSafeAreaFacts(segments(icon), frame, fps, { ...base, label: '图标' }, 'element')).toEqual([expect.objectContaining({ safeArea: { zone: 'action', edges: ['left'], overflowPercent: 2.5 } })])
    expect(videoEditSafeAreaFacts(segments(trace(hold(80, 30), { y: 900, width: 120, height: 120 })), frame, fps, base, 'element')).toEqual([])
    expect(videoEditSafeAreaFacts(segments(trace(hold(0, 30), { y: 0, width: 1920, height: 1080 })), frame, fps, base, 'element')).toEqual([])
    expect(videoEditSafeAreaFacts(segments(trace(hold(-60, 30), { y: 900, width: 120, height: 120 })), frame, fps, base, 'element')).toEqual([])
    expect(videoEditSafeAreaFacts(segments(trace(hold(200, 30))), frame, fps, base, 'text')).toEqual([])
  })
})

describe('运动速度对照节奏偏好', () => {
  const clip = { id: 'card', name: '标题卡' } as VideoEditClip
  const step = { sequenceId: 'root', clipId: 'card', itemId: 'item', track: 1, fps, clip }
  const motion = (peakSpeed: number, timeline = { from: 0, to: 15 }, extra: Partial<VideoEditMotionStructureFact> = {}): VideoEditMotionStructureFact => ({ kind: 'motion', sequenceId: 'root', path: [step], subjectId: 'card', basis: 'clip_transform', timeline, peakSpeed, ...extra })
  it('舒缓档对 80% 画面宽/秒的动作给出上限与拉长时长建议，常规档不报', () => {
    const facts = videoEditMotionSpeedFacts([motion(80)], 'gentle', fps)
    expect(facts).toEqual([expect.objectContaining({ kind: 'motion_too_fast', peakSpeed: 80, speedLimit: 60, timeline: { from: 0, to: 15 } })])
    expect(facts[0].detail).toContain('“标题卡”'); expect(facts[0].detail).toContain('约 0.7 秒')
    expect(videoEditMotionSpeedFacts([motion(80)], 'standard', fps)).toEqual([])
    expect(videoEditMotionSpeedFacts([motion(140)], 'brisk', fps)).toEqual([])
  })
  it('原视频运动、单帧跳位不算；同一片段同段动作只报最快的图层', () => {
    expect(videoEditMotionSpeedFacts([motion(300, undefined, { basis: 'video_pixels' }), motion(300, { from: 4, to: 6 })], 'gentle', fps)).toEqual([])
    const facts = videoEditMotionSpeedFacts([motion(90, undefined, { basis: 'code_structure', elementPath: ['a'] }), motion(120, undefined, { basis: 'code_structure', elementPath: ['b'] })], 'gentle', fps)
    expect(facts).toEqual([expect.objectContaining({ elementPath: ['b'], peakSpeed: 120 })])
  })
})
