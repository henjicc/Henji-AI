import { createVideoEditTestDocument as createVideoEditDocument } from './testFixtures'
import { expect, it } from 'vitest'
import { createVideoEditSequence, videoEditComposition, videoEditDocumentSchema, type VideoEditClip } from './document'
import { makeVideoEditItemClip } from './projectItems'
import { ensureVideoEditSequenceItem, nestVideoEditClips, videoEditNestedFrame } from './nestedSequences'
import { assertVideoEditSequenceGraph } from './sequenceGraph'
import { videoEditMatchFrameTarget } from './matchFrame'
import { videoEditAnnotationSchema } from './annotations'
import { videoEditTextMediaIdentity, videoEditTranscriptWords } from './textTranscript'

function fixture() {
  const document = createVideoEditDocument('嵌套'); const sequence = document.sequences[0]
  document.media = [{ id: 'media', name: '镜头', kind: 'video', path: '/fixture/shot.mp4', width: 64, height: 64, durationSeconds: 20 }]
  document.items = [{ id: 'item', name: '镜头', kind: 'video', mediaId: 'media' }]
  const track = sequence.tracks.find(track => track.kind === 'video')!.index
  sequence.clips = [{ ...makeVideoEditItemClip(document, 'item', sequence.id, { frame: 30, duration: 60, track }), id: 'a' }]
  return document
}
it('嵌套保存所选素材的词源，源微秒不平移；子序列单独读取与保存重开结果一致', () => {
  const document = fixture(), parent = document.sequences[0]
  parent.clips.push({ ...parent.clips[0], id: 'outside', itemId: 'other', start: 120 })
  document.items.push({ ...document.items[0], id: 'other' })
  const composition = videoEditComposition(document, parent.id)
  parent.textTranscription = { audioDocumentId: 'recognition', sources: ['item', 'other'].map(itemId => ({ itemId,
    mediaIdentity: videoEditTextMediaIdentity(composition, itemId), silences: [{ startFrame: 1_500_000, endFrame: 1_700_000 }],
    blocks: [{ id: 'word', text: '保留', startFrame: 0, endFrame: 1_000_000, included: true, locked: false, granularity: 'word' }],
  })) }
  const result = nestVideoEditClips(document, parent.id, ['a'], '子序列')
  expect(result.sequence.textTranscription?.sources).toEqual([parent.textTranscription.sources[0]])
  const reopened = videoEditDocumentSchema.parse(JSON.parse(JSON.stringify(result.document)))
  expect(videoEditTranscriptWords(videoEditComposition(reopened, result.sequence.id))).toMatchObject([{ text: '保留', from: 0, to: 30 }])
  expect(videoEditTranscriptWords(videoEditComposition(reopened, parent.id))).toMatchObject([{ text: '保留', from: 30, to: 60 }, { text: '保留', from: 120, to: 150 }])
  expect(parent.textTranscription.sources).toHaveLength(2)
})
it.each(['range', 'point'] as const)('嵌套同步平移 %s 标注的两端与目标', kind => {
  const document = fixture(); const parent = document.sequences[0]
  parent.annotations = [videoEditAnnotationSchema.parse({ id: 'note', clipId: 'a', frame: 40, endFrame: 70, space: 'composition-normalized',
    target: kind === 'range' ? { kind, startFrame: 40, endFrame: 70, clipIds: ['a'] } : { kind, x: .5, y: .5 },
    text: '修改这段', status: 'open', author: { kind: 'user', name: '我' }, createdAt: '2026-10-13T00:00:00.000Z', thread: [] })]
  const result = nestVideoEditClips(document, parent.id, ['a'], '子序列')
  expect(result.sequence.annotations[0]).toMatchObject({ frame: 10, endFrame: 40 })
  if (kind === 'range') expect(result.sequence.annotations[0].target).toMatchObject({ startFrame: 10, endFrame: 40, clipIds: ['a'] })
  expect(() => videoEditDocumentSchema.parse(result.document)).not.toThrow()
})
it('嵌套范围标注只引用子序列中的片段和新轨道', () => {
  const document = fixture(); const parent = document.sequences[0]
  parent.clips.push({ ...parent.clips[0], id: 'outside', start: 120 })
  const track = parent.tracks.find(track => track.index === parent.clips[0].track)!
  parent.annotations = [videoEditAnnotationSchema.parse({ id: 'note', clipId: 'a', frame: 40, endFrame: 70, space: 'composition-normalized',
    target: { kind: 'range', startFrame: 40, endFrame: 70, clipIds: ['a', 'outside'], trackIds: [track.id] },
    text: '修改这段', status: 'open', author: { kind: 'user', name: '我' }, createdAt: '2026-10-13T00:00:00.000Z', thread: [] })]
  const result = nestVideoEditClips(document, parent.id, ['a'], '子序列')
  expect(result.sequence.annotations[0].target).toMatchObject({ clipIds: ['a'], trackIds: [result.sequence.tracks.find(value => value.index === track.index)!.id] })
  expect(() => videoEditDocumentSchema.parse(result.document)).not.toThrow()
})
it('旧文件无需序列素材字段；嵌套保持源时钟与锚点，仅在父序列替换选区', () => {
  const document = fixture(); const parent = document.sequences[0]
  expect(videoEditDocumentSchema.parse(document)).toEqual(document)
  parent.clips[0].sourceInUs = 5_000_000
  parent.clips[0].speed = { numerator: 2, denominator: 1 }; parent.clips[0].reverse = true
  parent.markers = [{ id: 'marker', clipId: 'a', frame: 40, name: '重点' }]
  parent.captions = [{ id: 'caption', clipId: 'a', start: 40, duration: 10, text: '对白' }]
  parent.captionTrackEnabled = false
  const result = nestVideoEditClips(document, parent.id, ['a'], '子序列')
  expect(result.sequence.clips[0]).toMatchObject({ id: 'a', start: 0, sourceInUs: 5_000_000, reverse: true, speed: { numerator: 2, denominator: 1 } })
  expect(result.sequence.markers?.[0].frame).toBe(10); expect(result.sequence.captions?.[0].start).toBe(10)
  expect(result.sequence.captionTrackEnabled).toBe(false)
  expect(result.document.sequences[0].clips).toEqual([result.clip])
  expect(result.clip).toMatchObject({ kind: 'sequence', start: 30, duration: 60, sourceInUs: 0 })
  expect(document.sequences[0].clips[0].id).toBe('a')
  const placed = makeVideoEditItemClip(result.document, result.clip.itemId, parent.id, { frame: 150 })
  expect(placed.duration).toBe(60)
  expect(ensureVideoEditSequenceItem(result.document, result.sequence.id).itemId).toBe(result.clip.itemId)
})
it('变速、倒放与不同帧率统一换算；F 与渲染使用同一子帧', () => {
  const document = fixture(); const result = nestVideoEditClips(document, document.sequences[0].id, ['a'], '子序列')
  const parent = result.document.sequences[0]; const child = result.document.sequences[1]
  child.frameRate = { numerator: 60, denominator: 1 }; child.clips[0].duration = 120
  const clip: VideoEditClip = { ...result.clip, sourceInUs: 2_000_000, duration: 30, speed: { numerator: 2, denominator: 1 }, reverse: true }
  parent.clips = [clip]
  const composition = videoEditComposition(result.document, parent.id)
  const inner = videoEditComposition(result.document, child.id)
  expect(videoEditNestedFrame(composition, clip, inner, 30)).toBe(116)
  expect(videoEditNestedFrame(composition, clip, inner, 40)).toBe(76)
  expect(videoEditNestedFrame(composition, clip, inner, 40.125, true)).toBeCloseTo(75.5)
  expect(videoEditNestedFrame(composition, clip, inner, 40.125)).toBe(75)
  expect(videoEditMatchFrameTarget(result.document, parent, { clipIds: [clip.id], frame: 40, targetTracks: [] })).toMatchObject({ sequenceId: child.id, frame: 76 })
})
it('循环带路径拒绝，共享 DAG 合法，超过八层拒绝', () => {
  const document = fixture(); const result = nestVideoEditClips(document, document.sequences[0].id, ['a'], '子序列')
  const parent = result.document.sequences[0]; parent.name = '父序列'
  const child = result.document.sequences[1]
  result.document.items.push({ id: 'back', name: '父', kind: 'sequence', sequenceId: parent.id })
  child.clips.push({ ...result.clip, id: 'cycle', itemId: 'back', start: 60 })
  expect(() => assertVideoEditSequenceGraph(result.document)).toThrow('父序列 → 子序列 → 父序列')
  expect(videoEditDocumentSchema.safeParse(result.document).success).toBe(false)
  child.clips.pop()
  const other = createVideoEditSequence('另一父序列'); other.clips = [{ ...result.clip, id: 'other' }]
  result.document.sequences.push(other); expect(() => assertVideoEditSequenceGraph(result.document)).not.toThrow()
  const chain = Array.from({ length: 9 }, (_, index) => ({ id: `s${index}`, name: `层${index}`, clips: index === 8 ? [] : [{ kind: 'sequence', itemId: `i${index}` }] }))
  expect(() => assertVideoEditSequenceGraph({ sequences: chain, items: chain.slice(0, -1).map((_, index) => ({ id: `i${index}`, kind: 'sequence', sequenceId: `s${index + 1}` })) })).toThrow('超过 8 层')
})
it('锁轨与跨边界过渡在变换前拒绝', () => {
  const document = fixture(); const parent = document.sequences[0]
  parent.tracks.find(track => track.index === parent.clips[0].track)!.locked = true
  expect(() => nestVideoEditClips(document, parent.id, ['a'], '子')).toThrow()
  parent.tracks.forEach(track => { track.locked = false })
  parent.clips.push({ ...parent.clips[0], id: 'b', start: 90 })
  parent.transitions = [{ id: 'transition', kind: 'cross_dissolve', leftClipId: 'a', rightClipId: 'b', durationFrames: 10 }]
  expect(() => nestVideoEditClips(document, parent.id, ['a'], '子')).toThrow('过渡两侧')
  expect(nestVideoEditClips(document, parent.id, ['a', 'b'], '子').sequence.transitions).toEqual(parent.transitions)
})
it('轨道隐藏、静音或独奏会改变替换结果时拒绝嵌套', () => {
  const document = fixture(); const parent = document.sequences[0]; const picture = parent.clips[0]
  parent.clips.push({ ...picture, id: 'sound', kind: 'audio', track: parent.tracks.find(track => track.kind === 'audio')!.index })
  parent.tracks.find(track => track.index === picture.track)!.muted = true
  expect(() => nestVideoEditClips(document, parent.id, ['a', 'sound'], '子')).toThrow('静音或独奏')
  parent.tracks.find(track => track.index === picture.track)!.muted = false
  parent.tracks.find(track => track.kind === 'audio')!.solo = true
  expect(() => nestVideoEditClips(document, parent.id, ['a', 'sound'], '子')).toThrow('静音或独奏')
})
it('缩短子序列不改变父剪辑长度，子序列空白尾段保持对应帧时钟', () => {
  const document = fixture(); const result = nestVideoEditClips(document, document.sequences[0].id, ['a'], '子')
  result.document.sequences[1].clips[0].duration = 30
  expect(videoEditDocumentSchema.safeParse(result.document).success).toBe(true)
  expect(result.document.sequences[0].clips[0].duration).toBe(60)
  expect(videoEditNestedFrame({ fps: 30 }, result.clip, { fps: 30 }, 75)).toBe(45)
})
