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
import { WebRecordingStore } from './store'

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
  await vi.waitFor(() => expect(boundary.render).toHaveBeenCalledTimes(1))
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
  await vi.waitFor(() => expect(boundary.render).toHaveBeenCalledTimes(1))
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
  await vi.waitFor(() => expect(boundary.render).toHaveBeenCalledTimes(1))
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
  await vi.waitFor(() => expect(boundary.render).toHaveBeenCalledTimes(1))
  await expect(cancelWebRecordingRender({ recordingId: ids[0] })).resolves.toMatchObject({ previousState: 'running', state: 'failed' })
  const error = await running.then(() => null, (value: unknown) => value as Error)
  expect(error?.name).toBe('Error')
  expect(error?.message).toContain('replay-half.mp4')
})

it('版本重演中途取消：只删这次建出的 takes/，判为已取消；原有的 takes/ 与重演期间别人新建的文件夹都不动', async () => {
  const { cancelWebRecordingRender } = await import('./runtime')
  vi.spyOn(WebRecordingStore.prototype, 'readManifest').mockResolvedValue({ durationUs: 10_000_000 } as Awaited<ReturnType<WebRecordingStore['readManifest']>>)
  const cancelOnAbort = (during?: () => Promise<unknown>) => ({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { void (during?.() ?? Promise.resolve()).then(() => reject(new Error('已取消重演'))) }, { once: true })
  })
  const cancelRun = async (jobId: string, during?: () => Promise<unknown>) => {
    boundary.render.mockImplementationOnce(cancelOnAbort(during))
    const started = boundary.render.mock.calls.length
    const running = renderWebRecording({ recordingId: ids[0], take: '首问' }, jobId)
    // 等播放器真正开始再取消：排队中取消走的是另一条路径。
    await vi.waitFor(() => expect(boundary.render.mock.calls.length).toBe(started + 1))
    const cancelled = await cancelWebRecordingRender({ recordingId: ids[0] })
    return { cancelled, error: await running.then(() => null, (value: unknown) => value as Error) }
  }

  const first = await cancelRun('dddddddd-0000-4000-8000-000000000001')
  expect(first.cancelled).toMatchObject({ previousState: 'running', state: 'cancelled' })
  expect(first.error?.name).toBe('WebReplayCancelledError')
  expect(await fs.readdir(boundary.directory)).not.toContain('takes')

  // 重演期间用户在录制文件夹里新建的空文件夹不是这次重演建的：不删，如实点名。
  const second = await cancelRun('dddddddd-0000-4000-8000-000000000002', () => fs.mkdir(path.join(boundary.directory, '我的笔记')))
  expect(second.cancelled).toMatchObject({ state: 'failed' })
  expect(second.error?.message).toContain('我的笔记/')
  expect(await fs.readdir(boundary.directory)).toContain('我的笔记')
  expect(await fs.readdir(boundary.directory)).not.toContain('takes')

  await fs.rm(path.join(boundary.directory, '我的笔记'), { recursive: true })
  await fs.mkdir(path.join(boundary.directory, 'takes', '旧版本'), { recursive: true })
  const third = await cancelRun('dddddddd-0000-4000-8000-000000000003')
  expect(third.cancelled).toMatchObject({ state: 'cancelled' })
  expect(await fs.readdir(path.join(boundary.directory, 'takes'))).toEqual(['旧版本'])
  vi.restoreAllMocks()
})

it('重演失败时删掉为输出新建的多层空文件夹，删到这次建出的第一层为止；里面有别的东西的那层起保留', async () => {
  const output = path.join(boundary.directory, 'a', 'b', 'c', 'out.mp4')
  boundary.render.mockRejectedValueOnce(new Error('编码失败'))
  await expect(renderWebRecording({ recordingId: ids[0], output }, 'eeeeeeee-0000-4000-8000-000000000001')).rejects.toThrow('编码失败')
  // 录制文件夹本身此时也是空的：清理只删这次建出的几层，不能越过它往上删。
  expect(await fs.readdir(boundary.directory)).toEqual([])

  boundary.render.mockImplementationOnce(async () => { await fs.writeFile(path.join(boundary.directory, 'a', 'b', '别人的.txt'), 'x'); throw new Error('编码失败') })
  await expect(renderWebRecording({ recordingId: ids[0], output }, 'eeeeeeee-0000-4000-8000-000000000002')).rejects.toThrow('编码失败')
  expect(await fs.readdir(path.join(boundary.directory, 'a', 'b'))).toEqual(['别人的.txt'])
})

it('重演结束的通知处理出错，不影响重演本身的结果', async () => {
  const { webReplayRenderJobs } = await import('./renderJobs')
  const stop = webReplayRenderJobs.onSettled(() => { throw new Error('账本写不进去') })
  boundary.render.mockImplementationOnce(async () => ok())
  await expect(renderWebRecording({ recordingId: ids[0] }, 'cccccccc-0000-4000-8000-000000000002')).resolves.toMatchObject({ frames: 60 })
  expect(webReplayRenderJobs.get('cccccccc-0000-4000-8000-000000000002')).toMatchObject({ state: 'completed' })
  stop()
})
