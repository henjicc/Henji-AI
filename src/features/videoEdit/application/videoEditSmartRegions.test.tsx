import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest'
import type { VideoEditBuiltinEffect } from '@/core/videoEdit/compositing'
import { getPlatform } from '@/platform/runtime'
import type { SmartRegionProgressEvent, SmartRegionRequest, SmartRegionStatus } from '@/platform/contracts/smartRegions'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { appendVideoEditClip, appendVideoEditMedia, closeVideoEditProject, getActiveVideoEditSequence, listVideoEditInstances, undoVideoEdit } from './videoEditService'
import { applyVideoEditBuiltinEffect, updateVideoEditBuiltinEffect } from './videoEditCompositing'
import { VideoEditSmartRegionControls } from '../panels/VideoEditSmartRegionControls'
import { resetVideoEditSmartRegionsForTests, startVideoEditSmartRegions, videoEditSmartRegionSegments, waitVideoEditSmartRegions } from './videoEditSmartRegions'
import { nestVideoEditSelection } from './videoEditNesting'

vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks() {}
  async updateDocument() {}
  async present() { return { presented: true, bitmap: { close() {} } } }
  async dispose() {}
} }))

let progress: ((event: SmartRegionProgressEvent) => void) | undefined
let ensure: Mock<[SmartRegionRequest], Promise<SmartRegionStatus>>
let cancel: Mock<[SmartRegionRequest], Promise<void>>
beforeEach(() => {
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/smart-regions.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
  // 只替换主进程分析服务这一边界；协调、领域校验、事务与读回都是正式实现。
  resetVideoEditSmartRegionsForTests()
  ensure = vi.fn(async (_request: SmartRegionRequest): Promise<SmartRegionStatus> => ({ state: 'analyzing', progress: 0 }))
  cancel = vi.fn(async (_request: SmartRegionRequest): Promise<void> => undefined)
  vi.spyOn(getPlatform().smartRegions, 'ensure').mockImplementation(ensure as never)
  vi.spyOn(getPlatform().smartRegions, 'cancel').mockImplementation(cancel as never)
  vi.spyOn(getPlatform().smartRegions, 'onProgress').mockImplementation((handler) => { progress = handler; return () => { progress = undefined } })
  startVideoEditSmartRegions()
})
afterEach(async () => {
  for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id)
  resetVideoEditSmartRegionsForTests(); vi.restoreAllMocks(); uninstallHarnessNativeStorage()
})

async function project() {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditMedia(id, { id: 'm1', name: '采访', path: 'D:/media/interview.mp4', kind: 'video', durationSeconds: 20, width: 1920, height: 1080 })
  appendVideoEditClip(id, 'm1'); appendVideoEditClip(id)
  const sequence = getActiveVideoEditSequence(owner)
  const video = sequence.clips.find(clip => clip.kind === 'video')!; const other = sequence.clips.find(clip => clip.kind !== 'video' && clip.kind !== 'audio')!
  return { owner, id, video, other }
}
const flush = async (): Promise<void> => { for (let index = 0; index < 20; index++) await Promise.resolve() }
it('嵌套导出等待子序列智能区域，不因父片段没有文件而略过子遮罩', async () => {
  const { owner, id, video } = await project(); const sequenceId = owner.activeSequenceId
  applyVideoEditBuiltinEffect(id, sequenceId, [video.id], 'smart:face_mosaic'); await flush()
  nestVideoEditSelection({ projectId: id, sequenceId, clipIds: getActiveVideoEditSequence(owner).clips.map(clip => clip.id) }, '带区域的子序列')
  const snapshot = getActiveVideoEditSequence(owner)
  let completed = false; const waiting = waitVideoEditSmartRegions(snapshot, snapshot).then(() => { completed = true })
  await flush(); expect(completed).toBe(false)
  const issued = ensure.mock.calls.at(-1)![0] as SmartRegionRequest
  progress!({ request: issued, status: { state: 'ready', segment: { path: '/fixture/cache/face.hsrg', startUs: issued.startUs, endUs: issued.endUs, still: false, model: 'yunet', summary: { value: 1, peak: 1 } } } })
  await waiting; expect(completed).toBe(true)
})

it('助手：给视频片段加“人脸打码”（马赛克 + 人脸区域）即开始后台分析，读 region_status 看进度；改背景、清空区域；非画面素材片段被拒绝', async () => {
  const { owner, id, video, other } = await project()
  const app = createApplicationHarness()
  try {
    const clipRef = { kind: 'video_edit.clip', id: `${id}:${video.id}` }
    const baseline = await app.read(clipRef)
    const created = await app.call('change_application_entities', { summary: '人脸打码', changes: [{ kind: 'create_items', entityType: 'video_edit.effect', parent: clipRef, items: [{ properties: {
      'video_edit.effect.definition_id': 'effect:mosaic', 'video_edit.effect.mask': { regionId: 'face', expand: 40 } } }] }] }, baseline.revisions as Record<string, number>)
    expect(created, JSON.stringify(created)).toMatchObject({ ok: true })
    const effect = getActiveVideoEditSequence(owner).clips.find(clip => clip.id === video.id)!.effects![0]
    expect(effect.mask).toEqual({ regionId: 'face', expand: 40 })
    await flush()
    const request: SmartRegionRequest = { source: 'D:/media/interview.mp4', kind: 'face', still: false, startUs: 0, endUs: expect.any(Number) as unknown as number }
    expect(ensure).toHaveBeenCalledWith(expect.objectContaining(request))
    const ref = { kind: 'video_edit.effect', id: `${id}:${effect.id}` }
    const read = async (): Promise<unknown> => ((await app.read(ref, ['video_edit.effect.region_status'])) as { properties: Record<string, unknown> }).properties['video_edit.effect.region_status']
    expect(await read()).toBe('analyzing:0%')
    const issued = ensure.mock.calls[0][0] as SmartRegionRequest
    progress!({ request: issued, status: { state: 'analyzing', progress: 0.42 } })
    expect(await read()).toBe('analyzing:42%')
    progress!({ request: issued, status: { state: 'ready', segment: { path: 'C:/cache/a.hsrg', startUs: issued.startUs, endUs: issued.endUs, still: false, model: 'yunet', summary: { value: 2, peak: 1 } } } })
    expect(await read()).toBe('ready')
    expect(Object.values(videoEditSmartRegionSegments())[0].face?.[0]).toMatchObject({ startUs: issued.startUs, endUs: issued.endUs })

    // 改成背景（另一种分析），旧的人脸已完成不取消；清空区域回到整个画面。
    const changed = await app.change(ref, { 'video_edit.effect.mask': { regionId: 'background' } })
    expect(changed, JSON.stringify(changed)).toMatchObject({ ok: true })
    await flush()
    expect(ensure).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'person' }))
    const cleared = await app.change(ref, { 'video_edit.effect.mask': null })
    expect(cleared, JSON.stringify(cleared)).toMatchObject({ ok: true })
    expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === video.id)!.effects![0].mask).toBeUndefined()
    await flush()
    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ kind: 'person' }))
    expect(await read()).toBe('')

    const otherRef = { kind: 'video_edit.clip', id: `${id}:${other.id}` }
    const before = await app.read(otherRef)
    const rejected = await app.call('change_application_entities', { summary: '文字片段打码', changes: [{ kind: 'create_items', entityType: 'video_edit.effect', parent: otherRef, items: [{ properties: {
      'video_edit.effect.definition_id': 'effect:mosaic', 'video_edit.effect.mask': { regionId: 'face' } } }] }] }, before.revisions as Record<string, number>)
    expect(rejected.ok).toBe(false); expect(JSON.stringify(rejected)).toContain('只能用在视频、图片片段上')
  } finally { app.dispose() }
})

it('导出前等待区域分析：完成后继续；失败时给出用户语言的原因', async () => {
  const { owner, id, video } = await project()
  const app = createApplicationHarness()
  try {
    const clipRef = { kind: 'video_edit.clip', id: `${id}:${video.id}` }
    const baseline = await app.read(clipRef)
    await app.call('change_application_entities', { summary: '背景虚化', changes: [{ kind: 'create_items', entityType: 'video_edit.effect', parent: clipRef, items: [{ properties: { 'video_edit.effect.definition_id': 'effect:gaussian_blur', 'video_edit.effect.mask': { regionId: 'background' } } }] }] }, baseline.revisions as Record<string, number>)
    await flush()
    const sequence = getActiveVideoEditSequence(owner)
    const waiting = waitVideoEditSmartRegions(sequence, sequence)
    const issued = ensure.mock.calls.at(-1)![0] as SmartRegionRequest
    progress!({ request: issued, status: { state: 'ready', segment: { path: 'C:/cache/p.hsrg', startUs: issued.startUs, endUs: issued.endUs, still: false, model: 'rvm', summary: { value: 0.3, peak: 0 } } } })
    await expect(waiting).resolves.toBeUndefined()

    progress!({ request: issued, status: { state: 'failed', reason: 'model' } })
    ensure.mockResolvedValueOnce({ state: 'failed', reason: 'model' })
    await expect(waitVideoEditSmartRegions(sequence, sequence)).rejects.toThrow('本地模型下载失败')
  } finally { app.dispose() }
})

it('效果面板“智能”预设：人脸打码只加到所选的视频片段（文字片段跳过），一步撤销；效果控件改区域、清空区域', async () => {
  const { owner, id, video, other } = await project()
  const sequenceId = getActiveVideoEditSequence(owner).id
  const created = applyVideoEditBuiltinEffect(id, sequenceId, [video.id, other.id], 'smart:face_mosaic')
  expect(created).toHaveLength(1)
  const effect = getActiveVideoEditSequence(owner).clips.find(clip => clip.id === video.id)!.effects![0]
  expect(effect).toMatchObject({ name: '人脸打码', builtin: { id: 'mosaic', params: { block_size: 40 } }, mask: { regionId: 'face' } })
  expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === other.id)!.effects ?? []).toEqual([])
  expect(() => applyVideoEditBuiltinEffect(id, sequenceId, [other.id], 'smart:background_blur')).toThrow('请选择视频或图片片段')
  updateVideoEditBuiltinEffect({ projectId: id, sequenceId, clipId: video.id }, effect.id, { mask: { regionId: 'text', feather: 40 } })
  expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === video.id)!.effects![0].mask).toEqual({ regionId: 'text', feather: 40 })
  updateVideoEditBuiltinEffect({ projectId: id, sequenceId, clipId: video.id }, effect.id, { mask: null })
  expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === video.id)!.effects![0].mask).toBeUndefined()
  undoVideoEdit(id); undoVideoEdit(id); undoVideoEdit(id)
  expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === video.id)!.effects ?? []).toEqual([])
})

it('效果控件的作用区域：选区域后出现羽化 / 扩展 / 反转与分析进度；失败给出说明、重试与去下载模型；文字片段只有手绘遮罩', async () => {
  const { owner, id, video, other } = await project()
  const sequenceId = getActiveVideoEditSequence(owner).id
  applyVideoEditBuiltinEffect(id, sequenceId, [video.id], 'smart:background_blur')
  await flush()
  const target = { projectId: id, sequenceId, clipId: video.id }
  const effect = (): VideoEditBuiltinEffect => getActiveVideoEditSequence(owner).clips.find(clip => clip.id === video.id)!.effects![0] as VideoEditBuiltinEffect
  const gesture = { begin: vi.fn(), finish: vi.fn(), cancel: vi.fn(), active: () => false, commit: (changes: Parameters<typeof updateVideoEditBuiltinEffect>[2]) => updateVideoEditBuiltinEffect(target, effect().id, changes) }
  const view = render(<VideoEditSmartRegionControls target={target} effect={effect()} gesture={gesture} />)
  expect(view.getByRole('status').textContent).toContain('正在分析画面')
  expect(view.getByLabelText('羽化')).toBeTruthy(); expect(view.getByLabelText('反转作用区域')).toBeTruthy()
  const issued = ensure.mock.calls.at(-1)![0]
  act(() => { progress!({ request: issued, status: { state: 'failed', reason: 'model' } }) })
  expect(view.getByRole('alert').textContent).toContain('本地模型下载失败')
  fireEvent.click(view.getByText('重试'))
  await flush()
  expect(ensure).toHaveBeenLastCalledWith(issued)
  view.unmount()
  const textView = render(<VideoEditSmartRegionControls target={{ ...target, clipId: other.id }} effect={effect()} gesture={gesture} />)
  // 文字片段不能分析画面：只有手绘遮罩（4.10），没有分析进度
  expect(textView.getByLabelText('创建椭圆遮罩')).toBeTruthy(); expect(textView.queryByRole('status')).toBeNull()
  cleanup()
})
