import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ temp: '', allowed: false }))
vi.mock('electron', () => ({ app: { getPath: () => state.temp }, BrowserWindow: {} }))
vi.mock('../protocol', () => ({ isRealPathWithinAllowedMediaRoots: async () => state.allowed }))
vi.mock('../services/audio-capture/service', () => ({ AudioCaptureService: class {} }))
vi.mock('../services/media-permissions', () => ({ mediaPermissions: {} }))
vi.mock('../services/logging', () => ({ createMainLogger: vi.fn() }))
vi.mock('./registry', () => ({ registerIpcHandler: vi.fn() }))
vi.mock('./application-control', () => ({ assertTrustedApplicationSender: vi.fn() }))
vi.mock('../services/audio-capture/client', () => ({ mainClockUs: () => 0 }))
import { audioCaptureExecutablePath, authorizedCapturePath } from './audio-capture'
import { audioCaptureRequestSchema } from '../../../src/core/audioCapture/contracts'

describe('录音 IPC 输入与文件授权', () => {
  let root: string
  beforeAll(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'capture-path-test-')); state.temp = path.join(root, 'temporary'); await fs.mkdir(state.temp) })
  afterAll(async () => { await fs.rm(root, { recursive: true, force: true }) })
  it('仅允许已授权目录或系统临时目录，不能越界或写其他文件类型', async () => {
    await expect(authorizedCapturePath(path.join(state.temp, 'a.wav'))).resolves.toBe(path.join(state.temp, 'a.wav'))
    await expect(authorizedCapturePath(path.join(root, 'a.wav'))).rejects.toMatchObject({ code: 'PATH_DENIED' })
    await expect(authorizedCapturePath(path.join(state.temp, '../a.wav'))).rejects.toThrow()
    await expect(authorizedCapturePath(path.join(state.temp, 'a.exe'))).rejects.toThrow()
    state.allowed = true
    await expect(authorizedCapturePath(path.join(root, 'a.wav'))).resolves.toBe(path.join(root, 'a.wav'))
  })
  it('严格拒绝任意字段和尚未实现的监听，不放行无会话控制', () => {
    expect(() => audioCaptureRequestSchema.parse({ action: 'start', request: { outputPath: 'x.wav', monitor: true } })).toThrow()
    expect(() => audioCaptureRequestSchema.parse({ action: 'stop', sessionId: '../x' })).toThrow()
    expect(() => audioCaptureRequestSchema.parse({ action: 'enumerate', command: 'shell' })).toThrow()
  })
  it('未打包生产入口从工作目录定位已构建录音引擎，缺失时保留中文错误', async () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root)
    try {
      expect(() => audioCaptureExecutablePath()).toThrow('原生录音引擎缺失')
      const binary = path.join(root, 'native/audio-capture/target/release', `henji-audio-capture${process.platform === 'win32' ? '.exe' : ''}`)
      await fs.mkdir(path.dirname(binary), { recursive: true })
      await fs.writeFile(binary, '')
      expect(audioCaptureExecutablePath()).toBe(binary)
    } finally { cwd.mockRestore() }
  })
})
