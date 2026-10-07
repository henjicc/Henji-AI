import { describe, expect, it } from 'vitest'
import { assertVideoEditAnnotationTransition, videoEditAnnotationSchema, type VideoEditAnnotation } from './annotations'
import { createVideoEditTestDocument } from './testFixtures'
import { changeVideoEditSequenceSettings, splitVideoEditClip, videoEditDocumentSchema, type VideoEditClip } from './document'
import { retimeVideoEditAnnotations } from './timelineTrims'
import { copyVideoEditSequence } from './sequenceCopy'
import { reconcileVideoEditTimedContent } from './timedContent'
import { applyVideoEditTimelineEdit, copyVideoEditClips } from './timelineEdits'

export function annotation(input: Partial<VideoEditAnnotation> = {}): VideoEditAnnotation {
  return videoEditAnnotationSchema.parse({ id: 'note', frame: 20, space: 'composition-normalized', target: { kind: 'point', x: .4, y: .3 }, text: '把标题移到这里', status: 'open', author: { kind: 'user', name: '我' }, createdAt: '2026-10-08T00:00:00.000Z', thread: [], ...input })
}
const reply = { id: 'reply', author: { kind: 'assistant' as const, name: '助手' }, createdAt: '2026-10-08T01:00:00.000Z', text: '移动了标题，撤销本次修改可恢复。' }
describe('标注状态与目标', () => {
  it('五种目标可写，错误矩形、时间段和元素定位均拒绝', () => {
    for (const target of [{ kind: 'point', x: .5, y: .5 }, { kind: 'region', x: .2, y: .2, width: .3, height: .4 }, { kind: 'stroke', strokes: [[{ x: .2, y: .3 }], [{ x: .4, y: .5 }]] }, { kind: 'element', elementId: 'headline', sourceSpan: { start: 5, end: 15 } }, { kind: 'range', startFrame: 20, endFrame: 30 }]) expect(videoEditAnnotationSchema.safeParse({ ...annotation(), target, clipId: 'clip', ...(target.kind === 'range' ? { endFrame: 30 } : {}) }).success).toBe(true)
    expect(() => annotation({ target: { kind: 'region', x: .8, y: .2, width: .3, height: .4 } })).toThrow('画幅')
    expect(() => annotation({ target: { kind: 'element', elementId: 'headline' } })).toThrow('片段')
    expect(() => annotation({ target: { kind: 'range', startFrame: 20, endFrame: 30 }, endFrame: 40 })).toThrow('一致')
  })
  it('草稿→待处理→待审查→用户通过；拒绝Agent通过、回退草稿和覆盖讨论', () => {
    const draft = annotation({ status: 'draft' }); const open = { ...draft, status: 'open' as const }
    const addressed = annotation({ status: 'addressed', addressedBy: { revision: 2 }, thread: [reply] }); const resolved = { ...addressed, status: 'resolved' as const }
    expect(() => assertVideoEditAnnotationTransition(draft, open, 'user')).not.toThrow()
    expect(() => assertVideoEditAnnotationTransition(open, addressed, 'agent')).not.toThrow()
    expect(() => assertVideoEditAnnotationTransition(addressed, resolved, 'agent')).toThrow('只有用户')
    expect(() => assertVideoEditAnnotationTransition(addressed, resolved, 'user')).not.toThrow()
    expect(() => assertVideoEditAnnotationTransition(resolved, open, 'user')).not.toThrow()
    expect(() => assertVideoEditAnnotationTransition(open, draft, 'agent')).toThrow('转换')
    expect(() => assertVideoEditAnnotationTransition(addressed, { ...addressed, thread: [] }, 'agent')).toThrow('追加')
    expect(() => annotation({ status: 'addressed' })).toThrow('回复')
  })
})
it('拆分、序列变帧率、200%变速和倒放都跟随完整标注范围；未绑定片段的画面标注保留', () => {
  const document = createVideoEditTestDocument('标注测试'); const sequence = document.sequences[0]
  const clip: VideoEditClip = { id: 'clip', itemId: 'item', name: '片段', kind: 'video', track: 1, start: 0, duration: 100, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }
  sequence.frameRate = { numerator: 60, denominator: 1 }
  sequence.clips = [clip]; sequence.annotations = [annotation({ clipId: clip.id }), annotation({ id: 'range', frame: 10, endFrame: 80, clipId: clip.id, target: { kind: 'range', startFrame: 10, endFrame: 80 } }), annotation({ id: 'unbound', frame: 5 })]
  const split = splitVideoEditClip(sequence, clip.id, 15)
  expect(split.annotations[0].clipId).toBe(split.clips[1].id)
  expect(split.annotations[1]).toMatchObject({ clipId: undefined, frame: 10, endFrame: 80, target: { clipIds: [clip.id, split.clips[1].id] } })
  const elementSplit = splitVideoEditClip({ ...sequence, clips: [{ ...clip, kind: 'code' }], annotations: [annotation({ clipId: clip.id, frame: 10, endFrame: 80, target: { kind: 'element', elementId: 'title' } })] }, clip.id, 15)
  expect(elementSplit.annotations).toHaveLength(2); expect(elementSplit.annotations[0]).toMatchObject({ frame: 10, endFrame: 14, clipId: clip.id }); expect(elementSplit.annotations[1]).toMatchObject({ frame: 15, endFrame: 80, clipId: elementSplit.clips[1].id })
  const rate = changeVideoEditSequenceSettings(sequence, { frameRate: { numerator: 30, denominator: 1 } })
  expect(rate.annotations[1]).toMatchObject({ frame: 5, endFrame: 40, target: { startFrame: 5, endFrame: 40 } })
  const fast = retimeVideoEditAnnotations(sequence, [{ ...clip, duration: 50, speed: { numerator: 2, denominator: 1 } }], 60)
  expect(fast[0].frame).toBe(10); expect(fast[1]).toMatchObject({ frame: 5, endFrame: 40, target: { startFrame: 5, endFrame: 40 } }); expect(fast[2].frame).toBe(5)
  const reversed = retimeVideoEditAnnotations(sequence, [{ ...clip, reverse: true, sourceInUs: Math.round(100 / 60 * 1e6) }], 60)
  expect(reversed[0].frame).toBe(79); expect(reversed[1]).toMatchObject({ frame: 19, endFrame: 89 })
  const raw = reconcileVideoEditTimedContent(document, { ...document, sequences: [{ ...sequence, clips: [{ ...clip, start: 30, duration: 50, speed: { numerator: 2, denominator: 1 } }] }] })
  expect(raw.sequences[0].annotations[0].frame).toBe(40); expect(raw.sequences[0].annotations[1]).toMatchObject({ frame: 35, endFrame: 70 })
})

it('复制范围标注随粘贴重映射目标片段和轨道，剪切后也不依赖原标注仍在序列里', () => {
  const document = createVideoEditTestDocument('复制标注'); const sequence = document.sequences[0]
  const item = { id: 'item', name: '标题', kind: 'text' as const, text: '标题', binId: '' }; document.items.push(item)
  const clip: VideoEditClip = { id: 'clip', itemId: item.id, name: '标题', kind: 'text', track: 1, start: 0, duration: 100, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, text: '标题' }
  sequence.clips = [clip]; sequence.annotations = [annotation({ frame: 10, endFrame: 50, target: { kind: 'range', startFrame: 10, endFrame: 50, clipIds: [clip.id], trackIds: [sequence.tracks.find(track => track.index === 1)!.id] } })]
  const clipboard = copyVideoEditClips(document, sequence.id, [clip.id]); sequence.clips = []; sequence.annotations = []
  const pasted = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'place', mode: 'paste', frame: 120, clipboard })
  expect(pasted.annotations[0]).toMatchObject({ frame: 130, endFrame: 170, target: { clipIds: [pasted.clips[0].id], trackIds: [sequence.tracks.find(track => track.index === 1)!.id] } })
})
it('序列复制重映射标注的片段与轨道，不继承原运行撤销关联；元素必须属于代码片段', () => {
  const document = createVideoEditTestDocument('标注测试'); const sequence = document.sequences[0]
  sequence.annotations = [annotation({ frame: 0, endFrame: 5, target: { kind: 'range', startFrame: 0, endFrame: 5, trackIds: [sequence.tracks[0].id] } })]
  const copy = copyVideoEditSequence(sequence)
  expect(copy.annotations[0].target).toMatchObject({ trackIds: [copy.tracks[0].id] })
  sequence.annotations = [annotation({ clipId: 'missing', target: { kind: 'element', elementId: 'headline' } })]
  expect(() => videoEditDocumentSchema.parse(document)).toThrow('片段')
})
