import { canEncodeVideo } from 'mediabunny'

export interface VideoEditExportEncoderSpec { width: number; height: number; frameRate: number; bitrate: number }
/** 探测实际输出规格；大画幅优先 HEVC，其他规格优先 H.264。 */
export async function selectVideoEditExportEncoder(spec: VideoEditExportEncoderSpec): Promise<'avc' | 'hevc'> {
  const codecs = Math.max(spec.width, spec.height) > 4096 ? ['hevc', 'avc'] as const : ['avc', 'hevc'] as const
  for (const codec of codecs) if (await canEncodeVideo(codec, spec)) return codec
  throw new Error(`当前设备无法导出 ${spec.width} × ${spec.height} · ${Number(spec.frameRate.toFixed(3))} 帧视频。请降低导出分辨率或帧率后重试。`)
}
