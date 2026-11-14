import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { createMainLogger } from '../logging'
import { VIDEO_EDIT_EXPORT_ENCODERS, videoEditExportQualityEncoding, type VideoEditExportCapabilities } from '../../../../src/core/videoEdit/exportEncoding'
import { runVideoEditExportFfmpeg, videoEditExportFfmpegVideoArgs, videoEditExportFfmpegErrorSummary } from './ffmpeg'

const logger = createMainLogger('main.video_edit_export')
const unsupported = (reason: string): boolean => /no (?:nvenc capable )?devices?|cannot load (?:nvcuda|libcuda|nvencodeapi|libnvidia-encode)|does(?: not|n't) support|not supported|unsupported device|unknown device type|minimum required nvidia driver/i.test(reason)
export class VideoEditExportCapabilityProbe {
  private cached?: Promise<VideoEditExportCapabilities>
  constructor(private readonly run: (args: string[]) => Promise<string>) {}
  get(): Promise<VideoEditExportCapabilities> {
    return this.cached ??= this.probe().catch(error => { this.cached = undefined; throw error })
  }
  private async probe(): Promise<VideoEditExportCapabilities> {
    logger.info('探测导出编码器', { event: 'video_edit_export.capabilities.start' })
    try {
      const list = await this.run(['-encoders'])
      const encoders = {} as VideoEditExportCapabilities['encoders']
      let transient = false
      const tests: Array<() => Promise<void>> = VIDEO_EDIT_EXPORT_ENCODERS.map(encoder => async () => {
        const codec = encoder === 'hevc_nvenc' || encoder === 'libx265' ? 'hevc' : 'avc'
        const template = videoEditExportQualityEncoding(codec, 'visually_lossless', encoder)
        let reason: string | undefined
        const test = async (tenBit: boolean): Promise<boolean> => {
          try { await this.run([...(encoder.endsWith('_nvenc') ? ['-hwaccel', 'cuda'] : []), '-f', 'lavfi', '-i', 'color=s=256x256:r=30', '-frames:v', '1', ...videoEditExportFfmpegVideoArgs({ ...template, tenBit }, 30), '-f', 'null', '-']); return true }
          catch (error) {
            const detail = videoEditExportFfmpegErrorSummary(error)
            // 只有明确的设备/格式缺失才是稳定结论，忙、超时及未知初始化失败允许重试。
            const stable = unsupported(detail)
            if (!stable) transient = true
            // reason 会显示在导出窗口里：编码器的英文输出只进日志。
            reason = stable ? `这台电脑的显卡或驱动不支持 ${encoder}${tenBit ? ' 10 位输出' : ''}。` : `${encoder} 暂时初始化不了（可能正被其他程序占用），稍后会重新检测。`
            logger.debug('编码器初始化未通过', { event: 'video_edit_export.capabilities.unsupported', error, context: { encoder, tenBit, detail } }); return false
          }
        }
        const supported = new RegExp(`\\b${encoder}\\b`).test(list) && await test(false)
        const tenBit = supported && await test(true)
        encoders[encoder] = { supported, tenBit, ...(!supported || !tenBit ? { reason: reason ?? `随包 FFmpeg 不包含 ${encoder}。` } : {}) }
      })
      let cuda = false
      tests.push(async () => {
        try { await this.run(['-init_hw_device', 'cuda', '-f', 'lavfi', '-i', 'color=s=256x256', '-frames:v', '1', '-f', 'null', '-']); cuda = true } catch (error) { if (!unsupported(videoEditExportFfmpegErrorSummary(error))) transient = true }
      })
      // 每个编码器内部按 8/10 位顺序初始化，包含 CUDA 探测在内最多四个子进程。
      await Promise.all(Array.from({ length: 4 }, async () => {
        for (let test = tests.shift(); test; test = tests.shift()) await test()
      }))
      const result = { cuda, encoders }
      logger.info('导出编码器探测完成', { event: 'video_edit_export.capabilities.completed', context: result })
      if (transient) this.cached = undefined
      return result
    } catch (error) { logger.error('导出编码器探测失败', { event: 'video_edit_export.capabilities.failed', error }); throw error }
  }
}
const probe = new VideoEditExportCapabilityProbe(async args => runVideoEditExportFfmpeg(await loadFfmpegPath(), args, AbortSignal.timeout(30_000)))
export function videoEditExportCapabilities(): Promise<VideoEditExportCapabilities> { return probe.get() }
