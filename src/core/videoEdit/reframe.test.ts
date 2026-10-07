import { expect, it } from 'vitest'
import { createVideoEditDocument, videoEditDocumentSchema, type VideoEditClip } from './document'
import { copyVideoEditSequence } from './sequenceCopy'
import { evaluateVideoEditKeyframes, isVideoEditReframeKeyframe, sliceVideoEditClipKeyframes, rescaleVideoEditClipKeyframes, writeVideoEditClipKeyframes } from './keyframes'
import { generateVideoEditReframeKeyframes, smoothVideoEditAttention, videoEditReframeViewport, type VideoEditAttentionBox } from './reframe'
import { videoEditClipToFrame } from './clipGeometry'

const picture = { width: 1920, height: 1080 }; const target = { width: 1080, height: 1920 }
const settings = { motion: 'default', attention: 'face' } as const
function clip(duration = 90): VideoEditClip {
  return { id: 'clip', itemId: 'item', name: '采访', kind: 'video', track: 0, start: 30, duration, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }
}
const box = (x: number): VideoEditAttentionBox => ({ x, y: .2, width: .08, height: .25 })
it('各运动速度按强度平滑；每帧主体四角在画幅内且四个画幅角没有黑边', () => {
  const boxes = Array.from({ length: 90 }, (_, time) => box(.15 + time / 90 * .55))
  const slow = smoothVideoEditAttention(boxes, picture, target, 30, 'slow'); const fast = smoothVideoEditAttention(boxes, picture, target, 30, 'fast')
  expect(fast[15].x).toBeLessThan(slow[15].x)
  for (const motion of ['slow', 'default', 'fast'] as const) {
    const result = generateVideoEditReframeKeyframes(clip(), boxes, picture, target, 30, { ...settings, motion })
    for (let time = 0; time < boxes.length; time++) {
      const placement = { ...result, x: evaluateVideoEditKeyframes(result.curves!.x, time, 0), y: evaluateVideoEditKeyframes(result.curves!.y, time, 0), scale: evaluateVideoEditKeyframes(result.curves!.scale, time, 1) }
      const b = boxes[time]
      for (const [u, v] of [[b.x, b.y], [b.x + b.width, b.y + b.height]]) {
        const point = videoEditClipToFrame(placement, picture, target, u, v)
        expect(point.x).toBeGreaterThanOrEqual(-1e-8); expect(point.x).toBeLessThanOrEqual(1 + 1e-8)
        expect(point.y).toBeGreaterThanOrEqual(-1e-8); expect(point.y).toBeLessThanOrEqual(1 + 1e-8)
      }
      const top = videoEditClipToFrame(placement, picture, target, 0, 0); const bottom = videoEditClipToFrame(placement, picture, target, 1, 1)
      expect(top.x).toBeLessThanOrEqual(1e-8); expect(top.y).toBeLessThanOrEqual(1e-8)
      expect(bottom.x).toBeGreaterThanOrEqual(1 - 1e-8); expect(bottom.y).toBeGreaterThanOrEqual(1 - 1e-8)
    }
  }
})
it('切点重置平滑，前帧定格；切点未检测主体时独立居中，不继承前镜头位置', () => {
  const boxes = Array.from({ length: 60 }, (_, time) => box(time < 30 ? .15 : .7))
  const result = generateVideoEditReframeKeyframes(clip(60), boxes, picture, target, 30, settings, [30])
  expect(result.curves!.x!.find(point => point.time === 29)?.interpolation).toBe('hold')
  const independent = smoothVideoEditAttention(boxes.slice(30), picture, target, 30, 'default')
  expect(evaluateVideoEditKeyframes(result.curves!.x, 30, 0)).toBe(independent[0].x)
  expect(evaluateVideoEditKeyframes(result.curves!.x, 29.9, 0)).toBe(evaluateVideoEditKeyframes(result.curves!.x, 29, 0))
  const missing = smoothVideoEditAttention([...boxes.slice(0, 30), null], picture, target, 30, 'slow', [30])
  expect(missing[30].x).toBe(0)
})
it('来源标记与原值基线保护重生成、手改、同帧冲突、拆分和变速', () => {
  const boxes = Array.from({ length: 90 }, () => box(.45))
  const original = generateVideoEditReframeKeyframes(clip(), boxes, picture, target, 30, settings)
  expect(original.curves!.x!.every(isVideoEditReframeKeyframe)).toBe(true)
  const manual = { time: 0, value: 0, interpolation: 'linear' as const }
  const changed = writeVideoEditClipKeyframes(original, 'x', [manual, original.curves!.x!.at(-1)!])
  const regenerated = generateVideoEditReframeKeyframes(changed, boxes, picture, target, 30, settings)
  expect(regenerated.curves!.x![0]).toEqual(manual)
  expect(regenerated.curves!.x).toHaveLength(2)
  const edited = { ...original, curves: { ...original.curves, x: original.curves!.x!.map(point => point.time === 0 ? { ...point, value: 0 } : point) } }
  expect(isVideoEditReframeKeyframe(edited.curves.x[0])).toBe(false)
  expect(generateVideoEditReframeKeyframes(edited, boxes, picture, target, 30, settings).curves!.x![0]).toEqual(edited.curves.x[0])
  expect(sliceVideoEditClipKeyframes(original, 20, 40).curves!.x!.every(isVideoEditReframeKeyframe)).toBe(true)
  expect(rescaleVideoEditClipKeyframes(original, time => Math.round(time / 2), 45).curves!.x!.every(isVideoEditReframeKeyframe)).toBe(true)
})
it('主体装不下、超缩放、手动构图冲突整批拒绝；非中心锚点按现有几何求位置', () => {
  expect(() => videoEditReframeViewport({ width: 4000, height: 200 }, target)).toThrow('缩放范围')
  expect(() => generateVideoEditReframeKeyframes(clip(), Array(90).fill({ x: .1, y: .1, width: .8, height: .8 }), picture, target, 30, settings)).toThrow('主体超出')
  expect(() => generateVideoEditReframeKeyframes({ ...clip(), curves: { x: [{ time: 0, value: 2, interpolation: 'linear' }] } }, Array(90).fill(box(.45)), picture, target, 30, settings)).toThrow('手动运动')
  const result = generateVideoEditReframeKeyframes({ ...clip(), anchorX: .7 }, Array(90).fill(box(.45)), picture, target, 30, settings)
  expect(result.anchorX).toBe(.7); expect(result.curves!.x![0].value).toBeGreaterThan(0)
})
it('30 分钟真实帧数的静态构图只产生端点；密集切换不静默丢弃关键帧', () => {
  const result = generateVideoEditReframeKeyframes(clip(54000), Array(54000).fill(box(.45)), picture, target, 30, settings)
  expect(result.curves!.x).toHaveLength(2)
  expect(() => generateVideoEditReframeKeyframes(clip(300), Array.from({ length: 300 }, (_, frame) => box(frame % 2 ? .1 : .7)), picture, target, 30, settings, Array.from({ length: 299 }, (_, i) => i + 1))).toThrow()
})
it('序列复制重新分配所有序列内引用；媒体共享，音轨、字幕、过渡、跟随和标记保留', () => {
  const document = createVideoEditDocument('复制测试'); const sequence = document.sequences[0]
  document.media = [{ id: 'media', name: '采访', path: '/fixture/video.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 10, hasAudio: true }]
  document.items = [{ id: 'item', name: '采访', kind: 'video', mediaId: 'media' }]
  sequence.clips = [{ ...clip(), linkId: 'pair', groupId: 'group' }, { ...clip(), id: 'next', start: 120, follow: { clipId: 'clip', trackerId: 'tracker', offsetX: 0, offsetY: 0 }, linkId: 'pair', groupId: 'group' }]
  sequence.clips = sequence.clips.map(clip => ({ ...clip, track: sequence.tracks.find(track => track.kind === 'video')!.index }))
  sequence.clips.push({ ...clip(), id: 'sound', kind: 'audio', sourceComponent: 'audio', track: sequence.tracks.find(track => track.kind === 'audio')!.index, linkId: 'pair' })
  sequence.transitions = [{ id: 'transition', kind: 'cross_dissolve', leftClipId: 'clip', rightClipId: 'next', durationFrames: 10 }]
  sequence.annotations = [{ id: 'note', clipId: 'clip', frame: 40, space: 'composition-normalized', kind: 'point', x: .5, y: .5, width: 0, height: 0, text: '主体' }]
  sequence.markers = [{ id: 'marker', clipId: 'clip', frame: 40, name: '镜头' }]
  sequence.captions = [{ id: 'caption', clipId: 'clip', start: 40, duration: 20, text: '字幕' }]
  const copy = copyVideoEditSequence(sequence)
  expect(copy.id).not.toBe(sequence.id); expect(copy.clips[0].itemId).toBe('item')
  expect(copy.clips[0].linkId).toBe(copy.clips[1].linkId); expect(copy.clips[0].linkId).not.toBe('pair')
  expect(copy.clips[0].groupId).toBe(copy.clips[1].groupId)
  expect(copy.clips[1].follow!.clipId).toBe(copy.clips[0].id)
  expect(copy.clips[2]).toMatchObject({ kind: 'audio', sourceComponent: 'audio', volume: sequence.clips[2].volume, linkId: copy.clips[0].linkId })
  expect(copy.transitions![0]).toMatchObject({ kind: 'cross_dissolve', leftClipId: copy.clips[0].id, rightClipId: copy.clips[1].id, durationFrames: 10 })
  expect(copy.transitions![0].id).not.toBe('transition')
  expect(copy.annotations[0].clipId).toBe(copy.clips[0].id); expect(copy.markers![0].clipId).toBe(copy.clips[0].id); expect(copy.captions![0].clipId).toBe(copy.clips[0].id)
  expect(copy.tracks[0].id).not.toBe(sequence.tracks[0].id)
  expect(videoEditDocumentSchema.parse({ ...document, sequences: [...document.sequences, copy] })).toBeTruthy()
})
