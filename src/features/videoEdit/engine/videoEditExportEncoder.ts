import { canEncodeVideo } from 'mediabunny'
import type { VideoEditExportSettings } from '@/core/videoEdit/exportPresets'

export interface VideoEditExportEncoderSpec { width: number; height: number; frameRate: number; bitrate: number; codec?: 'avc' | 'hevc'; bitrateMode?: 'vbr' | 'cbr'; encoderPreference?: 'hardware' | 'software' }
export function videoEditExportVideoOptions(settings: Pick<VideoEditExportSettings, 'codec' | 'videoBitrateMbps' | 'bitrateMode' | 'encoderPreference' | 'keyframeInterval'>) {
  return { codec: settings.codec, bitrate: Math.round(settings.videoBitrateMbps * 1_000_000), bitrateMode: settings.bitrateMode === 'cbr' ? 'constant' as const : 'variable' as const,
    hardwareAcceleration: settings.encoderPreference === 'software' ? 'prefer-software' as const : 'prefer-hardware' as const,
    ...(settings.keyframeInterval === 'auto' ? {} : { keyFrameInterval: settings.keyframeInterval }) }
}
export async function canEncodeVideoEditExport(spec: VideoEditExportEncoderSpec & { codec: 'avc' | 'hevc' }): Promise<boolean> {
  const { codec, bitrateMode, encoderPreference, ...geometry } = spec
  return canEncodeVideo(codec, { ...geometry, ...(bitrateMode ? { bitrateMode: bitrateMode === 'cbr' ? 'constant' : 'variable' } : {}), ...(encoderPreference ? { hardwareAcceleration: encoderPreference === 'software' ? 'prefer-software' : 'prefer-hardware' } : {}) })
}
/** 探测实际输出规格；大画幅优先 HEVC，其他规格优先 H.264。 */
export async function selectVideoEditExportEncoder(spec: VideoEditExportEncoderSpec): Promise<'avc' | 'hevc'> {
  const codecs = spec.codec ? [spec.codec] : Math.max(spec.width, spec.height) > 4096 ? ['hevc', 'avc'] as const : ['avc', 'hevc'] as const
  for (const codec of codecs) if (await canEncodeVideoEditExport({ ...spec, codec })) return codec
  if (spec.codec) throw new Error(`当前设备不支持 ${spec.codec === 'avc' ? 'H.264' : 'HEVC'} · ${spec.width} × ${spec.height} · ${Number(spec.frameRate.toFixed(3))} 帧的所选编码设置。${spec.codec === 'avc' ? '请尝试 HEVC，或' : '请'}降低规格、切换性能或码率模式。`)
  throw new Error(`当前设备无法导出 ${spec.width} × ${spec.height} · ${Number(spec.frameRate.toFixed(3))} 帧视频。请降低导出分辨率或帧率后重试。`)
}
