import { expect, it } from 'vitest'
import { createVideoEditDocument, videoEditDocumentSchema, type VideoEditClip } from './document'
import { makeVideoEditItemClip } from './projectItems'
import { applyVideoEditTimelineEdit, applyVideoEditTimelineEditResult, copyVideoEditClips, videoEditMoveTrackMap } from './timelineEdits'
import { expandVideoEditSelection, selectVideoEditRegion } from './timelineSelection'
import { assertVideoEditLockedTracks } from './lockedTracks'
import { videoEditSyncOffsets } from './linkSync'
import { offsetVideoEditSource } from './time'
import { addLegacyVideoEditTracks } from './testFixtures'

function fixture() {
  const document = createVideoEditDocument('多轨剪辑'); addLegacyVideoEditTracks(document.sequences[0])
  document.media = [{ id: 'media', name: '原视频', path: 'D:/original.mp4', kind: 'video', width: 3840, height: 2160, durationSeconds: 20, hasAudio: true }]
  document.items = [{ id: 'item', name: '原视频', kind: 'video', mediaId: 'media' }]
  const sequence = document.sequences[0]
  sequence.frameRate = { numerator: 60000, denominator: 1001 }
  const clip = makeVideoEditItemClip(document, 'item', sequence.id, { frame: 10, track: 1 })
  sequence.clips = [{ ...clip, id: 'a', duration: 60 }, { ...clip, id: 'b', start: 100, duration: 60 }]
  return { document, sequence }
}
function apply(document: ReturnType<typeof createVideoEditDocument>, edit: Parameters<typeof applyVideoEditTimelineEdit>[2]) {
  const sequence = applyVideoEditTimelineEdit(document, document.sequences[0].id, edit)
  return videoEditDocumentSchema.parse({ ...document, sequences: [sequence] })
}
it('插入和覆盖只选择实际放置片段，不选择保留的原片段右尾', () => {
  const { document, sequence } = fixture()
  const clipboard = copyVideoEditClips(document, sequence.id, ['b']); clipboard.clips[0].duration = 10
  for (const mode of ['insert', 'overwrite'] as const) {
    const result = applyVideoEditTimelineEditResult(document, sequence.id, { kind: 'place', clipboard, frame: 40, mode })
    expect(result.selectedClipIds).toHaveLength(1)
    expect(result.sequence.clips.find(clip => clip.id === result.selectedClipIds![0])).toMatchObject({ start: 40, duration: 10 })
    expect(result.sequence.clips.filter(clip => clip.start === 50).every(clip => !result.selectedClipIds!.includes(clip.id))).toBe(true)
  }
})
it('完整音画覆盖后左右各自关联；只覆盖画面时两段画面仍与整段声音链接且同步', () => {
  const { document, sequence } = fixture()
  document.sequences[0] = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'separate_audio', clipIds: ['a'], audioTrack: 0 })
  const paired = document.sequences[0]
  paired.clips.filter(clip => clip.linkId).forEach(clip => { clip.groupId = 'group' })
  const clipboard = copyVideoEditClips(document, sequence.id, ['a']); clipboard.clips.forEach(clip => { clip.duration = 10 })
  const result = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'place', clipboard, frame: 40, mode: 'overwrite' })
  const left = result.clips.filter(clip => clip.start === 10); const right = result.clips.filter(clip => clip.start === 50)
  expect(left).toHaveLength(2); expect(right).toHaveLength(2)
  expect(new Set(right.map(clip => clip.linkId)).size).toBe(1); expect(new Set(right.map(clip => clip.groupId)).size).toBe(1)
  expect(left[0].linkId).not.toBe(right[0].linkId); expect(left[0].groupId).not.toBe(right[0].groupId)
  expect(expandVideoEditSelection(result, [right[0].id])).toHaveLength(2)
  const partial = { ...clipboard, clips: clipboard.clips.filter(clip => clip.kind !== 'audio') }
  const picture = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'place', clipboard: partial, frame: 40, mode: 'overwrite' })
  const original = paired.clips.find(clip => clip.id === 'a')!.linkId
  expect(picture.clips.filter(clip => clip.linkId === original).map(clip => [clip.kind, clip.start, clip.duration])).toEqual([['video', 10, 30], ['video', 50, 20], ['audio', 10, 60]])
  expect(videoEditSyncOffsets(picture).size).toBe(0)
})
it('关闭同步的链接伙伴在波纹和插入中原地保留并显示失步帧数（Premiere 同步锁定语义）', () => {
  const { document, sequence } = fixture()
  document.sequences[0] = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'separate_audio', clipIds: ['b'], audioTrack: 0 })
  const paired = document.sequences[0]; paired.tracks[0].syncLocked = false
  const sound = paired.clips.find(clip => clip.kind === 'audio')!.id
  const clipboard = copyVideoEditClips(document, sequence.id, ['a'])
  for (const locked of [false, true]) {
    paired.tracks[0].locked = locked
    const before = JSON.stringify(document)
    const rippled = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'delete', clipIds: ['a'], ripple: true, targetTracks: [1] })
    expect(rippled.clips.find(clip => clip.id === 'b')!.start).toBe(40); expect(rippled.clips.find(clip => clip.id === sound)!.start).toBe(100)
    expect(Object.fromEntries(videoEditSyncOffsets(rippled))).toEqual({ b: -60, [sound]: 60 })
    const inserted = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'place', clipboard, frame: 80, mode: 'insert', targetTracks: [1] })
    expect(inserted.clips.find(clip => clip.id === 'b')!.start).toBe(160); expect(inserted.clips.find(clip => clip.id === sound)!.start).toBe(100)
    expect(videoEditSyncOffsets(inserted).get('b')).toBe(60)
    expect(JSON.stringify(document)).toBe(before)
  }
})
it('不允许来源轨折叠成新重叠，实际插入和删除轨始终纳入波纹范围', () => {
  const { document, sequence } = fixture(); sequence.clips[1] = { ...sequence.clips[1], start: 10, track: 2 }
  expect(() => apply(document, { kind: 'adjust', clipIds: ['a', 'b'], mode: 'move', delta: 0, trackMap: { 1: 3, 2: 3 } })).toThrow('重叠')
  const two = copyVideoEditClips(document, sequence.id, ['a', 'b'])
  expect(() => apply(document, { kind: 'place', clipboard: two, frame: 400, mode: 'paste', trackMap: { 1: 3, 2: 3 } })).toThrow('重叠')
  sequence.clips[1] = { ...sequence.clips[1], start: 100, track: 1 }; sequence.tracks[1].syncLocked = false
  const one = copyVideoEditClips(document, sequence.id, ['a']); one.clips[0].duration = 10
  const inserted = apply(document, { kind: 'place', clipboard: one, frame: 10, mode: 'insert', targetTracks: [2] }).sequences[0]
  expect(inserted.clips.find(clip => clip.id === 'a')!.start).toBe(20)
  const deleted = apply(document, { kind: 'delete', clipIds: ['a'], ripple: true, targetTracks: [2] }).sequences[0]
  expect(deleted.clips.find(clip => clip.id === 'b')!.start).toBe(40)
})
it('旧v2仍可读，音画拆开不增加媒体或素材项，源时间与联动剪切保持精确', () => {
  const { document } = fixture(); delete document.media[0].hasAudio
  expect(videoEditDocumentSchema.parse(document).version).toBe(2)
  expect(() => apply(document, { kind: 'separate_audio', clipIds: ['a'], audioTrack: 0 })).toThrow('音轨')
  document.media[0].hasAudio = true
  let next = apply(document, { kind: 'separate_audio', clipIds: ['a'], audioTrack: 0 })
  expect(next.media).toEqual(document.media); expect(next.items).toEqual(document.items)
  const pair = next.sequences[0].clips.filter(clip => clip.linkId)
  expect(pair).toHaveLength(2); expect(pair.map(clip => clip.sourceComponent)).toEqual(['video', 'audio'])
  next = apply(next, { kind: 'adjust', clipIds: ['a'], mode: 'in', delta: 7 })
  expect(next.sequences[0].clips.filter(clip => clip.linkId).map(clip => ({ start: clip.start, duration: clip.duration, sourceInUs: clip.sourceInUs, sourceRemainder: clip.sourceRemainder }))).toEqual([0, 1].map(() => ({ start: 17, duration: 53, ...offsetVideoEditSource(pair[0], 7, document.sequences[0].frameRate) })))
  next = apply(next, { kind: 'split', clipIds: ['a'], frame: 40 })
  const halves = next.sequences[0].clips.filter(clip => clip.linkId)
  const left = halves.filter(clip => clip.start === 17); const right = halves.filter(clip => clip.start === 40)
  expect(new Set(left.map(clip => clip.linkId)).size).toBe(1); expect(new Set(right.map(clip => clip.linkId)).size).toBe(1)
  expect(left[0].linkId).not.toBe(right[0].linkId)
  expect(right[0].sourceRemainder).toEqual(right[1].sourceRemainder)
  expect(expandVideoEditSelection(next.sequences[0], ['a'])).toHaveLength(2)
})
it('选择闭包处理链接编组交集，框选使用半开区间，达到500片段仍有界', () => {
  const { sequence } = fixture()
  const base = sequence.clips[0]
  sequence.clips = Array.from({ length: 500 }, (_, index) => ({ ...base, id: `c${index}`, start: index * 2, duration: 1, linkId: `l${Math.floor(index / 2)}`, groupId: index % 2 ? `g${index}` : index ? `g${index - 1}` : 'start' }))
  expect(expandVideoEditSelection(sequence, ['c0'])).toHaveLength(500)
  expect(expandVideoEditSelection(sequence, ['c4'], false)).toEqual(['c4'])
  expect(selectVideoEditRegion({ ...sequence, clips: [{ ...base, id: 'edge', start: 10, duration: 10 }] }, { from: 20, to: 30, tracks: [1] })).toEqual([])
  expect(() => expandVideoEditSelection(sequence, ['other-sequence'])).toThrow('序列')
})
it('多选移动共享边界位移、播放头/标记吸附，冲突和错轨不半改选区', () => {
  const { document } = fixture()
  let next = apply(document, { kind: 'adjust', clipIds: ['a', 'b'], mode: 'move', delta: -100 })
  expect(next.sequences[0].clips.map(clip => clip.start)).toEqual([0, 90])
  next = apply(document, { kind: 'adjust', clipIds: ['a'], mode: 'move', delta: 12, snapThreshold: 3, snapFrames: [25] })
  expect(next.sequences[0].clips[0].start).toBe(25)
  expect(() => apply(document, { kind: 'adjust', clipIds: ['a'], mode: 'move', delta: 40 })).toThrow('目标位置')
  expect(() => apply(document, { kind: 'adjust', clipIds: ['a'], mode: 'move', delta: 0, trackMap: { 1: 0 } })).toThrow('类型')
  expect(document.sequences[0].clips[0].start).toBe(10)
})
it('轨道拖动保持同类相对轨道，链接音轨不被移到视频轨', () => {
  const { document } = fixture()
  const next = apply(document, { kind: 'separate_audio', clipIds: ['a'], audioTrack: 0 }); const sequence = next.sequences[0]
  const ids = expandVideoEditSelection(sequence, ['a'])
  const map = videoEditMoveTrackMap(sequence, ids, 'a', 2)
  expect(map).toEqual({ 1: 2 })
  const moved = apply(next, { kind: 'adjust', clipIds: ids, mode: 'move', delta: 5, trackMap: map })
  expect(moved.sequences[0].clips.filter(clip => clip.linkId).map(clip => [clip.track, clip.start])).toEqual([[2, 15], [0, 15]])
})
it('入出点与移动共用吸附候选，源下界和联动共同位移仍优先保护', () => {
  const { document } = fixture()
  const trimmed = apply(document, { kind: 'adjust', clipIds: ['a'], mode: 'in', delta: 13, snapThreshold: 3, snapFrames: [25] })
  expect(trimmed.sequences[0].clips[0].start).toBe(25)
  expect(trimmed.sequences[0].clips[0]).toMatchObject(offsetVideoEditSource(document.sequences[0].clips[0], 15, document.sequences[0].frameRate))
  const out = apply(document, { kind: 'adjust', clipIds: ['a'], mode: 'out', delta: 14, snapThreshold: 3, snapFrames: [85] })
  expect(out.sequences[0].clips[0].duration).toBe(75)
  expect(apply(document, { kind: 'adjust', clipIds: ['a'], mode: 'in', delta: -7, snapThreshold: 8, snapFrames: [0] }).sequences[0].clips[0].start).toBe(10)
})
it('普通删除留隙，波纹删除合并区间且不修改关闭同步的轨道', () => {
  const { document, sequence } = fixture()
  sequence.clips.push({ ...sequence.clips[0], id: 'c', start: 200, track: 2 })
  sequence.tracks[2].syncLocked = false
  expect(apply(document, { kind: 'delete', clipIds: ['a'] }).sequences[0].clips.map(clip => clip.start)).toEqual([100, 200])
  expect(apply(document, { kind: 'delete', clipIds: ['a'], ripple: true }).sequences[0].clips.map(clip => clip.start)).toEqual([40, 200])
  sequence.clips.push({ ...sequence.clips[0], id: 'overlap', start: 5, duration: 90, track: 3 })
  expect(() => apply(document, { kind: 'delete', clipIds: ['a'], ripple: true })).toThrow('未选片段')
})
it('锁定任一链接伙伴整组拒绝，通用提交也保护标注、新增及同次解锁绕过', () => {
  const { document } = fixture(); const next = apply(document, { kind: 'separate_audio', clipIds: ['a'], audioTrack: 0 })
  next.sequences[0].tracks[0].locked = true
  expect(() => apply(next, { kind: 'delete', clipIds: ['a'] })).toThrow('锁定')
  expect(() => apply(next, { kind: 'adjust', clipIds: ['a'], mode: 'move', delta: 1 })).toThrow('锁定')
  for (const update of [
    (value: typeof next) => { value.sequences[0].clips.find(clip => clip.kind === 'audio')!.volume = .2 },
    (value: typeof next) => { const clip = value.sequences[0].clips.find(clip => clip.kind === 'audio')!; value.sequences[0].annotations.push({ id: 'mark', clipId: clip.id, frame: 12, kind: 'point', space: 'composition-normalized', x: .5, y: .5, width: 0, height: 0, text: '' }) },
    (value: typeof next) => { value.sequences[0].tracks[0].locked = false; value.sequences[0].clips = value.sequences[0].clips.filter(clip => clip.kind !== 'audio') },
  ]) { const candidate = structuredClone(next); update(candidate); expect(() => assertVideoEditLockedTracks(next, candidate)).toThrow('锁定') }
  const unlocked = structuredClone(next); unlocked.sequences[0].tracks[0].locked = false; unlocked.sequences[0].tracks[0].height = 96
  expect(() => assertVideoEditLockedTracks(next, unlocked)).not.toThrow()
})
it('复制粘贴重新映射链接与标注，换帧率按绝对边界换算且不连接原片段', () => {
  const { document } = fixture(); let next = apply(document, { kind: 'separate_audio', clipIds: ['a'], audioTrack: 0 })
  next.sequences[0].annotations.push({ id: 'm', clipId: 'a', frame: 25, kind: 'point', space: 'composition-normalized', x: .5, y: .5, width: 0, height: 0, text: '保留' })
  const clipboard = copyVideoEditClips(next, next.sequences[0].id, ['a'])
  next.sequences[0].frameRate = { numerator: 30, denominator: 1 }
  next = apply(next, { kind: 'place', clipboard, frame: 200, mode: 'paste' })
  const pasted = next.sequences[0].clips.filter(clip => clip.start === 200)
  expect(pasted).toHaveLength(2); expect(pasted[0].duration).toBe(30)
  expect(pasted[0].linkId).toBe(pasted[1].linkId); expect(pasted[0].linkId).not.toBe(clipboard.clips[0].linkId)
  expect(next.sequences[0].annotations.find(mark => mark.id !== 'm')).toMatchObject({ clipId: pasted[0].id, frame: 208 })
  expect(() => apply(next, { kind: 'place', clipboard: { ...clipboard, projectId: 'other' }, frame: 0, mode: 'paste' })).toThrow('另一剪辑')
})
it('插入拆开跨入点片段并保持右侧源时间，覆盖只替换目标轨且保存两侧', () => {
  const { document, sequence } = fixture()
  const clipboard = copyVideoEditClips(document, sequence.id, ['a']); clipboard.clips[0].duration = 10
  const inserted = apply(document, { kind: 'place', clipboard, frame: 40, mode: 'insert' }).sequences[0]
  expect(inserted.clips.filter(clip => clip.id === 'a' || clip.start === 50).map(clip => [clip.start, clip.duration])).toEqual([[10, 30], [50, 30]])
  expect(inserted.clips.find(clip => clip.start === 50)).toMatchObject(offsetVideoEditSource(sequence.clips[0], 30, sequence.frameRate))
  expect(inserted.clips.find(clip => clip.id === 'b')!.start).toBe(110)
  const overwritten = apply(document, { kind: 'place', clipboard, frame: 40, mode: 'overwrite' }).sequences[0]
  expect(overwritten.clips.map(clip => [clip.start, clip.duration])).toEqual([[10, 30], [50, 20], [100, 60], [40, 10]])
  expect(overwritten.clips.find(clip => clip.start === 50)).toMatchObject(offsetVideoEditSource(sequence.clips[0], 40, sequence.frameRate))
})
it('锁定同步后续片段阻止波纹和插入；显式关闭同步后允许原样保留', () => {
  const { document, sequence } = fixture()
  sequence.clips[1].track = 2; sequence.tracks[2].locked = true
  expect(() => apply(document, { kind: 'delete', clipIds: ['a'], ripple: true })).toThrow('锁定')
  const clipboard = copyVideoEditClips(document, sequence.id, ['a'])
  expect(() => apply(document, { kind: 'place', clipboard, frame: 0, mode: 'insert' })).toThrow('锁定')
  sequence.tracks[2].syncLocked = false
  expect(apply(document, { kind: 'place', clipboard, frame: 0, mode: 'insert' }).sequences[0].clips.find(clip => clip.id === 'b')!.start).toBe(100)
})
it('无效分量、无声音视频与不匹配公共工厂轨道不创建占位', () => {
  const { document, sequence } = fixture(); document.media[0].hasAudio = false
  expect(() => makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0, track: 0, sourceComponent: 'audio' })).toThrow('分量')
  const bad: VideoEditClip = { ...sequence.clips[0], kind: 'audio', sourceComponent: 'audio', track: 0 }
  expect(videoEditDocumentSchema.safeParse({ ...document, sequences: [{ ...sequence, clips: [bad] }] }).success).toBe(false)
  document.media[0].hasAudio = true
  expect(makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0, track: 0, sourceComponent: 'audio' })).toMatchObject({ kind: 'audio', track: 0, itemId: 'item' })
})
it('有声音角色的视频分离音频：角色及回避点留在声音，画面去掉声音角色且文档仍有效', () => {
  const { document, sequence } = fixture()
  sequence.clips[0].audioRole = 'music'
  sequence.clips[0].curves = { volume: [{ time: 0, value: .5, interpolation: 'linear', source: 'ducking', duckingOrigin: { time: 0, value: .5 } }] }
  const next = apply(document, { kind: 'separate_audio', clipIds: ['a'], audioTrack: 0 }).sequences[0]
  expect(next.clips.find(clip => clip.id === 'a')?.audioRole).toBeUndefined()
  const sound = next.clips.find(clip => clip.sourceComponent === 'audio')!
  expect(sound.audioRole).toBe('music'); expect(sound.curves?.volume).toEqual(sequence.clips[0].curves.volume)
})
