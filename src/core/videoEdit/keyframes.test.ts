import { createVideoEditTestDocument as createVideoEditDocument } from './testFixtures'
import { expect, it } from 'vitest'
import { videoEditComposition, videoEditDocumentSchema, splitVideoEditClip, changeVideoEditSequenceSettings, type VideoEditClip } from './document'
import { evaluateVideoEditClip, evaluateVideoEditKeyframes, sliceVideoEditCurves, videoEditKeyframesSchema, type VideoEditKeyframes } from './keyframes'
import { videoEditClipCenterPosition, videoEditClipToFrame, videoEditFrameToClip } from './clipGeometry'
import { applyVideoEditRateStretch } from './clipSpeedEdits'
import { defaultVideoEditTextStyle } from './text'
import { BLACK_HEX, WHITE_HEX } from '../theme/colorTokens'
import { codeCubicBezier } from './codeMaterial/motion'

const curve = (interpolation: 'linear' | 'hold' | 'ease'): VideoEditKeyframes => [{ time: 0, value: 0, interpolation }, { time: 100, value: 1, interpolation }]
it('自定义贝塞尔反求时间，允许过冲；修剪与再次修剪保留原曲线（含等值端点）', () => {
  const points: VideoEditKeyframes = [{ time: 0, value: 0, interpolation: 'bezier', bezier: [.2, 2, .8, -1] }, { time: 100, value: 1, interpolation: 'linear' }]
  expect(evaluateVideoEditKeyframes(points, 25, 0)).toBeCloseTo(codeCubicBezier(.2, 2, .8, -1, .25), 8)
  const sliced = sliceVideoEditCurves({ opacity: points }, 20, 61)!.opacity
  const again = sliceVideoEditCurves({ opacity: sliced }, 10, 40)!.opacity
  for (let time = 0; time <= 39; time += .25) expect(evaluateVideoEditKeyframes(again, time, 0)).toBeCloseTo(evaluateVideoEditKeyframes(points, time + 30, 0), 7)
  expect(videoEditKeyframesSchema.parse(again)).toEqual(again)
  const equal: VideoEditKeyframes = [{ time: 0, value: 0, interpolation: 'bezier', bezier: [1 / 3, 3, 2 / 3, -2] }, { time: 100, value: 1, interpolation: 'linear' }]
  const equalSlice = sliceVideoEditCurves({ x: equal }, 25, 76)!.x
  for (let time = 0; time <= 75; time += .5) expect(evaluateVideoEditKeyframes(equalSlice, time, 0)).toBeCloseTo(evaluateVideoEditKeyframes(equal, time + 25, 0), 7)
  expect(() => videoEditKeyframesSchema.parse([{ ...points[0], easeRange: [.25, 1] }])).toThrow('easeValues')
  expect(() => videoEditKeyframesSchema.parse([{ ...points[0], bezier: [-.1, 0, 1, 1] }])).toThrow()
  expect(() => videoEditKeyframesSchema.parse([{ ...points[0], bezier: [0, Infinity, 1, 1] }])).toThrow()
  const colors: VideoEditKeyframes = [{ time: 0, value: BLACK_HEX, interpolation: 'bezier', bezier: [.2, 3, .8, 3] }, { time: 10, value: WHITE_HEX, interpolation: 'linear' }]
  expect(evaluateVideoEditKeyframes(colors, 5, '')).toBe(WHITE_HEX)
  expect(evaluateVideoEditKeyframes([{ time: 0, value: `${BLACK_HEX}00`, interpolation: 'linear' }, { time: 10, value: `${WHITE_HEX}ff`, interpolation: 'linear' }], 5, '')).toBe(`${BLACK_HEX.slice(0, 1)}80808080`)
})
function fixture(): ReturnType<typeof createVideoEditDocument> {
  const document = createVideoEditDocument('关键帧')
  document.items.push({ id: 'item', kind: 'text', name: '标题' })
  document.sequences[0].clips.push({ id: 'clip', itemId: 'item', kind: 'text', name: '标题', start: 0, duration: 101, track: document.sequences[0].tracks.find(track => track.kind === 'video')!.index, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, text: '标题', curves: { opacity: curve('ease') } })
  return document
}

it('过冲在消费范围内夹取，拆分后仍可保存且与原曲线逐帧一致', () => {
  const document = fixture(); const original = document.sequences[0].clips[0]
  original.curves = { opacity: [{ time: 0, value: 0, interpolation: 'bezier', bezier: [1 / 3, 3, 2 / 3, 3] }, { time: 100, value: 1, interpolation: 'linear' }] }
  original.effects = [{ id: 'blur', name: '模糊', enabled: true, amount: 1, builtin: { id: 'gaussian_blur', params: {}, curves: { sigma_fraction_height: [{ ...original.curves.opacity![0], value: 0 }, { time: 100, value: 100, interpolation: 'linear' }] } } }]
  expect(evaluateVideoEditClip(original, 50).opacity).toBe(1)
  const sequence = splitVideoEditClip(document.sequences[0], 'clip', 50)
  expect(videoEditDocumentSchema.parse({ ...document, sequences: [sequence] })).toBeTruthy()
  for (let frame = 0; frame <= 100; frame++) {
    const clipped = evaluateVideoEditClip(sequence.clips[frame < 50 ? 0 : 1], frame)
    const before = evaluateVideoEditClip(original, frame)
    expect(clipped.opacity).toBeCloseTo(before.opacity, 7)
    expect(clipped.effects![0].builtin!.params.sigma_fraction_height).toBeCloseTo(Number(before.effects![0].builtin!.params.sigma_fraction_height), 5)
  }
  sequence.clips[1].curves!.opacity![0].easeValues = [0, 99]
  expect(() => videoEditDocumentSchema.parse({ ...document, sequences: [sequence] })).toThrow()
})
it('停用固有分区按默认渲染，保存参数和关键帧，再打开恢复', () => {
  const clip = fixture().sequences[0].clips[0]
  Object.assign(clip, { x: .4, y: .2, scale: 2, rotation: 45, anchorX: .1, anchorY: .9, opacity: .5, volume: .2, disabledIntrinsicSections: ['motion', 'opacity', 'audio', 'text', 'textStyle'] })
  clip.textStyle = { ...defaultVideoEditTextStyle(1080), fontSize: 100 }
  const before = structuredClone(clip)
  const evaluated = evaluateVideoEditClip(clip, 25)
  expect(evaluated).toMatchObject({ x: 0, y: 0, scale: 1, rotation: 0, anchorX: .5, anchorY: .5, opacity: 1, volume: 1, text: '' })
  expect(evaluated.textStyle).toBeUndefined(); expect(clip).toEqual(before)
  const restored = evaluateVideoEditClip({ ...clip, disabledIntrinsicSections: [] }, 25)
  expect(restored.x).toBe(.4); expect(restored.opacity).toBe(.15625); expect(restored.text).toBe('标题')
  expect(restored.textStyle?.fontSize).toBe(100)
})
it('文档拒绝片段固有亮度及其关键帧，内置亮度效果仍可保存', () => {
  const document = fixture(); const clip = document.sequences[0].clips[0]
  const withClip = (value: unknown) => ({ ...document, sequences: [{ ...document.sequences[0], clips: [value] }] })
  expect(videoEditDocumentSchema.safeParse(withClip({ ...clip, brightness: 1 })).success).toBe(false)
  expect(videoEditDocumentSchema.safeParse(withClip({ ...clip, curves: { brightness: curve('linear') } })).success).toBe(false)
  clip.effects = [{ id: 'brightness-effect', name: '亮度与对比度', enabled: true, amount: 1, builtin: { id: 'brightness_contrast', params: { brightness: 25 } } }]
  expect(videoEditDocumentSchema.parse(document).sequences[0].clips[0].effects![0].builtin!.params.brightness).toBe(25)
})
it('集中插值支持边界、线性、定格、固定三次贝塞尔；拒绝乱序/重复', () => {
  for (const interpolation of ['linear', 'hold', 'ease'] as const) {
    expect(evaluateVideoEditKeyframes(curve(interpolation), -5, 5)).toBe(0)
    expect(evaluateVideoEditKeyframes(curve(interpolation), 100, 5)).toBe(1)
  }
  expect(evaluateVideoEditKeyframes(curve('linear'), 25, 0)).toBe(.25)
  expect(evaluateVideoEditKeyframes(curve('hold'), 99.99, 0)).toBe(0)
  expect(evaluateVideoEditKeyframes(curve('ease'), 25, 0)).toBe(.15625)
  expect(evaluateVideoEditKeyframes(undefined, 25, 8)).toBe(8)
  expect(() => videoEditKeyframesSchema.parse([...curve('linear')].reverse())).toThrow('升序')
  expect(() => videoEditKeyframesSchema.parse([curve('linear')[0], curve('linear')[0]])).toThrow('重复')
  const full = Array.from({ length: 256 }, (_, time) => ({ time, value: time / 255, interpolation: 'linear' as const }))
  expect(videoEditKeyframesSchema.parse(sliceVideoEditCurves({ opacity: full }, -10, 300)!.opacity)).toHaveLength(256)
})
it('拆分/修剪保留线性、定格和缓动区间的逐帧值（含再次修剪）', () => {
  for (const interpolation of ['linear', 'hold', 'ease'] as const) {
    const points = curve(interpolation)
    const sliced = sliceVideoEditCurves({ opacity: points }, 25, 50)!.opacity
    const again = sliceVideoEditCurves({ opacity: sliced }, 10, 25)!.opacity
    for (let time = 0; time <= 24; time += .25) expect(evaluateVideoEditKeyframes(again, time, 0)).toBeCloseTo(evaluateVideoEditKeyframes(points, time + 35, 0), 12)
  }
  const doc = fixture(); const sequence = splitVideoEditClip(doc.sequences[0], 'clip', 40)
  for (let frame = 0; frame < 101; frame++) {
    const clip = sequence.clips[frame < 40 ? 0 : 1]
    expect(evaluateVideoEditClip(clip, frame).opacity).toBeCloseTo(evaluateVideoEditClip(doc.sequences[0].clips[0], frame).opacity, 12)
  }
})
it('旧文件兼容；片内时间、值、内置效果参数与插值受文档验证', () => {
  const doc = fixture(); expect(videoEditDocumentSchema.parse(doc)).toBeTruthy()
  const clip = doc.sequences[0].clips[0]
  clip.curves!.opacity![1].time = 101
  expect(() => videoEditDocumentSchema.parse(doc)).toThrow('0–100')
  delete clip.curves
  expect(videoEditDocumentSchema.parse(doc).sequences[0].clips[0].anchorX).toBeUndefined()
  clip.effects = [{ id: 'color_grade', name: '调色', enabled: true, amount: 1, builtin: { id: 'color_grade', params: {}, curves: { exposure: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 100, value: 2, interpolation: 'ease' }] } } }]
  const result = evaluateVideoEditClip(clip, 50)
  expect(result.effects![0].builtin!.params.exposure).toBe(1)
  expect(clip.effects[0].builtin!.params).toEqual({})
  clip.effects[0].builtin!.curves!.exposure[1].value = 500
  expect(() => videoEditDocumentSchema.parse(doc)).toThrow('曝光')
})
it('帧率与比率拉伸按新帧网格重定位关键帧，冲突去重不越界', () => {
  const doc = fixture(); const sequence = doc.sequences[0]
  const changed = changeVideoEditSequenceSettings(sequence, { frameRate: { numerator: 24, denominator: 1 } })
  expect(changed.clips[0].curves!.opacity!.at(-1)!.time).toBeLessThan(changed.clips[0].duration)
  const phase = fixture().sequences[0]
  phase.clips[0] = { ...phase.clips[0], start: 1, curves: { x: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 2, value: 1, interpolation: 'linear' }] } }
  expect(changeVideoEditSequenceSettings(phase, { frameRate: { numerator: 24, denominator: 1 } }).clips[0].curves!.x![1].time).toBe(1)
  doc.media = [{ id: 'media', name: '视频', path: '/video.mp4', kind: 'video', width: 10, height: 10, durationSeconds: 10 }]
  doc.items[0] = { id: 'item', name: '视频', kind: 'video', mediaId: 'media' }; sequence.clips[0].kind = 'video'
  const stretched = applyVideoEditRateStretch(doc, sequence.id, ['clip'], 'out', -51).sequence.clips[0]
  expect(stretched.duration).toBe(50); expect(stretched.curves!.opacity!.at(-1)!.time).toBe(49)
  expect(videoEditComposition(doc, sequence.id)).toBeTruthy()
})
it('锚点参与同一几何；跟随上的关键帧为偏移与缩放乘数', () => {
  const clip: VideoEditClip = fixture().sequences[0].clips[0]
  const placement = { ...clip, anchorX: 0, anchorY: 0, rotation: 90 }
  const size = { width: 100, height: 100 }
  expect(videoEditClipCenterPosition(placement, size, size).x).toBeCloseTo(-.5)
  expect(videoEditClipCenterPosition(placement, size, size).y).toBeCloseTo(.5)
  const at = videoEditClipToFrame(placement, size, size, .2, .3)
  const back = videoEditFrameToClip(placement, size, size, at.x, at.y)
  expect(back.u).toBeCloseTo(.2); expect(back.v).toBeCloseTo(.3)
  clip.follow = { clipId: 'other', trackerId: 'tracker', offsetX: 0, offsetY: 0 }
  clip.x = .2; clip.scale = 2; clip.curves = { x: [{ time: 0, value: .1, interpolation: 'linear' }], scale: [{ time: 0, value: .5, interpolation: 'linear' }] }
  expect(evaluateVideoEditClip(clip, 0).x).toBeCloseTo(.3)
  expect(evaluateVideoEditClip(clip, 0).scale).toBe(1)
})
