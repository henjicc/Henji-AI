import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({ directory: '', render: vi.fn() }))
vi.mock('electron', () => ({ net: {}, shell: {} }))
vi.mock('./player/player', () => ({ WebRecordingPlayer: { open: () => ({ render: boundary.render }) } }))
vi.mock('./backupVideo', () => ({ BACKUP_VIDEO_FILE: 'backup.mp4', BACKUP_AUDIO_DIRECTORY: 'audio', WebRecordingBackupVideo: {}, mixWebRecordingBackupAudio: vi.fn() }))
vi.mock('./server', () => ({ WEB_REPLAY_PORT: 7891, WebReplayServer: class {} }))
vi.mock('./locations', () => ({ resolveWebRecordingDirectory: async () => boundary.directory }))
vi.mock('../documents/runtime', () => ({ getDocumentService: vi.fn() }))
vi.mock('../appPaths', () => ({ getUserFolderDir: () => boundary.directory }))

import { renderWebRecording } from './runtime'

const ids = ['4c4fd189-61bf-4408-afc0-751c8c9ede67', '7d1e0c55-5a8e-4f3b-9d55-1f7a3c2b9e10']
const ok = (): { output: string; frames: number; width: number; height: number; durationMs: number; issues: Array<{ t: number; kind: string; message: string }>; looseMatches: number; unusedCalls: number; locatorMisses: number } => ({ output: 'video.mp4', frames: 60, width: 10, height: 10, durationMs: 1000, issues: [], looseMatches: 0, unusedCalls: 0, locatorMisses: 0 })

beforeEach(async () => { boundary.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-runtime-render-')) })
afterEach(async () => {
  await fs.rm(boundary.directory, { recursive: true, force: true })
  boundary.render.mockReset()
})

it('几段同时请求重演时排队，一段渲完才开始下一段', async () => {
  let release!: () => void
  const first = new Promise<void>(resolve => { release = resolve })
  boundary.render.mockImplementationOnce(async () => { await first; return ok() }).mockImplementationOnce(async () => ok())
  const a = renderWebRecording({ recordingId: ids[0], fps: 60, longEdge: 3840 })
  const b = renderWebRecording({ recordingId: ids[1], textOnly: true })
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(boundary.render).toHaveBeenCalledTimes(1)
  // 同一段在排队或渲染中不能再开一次
  await expect(renderWebRecording({ recordingId: ids[1] })).rejects.toThrow('正在重演')
  release()
  await a; await b
  expect(boundary.render).toHaveBeenCalledTimes(2)
  expect(boundary.render.mock.calls[1][0]).toMatchObject({ video: false })
})

it('排队中与正在跑的重演都能按登记取消，取消后记为已取消、不再开始；没有登记的任务不认', async () => {
  const { cancelWebRecordingRender } = await import('./runtime')
  boundary.render.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('已取消重演')), { once: true })
  }))
  const running = renderWebRecording({ recordingId: ids[0] }, 'aaaaaaaa-0000-4000-8000-000000000001')
  const queued = renderWebRecording({ recordingId: ids[1] }, 'aaaaaaaa-0000-4000-8000-000000000002')
  await new Promise(resolve => setTimeout(resolve, 20))
  await expect(cancelWebRecordingRender({ recordingId: ids[1] })).resolves.toMatchObject({ jobId: 'aaaaaaaa-0000-4000-8000-000000000002', previousState: 'queued', state: 'cancelled' })
  await expect(queued).rejects.toMatchObject({ name: 'WebReplayCancelledError' })
  await expect(cancelWebRecordingRender({ jobId: 'aaaaaaaa-0000-4000-8000-000000000001' })).resolves.toMatchObject({ recordingId: ids[0], previousState: 'running', state: 'cancelled' })
  await expect(running).rejects.toMatchObject({ name: 'WebReplayCancelledError' })
  expect(boundary.render).toHaveBeenCalledTimes(1)
  await expect(cancelWebRecordingRender({ recordingId: ids[0] })).rejects.toMatchObject({ name: 'WebReplayJobNotFoundError' })
  await expect(cancelWebRecordingRender({ jobId: 'aaaaaaaa-0000-4000-8000-000000000009' })).rejects.toMatchObject({ name: 'WebReplayJobNotFoundError' })
})

it('同一段录制在重演时再提交：拒绝且点名原操作，结果留在登记里供重载后的账本取回', async () => {
  const { webReplayRenderJobs } = await import('./renderJobs')
  webReplayRenderJobs.setOwnerResolver(jobId => (jobId === 'bbbbbbbb-0000-4000-8000-000000000001' ? 'original-operation' : undefined))
  let release!: () => void
  boundary.render.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve }); return ok() })
  const first = renderWebRecording({ recordingId: ids[0] }, 'bbbbbbbb-0000-4000-8000-000000000001')
  await new Promise(resolve => setTimeout(resolve, 20))
  await expect(renderWebRecording({ recordingId: ids[0] }, 'bbbbbbbb-0000-4000-8000-000000000002')).rejects.toMatchObject({ name: 'WebReplayBusyError', message: expect.stringContaining('operationId=original-operation') })
  expect(webReplayRenderJobs.get('bbbbbbbb-0000-4000-8000-000000000002')).toBeUndefined()
  release()
  await first
  expect(webReplayRenderJobs.get('bbbbbbbb-0000-4000-8000-000000000001')).toMatchObject({ state: 'completed', result: { frames: 60 } })
  webReplayRenderJobs.setOwnerResolver(() => undefined)
})

it('取消后录制文件夹里留下了半成品：按失败处理并点名留下的文件，不判为未执行', async () => {
  const { cancelWebRecordingRender } = await import('./runtime')
  boundary.render.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { void fs.writeFile(path.join(boundary.directory, 'replay-half.mp4'), 'x').then(() => reject(new Error('已取消重演'))) }, { once: true })
  }))
  const running = renderWebRecording({ recordingId: ids[0] }, 'cccccccc-0000-4000-8000-000000000001')
  await new Promise(resolve => setTimeout(resolve, 20))
  await expect(cancelWebRecordingRender({ recordingId: ids[0] })).resolves.toMatchObject({ previousState: 'running', state: 'failed' })
  const error = await running.then(() => null, (value: unknown) => value as Error)
  expect(error?.name).toBe('Error')
  expect(error?.message).toContain('replay-half.mp4')
})

it('重演结束的通知处理出错，不影响重演本身的结果', async () => {
  const { webReplayRenderJobs } = await import('./renderJobs')
  const stop = webReplayRenderJobs.onSettled(() => { throw new Error('账本写不进去') })
  boundary.render.mockImplementationOnce(async () => ok())
  await expect(renderWebRecording({ recordingId: ids[0] }, 'cccccccc-0000-4000-8000-000000000002')).resolves.toMatchObject({ frames: 60 })
  expect(webReplayRenderJobs.get('cccccccc-0000-4000-8000-000000000002')).toMatchObject({ state: 'completed' })
  stop()
})
