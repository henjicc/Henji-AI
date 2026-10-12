import { beforeEach, expect, it, vi } from 'vitest'
import { createAudioEditDocumentContent } from '../../../../src/core/audioEdit/documentContent'
import type { AudioEditStoredTask } from './task-store'
import { preflightAudioEditTranscription, transcribeAudioEditProject } from './asr'

const mock = vi.hoisted(() => ({ project: vi.fn(), verify: vi.fn(), prepareAudio: vi.fn(), preflight: vi.fn(), execute: vi.fn(),
  task: undefined as AudioEditStoredTask | undefined, active: false }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))
vi.mock('./project-store', () => ({ requireAudioEditProject: mock.project }))
vi.mock('./media', () => ({ verifyAudioEditSource: mock.verify, prepareAudioEditAudio: mock.prepareAudio }))
vi.mock('./timestamped-asr', () => ({ timestampedAsrService: {
  client: { get: () => ({ descriptor: { features: ['resume-task'] } }) }, listModels: () => [],
  preflight: mock.preflight, execute: mock.execute,
  prepare: (input: Record<string, unknown>) => ({ ...input, modelId: 'fixture-asr', providerId: 'fixture', cost: { status: 'unknown', amount: null, currency: null } }),
} }))
vi.mock('./task-store', () => ({
  findAudioEditTranscription: () => mock.task,
  isAudioEditTaskActive: () => mock.active,
  assertAudioEditProjectIdle: () => {},
  registerAudioEditTaskController: () => () => {},
  createAudioEditTask: ({ requestId }: { requestId: string }) => { mock.task = { request_id: requestId, state: 'queued', provider_task_id: null, input_digest: '', result_json: null } },
  updateAudioEditTask: (_id: string, value: { state: AudioEditStoredTask['state']; result?: unknown; providerTaskId?: string; errorMessage?: string }) => {
    if (!mock.task) throw new Error('TASK_NOT_FOUND')
    Object.assign(mock.task, { state: value.state, error_message: value.errorMessage }, value.result ? { result_json: JSON.stringify(value.result) } : {}, value.providerTaskId ? { provider_task_id: value.providerTaskId } : {})
  },
}))
const source = { mediaType: 'audio' as const, sourcePath: 'voice.wav', audioPath: 'voice.wav', sampleRate: 1000, channels: 1, durationFrames: 2400 }
const request = { projectId: 'audio', requestId: 'request' }
beforeEach(() => {
  vi.clearAllMocks(); mock.task = undefined; mock.active = false
  mock.project.mockResolvedValue({ ...createAudioEditDocumentContent(source), id: 'audio', name: '声音', revision: 1, createdAt: 1, updatedAt: 1 })
  mock.verify.mockResolvedValue(undefined); mock.prepareAudio.mockResolvedValue('voice.wav')
  mock.preflight.mockResolvedValue({ modelId: 'fixture-asr' })
  mock.execute.mockResolvedValue({ unit: 'ms', granularity: 'word', text: '你好', words: [], segments: [{ text: '你好', startMs: 0, endMs: 1000, granularity: 'segment', timing: 'coarse' }] })
})
it('识别前媒体/能力失败可确认未计费，不创建任务或提交', async () => {
  mock.preflight.mockRejectedValueOnce(new Error('宿主未提供本地文件直传'))
  await expect(transcribeAudioEditProject(request)).rejects.toMatchObject({ transcriptionFacts: { billing: 'not_charged', targetMutation: 'none' } })
  expect(mock.task).toBeUndefined(); expect(mock.execute).not.toHaveBeenCalled()
})
it('任务回执保留完整识别结果，重载丢失 IPC 响应后续取不重复调用', async () => {
  const result = await transcribeAudioEditProject(request)
  expect(result.project.transcript).toHaveLength(1)
  expect(mock.task?.state).toBe('completed')
  const prepared = await preflightAudioEditTranscription({ sourcePath: source.sourcePath, durationMs: 2400, audioDocumentId: 'audio' })
  expect(prepared.requiresConfirmation).toBe(false)
  expect((await transcribeAudioEditProject({ ...request, requestId: 'retry' })).project.transcript).toEqual(result.project.transcript)
  expect(mock.execute).toHaveBeenCalledTimes(1)
})
it('未知提交不重放；有供应商任务时只恢复查询并保留已提交事实', async () => {
  mock.execute.mockRejectedValueOnce(new Error('network interrupted'))
  await expect(transcribeAudioEditProject(request)).rejects.toMatchObject({ transcriptionFacts: { billing: 'unknown' } })
  await expect(preflightAudioEditTranscription({ sourcePath: source.sourcePath, durationMs: 2400, audioDocumentId: 'audio' })).rejects.toThrow('尚未确认')
  await expect(transcribeAudioEditProject(request)).rejects.toThrow('无法确认')
  expect(mock.execute).toHaveBeenCalledTimes(1)
  mock.task!.provider_task_id = 'provider-task'
  await transcribeAudioEditProject(request)
  expect(mock.execute.mock.calls[1][1]).toMatchObject({ resumeTaskId: 'provider-task' })
})
it('历史 native_upload_unsupported 有零提交证据，可复用原口播重新识别', async () => {
  mock.task = { request_id: 'previous', state: 'failed', provider_task_id: null, input_digest: '', result_json: JSON.stringify({ modelId: 'fixture-asr', sourceDigest: 'voice.wav' }), error_message: '[native_upload_unsupported] 长音频上传需要宿主接入原生文件直传' }
  expect((await preflightAudioEditTranscription({ sourcePath: source.sourcePath, durationMs: 2400, audioDocumentId: 'audio' })).requiresConfirmation).toBe(true)
  await transcribeAudioEditProject(request)
  expect(mock.execute.mock.calls[0][1]).toMatchObject({ requestId: 'previous', resumeTaskId: undefined })
})
