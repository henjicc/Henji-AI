import { describe, expect, it } from 'vitest'
import { hevcConfigurationWithColour, hevcSpsWithColour, videoEditExportHevcColour } from './videoEditExportHevcColour'

const hex = (value: string): Uint8Array => Uint8Array.from(value.match(/../g)!.map(byte => Number.parseInt(byte, 16)))
const text = (value: Uint8Array | undefined): string | undefined => value && [...value].map(byte => byte.toString(16).padStart(2, '0')).join('')
const BT709: VideoColorSpaceInit = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false }

// 4K59.94 HEVC 导出（Windows 硬件编码）的 hvcC：SPS 有 VUI（带时序信息）但没有 video_signal_type，FFmpeg 解码读出 unknown。
const ENCODER_RECORD = hex('01016000000090000000000099f000fcfdf8f800000f03'
  + 'a00001' + '0017' + '40010c01ffff216000000300900000030000030099ac09'
  + 'a10001' + '002b' + '420101216000000300900000030000030099a001e02002207c4e5ad2908464b08040000003004000000782'
  + 'a20001' + '0007' + '4401c0f7c0cc90')
// 以下两份写入结果用 FFmpeg 9.0（trace_headers 与解码首帧）核对过：色彩为 tv / bt709，VUI 其余各项与原 SPS 相同。
const WRITTEN_SPS = '420101216000000300900000030000030099a001e02002207c4e5ad2908464b09a808080820000030002000003003c10'
// 没有 VUI 的 SPS（由上面的 SPS 去掉 VUI 得到）写入后只多一段最小 VUI。
const NO_VUI_SPS = '420101216000000300900000030000030099a001e02002207c4e5ad2908464b020'
const NO_VUI_WRITTEN = '420101216000000300900000030000030099a001e02002207c4e5ad2908464b09a8080808040'

describe('HEVC 导出的 VUI 色彩', () => {
  it('把编码器报告的色彩写进配置记录里的 SPS，VPS、PPS 与其余字段不动，已写过的不再改', () => {
    const written = hevcConfigurationWithColour(ENCODER_RECORD, BT709)!
    expect(text(written)).toBe(text(ENCODER_RECORD)!.replace('002b420101216000000300900000030000030099a001e02002207c4e5ad2908464b08040000003004000000782', `0030${WRITTEN_SPS}`))
    expect(hevcConfigurationWithColour(written, BT709)).toBeUndefined()
    // 色彩不同时按新的再写一次。
    expect(hevcSpsWithColour(hex(WRITTEN_SPS), { primaries: 'bt470bg', transfer: 'smpte170m', matrix: 'bt470bg', fullRange: true })).toBeDefined()
  })

  it('没有 VUI 的 SPS 补一段只含色彩的 VUI', () => {
    expect(text(hevcSpsWithColour(hex(NO_VUI_SPS), BT709))).toBe(NO_VUI_WRITTEN)
    expect(hevcSpsWithColour(hex(NO_VUI_WRITTEN), BT709)).toBeUndefined()
  })

  it('编码器没报告完整色彩时不改；封装回调只换解码配置里的记录', () => {
    expect(hevcConfigurationWithColour(ENCODER_RECORD, { primaries: 'bt709' })).toBeUndefined()
    const meta: EncodedVideoChunkMetadata = { decoderConfig: { codec: 'hvc1.1.6.L153.B0', description: ENCODER_RECORD, colorSpace: BT709 } }
    videoEditExportHevcColour()(undefined, meta)
    expect(text(meta.decoderConfig!.description as Uint8Array)).toContain(WRITTEN_SPS)
  })
})
