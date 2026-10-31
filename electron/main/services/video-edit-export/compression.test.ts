import { expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { VideoEditExportCompression } from './compression'
import { videoEditExportQualityEncoding, type VideoEditExportCapabilities } from '../../../../src/core/videoEdit/exportEncoding'
import * as ffmpeg from './ffmpeg'

it('排队取消立即清理，后续任务仍等待正在运行的前驱', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-export-queue-'))
  const unsupported = { supported: false, tenBit: false }
  const result: VideoEditExportCapabilities = { cuda: false, encoders: { h264_nvenc: unsupported, hevc_nvenc: unsupported, libx264: unsupported, libx265: unsupported } }
  let release!: (value: VideoEditExportCapabilities) => void
  const gate = new Promise<VideoEditExportCapabilities>(resolve => { release = resolve })
  const capabilities = vi.fn(() => gate)
  const service = new VideoEditExportCompression(vi.fn(), capabilities)
  const encoding = videoEditExportQualityEncoding('avc', 'high')
  const work: Promise<void>[] = []
  try {
    const first = await service.prepare('first', 'a', path.join(root, 'a.mp4'))
    work.push(service.finish('first', first.id, encoding, 30, 10, vi.fn()))
    const firstRejected = expect(work[0]).rejects.toThrow()
    await vi.waitFor(() => expect(capabilities).toHaveBeenCalledOnce())
    const second = await service.prepare('second', 'b', path.join(root, 'b.mp4'))
    work.push(service.finish('second', second.id, encoding, 30, 10, vi.fn()))
    const cancelled = expect(work[1]).rejects.toThrow()
    await service.cancel('second', second.id)
    await cancelled
    expect(await fs.stat(path.dirname(second.intermediatePath)).catch(() => null)).toBeNull()
    const third = await service.prepare('third', 'c', path.join(root, 'c.mp4'))
    work.push(service.finish('third', third.id, encoding, 30, 10, vi.fn()))
    const thirdRejected = expect(work[2]).rejects.toThrow()
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(capabilities).toHaveBeenCalledOnce()
    release(result)
    await Promise.all([firstRejected, thirdRejected])
    expect(capabilities).toHaveBeenCalledTimes(2)
  } finally {
    release(result)
    await Promise.allSettled(work)
    await service.release(() => true)
    await fs.rm(root, { recursive: true, force: true })
  }
})
it('准备阶段回收崩溃残留、保留活动任务；空间不足在创建中间文件之前报出数值', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-export-space-'))
  const service = new VideoEditExportCompression()
  try {
    const active = await service.prepare('owner', 'active', path.join(root, 'active.mp4'))
    const stale = await fs.mkdtemp(path.join(root, '.henji-export-'))
    await fs.writeFile(path.join(stale, 'intermediate.mp4'), 'stale')
    const next = await service.prepare('owner', 'next', path.join(root, 'next.mp4'))
    expect(await fs.stat(stale).catch(() => null)).toBeNull()
    expect(await fs.stat(active.intermediatePath)).toBeDefined()
    const disk = await fs.statfs(root, { bigint: true })
    const spy = vi.spyOn(fs, 'statfs').mockResolvedValue({ ...disk, bavail: 1n, bsize: 1024n })
    try {
      await expect(service.prepare('owner', 'full', path.join(root, 'full.mp4'), 4_000_000_000)).rejects.toThrow(/需要 6\.00 GB，可用 0\.00 GB/)
      spy.mockResolvedValue({ ...disk, bavail: 6_000_000_000n, bsize: 1n })
      await expect(service.prepare('owner', 'fits', path.join(root, 'fits.mp4'), 4_000_000_000)).resolves.toHaveProperty('id')
    }
    finally { spy.mockRestore() }
    expect(await fs.stat(next.intermediatePath)).toBeDefined()
    expect((await fs.readdir(root)).filter(name => name.startsWith('.henji-export-'))).toHaveLength(3)
  } finally { await service.release(() => true); await fs.rm(root, { recursive: true, force: true }) }
})
it('成片发布后临时目录清理失败只记日志，不撤销成功结果；清理使用原生重试', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-export-clean-'))
  const supported = { supported: true, tenBit: true }
  const capabilities: VideoEditExportCapabilities = { cuda: true, encoders: { h264_nvenc: supported, hevc_nvenc: supported, libx264: supported, libx265: supported } }
  const service = new VideoEditExportCompression(async () => 'test-ffmpeg', async () => capabilities)
  const session = await service.prepare('owner', 'job', path.join(root, 'output.mp4'))
  const run = vi.spyOn(ffmpeg, 'runVideoEditExportFfmpeg').mockImplementation(async (_binary, _args, _signal, _line, cwd) => { await fs.writeFile(path.join(cwd!, 'compressed.mp4'), 'result'); return '' })
  const remove = vi.spyOn(fs, 'rm').mockRejectedValue(Object.assign(new Error('busy'), { code: 'EBUSY' }))
  try {
    const publish = vi.fn(async () => undefined)
    await expect(service.finish('owner', session.id, videoEditExportQualityEncoding('avc', 'high'), 30, 1, publish)).resolves.toBeUndefined()
    expect(publish).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledWith(path.dirname(session.intermediatePath), expect.objectContaining({ maxRetries: 5, retryDelay: 100 }))
  } finally { run.mockRestore(); remove.mockRestore(); await fs.rm(root, { recursive: true, force: true }) }
})
it('同目录里的其他服务及存活进程仍在导出时不回收它们的临时文件', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-export-owner-'))
  const first = new VideoEditExportCompression(), second = new VideoEditExportCompression()
  const otherPid = process.pid + 1
  const alive = await fs.mkdtemp(path.join(root, `.henji-export-${otherPid}-`))
  const dead = await fs.mkdtemp(path.join(root, `.henji-export-${otherPid + 1}-`))
  const kill = vi.spyOn(process, 'kill').mockImplementation(pid => {
    if (pid === otherPid) return true
    throw Object.assign(new Error('no process'), { code: 'ESRCH' })
  })
  try {
    const active = await first.prepare('first', 'first', path.join(root, 'first.mp4'))
    await second.prepare('second', 'second', path.join(root, 'second.mp4'))
    expect(await fs.stat(active.intermediatePath)).toBeDefined()
    expect(await fs.stat(alive)).toBeDefined()
    expect(await fs.stat(dead).catch(() => null)).toBeNull()
  } finally { kill.mockRestore(); await first.release(() => true); await second.release(() => true); await fs.rm(root, { recursive: true, force: true }) }
})
