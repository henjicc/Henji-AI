import { afterEach, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { VideoEditExportCompression } from './compression'
import { VideoEditExportJobRegistry } from './jobRegistry'
import { runVideoEditExportFfmpeg } from './ffmpeg'
import { videoEditExportCapabilities } from './capabilities'
import { loadFfmpegPath, loadFfprobePath } from '../video/ffmpeg-loader'
import { videoEditExportQualityEncoding, type VideoEditExportCapabilities } from '../../../../src/core/videoEdit/exportEncoding'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }) })
it('真实短片压制并复制声音，软件两遍编码成功，取消后能清理全部未发布文件', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-export-test-')); directories.push(root)
  const page = { senderId: 1, pageId: 'test-page' }, owner = '1:test-page'
  const registry = new VideoEditExportJobRegistry({
    createExclusive: async target => { await fs.writeFile(target, '', { flag: 'wx' }) },
    identify: async target => { try { const stat = await fs.stat(target, { bigint: true }); return { dev: stat.dev, ino: stat.ino, birthtimeNs: stat.birthtimeNs } } catch { return null } },
    remove: target => fs.rm(target, { force: true }), replace: (source, target) => fs.rename(source, target),
  })
  const binary = await loadFfmpegPath(), source = path.join(root, 'source.mp4')
  // CPU 专项不调用任何硬件探测，也不让压制服务间接初始化 GPU。
  const cpuOnly = process.env.HENJI_EXPORT_CPU_ONLY === '1'
  const duration = cpuOnly ? 1 : 10
  const capabilities: VideoEditExportCapabilities = cpuOnly ? { cuda: false, encoders: {
    h264_nvenc: { supported: false, tenBit: false }, hevc_nvenc: { supported: false, tenBit: false },
    libx264: { supported: true, tenBit: true }, libx265: { supported: true, tenBit: true },
  } } : await videoEditExportCapabilities()
  const service = new VideoEditExportCompression(async () => binary, async () => capabilities)
  if (process.env.HENJI_EXPORT_REQUIRE_NVENC === '1') {
    expect(capabilities.cuda).toBe(true)
    expect(capabilities.encoders.h264_nvenc.supported).toBe(true)
    expect(capabilities.encoders.hevc_nvenc.supported).toBe(true)
  }
  process.stdout.write(`导出测试能力：${JSON.stringify(capabilities)}\n`)
  await runVideoEditExportFfmpeg(binary, ['-y', ...(capabilities.cuda ? ['-hwaccel', 'cuda'] : []), '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', String(duration), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '10', '-c:a', 'aac', source], new AbortController().signal)
  const executed: string[] = []
  for (const encoder of ['libx264', 'libx265', ...(['h264_nvenc', 'hevc_nvenc'] as const).filter(encoder => capabilities.encoders[encoder].supported)] as const) {
    const target = path.join(root, `${encoder}.mp4`)
    registry.register(page, { snapshots: [], jobs: [{ id: encoder, projectId: 'p', name: 'test', presetName: '', outputPaths: [target], restorable: false }] })
    await registry.createOutput(page, encoder, target)
    const session = await service.prepare(owner, encoder, target)
    await fs.copyFile(source, session.intermediatePath)
    const encoding = videoEditExportQualityEncoding(encoder === 'libx265' || encoder === 'hevc_nvenc' ? 'hevc' : 'avc', 'high', encoder)
    await service.finish(owner, session.id, { ...encoding, ...(encoder === 'libx265' ? { rateControl: 'two_pass' } : {}), ...(encoder === 'h264_nvenc' ? { temporalAq: true } : {}) }, 30, duration,
      (job, output, staging) => registry.replaceOutput(page, job, output, staging), 2)
    executed.push(encoder)
    registry.outputPublished(page, encoder)
    const { stdout } = await promisify(execFile)(await loadFfprobePath(), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', target], { windowsHide: true })
    const details = JSON.parse(stdout) as { streams: Array<{ codec_name: string }>; format: { duration: string } }
    expect(details.streams.map(stream => stream.codec_name)).toContain('aac')
    expect(details.streams.map(stream => stream.codec_name)).toContain(encoder === 'libx265' || encoder === 'hevc_nvenc' ? 'hevc' : 'h264')
    expect(Number(details.format.duration)).toBeCloseTo(duration, 1)
    expect(await fs.stat(path.dirname(session.intermediatePath)).catch(() => null)).toBeNull()
  }
  process.stdout.write(`实际执行编码器：${executed.join(', ')}\n`)
  if (process.env.HENJI_EXPORT_REQUIRE_NVENC === '1') expect(executed).toEqual(expect.arrayContaining(['h264_nvenc', 'hevc_nvenc']))
  const target = path.join(root, 'cancelled.mp4'), jobId = 'cancel'
  registry.register(page, { snapshots: [], jobs: [{ id: jobId, projectId: 'p', name: 'cancel', presetName: '', outputPaths: [target], restorable: false }] })
  await registry.createOutput(page, jobId, target)
  const session = await service.prepare(owner, jobId, target)
  await fs.copyFile(source, session.intermediatePath)
  const work = service.finish(owner, session.id, { ...videoEditExportQualityEncoding('avc', 'visually_lossless', 'libx264'), preset: 'veryslow' }, 30, duration, (job, output, staging) => registry.replaceOutput(page, job, output, staging), 2)
  const rejected = expect(work).rejects.toThrow()
  await new Promise(resolve => setTimeout(resolve, 150))
  await service.cancel(owner, session.id); await rejected
  await registry.discardLeftovers(page, jobId)
  expect(await fs.stat(target).catch(() => null)).toBeNull()
  expect((await fs.readdir(root)).some(name => name.startsWith('.henji-export-'))).toBe(false)
}, 120_000)
