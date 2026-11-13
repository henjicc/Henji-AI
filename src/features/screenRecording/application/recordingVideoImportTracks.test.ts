// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createRecordingDocument, type RecordingMedia } from '@/core/screenRecording/document'
import { createVideoEditDocument, createVideoEditSequence, type VideoEditDocument } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { videoEditEdgeTracks, videoEditTrackCodes } from '@/core/videoEdit/tracks'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { closeAllVideoEdits, openSeededVideoEdit } from '@/features/videoEdit/application/videoEditDocumentTestKit'
import { editVideoProject, holdVideoEditActivity, setVideoEditLayout, undoVideoEdit, videoEditRevision } from '@/features/videoEdit/application/videoEditService'
import { videoEditRecordLayoutCommand } from '@/features/videoEdit/application/videoEditRecordLayoutCommands'
import { placeRecordingMedia } from './recordingVideoImport'
import { settleVideoEditRecordingTake, videoEditRecordingTarget } from '@/core/videoEdit/recordingLane'

vi.mock('@/features/navigation', () => ({ openApplicationSurface: vi.fn() }))
vi.mock('@/features/videoEdit', () => ({}))

beforeEach(() => installHarnessNativeStorage())
afterEach(async () => { await closeAllVideoEdits(); uninstallHarnessNativeStorage() })

function fixture(kinds: RecordingMedia['kind'][] = ['microphone', 'screen']): { document: VideoEditDocument; recording: ReturnType<typeof createRecordingDocument> } {
  const document = createVideoEditDocument('录屏导入')
  document.sequences.push(createVideoEditSequence())
  const recording = createRecordingDocument()
  recording.media = kinds.map(kind => ({ id: kind, kind, path: `D:/${kind}.wav`, monoUs: 0, durationUs: 2_000_000 }))
  for (const source of recording.media) {
    const kind = source.kind === 'screen' || source.kind === 'camera' ? 'video' : 'audio'
    document.media.push({ id: `media-${source.id}`, name: source.id, path: source.path, kind, durationSeconds: 2, width: 1920, height: 1080, hasAudio: kind === 'audio' })
    document.items.push({ id: source.id, name: source.id, kind, mediaId: `media-${source.id}` })
  }
  return { document, recording }
}

function place(document: VideoEditDocument, recording: ReturnType<typeof createRecordingDocument>, frame = 0): VideoEditDocument {
  return placeRecordingMedia(document, recording, recording.media, recording.media.map(media => media.id), { documentId: document.id, sequenceId: document.sequences[0].id, frame })
}

it('新项目复用最低空轨并改成语义名，多分片仍在同一轨', () => {
  const { document, recording } = fixture()
  let sequence = document.sequences[0]
  const originalIds = sequence.tracks.map(track => track.id)
  recording.media.push({ ...recording.media[1], monoUs: 2_000_000 })
  sequence = place(document, recording).sequences[0]
  expect(sequence.tracks.map(track => track.id)).toEqual(originalIds)
  expect(sequence.tracks.map(track => track.name)).toEqual(['麦克风', '屏幕'])
  const codes = videoEditTrackCodes(sequence)
  expect(sequence.clips.map(clip => codes.get(sequence.tracks.find(track => track.index === clip.track)!.id))).toEqual(['A1', 'V1', 'V1'])
})

it('中间插入不占用已有片段的轨道，即使插入处为空；已有片段不移动', () => {
  const { document, recording } = fixture()
  let sequence = document.sequences[0]
  sequence.clips = [makeVideoEditItemClip(document, 'microphone', sequence.id, { frame: 300, track: 0 }), makeVideoEditItemClip(document, 'screen', sequence.id, { frame: 300, track: 1 })]
  const before = structuredClone(sequence)
  sequence = place(document, recording, 120).sequences[0]
  expect(sequence.tracks.slice(0, 2)).toEqual(before.tracks)
  expect(sequence.clips.slice(0, 2)).toEqual(before.clips)
  expect(sequence.tracks).toHaveLength(4)
  expect(sequence.clips.slice(2).map(clip => [clip.start, clip.track])).toEqual([[120, 2], [120, 3]])
})

it('空轨不足只补缺少的轨道，按编号而非数组位置分配并保留锁定轨', () => {
  const { document, recording } = fixture(['microphone', 'systemAudio', 'screen', 'camera'])
  let sequence = document.sequences[0]
  const [extra] = videoEditEdgeTracks(sequence, 'video', 1)
  sequence.tracks.unshift(extra)
  sequence.tracks.find(track => track.kind === 'audio')!.locked = true
  sequence = place(document, recording).sequences[0]
  expect(sequence.tracks).toHaveLength(5)
  expect(sequence.tracks.find(track => track.index === 0)).toMatchObject({ name: '音频 1', locked: true })
  expect(sequence.clips.map(clip => [clip.itemId, clip.track])).toEqual([['microphone', 3], ['systemAudio', 4], ['screen', 1], ['camera', 2]])
})

it('轨道重命名、新增轨和片段同一步撤销及重做', async () => {
  const { document, recording } = fixture(['microphone', 'systemAudio', 'screen', 'camera'])
  const owner = await openSeededVideoEdit(document)
  const before = structuredClone(owner.document.sequences)
  const history = owner.past.length
  editVideoProject(document.id, current => place(current, recording))
  const after = structuredClone(owner.document.sequences)
  expect(owner.past).toHaveLength(history + 1)
  expect(after[0].tracks.map(track => track.name)).toEqual(['麦克风', '屏幕', '系统声音', '摄像头'])
  expect(after[0].clips).toHaveLength(4)
  undoVideoEdit(document.id)
  expect(owner.document.sequences).toEqual(before)
  undoVideoEdit(document.id, true)
  expect(owner.document.sequences).toEqual(after)
})

it('放在录屏轨上：新的一段沿用录屏轨已有的轨道，从指针处盖住原来的画面和声音，不新开轨道', () => {
  const { document, recording } = fixture()
  let sequence = place(document, recording).sequences[0]
  const tracks = sequence.tracks.map(track => track.id)
  // 录屏导入给录屏画面素材写上指针记录，录屏轨按它认（这里只在认轨与落定时带上，放素材时不带，免得拉起指针效果）
  const screen = document.media.find(media => media.id === 'media-screen')!
  const marked = { ...document, media: document.media.map(media => media === screen ? { ...media, recordingCursor: {} as never } : media) }
  const target = videoEditRecordingTarget({ ...sequence, items: marked.items, media: marked.media }, { at: 'frame', frame: 30 }, 60)
  expect(target).toMatchObject({ frame: 30, mode: 'overwrite' })
  const before = new Set(sequence.clips.map(clip => clip.id))
  const placed = placeRecordingMedia({ ...document, sequences: [sequence] }, recording, recording.media, recording.media.map(media => media.id), { documentId: document.id, sequenceId: sequence.id, frame: target.frame }, [], target.tracks)
  sequence = settleVideoEditRecordingTake({ ...placed, media: marked.media }, sequence.id, placed.sequences[0].clips.filter(clip => !before.has(clip.id)).map(clip => clip.id)).document.sequences[0]
  expect(sequence.tracks.map(track => track.id)).toEqual(tracks)
  const spans = (track: number) => sequence.clips.filter(clip => clip.track === track).sort((a, b) => a.start - b.start).map(clip => [clip.start, clip.start + clip.duration])
  expect(spans(1)).toEqual([[0, 30], [30, 90]])
  expect(spans(0)).toEqual([[0, 30], [30, 90]])
})

it('录制样子里录屏写进这份剪辑期间：撤销、重做都拒绝，上一段留着；开始与结束都通知界面刷新可用状态', async () => {
  const { document, recording } = fixture()
  const owner = await openSeededVideoEdit(document)
  editVideoProject(document.id, current => place(current, recording))
  const placed = structuredClone(owner.document.sequences)
  setVideoEditLayout(document.id, 'record')
  const revision = videoEditRevision()
  const release = holdVideoEditActivity(document.id, '屏幕录制')
  expect(videoEditRevision()).toBeGreaterThan(revision)
  expect(videoEditRecordLayoutCommand(owner, 'undo')).toMatchObject({ kind: 'blocked' })
  expect(() => undoVideoEdit(document.id)).toThrow('正在录制')
  expect(() => undoVideoEdit(document.id, true)).toThrow('正在录制')
  expect(owner.document.sequences).toEqual(placed)
  const stopped = videoEditRevision()
  release()
  expect(videoEditRevision()).toBeGreaterThan(stopped)
  undoVideoEdit(document.id)
  expect(owner.document.sequences).not.toEqual(placed)
})
