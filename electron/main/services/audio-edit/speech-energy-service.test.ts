import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createContentDiskCache } from '../media/content-disk-cache'
import { SpeechEnergyService } from './speech-energy-service'
import type { AudioEditSourceMetadata } from '../../../../src/core/audioEdit/types'

const directories: string[] = []
const result = { resolutionMs: 10 as const, thresholdDb: -42, highThresholdDb: -60, pauses: [{ startMs: 100, endMs: 300, cutMs: 200 }] }
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))) })
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-energy-service-')); directories.push(directory)
  const file = path.join(directory, 'voice'); await fs.writeFile(file, 'original-voice')
  const source: AudioEditSourceMetadata = { sourcePath: file, audioPath: file, sampleRate: 16000, durationFrames: 16000, channels: 2, mediaType: 'audio', ownership: 'external', audioStreamIndex: 0 }
  const disk = createContentDiskCache({ directory: () => path.join(directory, 'cache'), extension: '.json' })
  const verify = vi.fn(async (_signal: AbortSignal) => undefined)
  const run = vi.fn(async () => structuredClone(result))
  const service = new SpeechEnergyService(disk, run)
  return { file, source, disk, verify, run, service }
}

it('跨服务重建复用磁盘结果，改文件或改声道准确失效，返回副本隔离', async () => {
  const { file, source, disk, run, service, verify } = await fixture()
  const first = await service.analyze(source, {}, new AbortController().signal, () => undefined, verify)
  first.pauses.length = 0
  const restarted = new SpeechEnergyService(disk, run)
  expect(await restarted.analyze(source, {}, new AbortController().signal, () => undefined, verify)).toEqual(result)
  expect(run).toHaveBeenCalledOnce()
  await restarted.analyze(source, { channels: [{ stream: 0, channel: 1 }] }, new AbortController().signal, () => undefined, verify)
  await fs.writeFile(file, 'replacement-longer-voice')
  await restarted.analyze(source, {}, new AbortController().signal, () => undefined, verify)
  expect(run).toHaveBeenCalledTimes(3)
})

it('缓存结构合法但切点越界时重建，磁盘写入失败保留有效分析', async () => {
  const { source, disk, run, service, verify } = await fixture()
  const write = vi.spyOn(disk, 'write')
  await service.analyze(source, {}, new AbortController().signal, () => undefined, verify)
  const [key, bytes] = write.mock.calls[0]
  const corrupted = JSON.parse(Buffer.from(bytes).toString()) as { result: typeof result }
  corrupted.result.pauses[0].cutMs = 900
  await disk.write(key, Buffer.from(JSON.stringify(corrupted)))
  const errors = vi.fn()
  write.mockRejectedValueOnce(new Error('缓存磁盘已满'))
  const restarted = new SpeechEnergyService(disk, run, errors)
  expect(await restarted.analyze(source, {}, new AbortController().signal, () => undefined, verify)).toEqual(result)
  expect(run).toHaveBeenCalledTimes(2)
  expect(errors.mock.calls.map(call => call[0])).toEqual(['invalid', 'write_failed'])
})

it('入口验证期间文件改变时不解码、不发布缓存，下一次分析重算', async () => {
  const { file, source, disk, run, service, verify } = await fixture()
  const write = vi.spyOn(disk, 'write')
  await expect(service.analyze(source, {}, new AbortController().signal, () => undefined, async () => { await fs.writeFile(file, 'changed-during-analysis') })).rejects.toThrow('已改变')
  expect(write).not.toHaveBeenCalled()
  expect(run).not.toHaveBeenCalled()
  await service.analyze(source, {}, new AbortController().signal, () => undefined, verify)
  expect(run).toHaveBeenCalledOnce()
})

it('同源并发只分析一次，首位取消不影响其他调用者的解码、验证与保存', async () => {
  const { source, disk, verify } = await fixture()
  let finish!: () => void; let sharedSignal!: AbortSignal
  const run = vi.fn(async (_source, _options, signal: AbortSignal) => { sharedSignal = signal; await new Promise<void>(resolve => { finish = resolve }); signal.throwIfAborted(); return structuredClone(result) })
  const service = new SpeechEnergyService(disk, run)
  const controller = new AbortController()
  const verifyFirst = vi.fn(async () => controller.signal.throwIfAborted())
  const first = service.analyze(source, {}, controller.signal, () => undefined, verifyFirst).catch(error => error)
  const secondProgress = vi.fn()
  const second = service.analyze(source, {}, new AbortController().signal, secondProgress, verify)
  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
  await vi.waitFor(() => expect(secondProgress).toHaveBeenCalled())
  controller.abort(); finish()
  expect(await first).toBeInstanceOf(Error); expect(await second).toEqual(result)
  expect(sharedSignal.aborted).toBe(false)
  expect(verifyFirst).toHaveBeenCalledOnce()
  expect(run).toHaveBeenCalledOnce()
})
it('目录链接先发起的共享声音分析固定真实文件，各入口交付时独立复核', async () => {
  const { source, disk, verify } = await fixture()
  const root = path.dirname(source.sourcePath), alias = path.join(root, 'alias'), alternate = path.join(root, 'alternate')
  await fs.mkdir(alternate); await fs.writeFile(path.join(alternate, 'voice'), 'different-voice')
  await fs.symlink(root, alias, 'junction')
  let finish!: () => void
  const run = vi.fn(async () => { await new Promise<void>(resolve => { finish = resolve }); return structuredClone(result) })
  const service = new SpeechEnergyService(disk, run)
  const linked = path.join(alias, 'voice')
  const first = service.analyze({ ...source, sourcePath: linked, audioPath: linked }, {}, new AbortController().signal, () => undefined, verify).catch(error => error)
  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
  const progress = vi.fn(), second = service.analyze(source, {}, new AbortController().signal, progress, verify)
  await vi.waitFor(() => expect(progress).toHaveBeenCalledWith(0))
  await fs.unlink(alias); await fs.symlink(alternate, alias, 'junction'); finish()
  expect(await first).toMatchObject({ message: expect.stringContaining('原素材已改变') })
  expect(await second).toEqual(result); expect(run).toHaveBeenCalledOnce()
})
it('真实文件在共享计算中改变时拒绝所有旧证据，不发布缓存', async () => {
  const { source, disk, verify } = await fixture(), write = vi.spyOn(disk, 'write')
  const service = new SpeechEnergyService(disk, async () => { await fs.writeFile(source.audioPath, 'changed-during-decode'); return structuredClone(result) })
  await expect(service.analyze(source, {}, new AbortController().signal, () => undefined, verify)).rejects.toThrow('已改变')
  expect(write).not.toHaveBeenCalled()
})

it('缓存写入等待期间源文件改变也拒绝迟到结果', async () => {
  const { file, source, disk, run, service, verify } = await fixture()
  const write = disk.write.bind(disk)
  vi.spyOn(disk, 'write').mockImplementationOnce(async (key, bytes) => { await write(key, bytes); await fs.writeFile(file, 'replacement-while-cache-writing') })
  await expect(service.analyze(source, {}, new AbortController().signal, () => undefined, verify)).rejects.toThrow('已改变')
  await service.analyze(source, {}, new AbortController().signal, () => undefined, verify)
  expect(run).toHaveBeenCalledTimes(2)
})
