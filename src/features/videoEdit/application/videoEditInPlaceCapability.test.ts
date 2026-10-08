import { createVideoEditTestDocument as createVideoEditDocument } from '../../../core/videoEdit/testFixtures'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type VideoEditDocument } from '@/core/videoEdit/document'
import { landVideoEditInPlaceResult, planVideoEditInPlaceGeneration } from '@/core/videoEdit/inPlaceGeneration'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { VIDEO_EDIT_APPLICATION_CAPABILITIES } from '@/core/application-control/domains/videoEdit/videoEditApplicationCapabilities'
import { videoEditInPlaceInputSchema } from '@/core/application-control/domains/videoEdit/videoEditInPlaceGenerationCapabilities'

/** 助手入口：秒与引用换成时间线同一份请求；同一操作重放不重复生成；切回版本经同一编辑入口并回读保存。 */
const state = vi.hoisted(() => ({ document: null as unknown as VideoEditDocument }))
const start = vi.hoisted(() => vi.fn(async (request: unknown, options: { taskId: string }) => ({ job: { id: 'job', projectId: 'p', modelId: 'test-model', request, plan: { action: 'generate_shot', sequenceId: 's', frame: 90, duration: 120, fps: 30, trackIndex: 1, placement: 'add', references: [] } }, taskId: options.taskId, request })))
const jobs = vi.hoisted(() => new Map<string, unknown>())
vi.mock('./videoEditInPlaceGeneration', async () => {
  const { switchVideoEditClipTake } = await import('@/core/videoEdit/inPlaceGeneration')
  const original = await vi.importActual<typeof import('./videoEditInPlaceGeneration')>('./videoEditInPlaceGeneration')
  return {
    ...original,
    startVideoEditInPlaceGeneration: start, prepareVideoEditInPlace: vi.fn(), videoEditInPlaceActionLabel: () => '生成镜头',
    selectedVideoEditInPlaceReferences: original.selectedVideoEditInPlaceReferences, videoEditInPlaceDefaultParams: () => ({}), videoEditInPlaceReferenceLabel: original.videoEditInPlaceReferenceLabel,
    findVideoEditInPlaceJobByTask: (taskId: string) => jobs.get(taskId),
    requireVideoEditFailedGeneration: (_projectId: string, taskId: string) => jobs.get(taskId),
    switchVideoEditClipTakeInProject: (_projectId: string, sequenceId: string, clipId: string, index: number) => { state.document = switchVideoEditClipTake(state.document, sequenceId, clipId, index) },
  }
})
vi.mock('./videoEditService', async importOriginal => ({
  ...await importOriginal<typeof import('./videoEditService')>(),
  requireVideoEditInstance: () => ({ document: state.document, activeSequenceId: state.document.sequences[0].id }),
  saveVideoEdit: vi.fn(async () => undefined), verifyVideoEditSaved: vi.fn(async () => true),
}))
vi.mock('@/features/generation/application/generationApplicationService', () => ({ generationApplicationService: { getTask: () => ({ progress: 40 }) } }))

const { handleVideoEditInPlaceCapability } = await import('./videoEditInPlaceCapability')
const context = { signal: new AbortController().signal, requestId: 'op-1' }

beforeEach(() => {
  jobs.clear(); start.mockClear()
  const document = createVideoEditDocument('助手原地生成')
  document.media = [{ id: 'media', name: '原视频', path: 'D:/clip.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 20 }, { id: 'gen', name: '雨天', path: 'D:/gen.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 5 }]
  document.items = [{ id: 'item', name: '原视频', kind: 'video', mediaId: 'media' }, { id: 'gen-item', name: '雨天', kind: 'video', mediaId: 'gen' }]
  const sequence = document.sequences[0]
  const video = sequence.tracks.find(track => track.kind === 'video')!.index
  sequence.clips = [{ ...makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0, track: video, duration: 60 }), id: 'a', name: 'a' }]
  state.document = document
})

describe('原地生成助手能力', () => {
  it('公共输入携带原失败任务身份到正式替换占位服务；坏引用返回当前可用事实', async () => {
    const documentRef = { kind: 'video_edit.document', id: state.document.id }
    jobs.set('failed', { id: 'old-job', projectId: state.document.id, status: 'failed', taskId: 'failed' })
    await handleVideoEditInPlaceCapability('generate_video_edit_in_place', { documentRef, replacesTaskRef: { kind: 'generation.task', id: 'failed' }, target: { action: 'generate_shot', startSeconds: 3 }, prompt: '重试' }, context)
    expect(start.mock.calls.at(-1)?.[1]).toMatchObject({ replacesJobId: 'old-job' })
    await expect(handleVideoEditInPlaceCapability('prepare_video_edit_in_place_generation', { documentRef, sequenceRef: { kind: 'video_edit.sequence', id: `${state.document.id}:missing` }, target: { action: 'generate_shot', startSeconds: 3 }, prompt: '重试' }, context)).rejects.toMatchObject({ facts: { reason: 'reference_missing', availableRefs: [{ kind: 'video_edit.sequence', id: `${state.document.id}:${state.document.sequences[0].id}` }] } })
    await expect(handleVideoEditInPlaceCapability('restore_video_edit_clip_take', { documentRef, clipRef: { kind: 'video_edit.clip', id: `${state.document.id}:missing` } }, context)).rejects.toMatchObject({ facts: { availableRefs: [{ kind: 'video_edit.clip', id: `${state.document.id}:a` }] } })
  })
  it('已登记进剪辑能力目录，输入拒绝未声明字段并点名缺项', () => {
    const ids = VIDEO_EDIT_APPLICATION_CAPABILITIES.map(definition => definition.id)
    expect(ids).toEqual(expect.arrayContaining(['prepare_video_edit_in_place_generation', 'generate_video_edit_in_place', 'get_video_edit_in_place_generation', 'restore_video_edit_clip_take']))
    const base = { documentRef: { kind: 'video_edit.document', id: 'p' }, prompt: '日落' }
    expect(videoEditInPlaceInputSchema.safeParse({ ...base, target: { action: 'generate_audio' } }).error?.issues[0].message).toContain('startSeconds')
    expect(videoEditInPlaceInputSchema.safeParse({ ...base, target: { action: 'generate_shot', startSeconds: 3 }, script: 'x' }).success).toBe(false)
  })
  it('“3 秒处生成 4 秒的日落空镜”：秒换成帧与轨道编号；同一操作重放返回原任务', async () => {
    const document = state.document; const sequence = document.sequences[0]; const track = sequence.tracks.find(value => value.kind === 'video')!
    const raw = { documentRef: { kind: 'video_edit.document', id: document.id }, target: { action: 'generate_shot', startSeconds: 3, durationSeconds: 4, trackRef: { kind: 'video_edit.track', id: `${document.id}:${track.id}` } }, prompt: '日落空镜' }
    const output = await handleVideoEditInPlaceCapability('generate_video_edit_in_place', raw, context)
    expect(start.mock.calls[0][0]).toMatchObject({ projectId: document.id, sequenceId: sequence.id, intent: { action: 'generate_shot', frame: 90, duration: 120, trackIndex: track.index }, prompt: '日落空镜' })
    expect(output).toMatchObject({ status: 'submitted', taskRef: { kind: 'generation.task' } })
    const taskId = (output as { taskRef: { id: string } }).taskRef.id
    jobs.set(taskId, { id: 'job', projectId: document.id, modelId: 'test-model', status: 'generating', taskId, plan: start.mock.calls[0] && (await start.mock.results[0].value).job.plan, request: {} })
    await handleVideoEditInPlaceCapability('generate_video_edit_in_place', raw, context)
    expect(start).toHaveBeenCalledTimes(1)
    expect(await handleVideoEditInPlaceCapability('get_video_edit_in_place_generation', { documentRef: raw.documentRef, taskRef: { kind: 'generation.task', id: taskId } }, context)).toMatchObject({ status: 'generating', progress: 40 })
  })
  it('“把这个片段换成雨天版本”之后切回原镜头：经编辑入口切换并回读', async () => {
    const document = state.document; const sequenceId = document.sequences[0].id
    state.document = landVideoEditInPlaceResult(document, planVideoEditInPlaceGeneration(document, sequenceId, { action: 'replace_shot', clipId: 'a' }), 'gen-item').document
    expect(state.document.sequences[0].clips[0].itemId).toBe('gen-item')
    const output = await handleVideoEditInPlaceCapability('restore_video_edit_clip_take', { documentRef: { kind: 'video_edit.document', id: document.id }, clipRef: { kind: 'video_edit.clip', id: `${document.id}:a` } }, context)
    expect(output).toMatchObject({ verification: { verified: true } })
    expect(state.document.sequences[0].clips[0]).toMatchObject({ itemId: 'item', duration: 60, takes: [expect.objectContaining({ itemId: 'gen-item' })] })
  })
  it('不是原地生成的能力交回原处理', async () => {
    expect(await handleVideoEditInPlaceCapability('save_video_edit', {}, context)).toBeUndefined()
  })
  it('逐项参考和指定时间帧传到同一服务；取消参考不取帧，冲突与非法来源由契约拒绝', async () => {
    const documentRef = { kind: 'video_edit.document', id: state.document.id }
    const base = { documentRef, target: { action: 'generate_shot', startSeconds: 3 }, prompt: '日落' }
    await handleVideoEditInPlaceCapability('generate_video_edit_in_place', { ...base, referenceRoles: [], referenceTimeSeconds: 1.25 }, context)
    expect(start.mock.calls.at(-1)?.[0]).toMatchObject({ referenceRoles: [], referenceFrame: 38 })
    await handleVideoEditInPlaceCapability('generate_video_edit_in_place', { ...base, useReferenceFrames: false }, context)
    expect(start.mock.calls.at(-1)?.[0]).toMatchObject({ referenceRoles: [] })
    expect(start.mock.calls.at(-1)?.[0]).not.toHaveProperty('referenceFrame')
    expect(videoEditInPlaceInputSchema.safeParse({ ...base, useReferenceFrames: false, referenceTimeSeconds: 1 }).success).toBe(false)
    expect(videoEditInPlaceInputSchema.safeParse({ ...base, referenceRoles: ['missing'] }).success).toBe(false)
  })
})
