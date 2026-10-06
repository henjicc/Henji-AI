import type { VideoProxyRequest } from '../../../../src/core/videoEdit/proxy'
import { afterEach, expect, it, vi, type Mock } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createContentDiskCache } from '../media/content-disk-cache'
import { assertVideoProxyAlignment, videoProxyArguments, videoProxyKey, VideoProxyService } from './proxy'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }) })
async function fixture(): Promise<{ source: string; root: string; service: VideoProxyService; transcode: Mock<[VideoProxyRequest, string, AbortSignal], Promise<{ width: number; height: number }>> }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-proxy-unit-')); directories.push(root)
  const source = path.join(root, 'original.mov'); await fs.writeFile(source, 'original')
  const cache = createContentDiskCache({ directory: () => path.join(root, 'cache'), extension: '.mp4' })
  const metadata = createContentDiskCache({ directory: () => path.join(root, 'cache'), extension: '.json' })
  const transcode = vi.fn(async (_request: VideoProxyRequest, file: string, signal: AbortSignal) => { signal.throwIfAborted(); await fs.writeFile(file, 'proxy-video'); return { width: 1280, height: 720 } })
  return { source, root, service: new VideoProxyService(cache, metadata, transcode), transcode }
}
it('代理键只取内容身份、预设与算法；同内容命中，原片变动和540p分离，损坏代理重算', async () => {
  expect(videoProxyKey('a'.repeat(64), '720p')).not.toBe(videoProxyKey('a'.repeat(64), '540p'))
  const { source, service, transcode } = await fixture(); const signal = new AbortController().signal
  const request = { source, requestId: 'first', preset: '720p' as const }
  const result = await service.create(request, signal, () => undefined)
  expect(await service.create({ ...request, requestId: 'second' }, signal, () => undefined)).toEqual(result)
  expect(transcode).toHaveBeenCalledTimes(1)
  await fs.writeFile(result.path, 'broken')
  expect(await service.lookup(source, '720p')).toBeNull()
  await service.create(request, signal, () => undefined)
  await fs.writeFile(source, 'changed-original')
  expect(await service.lookup(source, '720p')).toBeNull()
  expect((await service.create(request, signal, () => undefined)).key).not.toBe(result.key)
})
it('取消与生成期间原片变化不发布代理，残留临时文件清理', async () => {
  const { source, root, service, transcode } = await fixture()
  const controller = new AbortController(); controller.abort(new Error('已取消'))
  await expect(service.create({ source, requestId: 'cancel', preset: '540p' }, controller.signal, () => undefined)).rejects.toThrow('已取消')
  expect(transcode).not.toHaveBeenCalled()
  transcode.mockImplementationOnce(async (_request: VideoProxyRequest, file: string) => { await fs.writeFile(file, 'proxy'); await fs.writeFile(source, 'changed'); return { width: 960, height: 540 } })
  await expect(service.create({ source, requestId: 'change', preset: '540p' }, new AbortController().signal, () => undefined)).rejects.toThrow('原片已改变')
  expect((await fs.readdir(path.join(root, 'cache'))).filter(name => name.endsWith('.tmp'))).toEqual([])
})
it('FFmpeg不变帧率或归零时间戳，720/540偶数尺寸、H264全帧内、无代理声音，时间错位拒绝', () => {
  const args = videoProxyArguments('input.mov', 'output.tmp', '540p')
  expect(args).toEqual(expect.arrayContaining(['-copyts', '-noautorotate', '-an', '-g', '1', '-fps_mode', 'passthrough', '-enc_time_base', 'demux', '-avoid_negative_ts', 'disabled', '-f', 'mp4']))
  expect(args).not.toContain('-r'); expect(args).not.toContain('-start_at_zero')
  expect(args.join(' ')).toContain('min(540,ih)')
  expect(() => assertVideoProxyAlignment([.523, .556367, .623], [.523, .556367, .623])).not.toThrow()
  expect(() => assertVideoProxyAlignment([.523], [0])).toThrow('时间戳')
  expect(() => assertVideoProxyAlignment([0, 1], [0])).toThrow('帧数')
})
