import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { SmartRegionSourceProbe } from './service'

const execFileAsync = promisify(execFile)

interface FfprobeStream {
  width?: number
  height?: number
  sample_aspect_ratio?: string
  avg_frame_rate?: string
  r_frame_rate?: string
  side_data_list?: Array<{ rotation?: number }>
  tags?: { rotate?: string }
}

function ratio(value: string | undefined): number {
  const [numerator, denominator] = (value ?? '').split(/[/:]/).map(Number)
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0 ? numerator / denominator : NaN
}

/** ffprobe JSON → 显示尺寸（含像素比与旋转）、帧率、容器起点。 */
export function parseSmartRegionProbe(json: string): SmartRegionSourceProbe {
  const parsed = JSON.parse(json) as { streams?: FfprobeStream[]; format?: { start_time?: string } }
  const stream = parsed.streams?.[0]
  if (!stream?.width || !stream.height) throw new Error('素材没有可分析的画面。')
  const sar = ratio(stream.sample_aspect_ratio)
  let width = stream.width * (sar > 0 ? sar : 1); let height = stream.height
  const rotation = stream.side_data_list?.find(entry => typeof entry.rotation === 'number')?.rotation ?? Number(stream.tags?.rotate ?? 0)
  if (Math.abs(Math.round(rotation / 90)) % 2 === 1) [width, height] = [height, width]
  const fps = [ratio(stream.avg_frame_rate), ratio(stream.r_frame_rate)].find(value => value > 0 && value < 1000) ?? 0
  const startSeconds = Number.parseFloat(parsed.format?.start_time ?? '')
  return { width: Math.round(width), height: Math.round(height), fps, startSeconds: Number.isFinite(startSeconds) ? startSeconds : 0 }
}

export async function probeSmartRegionSource(ffprobePath: string, source: string): Promise<SmartRegionSourceProbe> {
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'error', '-select_streams', 'v:0', '-print_format', 'json',
    '-show_entries', 'stream=width,height,sample_aspect_ratio,avg_frame_rate,r_frame_rate:stream_side_data=rotation:stream_tags=rotate:format=start_time',
    source,
  ], { windowsHide: true, maxBuffer: 1024 * 1024 })
  return parseSmartRegionProbe(stdout)
}
