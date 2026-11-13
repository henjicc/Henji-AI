import { beforeEach, expect, it, vi } from 'vitest'
import { createAudioEditDocumentContent } from '../../../../src/core/audioEdit/documentContent'
import type { AudioEditStoredTask } from './task-store'
import { listAudioEditTaskStatuses, preflightAudioEditTranscription, transcribeAudioEditProject } from './asr'

const mock = vi.hoisted(() => ({ project: vi.fn(), verify: vi.fn(), prepareAudio: vi.fn(), preflight: vi.fn(), execute: vi.fn(),
  task: undefined as AudioEditStoredTask | undefined, active: false, stale: false, clock: 0, controllers: new Map<string, AbortController>(),
  /** 补转写各段的任务（按 kind），整份转写仍在 task */
  fills: new Map<string, AudioEditStoredTask>() }))
const taskOf = (kind = 'transcription'): AudioEditStoredTask | undefined => kind === 'transcription' ? mock.task : mock.fills.get(kind)
const taskById = (requestId: string): AudioEditStoredTask | undefined => [mock.task, ...mock.fills.values()].find(task => task?.request_id === requestId)
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))
vi.mock('./project-store', () => ({ requireAudioEditProject: mock.project }))
vi.mock('./media', () => ({ verifyAudioEditSource: mock.verify, prepareAudioEditTranscriptionAudio: mock.prepareAudio }))
vi.mock('../media-recycle/cache-deletion', () => ({ removeUnmanagedCachePath: vi.fn(async () => undefined) }))
vi.mock('../keystore', () => ({ getAiProviderApiKey: () => undefined }))
vi.mock('../ai-runtime/native-file-upload', () => ({ resolveUploadFile: vi.fn(async (ref: string) => ref), scopedUploadFile: vi.fn() }))
vi.mock('../ai-runtime/sdk-runtime', () => ({ sdkRuntimeContext: { transport: { fetch: async () => { throw new Error('REAL_NETWORK_FORBIDDEN') } }, credentials: { get: () => undefined } } }))
vi.mock('./timestamped-asr', async importOriginal => ({ ...await importOriginal<typeof import('./timestamped-asr')>(), timestampedAsrService: {
  client: { get: () => ({ descriptor: { features: ['resume-task'] } }) }, listModels: () => [],
  preflight: mock.preflight, execute: mock.execute,
  prepare: (input: Record<string, unknown>) => ({ ...input, modelId: 'groq.speech-recognition.whisper-large-v3-turbo', providerId: 'groq', cost: { status: 'unknown', amount: null, currency: null } }),
} }))
vi.mock('./task-store', () => ({
  findAudioEditTranscription: (_projectId: string, kind?: string) => taskOf(kind),
  isAudioEditTaskActive: () => mock.active,
  isAudioEditTaskRunningHere: () => false,
  listAudioEditTasks: () => mock.task ? [{ requestId: mock.task.request_id, projectId: 'audio', kind: 'transcription', state: mock.task.state }] : [],
  settleStaleAudioEditTask: (requestId: string) => { if (mock.stale && mock.task?.request_id === requestId && ['queued', 'running'].includes(mock.task.state)) mock.task.state = 'failed' },
  assertAudioEditProjectIdle: () => {},
  registerAudioEditTaskController: (requestId: string, _projectId: string, controller: AbortController) => { mock.controllers.set(requestId, controller); return () => {} },
  // 与正式表同一套条件写入语义：新建要求这份口播还没有记录，接管要求已结束且 updated_at 未变，写入要求令牌对得上
  claimAudioEditTask: ({ requestId, kind, owner, result, takeoverUpdatedAt }: { requestId: string; kind: string; owner: string; result: Record<string, unknown>; takeoverUpdatedAt?: number }) => {
    const existing = taskOf(kind)
    if (takeoverUpdatedAt === undefined) {
      if (existing) return false
      const created = { request_id: requestId, state: 'running' as const, provider_task_id: null, input_digest: '', updated_at: ++mock.clock, result_json: JSON.stringify({ ...result, owner }) }
      if (kind === 'transcription') mock.task = created; else mock.fills.set(kind, created)
      return true
    }
    if (!existing || existing.updated_at !== takeoverUpdatedAt || !['failed', 'cancelled'].includes(existing.state)) return false
    Object.assign(existing, { state: 'running', updated_at: ++mock.clock, result_json: JSON.stringify({ ...result, owner }) })
    return true
  },
  updateOwnedAudioEditTask: (id: string, owner: string, value: { state: AudioEditStoredTask['state']; result?: Record<string, unknown>; providerTaskId?: string; errorMessage?: string }) => {
    const task = taskById(id)
    if (!task || JSON.parse(task.result_json ?? '{}').owner !== owner) return false
    Object.assign(task, { state: value.state, error_message: value.errorMessage, updated_at: ++mock.clock }, value.result ? { result_json: JSON.stringify({ ...value.result, owner }) } : {}, value.providerTaskId ? { provider_task_id: value.providerTaskId } : {})
    return true
  },
}))
/** 另一个进程接管这一行：换成它的令牌与回执 */
const takeOver = (receipt: Record<string, unknown>): void => { Object.assign(mock.task!, { state: 'running', updated_at: ++mock.clock, result_json: JSON.stringify({ ...receipt, owner: 'other-process' }) }) }
const source = { mediaType: 'audio' as const, sourcePath: 'voice.wav', audioPath: 'voice.wav', sampleRate: 1000, channels: 1, durationFrames: 2400 }
const request = { projectId: 'audio', requestId: 'request' }
beforeEach(() => {
  vi.clearAllMocks(); mock.task = undefined; mock.fills.clear(); mock.active = false; mock.stale = false; mock.clock = 10; mock.controllers.clear()
  mock.project.mockResolvedValue({ ...createAudioEditDocumentContent(source), id: 'audio', name: '声音', revision: 1, createdAt: 1, updatedAt: 1 })
  mock.verify.mockResolvedValue(undefined); mock.prepareAudio.mockResolvedValue({ path: 'voice-asr.ogg', bytes: 4096 })
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
  mock.execute.mockImplementationOnce(async (_plan, context) => { context.onSubmitting?.(); throw new Error('network interrupted') })
  await expect(transcribeAudioEditProject(request)).rejects.toMatchObject({ transcriptionFacts: { billing: 'unknown' } })
  await expect(preflightAudioEditTranscription({ sourcePath: source.sourcePath, durationMs: 2400, audioDocumentId: 'audio' })).rejects.toThrow('无法确认')
  await expect(transcribeAudioEditProject(request)).rejects.toThrow('无法确认')
  expect(mock.execute).toHaveBeenCalledTimes(1)
  mock.task!.provider_task_id = 'provider-task'
  await transcribeAudioEditProject(request)
  expect(mock.execute.mock.calls[1][1]).toMatchObject({ resumeTaskId: 'provider-task' })
})
it('上传阶段取消（还没发出提交请求）记为未计费，同一份口播可以重新识别，沿用原任务身份', async () => {
  mock.execute.mockImplementationOnce(async (_plan, context) => { mock.controllers.get('first')!.abort(); context.signal.throwIfAborted() })
  await expect(transcribeAudioEditProject({ ...request, requestId: 'first' })).rejects.toMatchObject({ transcriptionFacts: { billing: 'not_charged' } })
  expect(mock.task?.state).toBe('cancelled')
  expect(JSON.parse(mock.task!.result_json!)).toMatchObject({ billing: 'not_charged' })
  expect((await preflightAudioEditTranscription({ sourcePath: source.sourcePath, durationMs: 2400, audioDocumentId: 'audio' })).requiresConfirmation).toBe(true)
  await transcribeAudioEditProject({ ...request, requestId: 'retry' })
  expect(mock.execute).toHaveBeenCalledTimes(2)
  expect(mock.execute.mock.calls[1][1]).toMatchObject({ requestId: 'first', resumeTaskId: undefined })
})

it('进程退出遗留的“运行中”（心跳已停）先记为中断：未计费的可以重新识别；已经开始提交的仍然阻止重复付费', async () => {
  const preflight = () => preflightAudioEditTranscription({ sourcePath: source.sourcePath, durationMs: 2400, audioDocumentId: 'audio' })
  mock.stale = true
  mock.task = { request_id: 'crashed', state: 'running', provider_task_id: null, input_digest: '', updated_at: 1, result_json: JSON.stringify({ modelId: 'fixture-asr', sourceDigest: 'voice.wav', billing: 'not_charged' }) }
  expect((await preflight()).requiresConfirmation).toBe(true)
  expect(mock.task.state).toBe('failed')
  await transcribeAudioEditProject(request)
  expect(mock.execute).toHaveBeenCalledTimes(1)
  mock.task = { request_id: 'crashed', state: 'failed', provider_task_id: null, input_digest: '', updated_at: 1, result_json: JSON.stringify({ modelId: 'fixture-asr', sourceDigest: 'voice.wav', billing: 'unknown' }) }
  await expect(preflight()).rejects.toThrow('无法确认')
  await expect(transcribeAudioEditProject({ ...request, requestId: 'again' })).rejects.toThrow('无法确认')
  expect(mock.execute).toHaveBeenCalledTimes(1)
})

it('另一个进程（共用数据库的助手命令行或主应用）正在上传同一份口播时，不重提、不改标', async () => {
  const preflight = () => preflightAudioEditTranscription({ sourcePath: source.sourcePath, durationMs: 2400, audioDocumentId: 'audio' })
  mock.active = true
  mock.task = { request_id: 'other-process', state: 'running', provider_task_id: null, input_digest: '', updated_at: 1, result_json: JSON.stringify({ modelId: 'fixture-asr', sourceDigest: 'voice.wav', billing: 'not_charged' }) }
  await expect(preflight()).rejects.toThrow('正在转写')
  await expect(transcribeAudioEditProject(request)).rejects.toThrow('正在转写')
  expect(mock.task.state).toBe('running')
  expect(mock.execute).not.toHaveBeenCalled()
  // 心跳还新鲜（没有判为中断）时即使进程已经结束，“运行中”的回执也不当作从未提交
  mock.active = false
  await expect(preflight()).rejects.toThrow('无法确认')
  expect(mock.execute).not.toHaveBeenCalled()
})

it('上传期间被另一进程接管（本进程曾长时间卡住）：提交前那次写入落空，不发请求，也不覆盖接管方的回执', async () => {
  let submitted = 0
  mock.execute.mockImplementationOnce(async (_plan, context) => {
    takeOver({ modelId: 'fixture-asr', sourceDigest: 'voice.wav', billing: 'unknown' })
    context.onSubmitting?.()
    submitted++
  })
  await expect(transcribeAudioEditProject(request)).rejects.toMatchObject({ transcriptionFacts: { billing: 'not_charged' } })
  expect(submitted).toBe(0)
  expect(mock.task!.state).toBe('running')
  expect(JSON.parse(mock.task!.result_json!)).toMatchObject({ owner: 'other-process', billing: 'unknown' })
})

it('两处几乎同时为同一份新口播发起转写：只有一处认领成功、提交一次', async () => {
  let resolve!: () => void
  mock.preflight.mockImplementation(() => new Promise((done) => { resolve = () => done({ modelId: 'fixture-asr' }) }))
  const first = transcribeAudioEditProject({ ...request, requestId: 'a' })
  await vi.waitFor(() => expect(mock.preflight).toHaveBeenCalledTimes(1))
  const firstResolve = resolve
  const second = transcribeAudioEditProject({ ...request, requestId: 'b' })
  await vi.waitFor(() => expect(mock.preflight).toHaveBeenCalledTimes(2))
  resolve(); await expect(second).resolves.toBeTruthy()
  firstResolve(); await expect(first).rejects.toThrow('刚被另一个窗口')
  expect(mock.execute).toHaveBeenCalledTimes(1)
})

it('历史 native_upload_unsupported 有零提交证据，可复用原口播重新识别', async () => {
  mock.task = { request_id: 'previous', state: 'failed', provider_task_id: null, input_digest: '', updated_at: 1, result_json: JSON.stringify({ modelId: 'fixture-asr', sourceDigest: 'voice.wav' }), error_message: '[native_upload_unsupported] 长音频上传需要宿主接入原生文件直传' }
  expect((await preflightAudioEditTranscription({ sourcePath: source.sourcePath, durationMs: 2400, audioDocumentId: 'audio' })).requiresConfirmation).toBe(true)
  await transcribeAudioEditProject(request)
  expect(mock.execute.mock.calls[0][1]).toMatchObject({ requestId: 'previous', resumeTaskId: undefined })
})

it('同步供应商完成后本地规范化失败：回执保存原始付费结果，重试只重新解析', async () => {
  const raw = { text: '你好', segments: [{ text: '你好', startMs: 0, endMs: 1000 }] }
  mock.execute.mockImplementationOnce(async (_plan, context) => {
    context.onOutput?.(raw)
    throw new Error('本地规范化失败')
  })
  await expect(transcribeAudioEditProject(request)).rejects.toMatchObject({ transcriptionFacts: { billing: 'completed' } })
  expect(JSON.parse(mock.task!.result_json!)).toMatchObject({ billing: 'completed', rawOutput: raw })
  expect((await preflightAudioEditTranscription({ sourcePath: source.sourcePath, durationMs: 2400, audioDocumentId: 'audio' })).requiresConfirmation).toBe(false)
  const module = await import('./timestamped-asr')
  const prepare = vi.spyOn(module.timestampedAsrService, 'prepare').mockImplementationOnce(() => { throw new Error('凭据已删除') })
  expect((await transcribeAudioEditProject({ ...request, requestId: 'retry' })).project.transcript).toHaveLength(1)
  expect(prepare).not.toHaveBeenCalled()
  prepare.mockRestore()
  expect(mock.execute).toHaveBeenCalledTimes(1)
  expect(mock.preflight).toHaveBeenCalledTimes(1)
})

it('SDK started 会话标识不是可恢复供应商任务，未知结果不能据此查询或重放', async () => {
  mock.execute.mockImplementationOnce(async (_plan, context) => {
    context.onSubmitting?.()
    context.onEvent({ type: 'started', sessionId: 'sdk-session' })
    throw new Error('响应中断')
  })
  await expect(transcribeAudioEditProject(request)).rejects.toThrow('响应中断')
  expect(mock.task!.provider_task_id).toBeNull()
  await expect(transcribeAudioEditProject({ ...request, requestId: 'retry' })).rejects.toThrow('无法确认')
  expect(mock.execute).toHaveBeenCalledTimes(1)
})

it('供应商完成后空时间戳结果同样保留原始回执，再次失败不重复付费', async () => {
  const raw = { text: '只有文本' }
  mock.execute.mockImplementationOnce(async (_plan, context) => {
    context.onOutput?.(raw)
    return { text: raw.text, words: [], segments: [], granularity: 'none', unit: 'ms' }
  })
  await expect(transcribeAudioEditProject(request)).rejects.toThrow('没有可用时间戳')
  await expect(transcribeAudioEditProject({ ...request, requestId: 'retry' })).rejects.toThrow('没有可用时间戳')
  expect(mock.execute).toHaveBeenCalledTimes(1)
  expect(JSON.parse(mock.task!.result_json!)).toMatchObject({ billing: 'completed', rawOutput: raw })
})

it('付费结果后的源核验失败：重试复用完整结果；源身份变化拒绝旧结果', async () => {
  mock.verify.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('素材暂不可读'))
  await expect(transcribeAudioEditProject(request)).rejects.toThrow('素材暂不可读')
  await expect(transcribeAudioEditProject({ ...request, requestId: 'retry' })).resolves.toMatchObject({ granularity: 'segment' })
  expect(mock.execute).toHaveBeenCalledTimes(1)
  const project = await mock.project()
  mock.project.mockResolvedValue({ ...project, source: { ...source, identity: { digest: 'changed' } } })
  await expect(transcribeAudioEditProject({ ...request, requestId: 'changed' })).rejects.toThrow('素材已变化')
  expect(mock.execute).toHaveBeenCalledTimes(1)
})

it('只有采样指纹的素材移动后重新定位（摘要、大小、修改时间不变）：已付费的识别结果照样复用，不再提交', async () => {
  const fingerprint = { digest: 'f'.repeat(64), size: 9600, mtimeMs: 1_791_504_000_000 }
  const project = await mock.project()
  mock.project.mockResolvedValue({ ...project, source: { ...source, fingerprint } })
  mock.verify.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('素材暂不可读'))
  await expect(transcribeAudioEditProject(request)).rejects.toThrow('素材暂不可读')
  const moved = { ...source, sourcePath: 'D:/新位置/voice.wav', audioPath: 'D:/新位置/voice.wav', fingerprint }
  mock.project.mockResolvedValue({ ...project, source: moved })
  await expect(transcribeAudioEditProject({ ...request, requestId: 'relinked' })).resolves.toMatchObject({ granularity: 'segment' })
  expect(mock.execute).toHaveBeenCalledTimes(1)
  // 内容记录变了（修改时间不同）仍拒绝旧结果
  mock.project.mockResolvedValue({ ...project, source: { ...moved, fingerprint: { ...fingerprint, mtimeMs: fingerprint.mtimeMs + 1 } } })
  await expect(transcribeAudioEditProject({ ...request, requestId: 'touched' })).rejects.toThrow('素材已变化')
})

it('任务列表给出最近一次转写能否再发起，与提交时的拒绝条件一致', async () => {
  const resubmission = async () => (await listAudioEditTaskStatuses('audio'))[0]?.resubmission
  // 上传阶段取消：没有计费，可以重新转写
  mock.execute.mockImplementationOnce(async (_plan, context) => { mock.controllers.get('first')!.abort(); context.signal.throwIfAborted() })
  await expect(transcribeAudioEditProject({ ...request, requestId: 'first' })).rejects.toThrow()
  expect(await resubmission()).toBe('allowed')
  // 交给识别服务时中断：无法确认是否计费，不能重提；拿到供应商任务号后只续查
  mock.task = undefined
  mock.execute.mockImplementationOnce(async (_plan, context) => { context.onSubmitting?.(); throw new Error('network interrupted') })
  await expect(transcribeAudioEditProject(request)).rejects.toThrow()
  expect(await resubmission()).toBe('blocked')
  mock.task!.provider_task_id = 'provider-task'
  expect(await resubmission()).toBe('resume')
  // 另一个进程正在转写
  mock.active = true
  mock.task = { request_id: 'other-process', state: 'running', provider_task_id: null, input_digest: '', updated_at: 1, result_json: JSON.stringify({ modelId: 'fixture-asr', sourceDigest: 'voice.wav', billing: 'not_charged' }) }
  expect(await resubmission()).toBe('running_elsewhere')
  // 进程已退出、心跳停了的未计费记录：可以重新转写
  mock.active = false
  expect(await resubmission()).toBe('allowed')
  // 素材已变化：旧回执不能续用，也不能覆盖当前口播
  mock.task.result_json = JSON.stringify({ modelId: 'fixture-asr', sourceDigest: 'other.wav', billing: 'not_charged' })
  expect(await resubmission()).toBe('blocked')
  // 已完成的也标出来：已有转写，再调不会再识别
  mock.task = undefined
  await transcribeAudioEditProject({ ...request, requestId: 'done' })
  expect(await resubmission()).toBe('completed')
})

it('已有转写时只补转写插入段：按段截副本、只对这段估价计费，结果换掉占位；已付费的段重试不再提交', async () => {
  const word = (id: string, text: string, startFrame: number, endFrame: number) => ({ id, text, startFrame, endFrame, included: true, locked: false, granularity: 'word' as const })
  const placeholder = { id: 'recording-3-1000-0', text: '（需要重新转写）', startFrame: 1000, endFrame: 1800, included: true, locked: false, granularity: 'segment' as const, confidence: 0 }
  const base = await mock.project()
  mock.project.mockResolvedValue({ ...base, selectedAsrModelId: 'fixture-asr', transcript: [word('transcript-0', '前面', 0, 1000), placeholder, word('transcript-1', '后面', 1800, 2400)] })
  mock.execute.mockResolvedValue({ unit: 'ms', granularity: 'character', text: '补录', words: [], segments: [{ text: '补录', startMs: 0, endMs: 800, granularity: 'segment', timing: 'coarse', words: [
    { text: '补', startMs: 0, endMs: 400, granularity: 'character', timing: 'precise' }, { text: '录', startMs: 400, endMs: 800, granularity: 'character', timing: 'precise' }] }] })
  const preflight = () => preflightAudioEditTranscription({ sourcePath: source.sourcePath, durationMs: 2400, audioDocumentId: 'audio' })
  expect(await preflight()).toMatchObject({ requiresConfirmation: true })
  // 只按插入段的 0.8 秒检查上传上限与估价，不是整份 2.4 秒
  expect(mock.preflight.mock.calls[0][0]).toMatchObject({ durationMs: 800 })
  const result = await transcribeAudioEditProject(request)
  expect(mock.prepareAudio.mock.calls[0][3]).toMatchObject({ startFrame: 1000, endFrame: 1800 })
  expect(result.project.transcript.map(block => [block.id, block.text, block.startFrame, block.endFrame])).toEqual([
    ['transcript-0', '前面', 0, 1000], ['recording-3-1000-0:0', '补', 1000, 1400], ['recording-3-1000-0:1', '录', 1400, 1800], ['transcript-1', '后面', 1800, 2400]])
  expect(result.granularity).toBe('word')
  // 补转写用自己的任务，整份转写的记录不受影响
  expect(mock.task).toBeUndefined()
  expect([...mock.fills.keys()][0]).toMatch(/^transcription_fill:/)
  // 结果没送到界面（如重载）：再发起只取回回执，不再计费
  expect(await preflight()).toMatchObject({ requiresConfirmation: false })
  expect((await transcribeAudioEditProject({ ...request, requestId: 'retry' })).project.transcript).toEqual(result.project.transcript)
  expect(mock.execute).toHaveBeenCalledTimes(1)
  // 没有插入段的已有转写照旧拒绝
  mock.project.mockResolvedValue({ ...base, transcript: [word('transcript-0', '前面', 0, 2400)] })
  await expect(transcribeAudioEditProject({ ...request, requestId: 'again' })).rejects.toThrow('口播已有转写')
})
