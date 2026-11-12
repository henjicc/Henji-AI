/* HEVC SPS syntax walk adapted from Mediabunny 1.61.0 src/codec-data.ts (parseHevcSps, parseProfileTierLevel,
 * skipScalingListData, skipStRefPicSet, parseHevcVui). Copyright (c) 2026-present, Vanilagy and contributors.
 * MPL-2.0: https://mozilla.org/MPL/2.0/
 * lt_ref_pic_poc_lsb_sps is read as u(v) per H.265 7.3.2.2 (Mediabunny reads it as ue(v)).
 */
import { createLogger } from '@/core/logging'

const logger = createLogger('features.videoEdit.exportEncoder')

/**
 * 硬件 HEVC 编码器（Windows 上经 Media Foundation）写出的 SPS 不带 VUI 色彩描述，色彩只在容器的 colr 里。
 * FFmpeg 的 HEVC 解码器在 SPS 没有色彩描述时把色彩重置为未指定，所以按码流解码的工具与播放器读出 unknown；
 * H.264 解码器保留容器的值，同样的成片读出 bt709。封装前把编码器报告的色彩（与 colr 同一份）写进 SPS 的 VUI，
 * 码流与容器一致。只改 VUI 的 video_signal_type 一段，其余各位原样保留；不重新编码，不动画面数据。
 */

const PRIMARIES: Record<string, number> = { bt709: 1, bt470bg: 5, smpte170m: 6, bt2020: 9, smpte432: 12 }
const TRANSFER: Record<string, number> = { bt709: 1, smpte170m: 6, linear: 8, 'iec61966-2-1': 13, pq: 16, hlg: 18 }
const MATRIX: Record<string, number> = { rgb: 0, bt709: 1, bt470bg: 5, smpte170m: 6, 'bt2020-ncl': 9 }
const SPS_NAL_TYPE = 33

interface HevcColour { primaries: number; transfer: number; matrix: number; fullRange: boolean }

function hevcColour(colorSpace: VideoColorSpaceInit | undefined): HevcColour | undefined {
  const primaries = colorSpace?.primaries ? PRIMARIES[colorSpace.primaries] : undefined
  const transfer = colorSpace?.transfer ? TRANSFER[colorSpace.transfer] : undefined
  const matrix = colorSpace?.matrix ? MATRIX[colorSpace.matrix] : undefined
  if (primaries === undefined || transfer === undefined || matrix === undefined) return undefined
  return { primaries, transfer, matrix, fullRange: colorSpace?.fullRange === true }
}

function unescapeRbsp(nal: Uint8Array): Uint8Array {
  const out: number[] = []
  let zeros = 0
  for (const byte of nal) {
    if (zeros >= 2 && byte === 3) { zeros = 0; continue }
    out.push(byte)
    zeros = byte === 0 ? zeros + 1 : 0
  }
  return Uint8Array.from(out)
}
function escapeRbsp(rbsp: Uint8Array): Uint8Array {
  const out: number[] = []
  let zeros = 0
  for (const byte of rbsp) {
    if (zeros >= 2 && byte <= 3) { out.push(3); zeros = 0 }
    out.push(byte)
    zeros = byte === 0 ? zeros + 1 : 0
  }
  return Uint8Array.from(out)
}

class Bits {
  position = 0
  constructor(readonly bits: number[]) {}
  static of(bytes: Uint8Array): Bits {
    const bits: number[] = []
    for (const byte of bytes) for (let shift = 7; shift >= 0; shift--) bits.push((byte >> shift) & 1)
    return new Bits(bits)
  }
  read(count: number): number {
    if (this.position + count > this.bits.length) throw new Error('HEVC SPS 不完整。')
    let value = 0
    for (let index = 0; index < count; index++) value = value * 2 + this.bits[this.position++]
    return value
  }
  skip(count: number): void { this.read(count) }
  ue(): number {
    let zeros = 0
    while (this.read(1) === 0) { if (++zeros > 31) throw new Error('HEVC SPS 指数哥伦布码无效。') }
    return 2 ** zeros - 1 + this.read(zeros)
  }
  se(): number { const value = this.ue(); return value % 2 ? (value + 1) / 2 : -value / 2 }
}

function skipProfileTierLevel(bits: Bits, maxSubLayersMinus1: number): void {
  bits.skip(2 + 1 + 5 + 32 + 48 + 8)
  const profilePresent: number[] = [], levelPresent: number[] = []
  for (let index = 0; index < maxSubLayersMinus1; index++) { profilePresent.push(bits.read(1)); levelPresent.push(bits.read(1)) }
  if (maxSubLayersMinus1 > 0) for (let index = maxSubLayersMinus1; index < 8; index++) bits.skip(2)
  for (let index = 0; index < maxSubLayersMinus1; index++) { if (profilePresent[index]) bits.skip(88); if (levelPresent[index]) bits.skip(8) }
}
function skipScalingListData(bits: Bits): void {
  for (let sizeId = 0; sizeId < 4; sizeId++) {
    for (let matrixId = 0; matrixId < (sizeId === 3 ? 2 : 6); matrixId++) {
      if (!bits.read(1)) { bits.ue(); continue }
      if (sizeId > 1) bits.se()
      for (let index = 0; index < Math.min(64, 1 << (4 + (sizeId << 1))); index++) bits.se()
    }
  }
}
function skipShortTermRefPicSets(bits: Bits, count: number): void {
  const deltaPocs: number[] = []
  for (let index = 0; index < count; index++) {
    if (index !== 0 && bits.read(1)) {
      const reference = index === count ? index - (bits.ue() + 1) : index - 1
      bits.skip(1); bits.ue()
      // 预测得到的条目数是“被引用或保留”的项数（7.4.8），不等于参考集的条目数。
      let kept = 0
      for (let j = 0; j <= (deltaPocs[reference] ?? 0); j++) if (bits.read(1) || bits.read(1)) kept++
      deltaPocs[index] = kept
    } else {
      const negative = bits.ue(), positive = bits.ue()
      for (let j = 0; j < negative + positive; j++) { bits.ue(); bits.skip(1) }
      deltaPocs[index] = negative + positive
    }
  }
}

/** SPS 里 vui_parameters_present_flag 所在的位（含两字节 NAL 头）。 */
function vuiFlagPosition(bits: Bits): number {
  bits.skip(16 + 4)
  const maxSubLayersMinus1 = bits.read(3)
  bits.skip(1)
  skipProfileTierLevel(bits, maxSubLayersMinus1)
  bits.ue()
  if (bits.ue() === 3) bits.skip(1)
  bits.ue(); bits.ue()
  if (bits.read(1)) { bits.ue(); bits.ue(); bits.ue(); bits.ue() }
  bits.ue(); bits.ue()
  const pocLsbBits = bits.ue() + 4
  for (let index = bits.read(1) ? 0 : maxSubLayersMinus1; index <= maxSubLayersMinus1; index++) { bits.ue(); bits.ue(); bits.ue() }
  for (let index = 0; index < 6; index++) bits.ue()
  if (bits.read(1) && bits.read(1)) skipScalingListData(bits)
  bits.skip(2)
  if (bits.read(1)) { bits.skip(8); bits.ue(); bits.ue(); bits.skip(1) }
  skipShortTermRefPicSets(bits, bits.ue())
  if (bits.read(1)) for (let count = bits.ue(), index = 0; index < count; index++) bits.skip(pocLsbBits + 1)
  bits.skip(2)
  return bits.position
}

function signalBits(colour: HevcColour, videoFormat: number): number[] {
  const out: number[] = []
  const put = (value: number, count: number): void => { for (let shift = count - 1; shift >= 0; shift--) out.push((value >> shift) & 1) }
  put(1, 1); put(videoFormat, 3); put(colour.fullRange ? 1 : 0, 1); put(1, 1)
  put(colour.primaries, 8); put(colour.transfer, 8); put(colour.matrix, 8)
  return out
}

/** 写入色彩描述后的 SPS NAL（含 NAL 头与防竞争字节）；已经是这份色彩时返回 undefined。 */
export function hevcSpsWithColour(nal: Uint8Array, colorSpace: VideoColorSpaceInit | undefined): Uint8Array | undefined {
  const colour = hevcColour(colorSpace)
  if (!colour || ((nal[0] >> 1) & 0x3f) !== SPS_NAL_TYPE) return undefined
  const bits = Bits.of(unescapeRbsp(nal))
  const stop = bits.bits.lastIndexOf(1)
  if (stop < 0) throw new Error('HEVC SPS 缺少结尾位。')
  const vuiFlag = vuiFlagPosition(bits)
  let head: number[], tail: number[]
  if (bits.read(1)) {
    if (bits.read(1) && bits.read(8) === 255) bits.skip(32)
    if (bits.read(1)) bits.skip(1)
    const signalAt = bits.position
    let videoFormat = 5
    if (bits.read(1)) {
      videoFormat = bits.read(3)
      const fullRange = bits.read(1) === 1
      if (bits.read(1)) {
        const [primaries, transfer, matrix] = [bits.read(8), bits.read(8), bits.read(8)]
        if (primaries === colour.primaries && transfer === colour.transfer && matrix === colour.matrix && fullRange === colour.fullRange) return undefined
      }
    }
    head = [...bits.bits.slice(0, signalAt), ...signalBits(colour, videoFormat)]
    tail = bits.bits.slice(bits.position, stop)
  } else {
    // 没有 VUI：只写 video_signal_type，其余开关都是 0（宽高比、过扫描、色度位置、场、默认显示窗、时序、码流约束）。
    head = [...bits.bits.slice(0, vuiFlag), 1, 0, 0, ...signalBits(colour, 5), 0, 0, 0, 0, 0, 0, 0]
    tail = bits.bits.slice(vuiFlag + 1, stop)
  }
  const out = [...head, ...tail, 1]
  while (out.length % 8) out.push(0)
  const bytes = new Uint8Array(out.length / 8)
  for (let index = 0; index < out.length; index++) bytes[index >> 3] |= out[index] << (7 - (index & 7))
  return escapeRbsp(bytes)
}

/** hvcC 配置记录里的 SPS 换成写好色彩描述的；没有要改的返回 undefined。 */
export function hevcConfigurationWithColour(record: Uint8Array, colorSpace: VideoColorSpaceInit | undefined): Uint8Array | undefined {
  if (record.length < 23 || record[0] !== 1) throw new Error('导出 HEVC 配置记录不完整。')
  const out: number[] = [...record.subarray(0, 23)]
  let changed = false
  let offset = 23
  for (let array = 0; array < record[22]; array++) {
    if (offset + 3 > record.length) throw new Error('导出 HEVC 配置记录不完整。')
    const type = record[offset] & 0x3f, count = record[offset + 1] * 256 + record[offset + 2]
    out.push(...record.subarray(offset, offset + 3)); offset += 3
    for (let index = 0; index < count; index++) {
      if (offset + 2 > record.length) throw new Error('导出 HEVC 配置记录不完整。')
      const size = record[offset] * 256 + record[offset + 1]
      if (offset + 2 + size > record.length) throw new Error('导出 HEVC 参数集超出配置记录。')
      const nal = record.subarray(offset + 2, offset + 2 + size)
      const written = type === SPS_NAL_TYPE ? hevcSpsWithColour(nal, colorSpace) : undefined
      if (written) changed = true
      const value = written ?? nal
      out.push(value.length >> 8, value.length & 0xff, ...value)
      offset += 2 + size
    }
  }
  out.push(...record.subarray(offset))
  return changed ? Uint8Array.from(out) : undefined
}

/**
 * 封装前的回调（同 `videoEditExportAvcLevel`）：带解码配置的编码结果把配置记录里的 SPS 写上编码器报告的色彩。
 * 这台机器的编码器只在配置记录里给参数集、不在码流里重复（整片核对过）；码流里若出现 SPS，色彩以配置记录为准的
 * 播放器不受影响，按码流的仍读到它自己的 SPS。
 */
export function videoEditExportHevcColour(): (packet: unknown, meta?: EncodedVideoChunkMetadata) => void {
  return (_packet, meta) => {
    const config = meta?.decoderConfig
    if (!config?.description) return
    const source = config.description
    const record = ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) : new Uint8Array(source)
    // 色彩标记只是元数据：参数集读不懂时保持编码器给的配置，成片照常写出。
    try {
      const written = hevcConfigurationWithColour(record, config.colorSpace)
      if (written) config.description = written
    } catch (error) {
      logger.warn('导出 HEVC 色彩标记未写入', { event: 'video_edit.export.hevc_colour_skipped', context: { reason: error instanceof Error ? error.message : String(error) } })
    }
  }
}
