import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { WebTimeGrid } from '../../../../src/core/videoEdit/webTimeCache'
import { loadFfmpegPath, loadFfprobePath } from '../video/ffmpeg-loader'

export interface WebSegmentContract {
  grid: WebTimeGrid
  frameCount: number
  width: number
  height: number
}

/** 流式读取工具输出；不把完整码流诊断留在主进程内存中。 */
async function lines(executable: string, args: string[], stdout: (line: string) => void, stderr: (line: string) => void, signal?: AbortSignal): Promise<void> {
  const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal })
  const output = createInterface({ input: child.stdout }), errors = createInterface({ input: child.stderr })
  let failure: unknown, tail = ''
  const consume = (callback: (line: string) => void, line: string): void => {
    if (failure) return
    try { callback(line) } catch (error) { failure = error; child.kill() }
  }
  output.on('line', line => consume(stdout, line))
  errors.on('line', line => { tail = (tail + line + '\n').slice(-4000); consume(stderr, line) })
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', code => failure ? reject(failure) : code === 0 ? resolve() : reject(new Error(`网页缓存码流校验失败（${code}）：${tail}`)))
    })
  } finally { output.close(); errors.close() }
}

/**
 * 发布前核对容器与 HEVC 码流：I 帧标记不能证明独立可解，必须确认参数集、IDR 和无重排的本地 PTS。
 * 这里只验证编码契约；页面可靠性、硬解实探和内容批次校验由发布方另行证明。
 */
export async function validateWebTimeSegment(file: string, expected: WebSegmentContract, signal?: AbortSignal,
  binaries?: { ffmpeg: string; ffprobe: string }): Promise<{ frames: number; idrFrames: number[]; decodedPictureBufferSize: number }> {
  const { grid, frameCount, width, height } = expected
  if (!Number.isSafeInteger(frameCount) || frameCount < 1) throw new Error('网页缓存段不能没有帧')
  const tools = binaries ?? { ffmpeg: await loadFfmpegPath(), ffprobe: await loadFfprobePath() }
  let packets = 0, streamSeen = false
  await lines(tools.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'packet=pts_time,dts_time:stream=codec_name,pix_fmt,color_range,color_space,color_transfer,color_primaries,has_b_frames,width,height',
    '-of', 'compact=p=0:nk=0', file], line => {
    const fields = Object.fromEntries(line.split('|').map(value => value.split('=')))
    if ('codec_name' in fields) {
      streamSeen = true
      if (fields.codec_name !== 'hevc' || fields.pix_fmt !== 'yuv444p' || fields.color_range !== 'tv' || fields.color_space !== 'bt709'
        || fields.color_transfer !== 'iec61966-2-1' || fields.color_primaries !== 'bt709' || fields.has_b_frames !== '0'
        || Number(fields.width) !== width || Number(fields.height) !== height) throw new Error('网页缓存编码、尺寸或色彩契约不匹配')
    } else if ('pts_time' in fields) {
      const time = packets * grid.rate.denominator / grid.rate.numerator
      if (Math.abs(Number(fields.pts_time) - time) > .000001 || Math.abs(Number(fields.dts_time) - time) > .000001
        || !Number.isFinite(Number(fields.pts_time)) || !Number.isFinite(Number(fields.dts_time))) throw new Error('网页缓存 PTS 缺帧、重复或发生重排')
      packets++
    }
  }, () => undefined, signal)
  if (!streamSeen || packets !== frameCount) throw new Error(`网页缓存帧数不匹配：${packets}/${frameCount}`)
  const parameterSets = new Set<number>(), idrFrames: number[] = []
  let nal = -1, frames = 0, decodedPictureBufferSize = 0
  const gop = Math.max(1, Math.round(grid.rate.numerator / grid.rate.denominator / 2))
  await lines(tools.ffmpeg, ['-hide_banner', '-loglevel', 'info', '-hwaccel', 'cuda', '-i', file,
    '-map', '0:v:0', '-c:v', 'copy', '-bsf:v', 'trace_headers', '-f', 'null', '-'], () => undefined, line => {
    const type = /\bnal_unit_type\s+\S+\s+=\s+(\d+)/.exec(line)
    if (type) { nal = Number(type[1]); if (nal >= 32 && nal <= 34) parameterSets.add(nal) }
    const references = /\bsps_max_dec_pic_buffering_minus1\[\d+\]\s+\S+\s+=\s+(\d+)/.exec(line)
    if (references) decodedPictureBufferSize = Math.max(decodedPictureBufferSize, Number(references[1]) + 1)
    if (/\bfirst_slice_segment_in_pic_flag\s+\S+\s+=\s+1\s*$/.test(line)) {
      if (frames === 0 && (parameterSets.size !== 3 || nal !== 19 && nal !== 20)) throw new Error('网页缓存段首缺少参数集或 IDR')
      if (nal === 19 || nal === 20) idrFrames.push(frames)
      if (frames - (idrFrames.at(-1) ?? -gop) >= gop) throw new Error('网页缓存 IDR 间隔超过半秒')
      frames++
    }
  }, signal)
  if (frames !== frameCount || decodedPictureBufferSize < 1) throw new Error('网页缓存 HEVC 帧头或参考帧信息不完整')
  return { frames, idrFrames, decodedPictureBufferSize }
}
