import { expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'

vi.mock('../../video/ffmpeg-loader', () => ({ loadFfmpegPath: async () => 'ffmpeg' }))
const spawns = vi.hoisted(() => ({ factory: undefined as (() => unknown) | undefined }))
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), spawn: () => spawns.factory!() }))
import { FrameEncoder, keyframeInterval, rawFrameBytes } from './encoder'

it('关键帧每半秒一个，剪辑里跳转最多从半秒前解起', () => {
  expect([24, 30, 60].map(keyframeInterval)).toEqual([12, 15, 30])
})

it('原始帧字节数：BGRA 每像素 4 字节，NV12 1.5 字节', () => {
  expect(rawFrameBytes(3840, 2462, 'bgra')).toBe(3840 * 2462 * 4)
  expect(rawFrameBytes(3842, 2466, 'nv12')).toBe(3842 * 2466 * 3 / 2)
  expect(rawFrameBytes(65, 67, 'yuv444p')).toBe(65 * 67 * 3)
})

it('网页段逐帧提交，拒绝缺帧和补帧；编码管道背压失败能结束等待', async () => {
  let failing = false
  const process = new EventEmitter()
  const stdin = new Writable({ write(_chunk, _encoding, callback) { callback(failing ? new Error('EPIPE') : undefined) }, final(callback) { callback(); queueMicrotask(() => process.emit('close', 0)) } })
  spawns.factory = () => Object.assign(process, { stdin, stdout: new PassThrough(), stderr: new PassThrough(), kill: () => { process.emit('close', 1); return true } })
  const encoder = new FrameEncoder(257, 259, { numerator: 30000, denominator: 1001 }, 'segment.tmp', 'yuv444p')
  await encoder.start(257, 259)
  expect([encoder.width, encoder.height]).toEqual([258, 260])
  const bytes = Buffer.alloc(257 * 259 * 3)
  await expect(encoder.write(bytes, 1)).rejects.toThrow('不能补重复帧')
  await encoder.write(bytes, 0)
  await expect(encoder.finish(1)).rejects.toThrow('不能延长')
  failing = true
  await expect(encoder.write(bytes, 1)).rejects.toThrow('EPIPE')
  await encoder.abort()
  expect(encoder.frames).toBe(1)
})

it('编码器启动中取消不会迟到创建进程，同一会话不能重复启动', async () => {
  const spawn = vi.fn()
  spawns.factory = spawn
  const encoder = new FrameEncoder(256, 256, 60, 'segment.tmp', 'yuv444p')
  const opening = encoder.start(256, 256)
  await encoder.abort()
  await expect(opening).rejects.toThrow('已取消')
  await expect(encoder.start(256, 256)).rejects.toThrow('已经启动或结束')
  expect(spawn).not.toHaveBeenCalled()
})
