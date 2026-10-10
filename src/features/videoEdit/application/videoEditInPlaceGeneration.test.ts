import { createVideoEditTestDocument as createVideoEditDocument } from '../../../core/videoEdit/testFixtures'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type VideoEditDocument } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { VIDEO_EDIT_MAX_SEQUENCE_SECONDS, videoEditFps } from '@/core/videoEdit/time'

/*
 * 原地生成的执行编排：生成链路、取帧、收录与导入都换成替身，只验证编排本身——
 * 占位何时出现与消失、参考帧怎么带入、完成后一步落位、提交前失败不留占位、取消会取消生成任务。
 * 不发起任何真实生成。
 */
const state = vi.hoisted(() => ({
  document: null as unknown as VideoEditDocument,
  task: { status: 'pending', resultAvailable: false, errorMessage: null as string | null, cancellable: true, progress: 0 },
  listeners: new Set<() => void>(),
  submitError: null as Error | null,
  opened: true,
  ownerListeners: new Set<() => void>(),
  history: null as { status: string } | null,
  liveMissing: false,
  saveError: false,
}))
const generation = vi.hoisted(() => ({
  resolveModel: vi.fn(async () => ({ modelId: 'test-video', providerId: 'test', selection: 'user_default' })),
  prepare: vi.fn(() => ({ prepared: true, priceEstimate: { comparableCnyAmount: 1 } })),
  submit: vi.fn(async (_input: unknown, taskId?: string) => { if (state.submitError) throw state.submitError; return { taskId: taskId!, status: 'submitted' } }),
  getTask: vi.fn(() => { if (state.liveMissing) throw new Error('TASK_NOT_FOUND'); return { ...state.task } }),
  cancelTask: vi.fn(async () => ({})),
}))
const observe = vi.hoisted(() => vi.fn(async (_projectId: string, target: { kind: 'source'; itemId: string; timeUs: number } | { kind: 'program'; sequenceId?: string; frame: number }) => ({ asset: { filePath: target.kind === 'source' ? `/frames/${target.itemId}-${target.timeUs}.png` : `/frames/program-${target.frame}.png` } })))
const imports = vi.hoisted(() => vi.fn())
const saves = vi.hoisted(() => vi.fn(async () => { if (state.saveError) throw new Error('保存失败') }))
vi.mock('@/services/database', () => ({ databaseService: { getHistoryById: vi.fn(async () => state.history ?? (state.task.status === 'success' ? { status: 'success' } : null)) } }))

vi.mock('@/core/ModelRegistry', () => ({ registry: { getModel: (id: string) => ({ meta: { id, type: id.startsWith('test-audio') ? 'audio' : 'video', provider: 'test' } }), getSchema: () => [], getDefaultValues: () => ({}) } }))
vi.mock('@/core/inputs/inputLimits', () => ({ resolveInputLimits: () => ({ images: { min: 0, max: 2 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 } }) }))
vi.mock('@/features/generation/application/generationApplicationService', () => ({ generationApplicationService: generation }))
vi.mock('@/workspaces/GenerationWorkspace/application/visibleGenerationTaskCommand', () => ({ subscribeVisibleGenerationTaskChanges: (listener: () => void) => { state.listeners.add(listener); return () => state.listeners.delete(listener) } }))
vi.mock('@/services/imageSource', () => ({ toFetchableMediaUrl: (path: string) => `henji-media://${path}` }))
vi.mock('./videoEditFrameObservation', () => ({ observeVideoEditFrame: observe }))
vi.mock('./videoEditCreativeSources', () => ({ prepareVideoEditCreativeResult: async (source: { recordId: string }) => ({ asset: { id: 'asset-gen' }, origin: { type: 'generation', recordId: source.recordId, outputIndex: 0 } }) }))
vi.mock('./videoEditResultTarget', () => ({ placeVideoEditFileInProject: async (_owner: unknown, path: string) => path }))
vi.mock('./videoEditMedia', () => ({ importVideoEditSources: imports }))
vi.mock('./videoEditService', () => ({
  subscribeVideoEditDomain: () => () => undefined,
  requireVideoEditInstance: () => { if (!state.opened) throw new Error('已关闭'); return owner },
  subscribeVideoEdit: (listener: () => void) => { state.ownerListeners.add(listener); return () => state.ownerListeners.delete(listener) },
  updateVideoEditInPlaceMetadata: (_id: string, records: VideoEditDocument['inPlaceGenerations']) => { state.document = { ...state.document }; if (records?.length) state.document.inPlaceGenerations = structuredClone(records); else delete state.document.inPlaceGenerations },
  saveVideoEdit: saves,
  editVideoProject: (_id: string, update: (document: VideoEditDocument) => VideoEditDocument) => { state.document = update(state.document) },
}))

const owner = { get document() { return state.document }, get activeSequenceId() { return state.document.sequences[0].id }, targetTrackIds: [], sequenceViews: new Map() }

const service = await import('./videoEditInPlaceGeneration')

function fixture(): void {
  const document = createVideoEditDocument('原地生成')
  document.media = [{ id: 'media', name: '原视频', path: 'D:/clip.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 20 }]
  document.items = [{ id: 'item', name: '原视频', kind: 'video', mediaId: 'media' }]
  const sequence = document.sequences[0]
  const video = sequence.tracks.find(track => track.kind === 'video')!.index
  const clip = makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0, track: video, duration: 60 })
  sequence.clips = [{ ...clip, id: 'a', name: 'a' }, { ...clip, id: 'b', name: 'b', start: 150 }]
  state.document = document
}
function notify(patch: Partial<typeof state.task>): void { Object.assign(state.task, patch); for (const listener of [...state.listeners]) listener() }
const flush = async (): Promise<void> => { for (let index = 0; index < 10; index++) await Promise.resolve() }
const request = (): Parameters<typeof service.startVideoEditInPlaceGeneration>[0] => ({ projectId: state.document.id, sequenceId: state.document.sequences[0].id, intent: { action: 'generate_shot', frame: 60, trackIndex: state.document.sequences[0].tracks.find(track => track.kind === 'video')!.index }, prompt: '黄昏海边空镜' })

beforeEach(() => {
  service.resetVideoEditInPlaceJobsForTest()
  vi.clearAllMocks()
  state.task = { status: 'pending', resultAvailable: false, errorMessage: null, cancellable: true, progress: 0 }
  state.submitError = null
  state.opened = true; state.history = null; state.liveMissing = false; state.saveError = false
  fixture()
  // 导入：把生成结果作为素材项加进剪辑，再交给落位回调（一步编辑）
  imports.mockImplementation(async (_projectId: string, _sources: unknown, _bin: unknown, _signal: unknown, after: (document: VideoEditDocument, itemIds: string[]) => VideoEditDocument) => {
    const imported: VideoEditDocument = { ...state.document, media: [...state.document.media, { id: 'gen-media', name: '生成', path: 'D:/gen.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 5, assetId: 'asset-gen' }], items: [...state.document.items, { id: 'gen-item', name: '生成', kind: 'video', mediaId: 'gen-media' }] }
    state.document = after(imported, ['gen-item'])
    return ['gen-item']
  })
})

describe('原地生成执行', () => {
  it('只选后一片段首帧及指定节目帧，准备和提交一致；选择与取消均不移动播放头', async () => {
    const selected = { ...request(), referenceRoles: ['next_head' as const], referenceFrame: 45 }
    const prepared = await service.prepareVideoEditInPlace(selected)
    expect(prepared.references.map(reference => reference.role)).toEqual(['next_head', 'specified_time'])
    expect(observe).not.toHaveBeenCalled()
    await service.startVideoEditInPlaceGeneration(selected, { taskId: 'selected-frames' })
    expect(observe.mock.calls.map(call => call[1])).toEqual([{ kind: 'source', itemId: 'item', timeUs: Math.round(.5 / 30 * 1e6) }, { kind: 'program', sequenceId: selected.sequenceId, frame: 45 }])
    expect(state.document.inPlaceGenerations?.[0].request).toMatchObject({ referenceRoles: ['next_head'], referenceFrame: 45 })
    observe.mockClear()
    await service.startVideoEditInPlaceGeneration({ ...request(), referenceRoles: [] }, { taskId: 'without-frames' })
    expect(observe).not.toHaveBeenCalled()
  })
  it('被替换首帧可取消，超限按同一模型规则截取；不存在的来源、越界节目帧与声音参考提交前拒绝', async () => {
    const replace = { ...request(), intent: { action: 'replace_shot' as const, clipId: 'a' }, referenceRoles: ['replaced_head' as const] }
    expect((await service.prepareVideoEditInPlace(replace)).references.map(value => value.role)).toEqual(['replaced_head'])
    expect((await service.prepareVideoEditInPlace({ ...replace, referenceRoles: [] })).references).toEqual([])
    expect((await service.prepareVideoEditInPlace({ ...request(), referenceFrame: 0 })).references.map(value => value.role)).toEqual(['previous_tail', 'next_head'])
    await expect(service.startVideoEditInPlaceGeneration({ ...request(), referenceRoles: ['replaced_head'] })).rejects.toThrow('可用来源：previous_tail、next_head')
    const frameLimit = Math.floor(videoEditFps(state.document.sequences[0].frameRate) * VIDEO_EDIT_MAX_SEQUENCE_SECONDS)
    for (const referenceFrame of [54000, frameLimit - 1]) expect((await service.prepareVideoEditInPlace({ ...request(), referenceRoles: [], referenceFrame })).references).toEqual([{ role: 'specified_time', sequenceId: request().sequenceId, frame: referenceFrame }])
    await expect(service.startVideoEditInPlaceGeneration({ ...request(), referenceFrame: frameLimit })).rejects.toThrow(`0 到 ${frameLimit - 1}`)
    await expect(service.startVideoEditInPlaceGeneration({ ...request(), modelId: 'test-audio', intent: { action: 'generate_audio', frame: 0 }, referenceFrame: 0 })).rejects.toThrow('声音生成不接受参考画面')
    expect(observe).not.toHaveBeenCalled(); expect(generation.submit).not.toHaveBeenCalled(); expect(service.listVideoEditInPlaceJobs()).toEqual([])
  })
  it('占位存入项目，重启后按原任务恢复等待，完成只落位一次', async () => {
    const started = await service.startVideoEditInPlaceGeneration(request(), { taskId: 'resume-task' })
    expect(state.document.inPlaceGenerations).toEqual([expect.objectContaining({ taskId: 'resume-task', request: expect.objectContaining({ prompt: '黄昏海边空镜' }), plan: expect.objectContaining({ frame: 60 }) })])
    const stored = structuredClone(state.document)
    service.resetVideoEditInPlaceJobsForTest(); await flush()
    state.document = stored
    service.restoreVideoEditInPlaceJobs(stored.id); service.restoreVideoEditInPlaceJobs(stored.id)
    expect(service.readVideoEditInPlaceJob(started.job.id)?.status).toBe('generating')
    notify({ status: 'success', resultAvailable: true }); await flush(); await flush()
    expect(service.readVideoEditInPlaceJob(started.job.id)?.status).toBe('placed')
    expect(state.document.inPlaceGenerations).toBeUndefined()
    expect(imports).toHaveBeenCalledTimes(1); expect(generation.submit).toHaveBeenCalledTimes(1)
    service.restoreVideoEditInPlaceJobs(stored.id); await flush()
    expect(imports).toHaveBeenCalledTimes(1)
  })
  it('项目关闭暂停落位而不取消生成，关闭期间历史完成，重开直接落位', async () => {
    const started = await service.startVideoEditInPlaceGeneration(request(), { taskId: 'closed-task' })
    const stored = structuredClone(state.document)
    state.opened = false; for (const listener of [...state.ownerListeners]) listener()
    await flush()
    expect(generation.cancelTask).not.toHaveBeenCalled()
    notify({ status: 'success', resultAvailable: true }); await flush()
    expect(imports).not.toHaveBeenCalled()
    state.opened = true; state.document = stored; state.liveMissing = true; state.history = { status: 'completed' }
    service.restoreVideoEditInPlaceJobs(stored.id); await flush(); await flush()
    expect(service.readVideoEditInPlaceJob(started.job.id)).toMatchObject({ status: 'placed', taskId: 'closed-task' })
    expect(imports).toHaveBeenCalledTimes(1); expect(generation.submit).toHaveBeenCalledTimes(1)
  })
  it('历史已完成而内存仍旧显示生成中时，恢复以持久结果为准；已应用标记仅保存', async () => {
    const started = await service.startVideoEditInPlaceGeneration(request(), { taskId: 'history-task' })
    const stored = structuredClone(state.document)
    service.resetVideoEditInPlaceJobsForTest(); await flush(); state.document = stored
    state.history = { status: 'success' }
    service.restoreVideoEditInPlaceJobs(stored.id); await flush(); await flush()
    expect(service.readVideoEditInPlaceJob(started.job.id)?.status).toBe('placed')
    expect(imports).toHaveBeenCalledTimes(1)
    const clipId = service.readVideoEditInPlaceJob(started.job.id)!.clipId!
    service.resetVideoEditInPlaceJobsForTest(); await flush()
    state.document.inPlaceGenerations = [{ ...stored.inPlaceGenerations![0], status: 'placing', clipId }]
    service.restoreVideoEditInPlaceJobs(stored.id); await flush(); await flush()
    expect(service.readVideoEditInPlaceJob(started.job.id)).toMatchObject({ status: 'placed', clipId })
    expect(imports).toHaveBeenCalledTimes(1); expect(generation.submit).toHaveBeenCalledTimes(1)
  })
  it('重开的失败占位保留错误与参数；找不到任务时显示可恢复失败', async () => {
    const started = await service.startVideoEditInPlaceGeneration({ ...request(), params: { duration: 3 } }, { taskId: 'failed-task' })
    notify({ status: 'error', errorMessage: '审核失败' }); await flush()
    const stored = structuredClone(state.document); service.resetVideoEditInPlaceJobsForTest(); await flush(); state.document = stored
    service.restoreVideoEditInPlaceJobs(stored.id)
    expect(service.readVideoEditInPlaceJob(started.job.id)).toMatchObject({ status: 'failed', error: '审核失败', request: { params: { duration: 3 } } })
    state.document.inPlaceGenerations![0].status = 'generating'; state.liveMissing = true
    service.resetVideoEditInPlaceJobsForTest(); await flush(); service.restoreVideoEditInPlaceJobs(stored.id); await flush()
    expect(service.readVideoEditInPlaceJob(started.job.id)).toMatchObject({ status: 'failed', error: expect.stringContaining('找不到原生成任务') })
    expect(generation.submit).toHaveBeenCalledTimes(1)
  })
  it('生成成功后的落位保存失败，重试只保存已有编辑，不再次生成或导入', async () => {
    const started = await service.startVideoEditInPlaceGeneration(request(), { taskId: 'save-task' })
    state.saveError = true; notify({ status: 'success', resultAvailable: true }); await flush(); await flush()
    expect(service.readVideoEditInPlaceJob(started.job.id)).toMatchObject({ status: 'failed', clipId: expect.any(String), error: '保存失败' })
    await expect(service.startVideoEditInPlaceGeneration(request(), { taskId: 'do-not-pay', replacesJobId: started.job.id })).rejects.toMatchObject({ facts: { reason: 'recover_original', replayGeneration: false } })
    state.saveError = false; await service.retryVideoEditInPlaceJob(started.job.id, { recoveryOnly: true }); await flush(); await flush()
    expect(service.readVideoEditInPlaceJob(started.job.id)?.status).toBe('placed')
    expect(imports).toHaveBeenCalledTimes(1); expect(generation.submit).toHaveBeenCalledTimes(1)
  })
  it('付费重试只替换原失败身份，新提交失败保留原占位；免费恢复不能重新生成', async () => {
    const original = await service.startVideoEditInPlaceGeneration(request(), { taskId: 'original-failed' })
    notify({ status: 'error', errorMessage: '审核失败' }); await flush(); await flush()
    await expect(service.retryVideoEditInPlaceJob(original.job.id, { recoveryOnly: true })).rejects.toMatchObject({ facts: { reason: 'generation_failed' } })
    expect(generation.submit).toHaveBeenCalledTimes(1)
    state.submitError = new Error('提交失败')
    await expect(service.startVideoEditInPlaceGeneration(request(), { taskId: 'retry-failed', replacesJobId: original.job.id })).rejects.toThrow('提交失败')
    expect(service.readVideoEditInPlaceJob(original.job.id)?.status).toBe('failed')
    state.submitError = null
    const retried = await service.startVideoEditInPlaceGeneration(request(), { taskId: 'retry-paid', replacesJobId: original.job.id })
    expect(retried.taskId).toBe('retry-paid'); expect(service.readVideoEditInPlaceJob(original.job.id)).toBeUndefined()
    expect(state.document.inPlaceGenerations?.some(record => record.id === original.job.id)).toBe(false)
  })
  it('新付费重试提交后占位保存失败，错误带回新任务身份；恢复等待原结果而不再付费', async () => {
    const original = await service.startVideoEditInPlaceGeneration(request(), { taskId: 'old-failed' })
    notify({ status: 'error', errorMessage: '审核失败' }); await flush(); await flush()
    generation.submit.mockImplementationOnce(async (_input: unknown, taskId?: string) => {
      state.saveError = true; state.task.status = 'pending'
      return { taskId: taskId!, status: 'submitted' }
    })
    await expect(service.startVideoEditInPlaceGeneration(request(), { taskId: 'new-submitted', replacesJobId: original.job.id })).rejects.toMatchObject({ facts: { reason: 'submitted_save_failed', taskRef: { id: 'new-submitted' }, replayGeneration: false } })
    expect(service.readVideoEditInPlaceJob(original.job.id)).toBeUndefined()
    const next = service.findVideoEditInPlaceJobByTask('new-submitted')!
    expect(next.status).toBe('failed')
    state.saveError = false
    const recovered = await service.retryVideoEditInPlaceJob(next.id, { recoveryOnly: true })
    expect(recovered.taskId).toBe('new-submitted')
    notify({ status: 'success', resultAvailable: true }); await flush(); await flush()
    expect(service.readVideoEditInPlaceJob(next.id)?.status).toBe('placed')
    expect(generation.submit).toHaveBeenCalledTimes(2); expect(imports).toHaveBeenCalledTimes(1)
  })
  it('带入前后镜头参考帧提交；占位随状态推进，完成后一步落进空隙并保存', async () => {
    const started = await service.startVideoEditInPlaceGeneration(request(), { taskId: 'task-1' })
    expect(started.taskId).toBe('task-1')
    expect(service.readVideoEditInPlaceJob(started.job.id)?.status).toBe('generating')
    expect(observe.mock.calls.map(call => call[1])).toEqual([{ kind: 'source', itemId: 'item', timeUs: Math.round(59.5 / 30 * 1e6) }, { kind: 'source', itemId: 'item', timeUs: Math.round(0.5 / 30 * 1e6) }])
    const submitted = generation.submit.mock.calls[0][0] as { options: { images: string[]; uploadedFilePaths: string[] } }
    expect(submitted.options.uploadedFilePaths).toHaveLength(2)
    expect(submitted.options.images[0]).toMatch(/^henji-media:\/\//)
    expect(imports).not.toHaveBeenCalled()
    notify({ status: 'success', resultAvailable: true })
    await flush(); await flush()
    const job = service.readVideoEditInPlaceJob(started.job.id)!
    expect(job.status).toBe('placed')
    const clip = state.document.sequences[0].clips.find(value => value.id === job.clipId)
    expect(clip).toMatchObject({ itemId: 'gen-item', start: 60, duration: 90, creativeSource: { type: 'generation', recordId: 'task-1' } })
    expect(imports).toHaveBeenCalledTimes(1)
    expect(saves).toHaveBeenCalled()
  })
  it('提交前失败：撤回占位、剪辑不变，错误交给发起方', async () => {
    state.submitError = new Error('供应商密钥未配置')
    const before = state.document
    await expect(service.startVideoEditInPlaceGeneration(request())).rejects.toThrow('供应商密钥未配置')
    expect(service.listVideoEditInPlaceJobs()).toHaveLength(0)
    expect(state.document).toEqual(before)
  })
  it('生成失败留下可恢复的占位；重试换成新任务，旧占位移除', async () => {
    const started = await service.startVideoEditInPlaceGeneration(request(), { taskId: 'task-2' })
    notify({ status: 'error', errorMessage: '内容审核未通过' })
    await flush()
    expect(service.readVideoEditInPlaceJob(started.job.id)).toMatchObject({ status: 'failed', error: '内容审核未通过' })
    state.history = { status: 'error' }
    state.task = { status: 'pending', resultAvailable: false, errorMessage: null, cancellable: true, progress: 0 }
    const retried = await service.retryVideoEditInPlaceJob(started.job.id)
    expect(service.readVideoEditInPlaceJob(started.job.id)).toBeUndefined()
    expect(service.readVideoEditInPlaceJob(retried.job.id)?.status).toBe('generating')
    expect(imports).not.toHaveBeenCalled()
  })
  it('取消：一并取消生成任务，占位消失，结果不落位', async () => {
    const started = await service.startVideoEditInPlaceGeneration(request(), { taskId: 'task-3' })
    await service.cancelVideoEditInPlaceJob(started.job.id)
    expect(generation.cancelTask).toHaveBeenCalledWith('task-3', expect.any(String))
    expect(service.readVideoEditInPlaceJob(started.job.id)?.status).toBe('cancelled')
    notify({ status: 'success', resultAvailable: true })
    await flush()
    expect(imports).not.toHaveBeenCalled()
  })
  it('模型不能接受参考帧时不取帧；声音动作不接受视频模型', async () => {
    const plan = service.planVideoEditInPlace(state.document.id, state.document.sequences[0].id, { action: 'generate_audio', frame: 0, duration: 30 })
    expect(service.videoEditInPlaceModelMismatch(plan, 'test-video')).toContain('声音模型')
    await expect(service.prepareVideoEditInPlace({ ...request(), intent: { action: 'generate_audio', frame: 0, duration: 30 }, modelId: 'test-video' })).rejects.toThrow('声音模型')
    await service.startVideoEditInPlaceGeneration({ ...request(), referenceRoles: [] }, { taskId: 'task-4' })
    expect(observe).not.toHaveBeenCalled()
  })
})
