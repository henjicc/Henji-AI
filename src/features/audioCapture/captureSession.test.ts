import { describe, expect, it, vi } from 'vitest'
import { CaptureSession } from './captureSession'
import { captureFixture } from './captureTestFixture'
import { audioCaptureFileName } from '@/core/audioCapture/fileName'
import { captureTimecode, CaptureWaveform } from './captureLiveModel'

function fixture() {
  const platform = captureFixture(), imported = vi.fn(async () => 'draft'), confirm = vi.fn(async () => true)
  return { ...platform, imported, confirm, session: new CaptureSession(platform.api, imported, confirm) }
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
  it('取消离开和放弃不停止；确认离开只保留文件，放弃才进入回收站', async () => {
    const { session, confirm, api, imported } = fixture()
    await session.open(); await session.start()
    confirm.mockResolvedValue(false)
    expect(await session.leave()).toBe(false); await session.discard()
    expect(api.stop).not.toHaveBeenCalled(); expect(api.trashFile).not.toHaveBeenCalled()
    confirm.mockResolvedValue(true)
    expect(await session.leave()).toBe(true)
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
