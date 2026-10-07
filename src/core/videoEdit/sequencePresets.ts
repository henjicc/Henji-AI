import { isVideoEditSequenceSize, type VideoEditSequenceSize } from './sequenceSize'

export const VIDEO_EDIT_SEQUENCE_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const
export type VideoEditSequenceRatio = typeof VIDEO_EDIT_SEQUENCE_RATIOS[number]
export const VIDEO_EDIT_SEQUENCE_TIERS = [
  { label: '720p', shortEdge: 720 }, { label: '1080p', shortEdge: 1080 },
  { label: '2K', shortEdge: 1440 }, { label: '4K', shortEdge: 2160 }, { label: '8K', shortEdge: 4320 },
] as const
export type VideoEditSequenceTier = typeof VIDEO_EDIT_SEQUENCE_TIERS[number]['label']
const ultrawide: Record<VideoEditSequenceTier, number> = { '720p': 1680, '1080p': 2560, '2K': 3440, '4K': 5120, '8K': 10080 }
export function videoEditSequencePresetSize(ratio: VideoEditSequenceRatio, tier: VideoEditSequenceTier): VideoEditSequenceSize {
  const short = VIDEO_EDIT_SEQUENCE_TIERS.find(value => value.label === tier)!.shortEdge
  const [width, height] = ratio.split(':').map(Number)
  const long = ratio === '21:9' ? ultrawide[tier] : Math.round(short * Math.max(width, height) / Math.min(width, height) / 2) * 2
  return width >= height ? { width: long, height: short } : { width: short, height: long }
}
export function inferVideoEditSequencePreset(size: VideoEditSequenceSize): { ratio: VideoEditSequenceRatio; tier: VideoEditSequenceTier } | null {
  for (const ratio of VIDEO_EDIT_SEQUENCE_RATIOS) for (const { label: tier } of VIDEO_EDIT_SEQUENCE_TIERS) {
    const candidate = videoEditSequencePresetSize(ratio, tier)
    if (isVideoEditSequenceSize(candidate) && size.width === candidate.width && size.height === candidate.height) return { ratio, tier }
  }
  return null
}
