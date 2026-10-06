import { expect, it } from 'vitest'
import { createVideoEditDocument, videoEditDocumentSchema, type VideoEditDocument } from './document'
import { makeVideoEditItemClip } from './projectItems'
import { applyVideoEditTimelineEdit, copyVideoEditClips, type VideoEditTimelineEdit } from './timelineEdits'
import { expandVideoEditSelection, selectVideoEditRegion, videoEditPickRelations } from './timelineSelection'
import { videoEditSyncCorrections, videoEditSyncOffsets } from './linkSync'
import { offsetVideoEditSource } from './time'
import { addLegacyVideoEditTracks } from './testFixtures'

/** Two sources: a camera file (picture + two sound streams) and a separate recorder file. */
function fixture() {
  const document = createVideoEditDocument('链接剪辑'); addLegacyVideoEditTracks(document.sequences[0])
  document.media = [
    { id: 'camera', name: '机位', path: 'D:/camera.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 20, hasAudio: true },
    { id: 'cutaway', name: '空镜', path: 'D:/cutaway.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 20, hasAudio: true },
    { id: 'recorder', name: '录音', path: 'D:/recorder.wav', kind: 'audio', width: 0, height: 0, durationSeconds: 20 },
  ]
  document.items = [{ id: 'camera-item', name: '机位', kind: 'video', mediaId: 'camera' }, { id: 'cutaway-item', name: '空镜', kind: 'video', mediaId: 'cutaway' }, { id: 'recorder-item', name: '录音', kind: 'audio', mediaId: 'recorder' }]
  const sequence = document.sequences[0]
  sequence.tracks.push({ ...sequence.tracks[0], id: 'audio-track-2', index: 8, name: '音频 2' }, { ...sequence.tracks[0], id: 'audio-track-3', index: 9, name: '音频 3' })
  const at = (itemId: string, track: number, component?: 'video' | 'audio') => ({ ...makeVideoEditItemClip(document, itemId, sequence.id, { frame: 30, track, ...(component ? { sourceComponent: component } : {}) }), duration: 60 })
  sequence.clips = [
    { ...at('camera-item', 1, 'video'), id: 'v1', name: '机位画面', linkId: 'take' },
    { ...at('cutaway-item', 2), id: 'v2', name: '空镜画面', linkId: 'take' },
    { ...at('camera-item', 0, 'audio'), id: 'a1', name: '机位声音一', linkId: 'take' },
    { ...at('camera-item', 8, 'audio'), id: 'a2', name: '机位声音二', linkId: 'take' },
    { ...at('recorder-item', 9), id: 'r', name: '录音', linkId: 'take' },
  ]
  return { document, sequence }
}
function apply(document: VideoEditDocument, edit: VideoEditTimelineEdit): VideoEditDocument {
  const next = applyVideoEditTimelineEdit(document, document.sequences[0].id, edit)
  return videoEditDocumentSchema.parse({ ...document, sequences: [next] })
}
const clip = (document: VideoEditDocument, id: string) => document.sequences[0].clips.find(value => value.id === id)!

it('任意类型与三条以上片段可链接：选择联动、Alt/关闭链接选择只选一条、解除后完全独立', () => {
  const { document, sequence } = fixture()
  expect(new Set(expandVideoEditSelection(sequence, ['v2']))).toEqual(new Set(['v1', 'v2', 'a1', 'a2', 'r']))
  expect(videoEditPickRelations(true)).toEqual({ links: true, groups: true }); expect(videoEditPickRelations(true, true)).toEqual({ links: false, groups: false }); expect(videoEditPickRelations(false, true)).toEqual({ links: true, groups: false })
  expect(expandVideoEditSelection(sequence, ['v2'], videoEditPickRelations(true, true))).toEqual(['v2'])
  expect(selectVideoEditRegion(sequence, { from: 0, to: 40, tracks: [9] }, false)).toEqual(['r'])
  const relinked = apply(document, { kind: 'link', clipIds: ['v1', 'v2'], linked: false })
  expect(clip(relinked, 'v1').linkId).toBe(clip(relinked, 'v2').linkId); expect(clip(relinked, 'v1').linkId).not.toBe('take')
  const separate = apply(document, { kind: 'unlink', clipIds: ['a1'] })
  expect(separate.sequences[0].clips.every(value => !value.linkId)).toBe(true)
  const moved = apply(separate, { kind: 'adjust', clipIds: ['a1'], mode: 'move', delta: 5 })
  expect(moved.sequences[0].clips.filter(value => value.start !== 30).map(value => value.id)).toEqual(['a1'])
  expect(videoEditSyncOffsets(moved.sequences[0]).size).toBe(0)
})

it('剃刀联动在同一帧拆开组内全部跨越片段，左右两半各自成链；单独剃刀只拆一条并保持链接', () => {
  const { document, sequence } = fixture()
  const cut = apply(document, { kind: 'split', clipIds: ['a2'], frame: 50 }).sequences[0]
  expect(cut.clips.filter(value => value.start === 50)).toHaveLength(5)
  const right = cut.clips.filter(value => value.start === 50); const left = cut.clips.filter(value => value.start === 30)
  expect(new Set(right.map(value => value.linkId)).size).toBe(1); expect(left.every(value => value.linkId === 'take')).toBe(true)
  expect(right[0].linkId).not.toBe('take')
  expect(right.find(value => value.itemId === 'camera-item' && value.kind === 'audio')).toMatchObject(offsetVideoEditSource(sequence.clips[2], 20, sequence.frameRate))
  expect(new Set(expandVideoEditSelection(cut, [right[0].id]))).toEqual(new Set(right.map(value => value.id)))
  expect(videoEditSyncOffsets(cut).size).toBe(0)
  const single = apply(document, { kind: 'split', clipIds: ['v1'], linked: false, frame: 50 }).sequences[0]
  expect(single.clips).toHaveLength(6)
  expect(single.clips.filter(value => value.itemId === 'camera-item' && value.kind === 'video').every(value => value.linkId === 'take')).toBe(true)
  expect(videoEditSyncOffsets(single).size).toBe(0)
})

it('单独移动、修剪、删除与复制只作用于选中的一条，链接保留；同源失步显示偏移，不同源不显示', () => {
  const { document } = fixture()
  const moved = apply(document, { kind: 'adjust', clipIds: ['a1'], linked: false, mode: 'move', delta: 3 })
  expect(moved.sequences[0].clips.map(value => [value.id, value.start, value.linkId])).toEqual([['v1', 30, 'take'], ['v2', 30, 'take'], ['a1', 33, 'take'], ['a2', 30, 'take'], ['r', 30, 'take']])
  expect(Object.fromEntries(videoEditSyncOffsets(moved.sequences[0]))).toEqual({ a1: 3 })
  const pair = apply(document, { kind: 'delete', clipIds: ['a2'], linked: false })
  const drifted = apply(pair, { kind: 'adjust', clipIds: ['a1'], linked: false, mode: 'move', delta: -4 })
  expect(Object.fromEntries(videoEditSyncOffsets(drifted.sequences[0]))).toEqual({ v1: 4, a1: -4 })
  const unrelated = apply(document, { kind: 'adjust', clipIds: ['r', 'v2'], linked: false, mode: 'move', delta: 7 })
  expect(videoEditSyncOffsets(unrelated.sequences[0]).size).toBe(0)
  const trimmed = apply(document, { kind: 'adjust', clipIds: ['v1'], linked: false, mode: 'in', delta: 10 })
  expect(clip(trimmed, 'v1')).toMatchObject({ start: 40, duration: 50 }); expect(clip(trimmed, 'a1')).toMatchObject({ start: 30, duration: 60 })
  expect(videoEditSyncOffsets(trimmed.sequences[0]).size).toBe(0)
  const deleted = apply(document, { kind: 'delete', clipIds: ['v2'], linked: false }).sequences[0]
  expect(deleted.clips.map(value => value.id)).toEqual(['v1', 'a1', 'a2', 'r']); expect(deleted.clips.every(value => value.linkId === 'take')).toBe(true)
  expect(copyVideoEditClips(document, document.sequences[0].id, ['r'], false).clips.map(value => value.id)).toEqual(['r'])
  expect(copyVideoEditClips(document, document.sequences[0].id, ['r']).clips).toHaveLength(5)
})

it('移入同步与滑入同步只修正失步的一侧，越界时给出改用另一种方式的提示', () => {
  const { document } = fixture()
  const drifted = apply(document, { kind: 'adjust', clipIds: ['a1'], linked: false, mode: 'move', delta: 6 })
  expect(Object.fromEntries(videoEditSyncCorrections(drifted.sequences[0], ['v1', 'v2', 'a1', 'a2', 'r']))).toEqual({ a1: 6 })
  const moved = apply(drifted, { kind: 'sync', clipIds: ['v1', 'a1'], mode: 'move' })
  expect(clip(moved, 'a1').start).toBe(30); expect(videoEditSyncOffsets(moved.sequences[0]).size).toBe(0)
  const slipped = apply(drifted, { kind: 'sync', clipIds: ['a1'], mode: 'slip' })
  expect(clip(slipped, 'a1')).toMatchObject({ start: 36, ...offsetVideoEditSource(clip(drifted, 'a1'), 6, drifted.sequences[0].frameRate) })
  expect(videoEditSyncOffsets(slipped.sequences[0]).size).toBe(0)
  expect(() => apply(drifted, { kind: 'sync', clipIds: ['v2'], mode: 'move' })).toThrow('没有失步')
  const early = apply(document, { kind: 'adjust', clipIds: ['a1'], linked: false, mode: 'move', delta: -10 })
  expect(() => apply(early, { kind: 'sync', clipIds: ['a1'], mode: 'slip' })).toThrow('滑入同步')
  expect(clip(apply(early, { kind: 'sync', clipIds: ['a1'], mode: 'move' }), 'a1').start).toBe(30)
})

it('联动拆分时完全位于拆分点右侧的未拆成员随右半组，无关链接不受影响', () => {
  const { document } = fixture()
  const pieces = apply(document, { kind: 'split', clipIds: ['v1'], linked: false, frame: 60 })
  const tail = pieces.sequences[0].clips.find(value => value.itemId === 'camera-item' && value.kind === 'video' && value.start === 60)!
  const other = { ...tail, id: 'other', track: 3, linkId: 'unrelated', start: 200 }
  const withOther = { ...pieces, sequences: [{ ...pieces.sequences[0], clips: [...pieces.sequences[0].clips, other] }] }
  const cut = apply(withOther, { kind: 'split', clipIds: ['a1'], frame: 45 }).sequences[0]
  const right = cut.clips.filter(value => value.start === 45)
  expect(right).toHaveLength(5)
  expect(cut.clips.find(value => value.id === tail.id)!.linkId).toBe(right[0].linkId)
  expect(new Set(right.map(value => value.linkId)).size).toBe(1)
  expect(cut.clips.filter(value => value.linkId === 'take').map(value => value.start)).toEqual([30, 30, 30, 30, 30])
  expect(cut.clips.find(value => value.id === 'other')!.linkId).toBe('unrelated')
})

it('链接选择开关只管链接：关闭后点编组内片段仍选整组，Alt 才单选；开关关闭时 Alt 临时带上链接但不带编组', () => {
  const { sequence } = fixture()
  sequence.clips = sequence.clips.map(value => ['v2', 'r'].includes(value.id) ? { ...value, groupId: 'board' } : value)
  sequence.clips.push({ ...sequence.clips[4], id: 'r2', linkId: undefined, groupId: 'board', track: 3, kind: 'video', itemId: 'cutaway-item' })
  expect(new Set(expandVideoEditSelection(sequence, ['r2'], videoEditPickRelations(false)))).toEqual(new Set(['r2', 'v2', 'r']))
  expect(expandVideoEditSelection(sequence, ['r2'], videoEditPickRelations(true, true))).toEqual(['r2'])
  expect(new Set(expandVideoEditSelection(sequence, ['a1'], videoEditPickRelations(false, true)))).toEqual(new Set(['v1', 'v2', 'a1', 'a2', 'r']))
  expect(new Set(expandVideoEditSelection(sequence, ['v2'], videoEditPickRelations(false)))).toEqual(new Set(['v2', 'r', 'r2']))
  expect(new Set(selectVideoEditRegion(sequence, { from: 0, to: 40, tracks: [3] }, videoEditPickRelations(false)))).toEqual(new Set(['r2', 'v2', 'r']))
})
