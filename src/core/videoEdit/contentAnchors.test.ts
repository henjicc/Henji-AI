import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { createVideoEditTestDocument, addLegacyVideoEditTracks } from './testFixtures'
import { videoEditDocumentSchema, videoEditComposition, videoEditNestedComposition, type VideoEditClip } from './document'
import { makeVideoEditItemClip } from './projectItems'
import { applyVideoEditTimelineEdit, copyVideoEditClips } from './timelineEdits'
import { deleteVideoEditTextRanges, extractVideoEditTextRanges, insertVideoEditTextRanges } from './textEdits'
import { nestVideoEditClips } from './nestedSequences'

function fixture() {
  const document = createVideoEditTestDocument('内容关联'); const sequence = addLegacyVideoEditTracks(document.sequences[0])
  document.media = [{ id: 'voice-media', name: '口播', path: path.resolve(path.sep, 'voice.wav'), kind: 'audio', width: 0, height: 0, durationSeconds: 10, hasAudio: true }]
  document.items = [{ id: 'voice-item', name: '口播', kind: 'audio', mediaId: 'voice-media' }, { id: 'label-item', name: '强调', kind: 'text' }]
  const voice = { ...makeVideoEditItemClip(document, 'voice-item', sequence.id, { frame: 0, duration: 300 }), id: 'voice' }
  const label: VideoEditClip = { ...makeVideoEditItemClip(document, 'label-item', sequence.id, { frame: 30, duration: 30, track: 1 }), id: 'label', text: '重点', contentAnchor: { ranges: [{ clipId: 'voice', itemId: 'voice-item', fromUs: 1000000, toUs: 2000000 }], startOffsetSeconds: 0, endOffsetSeconds: 0 }, curves: { x: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 20, value: .2, interpolation: 'linear' }] } }
  sequence.clips = [voice, label, { ...label, id: 'fixed', track: 2, start: 180, contentAnchor: undefined }]
  return { document, sequence }
}

describe('画面元素按内容关联', () => {
  it('源片段移动时标签跟随，独立元素保持节目位置，手动偏移继续保留', () => {
    const { document, sequence } = fixture()
    const manual = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'adjust', clipIds: ['label'], linked: false, mode: 'move', delta: 15 })
    expect(manual.clips.find(clip => clip.id === 'label')!.contentAnchor).toMatchObject({ startOffsetSeconds: .5, endOffsetSeconds: .5 })
    const next = applyVideoEditTimelineEdit({ ...document, sequences: [manual] }, sequence.id, { kind: 'adjust', clipIds: ['voice'], linked: false, mode: 'move', delta: 90 })
    expect(next.clips.find(clip => clip.id === 'label')).toMatchObject({ start: 135, duration: 30, text: '重点' })
    expect(next.clips.find(clip => clip.id === 'fixed')!.start).toBe(180)
    expect(() => videoEditDocumentSchema.parse({ ...document, sequences: [next] })).not.toThrow()
  })
  it('源片段拆分后把两边分开移动，标签分成两个实例，仍能继续跟随自己的来源', () => {
    const { document, sequence } = fixture()
    const split = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'split', clipIds: ['voice'], linked: false, frame: 45 })
    const right = split.clips.find(clip => clip.itemId === 'voice-item' && clip.id !== 'voice')!
    const moved = applyVideoEditTimelineEdit({ ...document, sequences: [split] }, sequence.id, { kind: 'adjust', clipIds: [right.id], linked: false, mode: 'move', delta: 90 })
    const labels = moved.clips.filter(clip => clip.contentAnchor)
    expect(labels.map(clip => [clip.start, clip.duration])).toEqual([[30, 15], [135, 15]])
    expect(new Set(labels.map(clip => clip.id)).size).toBe(2)
    expect(() => videoEditDocumentSchema.parse({ ...document, sequences: [moved] })).not.toThrow()
  })
  it('删前文不丢失后文标签；删掉所绑定内容时连提前和延后显示部分一起移除', () => {
    const { document, sequence } = fixture()
    const next = deleteVideoEditTextRanges(document, sequence.id, [{ from: 0, to: 30 }])
    expect(next.sequences[0].clips.find(clip => clip.id === 'label')).toMatchObject({ start: 0, duration: 30 })
    sequence.clips[1] = { ...sequence.clips[1], start: 15, duration: 60, contentAnchor: { ...sequence.clips[1].contentAnchor!, startOffsetSeconds: -.5, endOffsetSeconds: .5 } }
    const removed = deleteVideoEditTextRanges(document, sequence.id, [{ from: 30, to: 60 }])
    expect(removed.sequences[0].clips.filter(clip => clip.itemId === 'label-item' && clip.id !== 'fixed')).toHaveLength(0)
    expect(() => videoEditDocumentSchema.parse(removed)).not.toThrow()
  })
  it('速度、倒放和片段拆分沿同一来源时钟，画面关键帧随时长缩放', () => {
    const { document, sequence } = fixture()
    const faster = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'speed', clipIds: ['voice'], linked: false, change: { speed: { numerator: 2, denominator: 1 } } })
    expect(faster.clips.find(clip => clip.id === 'label')).toMatchObject({ start: 15, duration: 15, curves: { x: [{ time: 0 }, { time: 10 }] } })
    const reversed = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'speed', clipIds: ['voice'], linked: false, change: { reverse: true } })
    expect(reversed.clips.find(clip => clip.id === 'label')).toMatchObject({ start: 240, duration: 30 })
    const split = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'split', clipIds: ['voice'], linked: false, frame: 45 })
    expect(split.clips.filter(clip => clip.id === 'label')).toHaveLength(1)
    expect(split.clips.find(clip => clip.id === 'label')!.contentAnchor!.ranges).toHaveLength(2)
  })
  it('复制来源自动携带关联画面，新实例只影响自己的标签；单独复制标签解除旧关联', () => {
    const { document, sequence } = fixture()
    const clipboard = copyVideoEditClips(document, sequence.id, ['voice'], false)
    expect(clipboard.clips.map(clip => clip.id)).toEqual(['voice', 'label'])
    const placed = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'place', clipboard, frame: 360, mode: 'paste' })
    const copy = placed.clips.find(clip => clip.itemId === 'voice-item' && clip.id !== 'voice')!
    const moved = applyVideoEditTimelineEdit({ ...document, sequences: [placed] }, sequence.id, { kind: 'adjust', clipIds: [copy.id], linked: false, mode: 'move', delta: 30 })
    expect(moved.clips.find(clip => clip.id === 'label')!.start).toBe(30)
    const copiedLabel = moved.clips.find(clip => clip.contentAnchor?.ranges.some(range => range.clipId === copy.id))!
    expect(copiedLabel.start).toBe(420)
    expect(copyVideoEditClips(document, sequence.id, ['label'], false).clips[0].contentAnchor).toBeUndefined()
    expect(() => videoEditDocumentSchema.parse({ ...document, sequences: [moved] })).not.toThrow()
  })
  it('提取与插入重映射关联来源，嵌套把来源和关联画面一起放入子序列', () => {
    const { document, sequence } = fixture()
    const excerpt = extractVideoEditTextRanges(document, sequence.id, [{ from: 30, to: 60 }])
    const label = excerpt.clips.find(clip => clip.id !== 'voice' && clip.contentAnchor)!
    expect(label).toMatchObject({ start: 0, duration: 30 })
    expect(label.contentAnchor!.ranges.every(range => excerpt.clips.some(clip => clip.id === range.clipId))).toBe(true)
    const inserted = insertVideoEditTextRanges(document, sequence.id, [{ from: 30, to: 60 }], 90)
    expect(inserted.sequences[0].clips.filter(clip => clip.contentAnchor).map(clip => clip.start).sort((a, b) => a - b)).toEqual([30, 90])
    const nested = nestVideoEditClips(document, sequence.id, ['voice'], '内容组')
    expect(nested.sequence.clips.map(clip => clip.id)).toEqual(['voice', 'label'])
    expect(() => videoEditDocumentSchema.parse(nested.document)).not.toThrow()
  })
  it('锁定关联画面时整组操作拒绝，循环与悬空来源不能保存', () => {
    const { document, sequence } = fixture()
    sequence.tracks.find(track => track.index === 1)!.locked = true
    expect(() => applyVideoEditTimelineEdit(document, sequence.id, { kind: 'adjust', clipIds: ['voice'], linked: false, mode: 'move', delta: 30 })).toThrow('锁定')
    sequence.clips[1].contentAnchor!.ranges[0].clipId = 'label'
    sequence.clips[1].contentAnchor!.ranges[0].itemId = 'label-item'
    expect(() => videoEditDocumentSchema.parse(document)).toThrow('循环')
    sequence.clips[1].contentAnchor!.ranges[0].clipId = 'missing'
    expect(() => videoEditDocumentSchema.parse(document)).toThrow('来源')
  })
  it('剪掉嵌套实例中的关联内容，包装的提前/延后显示也不在其他保留段残留', () => {
    const { document, sequence } = fixture()
    sequence.clips[1] = { ...sequence.clips[1], start: 15, duration: 60, contentAnchor: { ...sequence.clips[1].contentAnchor!, startOffsetSeconds: -.5, endOffsetSeconds: .5 } }
    const nested = nestVideoEditClips(document, sequence.id, ['voice'], '关联嵌套')
    const childBefore = structuredClone(nested.sequence)
    const edited = deleteVideoEditTextRanges(nested.document, sequence.id, [{ from: 30, to: 60 }])
    const parent = videoEditComposition(edited, sequence.id)
    for (const clip of parent.clips.filter(clip => clip.kind === 'sequence')) expect(videoEditNestedComposition(parent, clip)!.clips.some(clip => clip.contentAnchor)).toBe(false)
    expect(edited.sequences.find(sequence => sequence.id === nested.sequence.id)).toEqual(childBefore)
    expect(videoEditNestedComposition(parent, { ...nested.clip, start: 600 })!.clips.some(clip => clip.contentAnchor)).toBe(true)
  })
})
