import { describe, expect, it, vi } from 'vitest'
import { CaptureSession } from './captureSession'
import { captureFixture } from './captureTestFixture'
import { audioCaptureFileName } from '@/core/audioCapture/fileName'
import { captureTimecode, CaptureWaveform } from './captureLiveModel'

function fixture() {
  const platform = captureFixture(), imported = vi.fn(async () => 'draft')
  return { ...platform, imported, session: new CaptureSession(platform.api, imported) }
}
describe('录音会话', () => {
  it('开始、暂停、继续、停止后按原文件导入一次，并清除恢复记录', async () => {
    const { session, api, imported, status } = fixture()
    await session.open(); await session.start(); expect(session.store.getState().phase).toBe('recording')
    expect(api.start).toHaveBeenCalledWith({ outputPath: status.outputPath, streamSamples: true })
    await session.togglePause(); expect(session.store.getState().phase).toBe('paused')
    await session.togglePause(); expect(session.store.getState().phase).toBe('recording')
    await session.stop(); expect(imported).toHaveBeenCalledTimes(1); expect(imported).toHaveBeenCalledWith(status.outputPath)
    expect(api.completeFile).toHaveBeenCalledWith(status.outputPath)
    expect(session.store.getState().visible).toBe(false)
    await session.open(); expect(session.durationSeconds).toBe(0)
  })
  it('双击开始不会创建两个会话，启动失败保留错误及文件位置', async () => {
    const { session, api } = fixture()
    vi.mocked(api.start).mockRejectedValueOnce(new Error('设备被占用'))
    await expect(Promise.all([session.start(), session.start()])).rejects.toThrow('设备被占用')
    expect(api.start).toHaveBeenCalledTimes(1)
    expect(session.store.getState()).toMatchObject({ phase: 'idle', busy: false, error: '设备被占用' })
  })
  it('离开直接停止并保留文件，放弃直接进入回收站', async () => {
    const { session, api, imported } = fixture()
    await session.open(); await session.start()
    expect(await session.leave()).toBe(true)
    expect(api.stop).toHaveBeenCalledOnce(); expect(api.trashFile).not.toHaveBeenCalled()
    expect(imported).not.toHaveBeenCalled(); expect(api.completeFile).not.toHaveBeenCalled()
    await session.discard(); expect(api.trashFile).toHaveBeenCalledTimes(1)
  })
  it('中断保留已录时长，忽略其他会话事件，恢复成功才清记录', async () => {
    const { session, emit, status, api, imported } = fixture()
    await session.start()
    emit({ event: 'interrupted', sessionId: 'other', outputPath: 'other', writtenBytes: 0, error: { code: 'DISCONNECTED', message: '设备拔出', recoverable: true } })
    expect(session.store.getState().phase).toBe('recording')
    emit({ event: 'interrupted', sessionId: status.sessionId, outputPath: status.outputPath, writtenBytes: 432000, error: { code: 'DISCONNECTED', message: '设备拔出', recoverable: true } })
    expect(session.store.getState()).toMatchObject({ phase: 'interrupted', error: expect.stringContaining('3.0 秒') })
    vi.mocked(api.recover).mockRejectedValueOnce(new Error('恢复失败'))
    await expect(session.recover()).rejects.toThrow('恢复失败'); expect(imported).not.toHaveBeenCalled()
    await session.recover(); expect(imported).toHaveBeenCalledOnce()
  })
  it('导入失败可重试，导入成功但收尾失败也不会重复创建草稿', async () => {
    const { session, imported, api } = fixture()
    await session.start()
    imported.mockRejectedValueOnce(new Error('无法导入'))
    await expect(session.stop()).rejects.toThrow('无法导入'); expect(api.completeFile).not.toHaveBeenCalled()
    vi.mocked(api.completeFile).mockRejectedValueOnce(new Error('写入失败'))
    await expect(session.recover()).rejects.toThrow('写入失败')
    await session.recover(); expect(imported).toHaveBeenCalledTimes(2)
  })
})
it('本地日期命名、毫秒时间码与有界实时波形', () => {
  expect(audioCaptureFileName(new Date(2026, 9, 23, 1, 2, 3))).toBe('录音 2026-10-23 010203.wav')
  expect(audioCaptureFileName(new Date(2026, 9, 23, 1, 2, 3), 1)).toBe('录音 2026-10-23 010203 (1).wav')
  expect(captureTimecode(3661.123)).toBe('01:01:01.123')
  const waveform = new CaptureWaveform()
  const pcm = new Float32Array(24000).fill(.5)
  waveform.push({ event: 'samples', sessionId: 's', sequence: 0, firstFrame: 0, frames: pcm.length, channels: 1, sampleRate: 1000, monoUs: 0, nativeMonoUs: 0, uncertaintyUs: 0, format: 'float32le', pcm: new Uint8Array(pcm.buffer) })
  const result = waveform.snapshot()
  expect(result.pyramid.levels[0].peak[0]).toHaveLength(1000)
  expect(result.pyramid.levels[0].peak[0][999]).toBe(32768)
})


it('编辑器暂停结束 take 并提交，释放锁后可编辑，继续使用新播放头位置', async () => {
  const { api } = captureFixture()
  const release = vi.fn(), lock = vi.fn(() => release), commit = vi.fn(async (_path: string, _placement: import('@/core/audioCapture/contracts').AudioCapturePlacement) => undefined)
  const session = new CaptureSession(api, vi.fn(), { lock, commit, progress: vi.fn(), rate: () => 48000 })
  const placement = { projectId: 'p', startFrame: 100, endFrame: 100, revision: 1, spliceId: 'eced7817-a431-49e0-8890-5bf4b08ecb44' }
  await session.start(placement)
  expect(api.prepareFile).toHaveBeenCalledWith(placement)
  await session.togglePause()
  expect(api.stop).toHaveBeenCalledTimes(1)
  expect(api.pause).not.toHaveBeenCalled()
  expect(commit).toHaveBeenCalledTimes(1)
  expect(release).toHaveBeenCalledTimes(1)
  expect(session.store.getState()).toMatchObject({ phase: 'paused', outputPath: null })
  const next = { ...placement, startFrame: 1000, endFrame: 1000, revision: 2 }
  await session.start(next)
  await session.stop()
  expect(api.start).toHaveBeenCalledTimes(2)
  expect(commit.mock.calls[1][1]).toEqual(next)
  expect(session.store.getState().phase).toBe('idle')
})

it('覆盖录音到达末尾自动结束，启动失败释放编辑锁', async () => {
  const { api, emit, status } = captureFixture()
  const release = vi.fn(), commit = vi.fn(async () => undefined)
  const session = new CaptureSession(api, vi.fn(), { lock: () => release, commit, progress: vi.fn(), rate: () => 48000 })
  const placement = { projectId: 'p', startFrame: 0, endFrame: 48000, revision: 1, spliceId: 'eced7817-a431-49e0-8890-5bf4b08ecb44' }
  vi.mocked(api.getSettings).mockRejectedValueOnce(new Error('设备不可用'))
  await expect(session.start(placement)).rejects.toThrow('设备不可用')
  expect(release).toHaveBeenCalledTimes(1)
  await session.start(placement)
  emit({ event: 'level', sessionId: status.sessionId, durationSeconds: 1.01, peak: [.2], rms: [.1], clipped: [false], writtenBytes: 144000 })
  await vi.waitFor(() => expect(session.store.getState().phase).toBe('idle'))
  expect(commit).toHaveBeenCalledTimes(1)
})

it('设备中断后离开先修复文件并提交；失败保留会话，不能删掉待恢复的空草稿', async () => {
  const { api, emit, status } = captureFixture()
  const release = vi.fn(), commit = vi.fn(async () => undefined)
  const session = new CaptureSession(api, vi.fn(), { lock: () => release, commit, progress: vi.fn(), rate: () => 48000 })
  await session.start({ projectId: 'p', startFrame: 0, endFrame: 0, revision: 1, spliceId: 'eced7817-a431-49e0-8890-5bf4b08ecb44' })
  emit({ event: 'interrupted', sessionId: status.sessionId, outputPath: status.outputPath, writtenBytes: 432000, error: { code: 'DISCONNECTED', message: '设备拔出', recoverable: true } })
  commit.mockRejectedValueOnce(new Error('保存失败'))
  expect(await session.leave()).toBe(false)
  expect(session.store.getState().visible).toBe(true)
  expect(api.completeFile).not.toHaveBeenCalled()
  expect(await session.leave()).toBe(true)
  expect(api.recover).toHaveBeenCalledWith(status.outputPath)
  expect(api.completeFile).toHaveBeenCalledTimes(1)
})
