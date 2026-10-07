import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { videoEditSceneCutFrames } from '@/core/videoEdit/sceneEdits'
import { VideoEditSceneDetectionDialog } from '../panels/VideoEditSceneDetectionDialog'
import { detectVideoEditScenes, applyVideoEditScenes } from './videoEditSceneDetection'
import { editVideoProject, getActiveVideoEditSequence, undoVideoEdit } from './videoEditService'
import { closeAllVideoEdits, savedVideoEdit, failVideoEditSaves } from './videoEditDocumentTestKit'
import { appendVideoEditItems } from './videoEditProjectItems'
import { registerVideoEditSourcePresenter, updateVideoEditSource } from './videoEditSource'

vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks() {} async updateDocument() {} async present() { return { presented: true, bitmap: { close() {} } } } async dispose() {}
} }))
beforeEach(() => {
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().sceneDetection, 'detect').mockResolvedValue({ cutsSeconds: [2, 3], contentIdentity: 'a'.repeat(64) })
  vi.spyOn(getPlatform().sceneDetection, 'validate').mockResolvedValue(true)
  vi.spyOn(getPlatform().sceneDetection, 'onProgress').mockReturnValue(() => undefined)
  vi.spyOn(getPlatform().sceneDetection, 'cancel').mockResolvedValue()
})
afterEach(async () => { cleanup(); await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
async function fixture() {
  const owner = await createVideoEditProject(); const id = owner.document.id
  editVideoProject(id, document => {
    document.media.push({ id: 'media', name: '采访', path: '/fixture/scene.mp4', kind: 'video', width: 64, height: 64, durationSeconds: 10, hasAudio: true })
    document.items.push({ id: 'item', name: '采访', kind: 'video', mediaId: 'media' })
    const sequence = document.sequences[0]
    const base = makeVideoEditItemClip(document, 'item', sequence.id, { frame: 30, duration: 90, sourceInUs: 1000000, sourceOutUs: 4000000 })
    sequence.clips = [{ ...base, id: 'clip', linkId: 'pair', sourceComponent: 'video', curves: { opacity: [{ time: 0, value: .2, interpolation: 'linear' }, { time: 89, value: 1, interpolation: 'linear' }] } }, { ...base, id: 'sound', kind: 'audio', track: sequence.tracks.find(track => track.kind === 'audio')!.index, sourceComponent: 'audio', linkId: 'pair' }]
    sequence.markers = [{ id: 'old-marker', clipId: 'clip', frame: 100, name: '保留标记' }]
    sequence.captions = [{ id: 'caption', clipId: 'clip', start: 50, duration: 65, text: '保留字幕' }]
    return document
  })
  return { owner, target: { projectId: id, sequenceId: owner.activeSequenceId, clipId: 'clip' }, input: { documentRef: { kind: 'video_edit.document', id }, clipRef: { kind: 'video_edit.clip', id: `${id}:clip` } } }
}
it('对话框多选应用关联音画拆分、标记、子剪辑；一步撤销恢复原状态', async () => {
  const { owner, target } = await fixture(); const before = structuredClone(owner.document); const history = owner.past.length
  const close = vi.fn(); render(<VideoEditSceneDetectionDialog target={target} onClose={close} />)
  fireEvent.click(screen.getByRole('checkbox', { name: '添加片段标记' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '创建子剪辑（素材面板）' }))
  fireEvent.click(screen.getByRole('button', { name: '检测并应用' }))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  const sequence = getActiveVideoEditSequence(owner)
  expect(sequence.clips.filter(clip => clip.kind === 'video').map(clip => clip.duration)).toEqual([30, 30, 30])
  expect(sequence.clips.filter(clip => clip.kind === 'audio')).toHaveLength(3)
  expect(sequence.markers?.map(marker => marker.frame).sort()).toEqual([100, 60, 90].sort())
  expect(sequence.captions?.reduce((sum, caption) => sum + caption.duration, 0)).toBe(65)
  expect(sequence.clips.filter(clip => clip.kind === 'video').every(clip => clip.curves?.opacity?.length)).toBe(true)
  expect(owner.document.items.slice(1).map(item => item.sourceRange)).toEqual([{ inUs: 1000000, outUs: 2000000 }, { inUs: 2000000, outUs: 3000000 }, { inUs: 3000000, outUs: 4000000 }])
  expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(owner.document.id); expect(owner.document.sequences).toEqual(before.sequences); expect(owner.document.items).toEqual(before.items)
})
it('公共检测与应用保存回读，子剪辑范围可读写、预览及拖入；纯标记不拆分', async () => {
  const { owner, target, input } = await fixture(); const app = createApplicationHarness()
  try {
    const result = await app.requireResult('detect_video_edit_scenes', input)
    expect(result).toMatchObject({ cutsSeconds: [2, 3], cutFrames: [60, 90] })
    expect((await app.call('apply_video_edit_scenes', { ...input, analysisId: result.analysisId, options: { split: false, markers: true, subclips: true } })).ok).toBe(true)
    expect(savedVideoEdit(owner).sequences).toEqual(owner.document.sequences)
    expect(owner.document.sequences[0].clips).toHaveLength(2)
    const item = owner.document.items[2]; const ref = { kind: 'video_edit.item', id: `${target.projectId}:${item.id}` }
    expect((await app.read(ref, ['video_edit.item.source_range'])).properties).toEqual({ 'video_edit.item.source_range': { inUs: 2000000, outUs: 3000000 } })
    const off = registerVideoEditSourcePresenter(target.projectId, async request => ({ ...request, presentedTimeUs: request.timeUs }))
    try { expect(await updateVideoEditSource(target.projectId, { itemId: item.id })).toMatchObject({ timeUs: 2000000, inUs: 2000000, outUs: 3000000 }) } finally { off() }
    const placed = appendVideoEditItems(target.projectId, [item.id], target.sequenceId, { frame: 150 })
    expect(owner.document.sequences[0].clips.find(clip => clip.id === placed[0])).toMatchObject({ sourceInUs: 2000000, duration: 30 })
    const cleared = await app.change(ref, { 'video_edit.item.source_range': null }); expect(cleared, JSON.stringify(cleared)).toMatchObject({ ok: true })
    expect(owner.document.items.find(value => value.id === item.id)?.sourceRange).toBeUndefined()
    expect((await app.change(ref, { 'video_edit.item.source_range': { inUs: 0, outUs: 11000000 } })).ok).toBe(false)
  } finally { app.dispose() }
})
it('变速和倒放切点使用实际采样边界；首尾与重复帧排除', async () => {
  const { owner } = await fixture(); const sequence = owner.document.sequences[0]; const clip = sequence.clips[0]
  expect(videoEditSceneCutFrames({ ...clip, speed: { numerator: 2, denominator: 1 } }, sequence, [1, 2, 2.0001, 7])).toEqual([45, 46])
  expect(videoEditSceneCutFrames({ ...clip, sourceInUs: 4000000, reverse: true }, sequence, [1, 2, 2.0001, 3, 4])).toEqual([60, 89, 90])
})
it('检测结果过期、锁轨、跨片段及源内容变化均不写入', async () => {
  const { owner, target } = await fixture(); const analysis = await detectVideoEditScenes(target)
  const history = owner.past.length
  await expect(applyVideoEditScenes({ ...target, clipId: 'sound' }, analysis.analysisId, { split: true, markers: false, subclips: false })).rejects.toThrow('不属于')
  vi.mocked(getPlatform().sceneDetection.validate).mockResolvedValueOnce(false)
  await expect(applyVideoEditScenes(target, analysis.analysisId, { split: true, markers: false, subclips: false })).rejects.toThrow('原视频已改变')
  expect(owner.past).toHaveLength(history)
  editVideoProject(target.projectId, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, tracks: sequence.tracks.map(track => ({ ...track, locked: true })) })) }))
  await expect(applyVideoEditScenes(target, analysis.analysisId, { split: true, markers: false, subclips: false })).rejects.toThrow('已改变')
  const locked = await detectVideoEditScenes(target)
  await expect(applyVideoEditScenes(target, locked.analysisId, { split: true, markers: false, subclips: false })).rejects.toThrow('锁定')
})
it('后台检测及应用校验等待期间的编辑不会被旧结果覆盖；关闭后结果释放', async () => {
  const { owner, target } = await fixture()
  const result = { cutsSeconds: [2, 3], contentIdentity: 'a'.repeat(64) }
  let finish: (value: typeof result) => void = () => undefined
  vi.mocked(getPlatform().sceneDetection.detect).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = detectVideoEditScenes(target)
  editVideoProject(target.projectId, document => ({ ...document, items: document.items.map(item => ({ ...item, name: '用户改名' })) }))
  const changed = owner.document; finish(result)
  await expect(pending).rejects.toThrow('已改变'); expect(owner.document).toBe(changed)
  const analysis = await detectVideoEditScenes(target)
  let validate: (value: boolean) => void = () => undefined
  vi.mocked(getPlatform().sceneDetection.validate).mockImplementationOnce(() => new Promise(resolve => { validate = resolve }))
  const apply = applyVideoEditScenes(target, analysis.analysisId, { split: true, markers: false, subclips: false })
  editVideoProject(target.projectId, document => ({ ...document, items: document.items.map(item => ({ ...item, name: '再次改名' })) }))
  const edited = owner.document; const history = owner.past.length; validate(true)
  await expect(apply).rejects.toThrow('已改变'); expect(owner.document).toBe(edited); expect(owner.past).toHaveLength(history)
  const last = await detectVideoEditScenes(target)
  await closeAllVideoEdits()
  await expect(applyVideoEditScenes(target, last.analysisId, { split: true, markers: false, subclips: false })).rejects.toThrow()
})
it('取消检测转发主进程且不应用；保存失败保留一次写入并只重试保存', async () => {
  const { owner, target, input } = await fixture(); const stable = owner.document
  const controller = new AbortController()
  vi.mocked(getPlatform().sceneDetection.detect).mockImplementationOnce(async () => { controller.abort(new Error('取消')); return { cutsSeconds: [2], contentIdentity: 'a'.repeat(64) } })
  await expect(detectVideoEditScenes(target, 50, controller.signal)).rejects.toThrow('取消')
  expect(getPlatform().sceneDetection.cancel).toHaveBeenCalledOnce(); expect(owner.document).toBe(stable)
  const app = createApplicationHarness()
  try {
    const analysis = await app.requireResult('detect_video_edit_scenes', input); const history = owner.past.length
    failVideoEditSaves(true)
    const result = await app.call('apply_video_edit_scenes', { ...input, analysisId: analysis.analysisId, options: { split: true, markers: false, subclips: false } })
    expect(result.ok).toBe(false); expect(owner.past).toHaveLength(history + 1); expect(owner.document.sequences[0].clips).toHaveLength(6)
    failVideoEditSaves(false); await app.requireResult('save_video_edit', { documentRef: input.documentRef })
    expect(owner.past).toHaveLength(history + 1); expect(savedVideoEdit(owner).sequences).toEqual(owner.document.sequences)
  } finally { app.dispose() }
})
