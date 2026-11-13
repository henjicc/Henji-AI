// @vitest-environment jsdom
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { AudioCaptureEvent, AudioCaptureRecordingState, AudioCaptureStatus } from '@/core/audioCapture/contracts'
import type { AudioEditSpliceRequest } from '@/core/audioEdit/splice'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { getPlatform } from '@/platform'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { harnessDocumentStore, installHarnessNativeStorage, registerHarnessAudioEditProject, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { resetAudioEditProjectInstancesForTests } from '@/features/audioEdit/application/audioEditProjectInstances'
import { useAudioEditPlaybackStore } from '@/features/audioEdit'
import { useAudioEditStore } from '@/features/audioEdit/store/audioEditStore'
import { getAudioCaptureSession } from './captureApplicationService'

// 后台拼回的短等改成 50 毫秒，好在测试里走到“等不及返回”的那条路
vi.mock('@/core/application-control/execution/waitWithin', async original => ({ ...await original<typeof import('@/core/application-control/execution/waitWithin')>(), CAPABILITY_SHORT_WAIT_MS: 50 }))

// 只替换原生录音进程与拼接这两处进程边界；能力注册、执行上下文（写入前检查、改动上报）、录音会话、拼接入作品、保存、撤销都是正式实现。
const project: AudioEditProjectDocument = {
  id: 'voice', name: '口播', referenceScript: '', transcript: [], suggestions: [],
  source: { mediaType: 'audio', sourcePath: '/voice/original.wav', audioPath: '/voice/original.wav', durationFrames: 96_000, sampleRate: 48_000, channels: 1 },
  createdAt: 1, updatedAt: 1, revision: 1,
}
const documentRef = { kind: 'audio_edit.document', id: 'voice' } as const
const captureRef = { kind: 'audio_capture.settings', id: 'singleton' }
const status = (outputPath: string): AudioCaptureStatus => ({ sessionId: '7f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b', outputPath, state: 'recording', sampleRate: 48_000, inputLatency: 0.01, callbackFrames: 256, frames: 0, writtenBytes: 0, durationSeconds: 0 })
/** 主进程这边的事实：在录哪个文件、待恢复文件、最近一次中断。 */
let main: AudioCaptureRecordingState
let takes = 0
let emit: (event: AudioCaptureEvent) => void = () => {}
const stored = () => harnessDocumentStore().stored('voice')!.content as AudioEditProjectDocument
const splice = () => vi.mocked(getPlatform().audioEdit.splice)
let app: ReturnType<typeof createApplicationHarness>
const readProperty = async (id: string): Promise<unknown> => (await app.read(captureRef, [id]) as { properties: Record<string, unknown> }).properties[id]
const recording = async () => await readProperty('audio_capture.settings.recording') as Record<string, unknown>

beforeAll(() => {
  installHarnessNativeStorage()
  registerHarnessAudioEditProject(project)
  const capture = getPlatform().audioCapture
  vi.spyOn(capture, 'recordingState').mockImplementation(async () => structuredClone(main))
  vi.spyOn(capture, 'pendingFiles').mockImplementation(async () => structuredClone(main.pending))
  vi.spyOn(capture, 'active').mockResolvedValue(null)
  vi.spyOn(capture, 'prepareFile').mockImplementation(async placement => {
    const outputPath = `/作品/录音/录音 2026-11-13 12000${++takes}.wav`
    main.pending.push({ outputPath, name: `录音${takes}.wav`, durationSeconds: 0, ...(placement ? { placement } : {}) })
    return { outputPath, name: `录音${takes}.wav` }
  })
  vi.spyOn(capture, 'start').mockImplementation(async request => { main.recording = { outputPath: request.outputPath, state: 'recording', durationSeconds: 0, health: null }; return { ...status(request.outputPath), notice: null } })
  vi.spyOn(capture, 'stop').mockImplementation(async () => { const path = main.recording!.outputPath; main.recording = null; return { ...status(path), state: 'stopped', durationSeconds: 1 } })
  vi.spyOn(capture, 'recover').mockResolvedValue({ writtenBytes: 96_000 })
  vi.spyOn(capture, 'completeFile').mockImplementation(async path => { main.pending = main.pending.filter(file => file.outputPath !== path) })
  vi.spyOn(capture, 'trashFile').mockImplementation(async path => { main.pending = main.pending.filter(file => file.outputPath !== path) })
  vi.spyOn(capture, 'onEvent').mockImplementation(handler => { emit = handler; return () => {} })
  vi.spyOn(capture, 'onSamples').mockReturnValue(() => {})
  // 每拼一段，作品长一秒（48000 帧）
  vi.spyOn(getPlatform().audioEdit, 'splice').mockImplementation(async (request: AudioEditSpliceRequest) => {
    const path = `/voice/${request.resultId}.wav`
    return { source: { ...project.source, sourcePath: path, audioPath: path, ownership: 'managed', durationFrames: ((harnessDocumentStore().stored(request.projectId)!.content as { source: { durationFrames: number } | null }).source?.durationFrames ?? 0) + 48_000 - (request.endFrame - request.startFrame) }, insertedFrames: 48_000 }
  })
})
beforeEach(() => { main = { recording: null, sharedMicrophone: false, interruption: null, pending: [], settingsRevision: 0 }; app = createApplicationHarness() })
afterAll(async () => { app.dispose(); vi.restoreAllMocks(); await resetAudioEditProjectInstancesForTests(); uninstallHarnessNativeStorage() })

it('界面重载后还没接管时，录音状态按主进程读：在录、录到哪份口播哪个位置', async () => {
  const outputPath = '/作品/录音/重载前.wav'
  main.recording = { outputPath, state: 'recording', durationSeconds: 12.5, health: null }
  main.pending = [{ outputPath, name: '重载前.wav', durationSeconds: 12.5, placement: { projectId: 'voice', startFrame: 48_000, endFrame: 48_000, revision: 1, spliceId: crypto.randomUUID() } }]
  expect(await recording()).toMatchObject({ phase: 'recording', durationSeconds: 12.5, documentId: 'voice', positionSeconds: 1, attached: false, microphoneInUse: false })
  // 只读录音状态不去枚举设备、解析设置（它们在主进程排在录音操作后面）
  expect(getPlatform().audioCapture.pendingFiles).not.toHaveBeenCalled()
})

it('讲解占着麦克风时开始录音在写入前就被拒，不建文件', async () => {
  main.sharedMicrophone = true
  const result = await app.call('start_audio_edit_recording', { documentRef })
  expect(result).toMatchObject({ ok: false, error: { message: expect.stringContaining('讲解正在用麦克风'), details: { execution: { notExecuted: true } } } })
  expect(getPlatform().audioCapture.prepareFile).not.toHaveBeenCalled()
})

it('助手开始、暂停、从播放头继续、停止与界面同一个会话；每段拼回原位置并保存，按回执一步撤销', async () => {
  const started = await app.requireResult('start_audio_edit_recording', { documentRef, positionSeconds: 1 })
  expect(started).toMatchObject({ verified: true, recording: { phase: 'recording', positionSeconds: 1 } })
  // 界面录音按钮、标题栏指示读的就是这个会话
  expect(getAudioCaptureSession().store.getState()).toMatchObject({ phase: 'recording', placement: { projectId: 'voice', startFrame: 48_000, endFrame: 48_000 } })
  expect(await recording()).toMatchObject({ phase: 'recording', documentId: 'voice', attached: true })

  const paused = await app.requireResult('pause_audio_edit_recording', {})
  expect(paused).toMatchObject({ verified: true, recording: { phase: 'paused' }, durationFrames: 144_000, undoRef: expect.any(String) })
  expect(stored().source.durationFrames).toBe(144_000)
  // 音频编辑正显示这份口播、正在试听，用户把播放头挪到 0.5 秒：继续录音先停试听，接在播放头，与界面“继续录音”一样
  useAudioEditStore.setState({ project: { ...stored(), id: 'voice' } })
  useAudioEditPlaybackStore.setState({ sourceFrame: 24_000, playing: true })
  try { await app.requireResult('resume_audio_edit_recording', {}) } finally { useAudioEditStore.setState({ project: null }) }
  expect(useAudioEditPlaybackStore.getState().playing).toBe(false)
  expect(getAudioCaptureSession().store.getState().placement).toMatchObject({ startFrame: 24_000, endFrame: 24_000 })

  const stopped = await app.requireResult('stop_audio_edit_recording', {})
  expect(stopped).toMatchObject({ verified: true, recording: { phase: 'idle' }, durationFrames: 192_000, undoRef: expect.any(String) })
  expect(splice().mock.calls.map(([request]) => [request.startFrame, request.endFrame])).toEqual([[48_000, 48_000], [24_000, 24_000]])
  expect(main.pending).toEqual([])
  expect(await recording()).toMatchObject({ lastTake: { documentId: 'voice', undoRef: stopped.undoRef } })

  await app.requireResult('undo_audio_edit', { documentRef, undoRef: stopped.undoRef })
  expect(stored().source.durationFrames).toBe(144_000)
  await app.requireResult('undo_audio_edit', { documentRef, undoRef: paused.undoRef })
  expect(stored().source).toMatchObject({ sourcePath: '/voice/original.wav', durationFrames: 96_000 })
})

it('录音中断后读到中断与待恢复文件，停止提示改用恢复；恢复拼回原位置可撤销，再恢复一次说明已经没有', async () => {
  splice().mockClear()
  await app.requireResult('start_audio_edit_recording', { documentRef, positionSeconds: 0 })
  const outputPath = main.recording!.outputPath
  main.recording = null
  main.interruption = { outputPath, code: 'DEVICE_REMOVED', message: '录音设备已拔出', at: Date.now() }
  emit({ event: 'interrupted', sessionId: status(outputPath).sessionId, outputPath, writtenBytes: 96_000, error: { code: 'DEVICE_REMOVED', message: '录音设备已拔出', recoverable: true } })
  expect(await recording()).toMatchObject({ phase: 'interrupted', error: expect.stringContaining('录音设备已拔出'), documentId: 'voice' })
  expect(await readProperty('audio_capture.settings.pending_files')).toMatchObject([{ outputPath, documentId: 'voice', positionSeconds: 0 }])

  const stop = await app.call('stop_audio_edit_recording', {})
  expect(stop).toMatchObject({ ok: false, error: { message: expect.stringContaining('recover_audio_edit_recording'), details: { execution: { notExecuted: true } } } })

  const recovered = await app.requireResult('recover_audio_edit_recording', {})
  expect(recovered).toMatchObject({ verified: true, undoRef: expect.any(String) })
  expect(splice().mock.calls.map(([request]) => request.startFrame)).toEqual([0])
  expect(stored().source.durationFrames).toBe(144_000)
  const again = await app.call('recover_audio_edit_recording', {})
  expect(again).toMatchObject({ ok: false, error: { message: expect.stringContaining('没有待恢复的录音文件') } })
  await app.requireResult('undo_audio_edit', { documentRef, undoRef: recovered.undoRef })
  expect(stored().source.durationFrames).toBe(96_000)
})

it('不给口播时新建一份录音口播并在里面录，停止后拼回', async () => {
  const started = await app.requireResult('start_audio_edit_recording', {})
  const id = (started.resultRef as { id: string }).id
  expect(id).not.toBe('voice')
  expect(harnessDocumentStore().stored(id)).toBeTruthy()
  const stopped = await app.requireResult('stop_audio_edit_recording', {})
  expect(stopped).toMatchObject({ verified: true, resultRef: { id }, durationFrames: 48_000 })
})

it('新建口播后录音没开成：空口播与预建的录音文件都移进回收区，下一次开始不被挡住', async () => {
  vi.mocked(getPlatform().audioCapture.start).mockRejectedValueOnce(new Error('设备被占用'))
  const failed = await app.call('start_audio_edit_recording', {})
  expect(failed).toMatchObject({ ok: false, error: { message: expect.stringContaining('已移到回收区') } })
  expect(main.pending).toEqual([])
  expect(getAudioCaptureSession().store.getState().outputPath).toBeNull()
  await app.requireResult('start_audio_edit_recording', { documentRef })
  await app.requireResult('stop_audio_edit_recording', {})
})

it('没在音频编辑里显示这份口播时，继续录音接在刚拼回那一段的真实末尾，不用别处的播放头', async () => {
  splice().mockClear()
  await app.requireResult('start_audio_edit_recording', { documentRef, positionSeconds: 1 })
  await app.requireResult('pause_audio_edit_recording', {})
  useAudioEditPlaybackStore.setState({ sourceFrame: 0 })
  await app.requireResult('resume_audio_edit_recording', {})
  // 第一段从 1 秒插入 1 秒，拼回后末尾在 2 秒（96000 帧）
  expect(getAudioCaptureSession().store.getState().placement).toMatchObject({ startFrame: 96_000 })
  await app.requireResult('stop_audio_edit_recording', {})
})

it('暂停成功后停止等不及、后台拼回又失败：读回的 lastTake 指向这一段并写明原因，不留着上一段的撤销引用；后台期间的操作请调用方等待', async () => {
  await app.requireResult('start_audio_edit_recording', { documentRef, positionSeconds: 0 })
  const paused = await app.requireResult('pause_audio_edit_recording', {})
  expect(await recording()).toMatchObject({ lastTake: { state: 'saved', undoRef: paused.undoRef } })
  await app.requireResult('resume_audio_edit_recording', { positionSeconds: 0 })
  const secondTake = main.recording!.outputPath
  let fail!: (error: Error) => void
  splice().mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
  const stopped = await app.requireResult('stop_audio_edit_recording', {})
  expect(stopped).toMatchObject({ finishing: true, verified: false })
  expect(await recording()).toMatchObject({ busy: true, lastTake: { state: 'saving', outputPath: secondTake } })
  // 后台还在拼回：停止、继续、开始都请调用方等待（未执行），不引去恢复或新录
  for (const [id, input] of [['stop_audio_edit_recording', {}], ['resume_audio_edit_recording', {}], ['start_audio_edit_recording', { documentRef }], ['pause_audio_edit_recording', {}]] as const) {
    expect(await app.call(id, input)).toMatchObject({ ok: false, error: { message: expect.stringContaining('正在处理上一个录音操作'), details: { execution: { notExecuted: true } } } })
  }
  fail(new Error('磁盘已满'))
  await vi.waitFor(async () => expect(await recording()).toMatchObject({ busy: false, lastTake: { state: 'failed', outputPath: secondTake, error: expect.stringContaining('磁盘已满') } }))
  expect((await recording()).lastTake).not.toHaveProperty('undoRef')
  // 这一段的文件还在，按提示恢复
  await app.requireResult('recover_audio_edit_recording', { outputPath: secondTake })
})
