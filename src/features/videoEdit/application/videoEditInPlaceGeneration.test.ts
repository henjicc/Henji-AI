import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createVideoEditDocument, type VideoEditDocument } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'

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
}))
const generation = vi.hoisted(() => ({
  resolveModel: vi.fn(async () => ({ modelId: 'test-video', providerId: 'test', selection: 'user_default' })),
  prepare: vi.fn(() => ({ prepared: true, priceEstimate: { comparableCnyAmount: 1 } })),
  submit: vi.fn(async (_input: unknown, taskId?: string) => { if (state.submitError) throw state.submitError; return { taskId: taskId!, status: 'submitted' } }),
  getTask: vi.fn(() => ({ ...state.task })),
  cancelTask: vi.fn(async () => ({})),
}))
const observe = vi.hoisted(() => vi.fn(async (_projectId: string, target: { itemId: string; timeUs: number }) => ({ asset: { filePath: `D:/frames/${target.itemId}-${target.timeUs}.png` } })))
const imports = vi.hoisted(() => vi.fn())
const saves = vi.hoisted(() => vi.fn(async () => undefined))

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
  requireVideoEditInstance: () => ({ document: state.document, activeSequenceId: state.document.sequences[0].id, targetTrackIds: [], sequenceViews: new Map() }),
  saveVideoEdit: saves,
  editVideoProject: (_id: string, update: (document: VideoEditDocument) => VideoEditDocument) => { state.document = update(state.document) },
}))

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
  fixture()
  // 导入：把生成结果作为素材项加进剪辑，再交给落位回调（一步编辑）
  imports.mockImplementation(async (_projectId: string, _sources: unknown, _bin: unknown, _signal: unknown, after: (document: VideoEditDocument, itemIds: string[]) => VideoEditDocument) => {
    const imported: VideoEditDocument = { ...state.document, media: [...state.document.media, { id: 'gen-media', name: '生成', path: 'D:/gen.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 5, assetId: 'asset-gen' }], items: [...state.document.items, { id: 'gen-item', name: '生成', kind: 'video', mediaId: 'gen-media' }] }
    state.document = after(imported, ['gen-item'])
    return ['gen-item']
  })
})

describe('原地生成执行', () => {
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
    expect(state.document).toBe(before)
  })
  it('生成失败留下可恢复的占位；重试换成新任务，旧占位移除', async () => {
    const started = await service.startVideoEditInPlaceGeneration(request(), { taskId: 'task-2' })
    notify({ status: 'error', errorMessage: '内容审核未通过' })
    await flush()
    expect(service.readVideoEditInPlaceJob(started.job.id)).toMatchObject({ status: 'failed', error: '内容审核未通过' })
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
