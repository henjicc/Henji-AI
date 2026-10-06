// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { getPlatform } from '@/platform/runtime'
import { createVideoEditDocument } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { insertVideoEditTracks, removeVideoEditTracks, videoEditEdgeTracks, videoEditTrackCodes } from '@/core/videoEdit/tracks'
import { closeVideoEditProject, createVideoEditProject, listVideoEditInstances, undoVideoEdit } from './videoEditService'
import { addVideoEditTracks, deleteVideoEditTracks } from './videoEditTimeline'

beforeEach(() => { installHarnessNativeStorage(); vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/tracks.henji-video') })
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

const shape = (tracks: Array<{ index: number; kind: string; name: string }>) => tracks.map(track => [track.kind, track.index, track.name])

it('新序列与 PR 一样只有 V1/A1；加轨优先用相邻空编号，没有空位时整体重新编号并换算片段与调整范围，锁定轨道不被移动', () => {
  const document = createVideoEditDocument('轨道'); const sequence = document.sequences[0]
  expect(shape(sequence.tracks)).toEqual([['audio', 0, '音频 1'], ['video', 1, '视频 1']])
  // 最上面加视频轨、最下面加音频轨：不动已有编号
  const top = insertVideoEditTracks(sequence, 'video', 2, 1)
  expect(top.added.map(track => track.index)).toEqual([2, 3]); expect(top.sequence.tracks.slice(0, 2)).toEqual(sequence.tracks)
  expect([...videoEditTrackCodes(top.sequence).values()]).toEqual(['V1', 'V2', 'V3', 'A1'])
  // V1 之下没有空编号：音频在前、视频在后重新编号，片段跟着轨道走
  document.media = [{ id: 'm', name: '视频', path: 'D:/a.mp4', kind: 'video', width: 64, height: 64, durationSeconds: 10 }]
  document.items = [{ id: 'item', name: '视频', kind: 'video', mediaId: 'm' }]
  const withClip = { ...top.sequence, clips: [makeVideoEditItemClip({ ...document, sequences: [top.sequence] }, 'item', sequence.id, { frame: 0, track: 1 })] }
  const below = insertVideoEditTracks(withClip, 'video', 1, 0)
  const v1 = below.sequence.tracks.find(track => track.id === sequence.tracks[1].id)!
  expect(below.added[0].index).toBeLessThan(v1.index); expect(below.sequence.clips[0].track).toBe(v1.index)
  expect(new Set(below.sequence.tracks.map(track => track.index)).size).toBe(5)
  // 锁定的轨道需要换编号时拒绝
  const locked = { ...withClip, tracks: withClip.tracks.map(track => track.index === 1 ? { ...track, locked: true } : track) }
  expect(() => insertVideoEditTracks(locked, 'video', 1, 0)).toThrow('请先解锁该轨道')
  // 边缘加轨（拖到轨道外）：视频在最上、音频在最下，编号互不冲突
  expect(videoEditEdgeTracks(top.sequence, 'audio', 1)[0]).toMatchObject({ kind: 'audio', index: 4, name: '音频 2' })
})

it('删除轨道连同其上片段，每类至少保留一条、锁定轨道不能删除', () => {
  const document = createVideoEditDocument('删除轨道')
  document.sequences[0] = insertVideoEditTracks(document.sequences[0], 'video', 1, 1).sequence
  document.media = [{ id: 'm', name: '视频', path: 'D:/a.mp4', kind: 'video', width: 64, height: 64, durationSeconds: 10 }]
  document.items = [{ id: 'item', name: '视频', kind: 'video', mediaId: 'm' }]
  document.sequences[0].clips = [makeVideoEditItemClip(document, 'item', document.sequences[0].id, { frame: 0, track: 2 })]
  const v2 = document.sequences[0].tracks.find(track => track.index === 2)!
  const next = removeVideoEditTracks(document, document.sequences[0].id, [v2.id])
  expect(next.tracks.map(track => track.index)).toEqual([0, 1]); expect(next.clips).toEqual([])
  const audio = document.sequences[0].tracks.find(track => track.kind === 'audio')!
  expect(() => removeVideoEditTracks(document, document.sequences[0].id, [audio.id])).toThrow('至少保留一条音频轨道')
  document.sequences[0].tracks = document.sequences[0].tracks.map(track => track.id === v2.id ? { ...track, locked: true } : track)
  expect(() => removeVideoEditTracks(document, document.sequences[0].id, [v2.id])).toThrow('已锁定')
})

it('界面加删轨道各一步撤销；助手经通用集合新建与删除轨道，回读真实序列', async () => {
  const owner = await createVideoEditProject(); const projectId = owner.document.id; const sequenceId = owner.activeSequenceId
  const history = owner.past.length
  const [added] = addVideoEditTracks(projectId, sequenceId, [{ kind: 'audio', count: 1, slot: 1 }])
  expect(owner.past).toHaveLength(history + 1); expect(owner.document.sequences[0].tracks).toHaveLength(3)
  deleteVideoEditTracks(projectId, sequenceId, [added])
  expect(owner.document.sequences[0].tracks).toHaveLength(2)
  undoVideoEdit(projectId); expect(owner.document.sequences[0].tracks.some(track => track.id === added)).toBe(true)
  undoVideoEdit(projectId); expect(owner.document.sequences[0].tracks).toHaveLength(2)

  const app = createApplicationHarness(); const parent = { kind: 'video_edit.sequence', id: `${projectId}:${sequenceId}` }
  const baseline = await app.read(parent)
  const created = await app.call('change_application_entities', { summary: '新建一条视频轨', changes: [{ kind: 'create_items', entityType: 'video_edit.track', parent, items: [{ properties: { 'video_edit.track.kind': 'video', 'video_edit.track.name': '字幕' } }] }] }, baseline.revisions as Record<string, number>)
  expect(created, JSON.stringify(created)).toMatchObject({ ok: true })
  const track = owner.document.sequences[0].tracks.find(value => value.name === '字幕')!
  expect(track).toMatchObject({ kind: 'video', index: 2 })
  expect(await app.read({ kind: 'video_edit.track', id: `${projectId}:${track.id}` }, ['video_edit.track.kind', 'video_edit.track.name'])).toMatchObject({ properties: { 'video_edit.track.kind': 'video', 'video_edit.track.name': '字幕' } })
  const current = await app.read(parent)
  const removed = await app.call('change_application_entities', { summary: '删除视频轨', changes: [{ kind: 'remove_items', entityType: 'video_edit.track', parent, targets: [{ kind: 'video_edit.track', id: `${projectId}:${track.id}` }] }] }, current.revisions as Record<string, number>)
  expect(removed, JSON.stringify(removed)).toMatchObject({ ok: true })
  expect(owner.document.sequences[0].tracks.some(value => value.id === track.id)).toBe(false)
})
