// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { getPlatform } from '@/platform/runtime'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { isVideoEditReframeKeyframe } from '@/core/videoEdit/keyframes'
import { reframeVideoEditCapability } from '@/core/application-control/domains/videoEdit/videoEditReframeCapability'
import { analyzeVideoEditReframe } from '../engine/videoEditReframeAnalysis'
import { videoEditSmartRegionAttentionBox } from '../engine/videoEditSmartRegionMasks'
import { videoEditTrackerBox } from '../engine/videoEditTrackResults'
import { analyzeVideoEditReframeOffThread } from './videoEditReframeWorkerClient'
import { reframeVideoEdit } from './videoEditReframe'
import { executeVideoEditReframeCapability, queueVideoEditReframe } from './videoEditReframeCapability'
import { createVideoEditProject, editVideoProject, saveVideoEdit, undoVideoEdit } from './videoEditService'
import { closeAllVideoEdits, failVideoEditSaves, reopenVideoEdit, savedVideoEdit } from './videoEditDocumentTestKit'
import { updateVideoEditClipKeyframes } from './videoEditClipProperties'
import { detectVideoEditScenes } from './videoEditSceneDetection'
import { videoEditTrackerEntityId } from './videoEditCompositeEntities'
import { enqueueVideoEditExports } from './videoEditExportQueue'
import { VideoEditReframeDialog } from '../panels/VideoEditReframeDialog'
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks() {} async updateDocument() {} async present() { return { presented: true, bitmap: { close() {} } } } async dispose() {}
} }))
vi.mock('./videoEditReframeWorkerClient', () => ({ analyzeVideoEditReframeOffThread: vi.fn() }))
vi.mock('../engine/videoEditSmartRegionMasks', async importOriginal => ({ ...await importOriginal<object>(), videoEditSmartRegionAttentionBox: vi.fn() }))
vi.mock('../engine/videoEditTrackResults', async importOriginal => ({ ...await importOriginal<object>(), videoEditTrackerBox: vi.fn() }))
vi.mock('./videoEditExportQueue', async importOriginal => ({ ...await importOriginal<object>(), enqueueVideoEditExports: vi.fn() }))
const settings = { motion: 'default', attention: 'face' } as const
beforeEach(() => {
  installHarnessNativeStorage()
  vi.mocked(analyzeVideoEditReframeOffThread).mockImplementation(request => analyzeVideoEditReframe(request))
  vi.mocked(videoEditSmartRegionAttentionBox).mockImplementation(async (_url, kind, time) => kind === 'person' ? { x: .1, y: .1, width: .8, height: .8 } : { x: .3 + time / 1e6 * .05, y: .2, width: .08, height: .25 })
  vi.mocked(videoEditTrackerBox).mockResolvedValue([.4, .2, .1, .2, 1])
  vi.spyOn(getPlatform().smartRegions, 'ensure').mockImplementation(async request => ({ state: 'ready', segment: { path: `/cache/${request.kind}`, startUs: request.startUs, endUs: request.endUs, still: false, model: 'test', summary: { value: 1, peak: 1 } } }))
  vi.spyOn(getPlatform().smartRegions, 'onProgress').mockReturnValue(() => undefined)
  vi.spyOn(getPlatform().sceneDetection, 'detect').mockResolvedValue({ cutsSeconds: [1.5], contentIdentity: 'a'.repeat(64) })
  vi.spyOn(getPlatform().sceneDetection, 'validate').mockResolvedValue(true)
  vi.spyOn(getPlatform().sceneDetection, 'onProgress').mockReturnValue(() => undefined)
})
afterEach(async () => { cleanup(); await closeAllVideoEdits(); vi.restoreAllMocks(); vi.clearAllMocks(); uninstallHarnessNativeStorage() })
async function fixture() {
  const owner = await createVideoEditProject(); const id = owner.document.id
  editVideoProject(id, document => {
    document.media.push({ id: 'media', name: '采访', path: '/fixture/scene.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 10, hasAudio: true })
    document.items.push({ id: 'item', name: '采访', kind: 'video', mediaId: 'media' })
    const sequence = document.sequences[0]; const base = makeVideoEditItemClip(document, 'item', sequence.id, { frame: 30, duration: 90, sourceInUs: 1000000, sourceOutUs: 4000000 })
    sequence.clips = [{ ...base, id: 'clip', linkId: 'pair', groupId: 'group', sourceComponent: 'video', curves: { opacity: [{ time: 0, value: .8, interpolation: 'linear' }] } }, { ...base, id: 'sound', kind: 'audio', track: sequence.tracks.find(track => track.kind === 'audio')!.index, sourceComponent: 'audio', linkId: 'pair', groupId: 'group' }]
    sequence.markers = [{ id: 'marker', clipId: 'clip', frame: 50, name: '标记' }]
    sequence.captions = [{ id: 'caption', clipId: 'clip', start: 50, duration: 20, text: '字幕' }]
    return document
  })
  const target = { projectId: id, sequenceId: owner.activeSequenceId }
  return { owner, id, target, input: { documentRef: { kind: 'video_edit.document', id }, sequenceRef: { kind: 'video_edit.sequence', id: `${id}:${target.sequenceId}` }, settings } }
}
it('复制新序列、保留原序列/音画链接/声音/字幕/标记；一整组一步撤销并可保存重开', async () => {
  const { owner, target, id } = await fixture(); const original = structuredClone(owner.document.sequences[0]); const history = owner.past.length
  const result = await reframeVideoEdit(target, { size: { width: 1080, height: 1920 }, settings })
  expect(owner.document.sequences).toHaveLength(2); expect(owner.past).toHaveLength(history + 1)
  expect(owner.document.sequences[0]).toEqual(original); expect(owner.activeSequenceId).toBe(original.id)
  const created = owner.document.sequences[1]; const video = created.clips[0]
  expect(created).toMatchObject({ width: 1080, height: 1920, frameRate: original.frameRate, sampleRate: original.sampleRate })
  expect(video.curves!.scale![0].value).toBeCloseTo(256 / 81); expect(video.curves!.x!.every(isVideoEditReframeKeyframe)).toBe(true)
  expect(created.clips[1].volume).toBe(original.clips[1].volume); expect(created.clips[1].linkId).toBe(video.linkId)
  expect(video.curves!.opacity).toEqual(original.clips[0].curves!.opacity)
  expect(created.captions![0].clipId).toBe(video.id); expect(created.markers![0].clipId).toBe(video.id)
  await saveVideoEdit(id); expect(savedVideoEdit(id).sequences[1].id).toBe(result.sequenceId)
  undoVideoEdit(id); expect(owner.document.sequences).toEqual([original])
  await saveVideoEdit(id); expect((await reopenVideoEdit(id)).document.sequences).toEqual([original])
})
it('单片段能力适配器重生成保留手动点、其他动画；UI 与助手同一写入口并核实保存', async () => {
  const { owner, target, id, input } = await fixture()
  const result = await reframeVideoEdit(target, { size: { width: 1080, height: 1920 }, settings })
  const created = owner.document.sequences[1]; const clip = created.clips[0]
  const manual = { time: 0, value: clip.curves!.x![0].value, interpolation: 'linear' as const }
  updateVideoEditClipKeyframes(id, result.sequenceId, clip.id, 'x', [manual, ...clip.curves!.x!.slice(1)])
    const response = await executeVideoEditReframeCapability(reframeVideoEditCapability.inputSchema.parse({ documentRef: input.documentRef, clipRef: { kind: 'video_edit.clip', id: `${id}:${clip.id}` }, settings }))
    expect(response).toMatchObject({ created: false, verified: true, resultRef: { kind: 'video_edit.sequence', id: `${id}:${created.id}` } })
    expect(owner.document.sequences).toHaveLength(2)
    expect(savedVideoEdit(id).sequences[1].clips[0].curves!.x).toEqual(owner.document.sequences[1].clips[0].curves!.x)
    expect(owner.document.sequences[1].clips[0].curves!.x![0]).toEqual(manual)
})
it('默认人物装不下时用最大人脸；未检出主体保持构图并如实报告', async () => {
  const { target } = await fixture()
  const result = await reframeVideoEdit(target, { size: { width: 1080, height: 1920 }, settings: { motion: 'slow', attention: 'auto' } })
  expect(result.faceFrames).toBe(90)
  vi.mocked(videoEditSmartRegionAttentionBox).mockResolvedValue(null)
  const missing = await reframeVideoEdit(target, { size: { width: 1080, height: 1920 }, settings })
  expect(missing.missingFrames).toBe(90)
})
it('复用有效场景切点而非跨镜头平滑；变速和倒放按正式源时钟读区域', async () => {
  const { owner, target, id } = await fixture()
  await detectVideoEditScenes({ ...target, clipId: 'clip' })
  const result = await reframeVideoEdit(target, { size: { width: 1080, height: 1920 }, settings })
  const points = owner.document.sequences.find(sequence => sequence.id === result.sequenceId)!.clips[0].curves!.x!
  expect(points.find(point => point.time === 14)?.interpolation).toBe('hold')
  editVideoProject(id, document => { Object.assign(document.sequences[0].clips[0], { sourceInUs: 6000000, speed: { numerator: 2, denominator: 1 }, reverse: true }); return document })
  vi.mocked(videoEditSmartRegionAttentionBox).mockClear()
  await reframeVideoEdit(target, { size: { width: 1080, height: 1920 }, settings })
  const calls = vi.mocked(videoEditSmartRegionAttentionBox).mock.calls
  // Reverse sourceIn is an exclusive boundary; the first visible sample is one source step earlier.
  expect(calls[0][2]).toBeCloseTo(5933333, -1); expect(calls[1][2]).toBeCloseTo(5866667, -1)
})
it('绑定明确跟踪器完整结果；公共引用归属校验，返回新序列供现有导出消费', async () => {
  const { owner, id, target, input } = await fixture()
  editVideoProject(id, document => { document.sequences[0].clips[0].trackers = [{ id: 'tracker', name: '主体', method: 'box', prompts: [{ timeUs: 1000000, box: [.4, .2, .1, .2] }] }]; return document })
  vi.spyOn(getPlatform().tracking, 'status').mockResolvedValue({ state: 'ready', result: { path: '/cache/tracker', startUs: 0, endUs: 10000000, fps: 30, summary: { tracked: 300, lost: 0 } } })
    const result = await executeVideoEditReframeCapability(reframeVideoEditCapability.inputSchema.parse({ ...input, settings: { attention: 'tracker', motion: 'default' }, trackerBindings: [{ clipRef: { kind: 'video_edit.clip', id: `${id}:clip` }, trackerRef: { kind: 'video_edit.tracker', id: `${id}:${videoEditTrackerEntityId('clip', 'tracker')}` } }] }))
    expect(result.verified).toBe(true); expect(result.resultRef).toMatchObject({ kind: 'video_edit.sequence' })
    expect(videoEditTrackerBox).toHaveBeenCalledTimes(90)
    await expect(executeVideoEditReframeCapability(reframeVideoEditCapability.inputSchema.parse({ ...input, sequenceRef: { ...input.sequenceRef, id: `foreign:${target.sequenceId}` } }))).rejects.toThrow('documentRef')
    expect(owner.document.sequences).toHaveLength(2)
})
it('正式公共注册与通用属性回读共同核实重构结果', async () => {
  const { owner, id, input } = await fixture()
  const app = createApplicationHarness()
  try {
    const result = await app.requireResult('auto_reframe_video_edit', input)
    expect(result).toMatchObject({ verified: true, created: true })
    const created = owner.document.sequences[1]
    const read = await app.read({ kind: 'video_edit.clip', id: `${id}:${created.clips[0].id}` }, ['video_edit.clip.x.keyframes'])
    expect((read.properties as Record<string, unknown>)['video_edit.clip.x.keyframes']).toEqual(created.clips[0].curves!.x)
  } finally { app.dispose() }
})
it('取消等待、分析失败和迟到编辑不创建半成品；失败保存只恢复保存而不重新生成', async () => {
  const { owner, target, id, input } = await fixture(); const history = owner.past.length
  vi.mocked(analyzeVideoEditReframeOffThread).mockRejectedValueOnce(new Error('分析失败'))
  await expect(reframeVideoEdit(target, { size: { width: 1080, height: 1920 }, settings })).rejects.toThrow('分析失败'); expect(owner.past).toHaveLength(history)
  const controller = new AbortController()
  vi.mocked(getPlatform().smartRegions.ensure).mockImplementationOnce(async () => { controller.abort(new Error('取消')); return { state: 'analyzing', progress: 0 } })
  await expect(reframeVideoEdit(target, { size: { width: 1080, height: 1920 }, settings }, controller.signal)).rejects.toThrow('取消')
  vi.mocked(analyzeVideoEditReframeOffThread).mockImplementationOnce(async request => { const result = await analyzeVideoEditReframe(request); editVideoProject(id, document => { document.sequences[0].name = '用户编辑'; return document }); return result })
  await expect(reframeVideoEdit(target, { size: { width: 1080, height: 1920 }, settings })).rejects.toThrow('已改变')
  expect(owner.document.sequences).toHaveLength(1)
  failVideoEditSaves(true)
  await expect(executeVideoEditReframeCapability(reframeVideoEditCapability.inputSchema.parse(input))).rejects.toMatchObject({ facts: { recovery: { capabilityId: 'save_video_edit', replayMutation: false } } })
  expect(owner.document.sequences).toHaveLength(2)
  failVideoEditSaves(false); await saveVideoEdit(id)
  expect(savedVideoEdit(id).sequences).toHaveLength(2)
})
it('锁轨拒绝单片段修改；复制锁轨序列不改变原序列锁定，复制仍只占一步撤销', async () => {
  const { owner, target, id } = await fixture()
  editVideoProject(id, document => { document.sequences[0].tracks.forEach(track => { track.locked = true }); return document })
  await expect(reframeVideoEdit({ ...target, clipId: 'clip' }, { settings })).rejects.toThrow('锁定')
  const result = await reframeVideoEdit(target, { size: { width: 1080, height: 1920 }, settings })
  expect(owner.document.sequences.find(sequence => sequence.id === result.sequenceId)!.tracks.every(track => track.locked)).toBe(true)
})
it('对话框使用自动默认与慢/快意图；创建后用户可查看，失败重试保存不再复制', async () => {
  const { owner, target } = await fixture(); const close = vi.fn()
  failVideoEditSaves(true)
  render(<VideoEditReframeDialog target={target} onClose={close} />)
  fireEvent.click(screen.getByRole('button', { name: '创建并重构' }))
  await waitFor(() => expect(owner.document.sequences).toHaveLength(2))
  await waitFor(() => expect(screen.getByRole('button', { name: '重试保存' })).toBeTruthy())
  failVideoEditSaves(false)
  fireEvent.click(screen.getByRole('button', { name: '重试保存' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '完成' })).toBeTruthy())
  expect(owner.document.sequences).toHaveLength(2)
  expect(screen.getByText(/部分画面按人脸构图/)).toBeTruthy()
  await waitFor(() => expect(owner.activeSequenceId).toBe(owner.document.sequences[1].id))
  fireEvent.click(screen.getByRole('button', { name: '完成' })); expect(close).toHaveBeenCalledOnce()
})
it('导出选择原结果引用，相同画幅预设；入队失败保留已完成序列且可单独重试', async () => {
  const { owner, target, id } = await fixture()
  const result = await reframeVideoEdit(target, { size: { width: 1080, height: 1920 }, settings })
  vi.mocked(enqueueVideoEditExports).mockResolvedValueOnce([])
  const cancelled = await queueVideoEditReframe(id, result.sequenceId, 'builtin:douyin')
  expect(cancelled.exportIssue).toContain('取消'); expect(owner.document.sequences).toHaveLength(2)
  expect(enqueueVideoEditExports).toHaveBeenLastCalledWith([{ projectId: id, sequenceId: result.sequenceId, presetId: 'builtin:douyin' }], undefined)
  const mismatch = await queueVideoEditReframe(id, result.sequenceId, 'builtin:bilibili')
  expect(mismatch.exportIssue).toContain('画幅'); expect(enqueueVideoEditExports).toHaveBeenCalledTimes(1)
})
