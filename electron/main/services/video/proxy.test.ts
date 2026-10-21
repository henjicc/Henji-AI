import type { VideoProxyRequest } from '../../../../src/core/videoEdit/proxy'
import { afterEach, expect, it, vi, type Mock } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createContentDiskCache } from '../media/content-disk-cache'
import { assertVideoProxyAlignment, videoProxyArguments, videoProxyEncoderArguments, videoProxyFilter, videoProxyKey, videoProxySize, VideoProxyService } from './proxy'

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
it('FFmpeg不变帧率或归零时间戳，auto 取源的一半（短边最高1080）、短关键帧间隔、无B帧无声音，显卡编码与时间错位拒绝', () => {
  expect(videoProxySize(3840, 2160, 'auto')).toEqual({ width: 1920, height: 1080 })
  expect(videoProxySize(7680, 4320, 'auto')).toEqual({ width: 1920, height: 1080 })
  expect(videoProxySize(2160, 3840, 'auto')).toEqual({ width: 1080, height: 1920 })
  expect(videoProxySize(1920, 1080, 'auto')).toEqual({ width: 960, height: 540 })
  expect(videoProxySize(1920, 1080, '540p')).toEqual({ width: 960, height: 540 })
  const args = videoProxyArguments('input.mov', 'output.tmp', { width: 1920, height: 1080, fps: 59.94, encoder: 'h264_nvenc', color: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'tv' } })
  expect(args).toEqual(expect.arrayContaining(['-copyts', '-noautorotate', '-an', '-fps_mode', 'passthrough', '-enc_time_base', 'demux', '-avoid_negative_ts', 'disabled', '-f', 'mp4']))
  expect(args).not.toContain('-r'); expect(args).not.toContain('-start_at_zero')
})
it('编码参数：显卡 p4+hq、半秒 GOP、无 B 帧、闭合 GOP、VBR 目标按表、8 位 4:2:0、沿用原片色彩标记', () => {
  const value = (args: string[], flag: string): string | undefined => args[args.indexOf(flag) + 1]
  const nvenc = videoProxyEncoderArguments({ width: 1920, height: 1080, fps: 59.94, encoder: 'h264_nvenc', color: { primaries: 'bt2020', transfer: 'smpte2084', matrix: 'bt2020nc', range: 'tv' } })
  expect(nvenc.slice(0, 8)).toEqual(['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'hq', '-rc', 'vbr'])
  // 代理按自身分辨率帧率查预渲染同一张表：1080p 为 20Mbps 下限。
  expect([value(nvenc, '-b:v'), value(nvenc, '-maxrate'), value(nvenc, '-bufsize')]).toEqual(['20000k', '30000k', '40000k'])
  expect([value(nvenc, '-g'), value(nvenc, '-bf'), value(nvenc, '-flags'), value(nvenc, '-pix_fmt')]).toEqual(['30', '0', '+cgop', 'yuv420p'])
  expect(videoProxyFilter({ width: 1920, height: 1080, fps: 59.94, encoder: 'h264_nvenc', color: { primaries: 'bt2020', transfer: 'smpte2084', matrix: 'bt2020nc', range: 'tv' } }))
    .toBe('scale=1920:1080:flags=bilinear,format=yuv420p,setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc:range=tv')
  const cpu = videoProxyEncoderArguments({ width: 960, height: 540, fps: 24, encoder: 'cpu', color: { primaries: 'unknown', transfer: 'bad value' } })
  expect(cpu.slice(0, 4)).toEqual(['-c:v', 'libx264', '-preset', 'veryfast']); expect(value(cpu, '-g')).toBe('12')
  expect(videoProxyFilter({ width: 960, height: 540, fps: 24, encoder: 'cpu', color: { primaries: 'unknown', transfer: 'bad value' } })).toBe('scale=960:540:flags=bilinear,format=yuv420p')
  expect(videoProxyEncoderArguments({ width: 1920, height: 1080, fps: 30, encoder: 'h264_qsv' })).toEqual(expect.arrayContaining(['h264_qsv', 'medium']))
  expect(videoProxyEncoderArguments({ width: 1920, height: 1080, fps: 30, encoder: 'h264_amf' })).toEqual(expect.arrayContaining(['h264_amf', 'balanced']))
  expect(() => assertVideoProxyAlignment([.523, .556367, .623], [.523, .556367, .623])).not.toThrow()
  expect(() => assertVideoProxyAlignment([.523], [0])).toThrow('时间戳')
  expect(() => assertVideoProxyAlignment([0, 1], [0])).toThrow('帧数')
})
