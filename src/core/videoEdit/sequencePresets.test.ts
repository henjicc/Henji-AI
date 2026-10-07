import { expect, it } from 'vitest'
import { VIDEO_EDIT_SEQUENCE_RATIOS, VIDEO_EDIT_SEQUENCE_TIERS, inferVideoEditSequencePreset, videoEditSequencePresetSize } from './sequencePresets'
import { clampVideoEditSequenceSize, isVideoEditSequenceSize } from './sequenceSize'
import { createVideoEditDocument, createVideoEditSequence, videoEditDocumentSchema, videoEditSequenceSchema } from './document'
import { VIDEO_EDIT_SEQUENCE_DEFAULTS, videoEditSequenceDefaultsSchema } from './sequenceDefaults'
import { videoEditReframeSizeSchema } from './reframe'
import { videoEditSequenceFromItem, VideoEditSequenceFrameRateRequired } from './projectItems'

it('短边档位对应横竖屏、正方形与超宽常见规格，全部取偶数', () => {
  const wides = [1280, 1920, 2560, 3840, 7680]; const ultra = [1680, 2560, 3440, 5120, 10080]
  VIDEO_EDIT_SEQUENCE_TIERS.forEach(({ label, shortEdge }, i) => {
    expect(videoEditSequencePresetSize('16:9', label)).toEqual({ width: wides[i], height: shortEdge })
    expect(videoEditSequencePresetSize('9:16', label)).toEqual({ width: shortEdge, height: wides[i] })
    expect(videoEditSequencePresetSize('1:1', label)).toEqual({ width: shortEdge, height: shortEdge })
    expect(videoEditSequencePresetSize('21:9', label)).toEqual({ width: ultra[i], height: shortEdge })
  })
  expect(videoEditSequencePresetSize('4:3', '4K')).toEqual({ width: 2880, height: 2160 })
  expect(videoEditSequencePresetSize('3:4', '8K')).toEqual({ width: 4320, height: 5760 })
})
it('反推全部合法比例与档位；非标准、自定义与超限规格不误匹配', () => {
  for (const ratio of VIDEO_EDIT_SEQUENCE_RATIOS) for (const { label: tier } of VIDEO_EDIT_SEQUENCE_TIERS) {
    const size = videoEditSequencePresetSize(ratio, tier)
    expect(inferVideoEditSequencePreset(size)).toEqual(isVideoEditSequenceSize(size) ? { ratio, tier } : null)
  }
  expect(inferVideoEditSequencePreset({ width: 2048, height: 1080 })).toBeNull()
  expect(isVideoEditSequenceSize(videoEditSequencePresetSize('21:9', '8K'))).toBe(false)
  expect(isVideoEditSequenceSize(videoEditSequencePresetSize('1:1', '8K'))).toBe(true)
})
it.each([{ width: 7680, height: 4320 }, { width: 4320, height: 7680 }, { width: 4320, height: 4320 }, { width: 17, height: 23 }])('文档、默认规格与重构图共享尺寸边界 %j', size => {
  const sequence = { ...createVideoEditSequence(), ...size, frameRate: { numerator: 120, denominator: 1 } }
  expect(videoEditSequenceSchema.safeParse(sequence).success).toBe(true)
  const document = createVideoEditDocument('8K'); document.sequences.push(sequence)
  expect(videoEditDocumentSchema.safeParse(document).success).toBe(true)
  expect(videoEditSequenceDefaultsSchema.safeParse({ ...VIDEO_EDIT_SEQUENCE_DEFAULTS, ...size, frameRate: sequence.frameRate }).success).toBe(true)
  expect(videoEditReframeSizeSchema.safeParse(size).success).toBe(true)
})
it.each([{ width: 7680, height: 4321 }, { width: 6000, height: 6000 }, { width: 7681, height: 16 }, { width: 15, height: 720 }])('三种入口拒绝超限 %j', size => {
  expect(videoEditSequenceSchema.safeParse({ ...createVideoEditSequence(), ...size }).success).toBe(false)
  expect(videoEditSequenceDefaultsSchema.safeParse({ ...VIDEO_EDIT_SEQUENCE_DEFAULTS, ...size }).success).toBe(false)
  expect(videoEditReframeSizeSchema.safeParse(size).success).toBe(false)
})
it('按素材建立120帧8K序列；超过边长或像素上限等比缩小，不可靠帧率要求确认', () => {
  const document = createVideoEditDocument('素材')
  document.items.push({ id: 'item', name: '原片', kind: 'video', mediaId: 'media' })
  document.media.push({ id: 'media', name: '原片', path: '/fixture/8k.mp4', kind: 'video', width: 7680, height: 4320, durationSeconds: 1, frameRate: { numerator: 120, denominator: 1 }, frameRateMode: 'sampled-constant' })
  expect(videoEditSequenceFromItem(document, 'item')).toMatchObject({ width: 7680, height: 4320, frameRate: { numerator: 120, denominator: 1 } })
  document.media[0].width = 15360; document.media[0].height = 8640
  expect(videoEditSequenceFromItem(document, 'item')).toMatchObject({ width: 7680, height: 4320 })
  expect(clampVideoEditSequenceSize({ width: 7680, height: 7680 })).toEqual({ width: 5760, height: 5760 })
  document.media[0].frameRateMode = 'unknown'
  expect(() => videoEditSequenceFromItem(document, 'item')).toThrow(VideoEditSequenceFrameRateRequired)
})
