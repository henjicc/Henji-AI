// @vitest-environment jsdom
import React, { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'
import { registry } from '@/core/ModelRegistry'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { closeVideoEditProject, createVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, setVideoEditTimelineView, subscribeVideoEdit, videoEditRevision, type VideoEditInstance } from '../application/videoEditService'
import { resetVideoEditInPlaceJobsForTest, startVideoEditInPlaceGeneration } from '../application/videoEditInPlaceGeneration'
import { VideoEditTimeline } from '../VideoEditTimeline'
import { resetFilmstripFramesForTests } from '@/services/videoFilmstrip/filmstripFrameService'
import { VideoEditInPlaceDialog } from '../panels/VideoEditInPlaceDialog'
import * as inPlaceService from '../application/videoEditInPlaceGeneration'
import { createApplicationHarness } from '@/tests/applicationHarness'

/** 时间线上的原地生成（4.12）：右键菜单按落点给出生成项，面板说明落点；占位显示在原位置，取消后消失且剪辑不变。不发起真实生成。 */
let videoModel = ''
// jsdom 没有布局：提示词编辑器（ProseMirror）聚焦后滚动到选区要量 Range 的矩形，这里给出空矩形
const emptyRects = (): DOMRectList => Object.assign([], { item: () => null }) as unknown as DOMRectList
const emptyRect = (): DOMRect => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect
beforeAll(() => { Range.prototype.getClientRects ??= emptyRects; Range.prototype.getBoundingClientRect ??= emptyRect; Element.prototype.getClientRects ??= emptyRects })
beforeAll(async () => { await loadRealModelsIntoRegistry(); videoModel = registry.listAllModels().find(model => model.meta.type === 'video')!.meta.id })
const generation = vi.hoisted(() => ({
  resolveModel: vi.fn(async () => ({ modelId: '', providerId: '', selection: 'user_default' })),
  prepare: vi.fn((input: { modelId: string; mediaType: string; options: Record<string, unknown> }) => ({ prepared: true as const, modelId: input.modelId, providerId: 'test', mediaType: input.mediaType, options: input.options })),
  submit: vi.fn(async (_input: unknown, taskId?: string) => ({ taskId: taskId!, status: 'submitted' })),
  getTask: vi.fn(() => ({ status: 'generating', resultAvailable: false, errorMessage: null, cancellable: true, progress: 0 })),
  cancelTask: vi.fn(async () => ({})),
}))
vi.mock('@/features/generation/application/generationApplicationService', () => ({ generationApplicationService: generation }))

let owner: VideoEditInstance
const onError = vi.fn()
function View(): React.ReactElement { useSyncExternalStore(subscribeVideoEdit, videoEditRevision); return <VideoEditTimeline instance={owner} onError={onError} /> }
const current = () => getActiveVideoEditSequence(owner)
const trackY = (index: number): number => { const row = document.querySelector<HTMLElement>(`[data-video-edit-track][data-track-index="${index}"]`)!; return Number.parseFloat(row.parentElement!.style.top) + Number.parseFloat(row.style.top) + 8 }

beforeEach(async () => {
  installHarnessNativeStorage(); onError.mockClear(); resetVideoEditInPlaceJobsForTest()
  generation.resolveModel.mockResolvedValue({ modelId: videoModel, providerId: 'test', selection: 'user_default' })
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/fixture/in-place.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ left: 0, top: 0, right: 900, bottom: 300, width: 900, height: 300, x: 0, y: 0, toJSON: () => ({}) }))
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900)
  owner = (await createVideoEditProject())!
  editVideoProject(owner.document.id, document => {
    document.media.push({ id: 'media', name: '视频', path: 'D:/fixture/video.mp4', kind: 'video', width: 64, height: 64, durationSeconds: 30, hasAudio: false })
    document.items.push({ id: 'video-item', name: '视频', kind: 'video', mediaId: 'media' })
    const sequence = document.sequences[0]
    const video = sequence.tracks.find(track => track.kind === 'video')!.index
    sequence.clips = [{ ...makeVideoEditItemClip(document, 'video-item', sequence.id, { frame: 0, track: video }), duration: 30 }]
    return document
  })
  setVideoEditTimelineView(owner.document.id, { selectedClipIds: [], snapping: false })
})
afterEach(async () => { cleanup(); resetVideoEditInPlaceJobsForTest(); for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage(); resetFilmstripFramesForTests() })

it('右键空白处给出“生成镜头…”，片段上给出“替换镜头…”“延长…”；面板说明落点', async () => {
  const view = render(<View />)
  const video = current().tracks.find(track => track.kind === 'video')!
  const clip = document.querySelector<HTMLElement>('[data-video-edit-clip]')!
  // 片段之后的空白处
  fireEvent.contextMenu(document.querySelector(`[data-video-edit-track="${video.id}"]`)!, { clientX: Number.parseFloat(clip.style.left) + Number.parseFloat(clip.style.width) + 40, clientY: trackY(video.index) })
  await waitFor(() => expect(view.getByRole('menuitem', { name: '生成镜头…' })).toBeTruthy())
  fireEvent.click(view.getByRole('menuitem', { name: '生成镜头…' }))
  await waitFor(() => expect(document.querySelector('[data-video-edit-in-place="generate_shot"]')).toBeTruthy())
  expect(document.body.textContent).toContain('V1 轨 · ')
  await waitFor(() => expect(generation.resolveModel).toHaveBeenCalledWith(expect.objectContaining({ mediaType: 'video' })))
  fireEvent.click(view.getByRole('button', { name: '取消' }))
  fireEvent.contextMenu(view.getByRole('button', { name: '选择片段 视频' }), { clientX: 310, clientY: 80 })
  await waitFor(() => expect(view.getByRole('menuitem', { name: '替换镜头…' })).toBeTruthy())
  expect(view.getByRole('menuitem', { name: '延长…' })).toBeTruthy()
})

it('占位显示在原位置并可取消；取消后占位消失、生成任务一并取消、剪辑不变', async () => {
  const view = render(<View />)
  const before = owner.document
  const video = current().tracks.find(track => track.kind === 'video')!
  await act(async () => { await startVideoEditInPlaceGeneration({ projectId: owner.document.id, sequenceId: current().id, intent: { action: 'generate_shot', frame: 60, duration: 90, trackIndex: video.index }, prompt: '日落空镜', modelId: videoModel, referenceRoles: [] }, { taskId: 'ui-task' }) })
  const placeholder = await waitFor(() => { const element = document.querySelector<HTMLElement>('[data-video-edit-in-place-job]'); expect(element).toBeTruthy(); return element! })
  expect(placeholder.getAttribute('data-status')).toBe('generating')
  fireEvent.click(view.getByRole('button', { name: '取消生成' }))
  await waitFor(() => expect(document.querySelector('[data-video-edit-in-place-job]')).toBeNull())
  expect(generation.cancelTask).toHaveBeenCalledWith('ui-task', expect.any(String))
  expect(owner.document).toEqual(before)
})

it('参考来源逐项选择与取消，指定时间码传入同一生成入口；取消指定帧移除输入，非法时间码阻止提交', async () => {
  editVideoProject(owner.document.id, document => {
    const sequence = document.sequences[0]; const first = sequence.clips[0]
    sequence.clips.push({ ...first, id: 'after', name: '后镜头', start: 90 })
    return document
  })
  const submit = vi.spyOn(inPlaceService, 'startVideoEditInPlaceGeneration').mockRejectedValue(new Error('测试截断生成'))
  const view = render(<VideoEditInPlaceDialog projectId={owner.document.id} sequenceId={current().id}
    intent={{ action: 'generate_shot', frame: 30, duration: 60 }} initial={{ modelId: videoModel, prompt: '日落空镜' }} onClose={() => undefined} />)
  const previous = view.getByRole('checkbox', { name: /前一|最后一帧/ })
  fireEvent.click(previous)
  fireEvent.click(view.getByRole('checkbox', { name: '指定时间帧' }))
  fireEvent.change(view.getByRole('textbox', { name: '参考帧时间码' }), { target: { value: '00:00:00:15' } })
  await act(async () => { fireEvent.click(view.getByRole('button', { name: '生成' })) })
  expect(submit.mock.calls.at(-1)?.[0]).toMatchObject({ referenceRoles: ['next_head'], referenceFrame: 15 })
  fireEvent.change(view.getByRole('textbox', { name: '参考帧时间码' }), { target: { value: '无效' } })
  expect(view.getByRole('button', { name: '生成' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(view.getByRole('checkbox', { name: '指定时间帧' }))
  expect(view.queryByRole('textbox', { name: '参考帧时间码' })).toBeNull()
  await act(async () => { fireEvent.click(view.getByRole('button', { name: '生成' })) })
  expect(submit.mock.calls.at(-1)?.[0]).not.toHaveProperty('referenceFrame')
  fireEvent.click(view.getByRole('checkbox', { name: /第一帧/ }))
  await act(async () => { fireEvent.click(view.getByRole('button', { name: '生成' })) })
  expect(submit.mock.calls.at(-1)?.[0]).toMatchObject({ referenceRoles: [] })
})

it('重开面板时已消失的参考来源不阻止取消参考并继续提交', async () => {
  const submit = vi.spyOn(inPlaceService, 'startVideoEditInPlaceGeneration').mockRejectedValue(new Error('测试截断生成'))
  const view = render(<VideoEditInPlaceDialog projectId={owner.document.id} sequenceId={current().id}
    intent={{ action: 'replace_shot', clipId: current().clips[0].id }}
    initial={{ modelId: videoModel, prompt: '日落空镜', referenceRoles: ['previous_tail'] }} onClose={() => undefined} />)
  await waitFor(() => expect(view.getByRole('button', { name: '生成' }).hasAttribute('disabled')).toBe(false))
  await act(async () => { fireEvent.click(view.getByRole('button', { name: '生成' })) })
  expect(submit.mock.calls.at(-1)?.[0]).toMatchObject({ referenceRoles: [] })
})

it('公共准备入口按逐项选择给出真实参考清单，不取帧、不提交；取消和非法来源均按同一服务处理', async () => {
  editVideoProject(owner.document.id, document => {
    const sequence = document.sequences[0]; sequence.clips.push({ ...sequence.clips[0], id: 'after', name: '后镜头', start: 90 }); return document
  })
  const model = registry.listAllModels().find(model => model.meta.type === 'video' && inPlaceService.videoEditInPlaceReferenceLimit(model.meta.id, registry.getDefaultValues(model.meta.id), 2) === 2)!
  expect(model).toBeTruthy()
  const app = createApplicationHarness(); const submit = vi.spyOn(inPlaceService, 'startVideoEditInPlaceGeneration')
  try {
    const input = { documentRef: { kind: 'video_edit.document', id: owner.document.id }, target: { action: 'generate_shot', startSeconds: 1, durationSeconds: 2 }, prompt: '日落空镜', modelId: model.meta.id,
      referenceRoles: ['next_head'], referenceTimeSeconds: .5,
    }
    const result = await app.requireResult('prepare_video_edit_in_place_generation', input)
    expect((result.plan as { references: string[] }).references).toEqual(['「后镜头」后一的第一帧', '指定时间 00:00:00:15 的节目画面'])
    expect((await app.requireResult('prepare_video_edit_in_place_generation', { ...input, referenceRoles: [], referenceTimeSeconds: undefined })).plan).toMatchObject({ references: [] })
    const invalid = await app.call('prepare_video_edit_in_place_generation', { ...input, referenceRoles: ['replaced_head'] })
    expect(invalid).toMatchObject({ ok: false }); expect(JSON.stringify(invalid)).toContain('可用来源')
    expect(submit).not.toHaveBeenCalled()
  } finally { app.dispose() }
})
