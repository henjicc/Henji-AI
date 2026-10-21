import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AudioEditProjectDocument } from '../../../../src/core/audioEdit/types'
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))
vi.mock('../db', () => ({ getDb: vi.fn() }))
vi.mock('../appPaths', () => ({ getProgramStoreDir: () => `${os.tmpdir()}/AudioEdit` }))
vi.mock('../media/shared', () => ({ resolveLocalMediaPath: async (value: string) => value }))
vi.mock('../media/media-cache-runtime', () => ({ getMediaCacheManager: () => ({ categoryDirectory: (_category: string, id: string) => path.join(os.tmpdir(), '.痕迹AI缓存', 'audio-edit', id) }) }))
vi.mock('./project-store', () => ({ requireAudioEditProject: vi.fn() }))
import { identifyAudioEditSource, verifyAudioEditSource, audioEditCacheDirectory, probeAudioEditImport } from './media'
import { cancelAudioEditTask, hasActiveAudioEditTask } from './task-store'
import { runAudioEditProcess } from './process'
vi.mock('../video/ffmpeg-loader', () => ({ loadFfprobePath: async () => 'ffprobe' }))
vi.mock('./process', () => ({ runAudioEditProcess: vi.fn() }))

let directory: string | undefined
afterEach(async () => { if (directory) await fs.rm(directory, { recursive: true, force: true }); directory = undefined })
it('detects same-name, same-size, restored-time replacement without altering the source', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-source-test-'))
  const file = path.join(directory, '中文 & # 原素材.wav')
  await fs.writeFile(file, 'original')
  const identity = await identifyAudioEditSource(file)
  const project = { source: { sourcePath: file, identity } } as AudioEditProjectDocument
  await expect(verifyAudioEditSource(project)).resolves.toBeUndefined()
  await fs.writeFile(file, 'replaced')
  await fs.utimes(file, new Date(identity.mtimeMs), new Date(identity.mtimeMs))
  await expect(verifyAudioEditSource(project)).rejects.toThrow('内容已改变')
  expect(await fs.readFile(file, 'utf8')).toBe('replaced')
  await fs.rename(file, path.join(directory, '移动.wav'))
  await expect(verifyAudioEditSource(project)).rejects.toThrow('重新定位')
})
it('rejects cache traversal before filesystem deletion is possible', () => {
  expect(() => audioEditCacheDirectory('../original')).toThrow('无效')
  expect(() => audioEditCacheDirectory('C:\\original')).toThrow('无效')
  // 口播缓存随作品目录下的统一缓存根（缓存与代理改造），不再放程序目录。
  expect(audioEditCacheDirectory('safe-project')).toBe(path.join(os.tmpdir(), '.痕迹AI缓存', 'audio-edit', 'safe-project'))
})

it('探测前已登记取消，音频帧/视频包扫描与流式哈希都接收取消信号', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-probe-cancel-'))
  const file = path.join(directory, '素材.mp4')
  await fs.writeFile(file, Buffer.alloc(16 * 1024 * 1024))
  const process = vi.mocked(runAudioEditProcess)
  process.mockImplementation(async (_binary, args, signal, _onLine, onOutputLine, idleTimeout) => {
    expect(hasActiveAudioEditTask('probe-request')).toBe(true)
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(idleTimeout).toBe(30_000)
    if (args.includes('-show_streams')) return JSON.stringify({ streams: [
      { index: 0, codec_type: 'audio', sample_rate: '48000', duration: '1' },
      { index: 1, codec_type: 'video', r_frame_rate: '25/1', avg_frame_rate: '25/1', duration: '1' },
    ] })
    if (args.includes('-show_frames')) onOutputLine?.('48000')
    else { onOutputLine?.('0,0.04'); setImmediate(() => cancelAudioEditTask('probe-request')) }
    return ''
  })
  await expect(probeAudioEditImport(file, 'probe-request')).rejects.toMatchObject({ name: 'AbortError' })
  expect(process).toHaveBeenCalledTimes(3)
  expect(hasActiveAudioEditTask('probe-request')).toBe(false)
})
