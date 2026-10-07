import { expect, it } from 'vitest'
import { VIDEO_EDIT_SEQUENCE_RATIOS, VIDEO_EDIT_SEQUENCE_TIERS, inferVideoEditSequencePreset, roundVideoEditSequenceDimension, videoEditSequencePresetSize, videoEditSequenceRatioLabel, videoEditSequenceSizeForPixels, videoEditSequenceTierSize } from './sequencePresets'
import { clampVideoEditSequenceSize, isVideoEditSequenceSize } from './sequenceSize'
import { createVideoEditDocument, createVideoEditSequence, videoEditDocumentSchema, videoEditSequenceSchema } from './document'
import { VIDEO_EDIT_SEQUENCE_DEFAULTS, videoEditSequenceDefaultsSchema } from './sequenceDefaults'
import { videoEditReframeSizeSchema } from './reframe'
import { videoEditSequenceFromItem, VideoEditSequenceFrameRateRequired } from './projectItems'

const sizes = [
  [[854, 480], [480, 854], [480, 480], [640, 480], [480, 640], [1120, 480]],
  [[1280, 720], [720, 1280], [720, 720], [960, 720], [720, 960], [1680, 720]],
  [[1920, 1080], [1080, 1920], [1080, 1080], [1440, 1080], [1080, 1440], [2560, 1080]],
  [[2560, 1440], [1440, 2560], [1440, 1440], [1920, 1440], [1440, 1920], [3440, 1440]],
  [[3840, 2160], [2160, 3840], [2160, 2160], [2880, 2160], [2160, 2880], [5120, 2160]],
  [[7680, 4320], [4320, 7680], [4320, 4320], [5760, 4320], [4320, 5760], [10240, 4320]],
]
it('预设比例与档位取行业常用尺寸（按短边定档，21:9 用超宽屏规格）；自定义比例按总像素换算', () => {
  VIDEO_EDIT_SEQUENCE_TIERS.forEach(({ label }, i) => VIDEO_EDIT_SEQUENCE_RATIOS.forEach((ratio, j) => {
    const [width, height] = sizes[i][j]
    expect(videoEditSequencePresetSize(ratio, label), `${ratio} ${label}`).toEqual({ width, height })
  }))
  expect(videoEditSequenceTierSize(12 / 5, '1080p')).toEqual({ width: 2230, height: 930 })
})
it('反推精确组合优先；仅比例误差小于0.5%时保留比例，档位为自定义', () => {
  for (const ratio of VIDEO_EDIT_SEQUENCE_RATIOS) for (const { label: tier } of VIDEO_EDIT_SEQUENCE_TIERS) {
    expect(inferVideoEditSequencePreset(videoEditSequencePresetSize(ratio, tier))).toEqual({ ratio, tier })
  }
  expect(inferVideoEditSequencePreset({ width: 2048, height: 1080 })).toEqual({ ratio: '自定义', tier: '自定义' })
  expect(inferVideoEditSequencePreset({ width: 2000, height: 1124 })).toEqual({ ratio: '16:9', tier: '自定义' })
  expect(inferVideoEditSequencePreset({ width: 1787, height: 1000 })).toEqual({ ratio: '自定义', tier: '自定义' })
  expect(inferVideoEditSequencePreset({ width: 0, height: 0 })).toEqual({ ratio: '自定义', tier: '自定义' })
})
it('档位禁用按最终尺寸校验单边与总像素；只有超宽 8K 因单边超限禁用', () => {
  for (const ratio of VIDEO_EDIT_SEQUENCE_RATIOS) for (const { label } of VIDEO_EDIT_SEQUENCE_TIERS) {
    expect(isVideoEditSequenceSize(videoEditSequencePresetSize(ratio, label))).toBe(label !== '8K' || ratio !== '21:9')
  }
  expect(isVideoEditSequenceSize(videoEditSequenceTierSize(10, '4K'))).toBe(false)
})
it('偶数取整最小16；自定义像素和比例换算与比例文字可独立复用', () => {
  expect([0, 15, 16, 17, 18.9, 19].map(roundVideoEditSequenceDimension)).toEqual([16, 16, 16, 18, 18, 20])
  expect(videoEditSequenceSizeForPixels(1440 * 1440, 9 / 16)).toEqual({ width: 1080, height: 1920 })
  expect(videoEditSequenceSizeForPixels(1, 100)).toEqual({ width: 16, height: 16 })
  expect(() => videoEditSequenceSizeForPixels(100, 0)).toThrow('正数')
  expect(() => videoEditSequenceSizeForPixels(Infinity, 1)).toThrow('正数')
  expect(videoEditSequenceRatioLabel({ width: 2400, height: 1000 })).toBe('12:5')
  expect(videoEditSequenceRatioLabel({ width: 2350, height: 1000 })).toBe('47:20')
  expect(videoEditSequenceRatioLabel({ width: 2352, height: 1000 })).toBe('2.35:1')
  expect(videoEditSequenceRatioLabel({ width: 0, height: 1000 })).toBe('')
})
it.each([{ width: 7680, height: 4320 }, { width: 4320, height: 7680 }, { width: 8192, height: 4000 }, { width: 4000, height: 8192 }, { width: 5760, height: 5760 }, { width: 17, height: 23 }])('文档、默认规格与重构图共享8192与8K总像素边界 %j', size => {
  const sequence = { ...createVideoEditSequence(), ...size, frameRate: { numerator: 120, denominator: 1 } }
  expect(videoEditSequenceSchema.safeParse(sequence).success).toBe(true)
  const document = createVideoEditDocument('8K'); document.sequences.push(sequence)
  expect(videoEditDocumentSchema.safeParse(document).success).toBe(true)
  expect(videoEditSequenceDefaultsSchema.safeParse({ ...VIDEO_EDIT_SEQUENCE_DEFAULTS, ...size, frameRate: sequence.frameRate }).success).toBe(true)
  expect(videoEditReframeSizeSchema.safeParse(size).success).toBe(true)
})
it.each([{ width: 7680, height: 4321 }, { width: 6000, height: 6000 }, { width: 8193, height: 16 }, { width: 16, height: 8193 }, { width: 15, height: 720 }])('三种入口拒绝超限 %j', size => {
  expect(videoEditSequenceSchema.safeParse({ ...createVideoEditSequence(), ...size }).success).toBe(false)
  expect(videoEditSequenceDefaultsSchema.safeParse({ ...VIDEO_EDIT_SEQUENCE_DEFAULTS, ...size }).success).toBe(false)
  expect(videoEditReframeSizeSchema.safeParse(size).success).toBe(false)
})
it('按素材建立120帧8K序列；超过边长或像素上限等比缩小，不可靠帧率要求打开面板', () => {
  const document = createVideoEditDocument('素材')
  document.items.push({ id: 'item', name: '原片', kind: 'video', mediaId: 'media' })
  document.media.push({ id: 'media', name: '原片', path: '/fixture/8k.mp4', kind: 'video', width: 7680, height: 4320, durationSeconds: 1, frameRate: { numerator: 120, denominator: 1 }, frameRateMode: 'sampled-constant' })
  expect(videoEditSequenceFromItem(document, 'item')).toMatchObject({ width: 7680, height: 4320, frameRate: { numerator: 120, denominator: 1 } })
  document.media[0].width = 15360; document.media[0].height = 8640
  expect(videoEditSequenceFromItem(document, 'item')).toMatchObject({ width: 7680, height: 4320 })
  expect(clampVideoEditSequenceSize({ width: 7680, height: 7680 })).toEqual({ width: 5760, height: 5760 })
  expect(clampVideoEditSequenceSize({ width: 16384, height: 2000 })).toEqual({ width: 8192, height: 1000 })
  document.media[0].frameRateMode = 'unknown'
  expect(() => videoEditSequenceFromItem(document, 'item')).toThrow(VideoEditSequenceFrameRateRequired)
})
