import { z } from 'zod'

/**
 * 本机硬件编解码能力：首次启动后台检测一次，结果存在程序目录；显卡、驱动或 Electron/Chromium 版本变化时重新检测。
 * 解码由原生解码服务实际解码随包测试视频（FFmpeg + D3D11VA），编码由 WebCodecs 先询问再实际编码几帧。
 * 结果供预渲染格式“自动”、代理编码器选择与导出编码选项说明使用。
 */
export const HARDWARE_CAPABILITIES_VERSION = 1
export const HARDWARE_DECODE_CODECS = ['h264', 'hevc', 'av1', 'vp9'] as const
export type HardwareDecodeCodec = (typeof HARDWARE_DECODE_CODECS)[number]
export const HARDWARE_ENCODE_CODECS = ['h264', 'hevc', 'av1'] as const
export type HardwareEncodeCodec = (typeof HARDWARE_ENCODE_CODECS)[number]
export type HardwareChroma = '420' | '422' | '444'

/** 随包测试视频的组合（与 scripts/generate-hardware-probe-clips.cjs 一致）。 */
export const HARDWARE_DECODE_VARIANTS: ReadonlyArray<{ codec: HardwareDecodeCodec; bitDepth: 8 | 10; chroma: HardwareChroma }> = [
  ...(['8-420', '8-422', '8-444', '10-420', '10-422'] as const).map(variant => ({ codec: 'h264' as const, ...parseVariant(variant) })),
  ...(['8-420', '8-422', '8-444', '10-420', '10-422', '10-444'] as const).map(variant => ({ codec: 'hevc' as const, ...parseVariant(variant) })),
  ...(['8-420', '10-420', '8-444', '10-444'] as const).map(variant => ({ codec: 'av1' as const, ...parseVariant(variant) })),
  ...(['8-420', '8-444', '10-420', '10-444'] as const).map(variant => ({ codec: 'vp9' as const, ...parseVariant(variant) })),
]
function parseVariant(variant: string): { bitDepth: 8 | 10; chroma: HardwareChroma } {
  const [depth, chroma] = variant.split('-')
  return { bitDepth: depth === '10' ? 10 : 8, chroma: chroma as HardwareChroma }
}
export function hardwareProbeClipName(variant: { codec: HardwareDecodeCodec; bitDepth: 8 | 10; chroma: HardwareChroma }): string {
  return `${variant.codec}-${variant.bitDepth}-${variant.chroma}.mp4`
}

const gpuSchema = z.object({
  name: z.string().max(200), vendor: z.enum(['nvidia', 'amd', 'intel', 'apple', 'other']),
  driverVersion: z.string().max(100).nullable(), dedicatedMemoryMiB: z.number().int().min(0).nullable(),
  /** 原生解码服务用来解码的显卡。 */
  decodes: z.boolean(),
}).strict()
export type HardwareGpu = z.infer<typeof gpuSchema>

const decodeResultSchema = z.object({
  codec: z.enum(HARDWARE_DECODE_CODECS), bitDepth: z.union([z.literal(8), z.literal(10)]), chroma: z.enum(['420', '422', '444']),
  /** 能否解码（硬件或软件）。 */
  supported: z.boolean(),
  /** 实际解码首帧时是否走了硬件。 */
  hardware: z.boolean(),
}).strict()
export type HardwareDecodeResult = z.infer<typeof decodeResultSchema>

export const hardwareEncodeResultSchema = z.object({
  codec: z.enum(HARDWARE_ENCODE_CODECS),
  /** WebCodecs 硬件编码：询问支持且实际编码出帧。 */
  hardware: z.boolean(),
  /** WebCodecs 软件编码可用。 */
  software: z.boolean(),
  /** 硬件编码实测通过的最大画幅（宽×高）；不支持时为 null。 */
  maxHardwareSize: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict().nullable(),
}).strict()
export type HardwareEncodeResult = z.infer<typeof hardwareEncodeResultSchema>

export const hardwareCapabilitiesReportSchema = z.object({
  version: z.literal(HARDWARE_CAPABILITIES_VERSION),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  detectedAt: z.number().int(),
  electron: z.string().max(50), chrome: z.string().max(50),
  gpus: z.array(gpuSchema).max(16),
  decode: z.array(decodeResultSchema).max(64),
  encode: z.array(hardwareEncodeResultSchema).max(8),
}).strict()
export type HardwareCapabilitiesReport = z.infer<typeof hardwareCapabilitiesReportSchema>

export interface HardwareCapabilitiesState {
  report: HardwareCapabilitiesReport | null
  /** 没有结果或硬件/版本已变化，需要重新检测。 */
  stale: boolean
}

export function hardwareDecodes(report: HardwareCapabilitiesReport | null, codec: HardwareDecodeCodec, bitDepth: 8 | 10 = 8, chroma: HardwareChroma = '420'): boolean {
  return report?.decode.some(item => item.codec === codec && item.bitDepth === bitDepth && item.chroma === chroma && item.hardware) === true
}
export function hardwareEncodes(report: HardwareCapabilitiesReport | null, codec: HardwareEncodeCodec): boolean {
  return report?.encode.some(item => item.codec === codec && item.hardware) === true
}
