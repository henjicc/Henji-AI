import { expect, it, vi } from 'vitest'
import { videoEditExportQualityEncoding } from '../../../../src/core/videoEdit/exportEncoding'
import { videoEditExportFfmpegArgs } from './ffmpeg'
import { VideoEditExportCapabilityProbe } from './capabilities'

it('质量模式使用 CQ/CRF，码率模式与两遍分析使用各编码器原生参数', () => {
  const encode = videoEditExportQualityEncoding('avc', 'visually_lossless', 'h264_nvenc')
  const args = videoEditExportFfmpegArgs('input.mp4', 'output.mp4', encode, 29.97, true)
  expect(args.slice(0, 5)).toEqual(['-y', '-hwaccel', 'cuda', '-i', 'input.mp4'])
  expect(args).toContain('-cq'); expect(args).not.toContain('-crf')
  expect(args.slice(args.indexOf('-c:a'), args.indexOf('-c:a') + 2)).toEqual(['-c:a', 'copy'])
  expect(args).toContain('+faststart')
  for (const encoder of ['libx264', 'libx265'] as const) {
    const settings = videoEditExportQualityEncoding(encoder === 'libx264' ? 'avc' : 'hevc', 'high', encoder)
    expect(videoEditExportFfmpegArgs('in', 'out', settings, 30, false)).toContain('-crf')
    const pass = videoEditExportFfmpegArgs('in', 'out', { ...settings, rateControl: 'two_pass' }, 30, false, { number: 1, log: 'analysis' })
    expect(pass).toContain('-an'); expect(pass.slice(-3)).toEqual(['-f', 'null', '-'])
    expect(pass).not.toContain('-crf')
    expect(pass).toContain(encoder === 'libx264' ? '-pass' : '-x265-params')
  }
})
it('能力探测共享并发与成功缓存，真实初始化失败的 NVENC 不冒充可用', async () => {
  const run = vi.fn(async (args: string[]) => {
    if (args.includes('-encoders')) return ' h264_nvenc hevc_nvenc libx264 libx265'
    if (args.includes('h264_nvenc')) throw new Error('No NVENC capable devices found')
    return ''
  })
  const probe = new VideoEditExportCapabilityProbe(run)
  const [a, b] = await Promise.all([probe.get(), probe.get()])
  expect(a).toBe(b); expect(a.encoders.h264_nvenc.supported).toBe(false)
  expect(a.encoders.hevc_nvenc.tenBit).toBe(true)
  const calls = run.mock.calls.length
  expect(await probe.get()).toBe(a); expect(run).toHaveBeenCalledTimes(calls)
})
it('最大码率启用 VBV 时默认缓冲为两倍；VBR/CBR/两遍均使用顶层目标码率', () => {
  for (const rateControl of ['vbr', 'cbr', 'two_pass'] as const) {
    const settings = { ...videoEditExportQualityEncoding('avc', 'high'), rateControl, maxBitrateMbps: 12 }
    const args = videoEditExportFfmpegArgs('in', 'out', settings, 30, false, undefined, 7)
    expect(args[args.indexOf('-b:v') + 1]).toBe('7M')
    expect(args[args.indexOf('-bufsize') + 1]).toBe(rateControl === 'cbr' ? '14M' : '24M')
  }
})
it('忙与超时不缓存为不支持，错误保留 FFmpeg 摘要；探测帧尺寸满足 NVENC', async () => {
  let busy = true
  const run = vi.fn(async (args: string[]) => {
    if (args.includes('-encoders')) return ' h264_nvenc hevc_nvenc libx264 libx265'
    if (busy && args.includes('h264_nvenc')) throw new Error('OpenEncodeSessionEx failed: encoder busy')
    return ''
  })
  const probe = new VideoEditExportCapabilityProbe(run)
  expect((await probe.get()).encoders.h264_nvenc).toMatchObject({ supported: false, reason: expect.stringContaining('暂时初始化不了') })
  busy = false
  expect((await probe.get()).encoders.h264_nvenc.supported).toBe(true)
  expect(run.mock.calls.filter(([args]) => args.includes('h264_nvenc')).every(([args]) => args.includes('color=s=256x256:r=30'))).toBe(true)
})
it('输出矩阵对应正确的原色与传递标签', () => {
  for (const [colorMatrix, primaries, transfer] of [['bt709', 'bt709', 'bt709'], ['smpte170m', 'smpte170m', 'smpte170m'], ['bt2020nc', 'bt2020', 'bt2020-10']] as const) {
    const args = videoEditExportFfmpegArgs('in', 'out', { ...videoEditExportQualityEncoding('hevc', 'high'), colorMatrix }, 30, false)
    expect(args[args.indexOf('-colorspace') + 1]).toBe(colorMatrix)
    expect(args[args.indexOf('-color_primaries') + 1]).toBe(primaries)
    expect(args[args.indexOf('-color_trc') + 1]).toBe(transfer)
  }
})
it('无 CUDA 的确定失败会缓存，初始化并行且最多四个进程', async () => {
  let active = 0, maximum = 0
  const run = vi.fn(async (args: string[]) => {
    if (args.includes('-encoders')) return ' h264_nvenc hevc_nvenc libx264 libx265'
    maximum = Math.max(maximum, ++active)
    await new Promise<void>(resolve => setImmediate(resolve))
    active--
    if (args.includes('cuda')) throw new Error('unknown device type cuda')
    return ''
  })
  const probe = new VideoEditExportCapabilityProbe(run)
  const result = await probe.get()
  expect(result.cuda).toBe(false)
  expect(result.encoders.h264_nvenc.supported).toBe(false)
  expect(result.encoders.libx265.supported).toBe(true)
  expect(maximum).toBe(4)
  const count = run.mock.calls.length
  expect(await probe.get()).toBe(result)
  expect(run).toHaveBeenCalledTimes(count)
})
