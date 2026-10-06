// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { captureVideoEditCommandContext, executeVideoEditCommand, videoEditCommandState } from './videoEditCommands'
import { appendVideoEditClip, appendVideoEditMedia, appendVideoEditSequence, closeVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, setVideoEditTimelineView, setVideoEditView, switchVideoEditSequence, undoVideoEdit } from './videoEditService'
import { copyVideoEditTimeline, updateVideoEditTrack } from './videoEditTimeline'
import { registerVideoEditTimelineViewport } from './videoEditTimelineViewport'
import { registerVideoEditSourcePresenter, readVideoEditSource, updateVideoEditSource, observeVideoEditSource } from './videoEditSource'
import { createLegacyTrackVideoEditProject } from './videoEditDocumentTestKit'

beforeEach(() => {
  installHarnessNativeStorage()
  const platform = getPlatform()
  vi.spyOn(platform.system.dialog, 'save').mockResolvedValue('D:/fixture/commands.henji-video')
  vi.spyOn(platform.system.fs, 'writeTextFile').mockResolvedValue(undefined)
  vi.spyOn(platform.system.paths, 'dirname').mockResolvedValue('D:/fixture')
  vi.spyOn(platform.media, 'allowRoot').mockResolvedValue(undefined)
})
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
async function fixture() {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id
  appendVideoEditClip(id); appendVideoEditClip(id)
  editVideoProject(id, document => { document.sequences[0].clips[1].start = 200; return document })
  const [first, second] = getActiveVideoEditSequence(owner).clips.map(clip => clip.id)
  setVideoEditTimelineView(id, { selectedClipIds: [first] }, first)
  return { owner, id, first, second, sequence: getActiveVideoEditSequence(owner) }
}
it('菜单与键位共用命令，捕获的选区和播放头不被延迟点击改写', async () => {
  const { owner, id, first, second } = await fixture(); const history = owner.past.length
  const context = captureVideoEditCommandContext(id, 'timeline', { frame: 20 })
  setVideoEditTimelineView(id, { selectedClipIds: [second] }); setVideoEditView(id, { frame: 220 })
  expect(videoEditCommandState(context, 'split').enabled).toBe(true)
  await executeVideoEditCommand(context, 'split')
  expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === first)?.duration).toBe(20)
  expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === second)?.duration).toBe(90)
  expect(owner.past.length).toBe(history + 1)
  expect(videoEditCommandState(context, 'delete').enabled).toBe(false)
})
it('菜单启用状态与领域锁定、目标占用、波纹冲突一致，不形成失败历史', async () => {
  const { owner, id, first, second, sequence } = await fixture()
  copyVideoEditTimeline(id, sequence.id, [first])
  const context = captureVideoEditCommandContext(id, 'timeline', { frame: 200 })
  expect(videoEditCommandState(context, 'paste')).toMatchObject({ enabled: false, reason: expect.stringContaining('已有片段') })
  expect(videoEditCommandState(context, 'overwrite').enabled).toBe(true)
  updateVideoEditTrack(id, sequence.id, sequence.tracks[1].id, { locked: true })
  const locked = captureVideoEditCommandContext(id, 'timeline'); const history = owner.past.length
  expect(videoEditCommandState(locked, 'delete').enabled).toBe(false); expect(videoEditCommandState(locked, 'copy').enabled).toBe(true)
  await expect(executeVideoEditCommand(locked, 'delete')).rejects.toThrow('锁定')
  expect(owner.past.length).toBe(history); expect(getActiveVideoEditSequence(owner).clips.map(clip => clip.id)).toEqual([first, second])
})
it('复制后菜单固定原剪贴板及目标轨道，跨序列按同类轨道相对顺序粘贴', async () => {
  const { owner, id, first, second, sequence } = await fixture()
  editVideoProject(id, document => {
    const current = document.sequences[0]
    current.tracks = [{ ...current.tracks[0], index: 0 }, { ...current.tracks[1], index: 1 }, { ...current.tracks[0], id: 'audio-2', index: 2 }, { ...current.tracks[1], id: 'video-3', index: 3 }]
    current.clips[1].track = 3; return document
  })
  copyVideoEditTimeline(id, sequence.id, [first, second])
  const next = appendVideoEditSequence(id); switchVideoEditSequence(id, next)
  editVideoProject(id, document => { const current = document.sequences.find(value => value.id === next)!; current.tracks = [{ ...current.tracks[0], index: 0 }, { ...current.tracks[1], index: 1 }, { ...current.tracks[1], id: 'target-3', index: 3 }]; return document })
  const context = captureVideoEditCommandContext(id, 'timeline', { frame: 100 })
  const current = getActiveVideoEditSequence(owner)
  setVideoEditTimelineView(id, { targetTrackIds: [current.tracks.find(track => track.index === 3)!.id] }); setVideoEditView(id, { frame: 900 })
  await executeVideoEditCommand(context, 'paste')
  expect(getActiveVideoEditSequence(owner).clips.map(clip => [clip.start, clip.track])).toEqual([[100, 1], [300, 3]])
  expect(owner.document.items).toHaveLength(2)
})
it('关闭或换序列后原菜单失效，属性定位保留多选并明确主片段', async () => {
  const { owner, id, first, second } = await fixture()
  const context = captureVideoEditCommandContext(id, 'timeline', { clipIds: [second, first] })
  await executeVideoEditCommand(context, 'locate_effects')
  expect(owner.selectedClipIds).toEqual([second, first]); expect(owner.selection).toBe(second); expect(owner.activePanel).toBe('effects')
  const next = appendVideoEditSequence(id); switchVideoEditSequence(id, next)
  expect(videoEditCommandState(context, 'delete').enabled).toBe(false)
  await closeVideoEditProject(id)
  expect(videoEditCommandState(context, 'split').enabled).toBe(false)
})
it('源 I/O 为半开范围，插入保留原路径和范围；J/K/L 与步进使用同一源请求', async () => {
  const { owner, id } = await fixture()
  appendVideoEditMedia(id, { id: 'media', kind: 'video', name: '原视频', path: 'D:/source.mp4', durationSeconds: 5, width: 3840, height: 2160, frameRate: { numerator: 60, denominator: 1 }, hasAudio: true })
  const item = owner.document.items.find(item => item.mediaId === 'media')!
  const dispose = registerVideoEditSourcePresenter(id, async request => ({ timeUs: request.timeUs, presentedTimeUs: request.timeUs, playing: request.playing, volume: request.volume, playbackDirection: request.playbackDirection ?? 1 }))
  try {
    await updateVideoEditSource(id, { itemId: item.id, timeUs: 1_000_000 })
    await executeVideoEditCommand(captureVideoEditCommandContext(id, 'source'), 'mark_in')
    await updateVideoEditSource(id, { timeUs: 2_000_000 })
    await executeVideoEditCommand(captureVideoEditCommandContext(id, 'source'), 'mark_out')
    expect(readVideoEditSource(id)).toMatchObject({ inUs: 1_000_000, outUs: 2_016_667 })
    for (const [command, playing, direction] of [['play_reverse', true, -1], ['play_stop', false, 1], ['play_forward', true, 1]] as const) {
      await executeVideoEditCommand(captureVideoEditCommandContext(id, 'source'), command)
      expect(readVideoEditSource(id)).toMatchObject({ playing, playbackDirection: direction })
    }
    await executeVideoEditCommand(captureVideoEditCommandContext(id, 'source'), 'step_forward')
    expect(readVideoEditSource(id)).toMatchObject({ playing: false, timeUs: 2_025_000 })
    setVideoEditView(id, { frame: 500 })
    await executeVideoEditCommand(captureVideoEditCommandContext(id, 'source'), 'insert')
    const placed = getActiveVideoEditSequence(owner).clips.find(clip => clip.itemId === item.id)!
    expect(placed).toMatchObject({ start: 500, sourceInUs: 1_000_000, duration: 30 }); expect(owner.document.media).toHaveLength(1)
    observeVideoEditSource(id, item.id, { timeUs: 2_025_000, presentedTimeUs: 2_016_667, playing: false, volume: 1 })
    await executeVideoEditCommand(captureVideoEditCommandContext(id, 'source'), 'mark_in')
    expect(readVideoEditSource(id).inUs).toBe(2_016_667)
    observeVideoEditSource(id, item.id, { timeUs: 2_025_000, presentedTimeUs: 2_016_667, playing: false, volume: 1 })
    await executeVideoEditCommand(captureVideoEditCommandContext(id, 'source'), 'mark_out')
    expect(readVideoEditSource(id).outUs).toBe(2_033_333)
    const staleSource = captureVideoEditCommandContext(id, 'source')
    await updateVideoEditSource(id, { timeUs: 3_000_000 })
    await expect(executeVideoEditCommand(staleSource, 'mark_in')).rejects.toThrow('后续操作')
    expect(readVideoEditSource(id).inUs).toBe(2_016_667)
  } finally { dispose() }
})
it('手动节目穿梭与公共入口相同，等待源暂停确认后才开始且不覆盖后续定位', async () => {
  const { owner, id } = await fixture()
  appendVideoEditMedia(id, { id: 'source', name: '原视频', path: 'D:/source.mp4', kind: 'video', width: 3840, height: 2160, durationSeconds: 3 })
  const itemId = owner.document.items.find(item => item.mediaId === 'source')!.id
  let pause!: () => void; let defer = false
  const off = registerVideoEditSourcePresenter(id, request => {
    const result = { ...request, presentedTimeUs: request.timeUs }
    return defer && !request.playing ? new Promise(resolve => { pause = () => resolve(result) }) : Promise.resolve(result)
  })
  try {
    await updateVideoEditSource(id, { itemId, playing: true }); defer = true
    const pending = executeVideoEditCommand(captureVideoEditCommandContext(id, 'program'), 'play_forward')
    await vi.waitFor(() => expect(pause).toBeTypeOf('function')); expect(owner.playing).toBe(false)
    pause(); await pending; expect(owner.playing).toBe(true); expect(readVideoEditSource(id).playing).toBe(false)
    defer = false; await updateVideoEditSource(id, { playing: true }); defer = true
    const rejected = expect(executeVideoEditCommand(captureVideoEditCommandContext(id, 'program'), 'play_forward')).rejects.toThrow('后续控制')
    await vi.waitFor(() => expect(readVideoEditSource(id).status).toBe('loading'))
    setVideoEditView(id, { frame: 70, playing: false }); pause(); await rejected
    expect(owner).toMatchObject({ frame: 70, playing: false })
  } finally { off() }
})
it('Premiere 时间线视图键：五帧步进、轨道高度一步编辑、缩放到序列与翻屏只在时间线显示时可用', async () => {
  const { owner, id, sequence } = await fixture()
  setVideoEditView(id, { frame: 20 })
  await executeVideoEditCommand(captureVideoEditCommandContext(id, 'timeline'), 'step_forward_five')
  expect(owner.frame).toBe(25)
  await executeVideoEditCommand(captureVideoEditCommandContext(id, 'timeline'), 'step_back_five')
  expect(owner.frame).toBe(20)
  const history = owner.past.length
  await executeVideoEditCommand(captureVideoEditCommandContext(id, 'timeline'), 'increase_video_tracks')
  const heights = () => getActiveVideoEditSequence(owner).tracks.map(track => [track.kind, track.height ?? 32])
  expect(heights()).toEqual(sequence.tracks.map(track => [track.kind, (track.height ?? 32) + (track.kind === 'video' ? 8 : 0)]))
  expect(owner.past.length).toBe(history + 1)
  await executeVideoEditCommand(captureVideoEditCommandContext(id, 'timeline'), 'minimize_all_tracks')
  expect(heights().every(([, height]) => height === 24)).toBe(true)
  expect(videoEditCommandState(captureVideoEditCommandContext(id, 'timeline'), 'decrease_audio_tracks')).toMatchObject({ enabled: false })
  expect(videoEditCommandState(captureVideoEditCommandContext(id, 'timeline'), 'zoom_to_sequence')).toMatchObject({ enabled: false })
  const calls: string[] = []
  const off = registerVideoEditTimelineViewport(id, { sequenceId: sequence.id, zoomToSequence: () => calls.push('fit'), showScreen: direction => calls.push(`screen:${direction}`) })
  try {
    for (const command of ['zoom_to_sequence', 'next_screen', 'previous_screen'] as const) await executeVideoEditCommand(captureVideoEditCommandContext(id, 'timeline'), command)
    expect(calls).toEqual(['fit', 'screen:1', 'screen:-1'])
  } finally { off() }
})
it('Premiere 导航、标记片段、入出点与序列标记键按目标轨道定位，没有落点时说明原因', async () => {
  const { owner, id, sequence } = await fixture()
  const video = sequence.tracks.find(track => track.index === 1)!
  setVideoEditTimelineView(id, { targetTrackIds: [video.id] }); setVideoEditView(id, { frame: 120 })
  const run = (command: Parameters<typeof executeVideoEditCommand>[1], scope: 'timeline' | 'source' = 'timeline') => executeVideoEditCommand(captureVideoEditCommandContext(id, scope), command)
  await run('go_prev_edit'); expect(owner.frame).toBe(90)
  await run('go_next_edit'); expect(owner.frame).toBe(200)
  await run('go_next_edit'); expect(owner.frame).toBe(290)
  expect(videoEditCommandState(captureVideoEditCommandContext(id, 'timeline'), 'go_next_edit')).toMatchObject({ enabled: false, reason: '这个方向没有编辑点。' })
  await run('go_start'); expect(owner.frame).toBe(0)
  await run('go_end'); expect(owner.frame).toBe(290)
  setVideoEditView(id, { frame: 210 }); await run('mark_clip')
  expect(owner).toMatchObject({ inFrame: 200, outFrame: 290 })
  setVideoEditView(id, { frame: 0 }); await run('go_out'); expect(owner.frame).toBe(289)
  await run('go_in'); expect(owner.frame).toBe(200)
  await run('clear_out'); expect(owner).toMatchObject({ inFrame: 200, outFrame: null })
  await run('clear_in_out'); expect(owner).toMatchObject({ inFrame: null, outFrame: null })
  expect(videoEditCommandState(captureVideoEditCommandContext(id, 'timeline'), 'go_in').enabled).toBe(false)
  setVideoEditView(id, { frame: 30 }); await run('add_marker'); setVideoEditView(id, { frame: 250 }); await run('add_marker')
  expect(getActiveVideoEditSequence(owner).markers?.map(mark => [mark.frame, mark.name])).toEqual([[30, '标记 1'], [250, '标记 2']])
  await run('prev_marker'); expect(owner.frame).toBe(30)
  await run('next_marker'); expect(owner.frame).toBe(250)
  setVideoEditView(id, { frame: 10 }); setVideoEditTimelineView(id, { selectedClipIds: [] }); await run('select_clip_at_playhead')
  expect(owner.selectedClipIds).toHaveLength(1)
  await run('deselect_all'); expect(owner.selectedClipIds).toEqual([])
})
it('提升、提取与 Q/W 波纹修剪各是一步编辑；Alt 方向键微移所选片段；Ctrl+L 链接开关与剪切', async () => {
  const { owner, id, first, second, sequence } = await fixture()
  const video = sequence.tracks.find(track => track.index === 1)!
  setVideoEditTimelineView(id, { targetTrackIds: [video.id], inFrame: 40, outFrame: 60 })
  const run = (command: Parameters<typeof executeVideoEditCommand>[1]) => executeVideoEditCommand(captureVideoEditCommandContext(id, 'timeline'), command)
  const spans = () => getActiveVideoEditSequence(owner).clips.filter(clip => clip.track === 1).map(clip => [clip.start, clip.start + clip.duration]).sort((a, b) => a[0] - b[0])
  let history = owner.past.length
  await run('lift'); expect(spans()).toEqual([[0, 40], [60, 90], [200, 290]]); expect(owner.past.length).toBe(history + 1)
  undoVideoEdit(id)
  await run('extract'); expect(spans()).toEqual([[0, 40], [40, 70], [180, 270]])
  setVideoEditTimelineView(id, { inFrame: null, outFrame: null })
  expect(videoEditCommandState(captureVideoEditCommandContext(id, 'timeline'), 'lift')).toMatchObject({ enabled: false, reason: '请先设置序列入点或出点。' })
  setVideoEditView(id, { frame: 200 }); history = owner.past.length
  await run('ripple_trim_prev'); expect(spans()).toEqual([[0, 40], [40, 70], [180, 250]]); expect(owner.past.length).toBe(history + 1)
  setVideoEditView(id, { frame: 200 }); await run('ripple_trim_next'); expect(spans()).toEqual([[0, 40], [40, 70], [180, 200]])
  const last = getActiveVideoEditSequence(owner).clips.find(clip => clip.start === 180)!
  setVideoEditTimelineView(id, { selectedClipIds: [last.id] }, last.id)
  await run('nudge_right_five'); expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === last.id)!.start).toBe(185)
  await run('nudge_up'); expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === last.id)!.track).toBe(2)
  const left = getActiveVideoEditSequence(owner).clips.find(clip => clip.start === 0)!
  setVideoEditTimelineView(id, { selectedClipIds: [left.id, last.id] }, left.id)
  await run('toggle_link'); expect(new Set(getActiveVideoEditSequence(owner).clips.filter(clip => [left.id, last.id].includes(clip.id)).map(clip => clip.linkId)).size).toBe(1)
  await run('toggle_link'); expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === left.id)!.linkId).toBeUndefined()
  setVideoEditTimelineView(id, { selectedClipIds: [left.id] }, left.id)
  await run('cut'); expect(getActiveVideoEditSequence(owner).clips.some(clip => clip.id === left.id)).toBe(false)
  setVideoEditView(id, { frame: 0 }); await run('paste'); expect(spans()[0]).toEqual([0, 40])
  expect([first, second]).toHaveLength(2)
})
