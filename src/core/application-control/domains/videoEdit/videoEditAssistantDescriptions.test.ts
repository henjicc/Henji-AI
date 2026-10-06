import { expect, it } from 'vitest'
import { createVideoEditDocument } from '../../../videoEdit/document'
import { makeVideoEditItemClip } from '../../../videoEdit/projectItems'
import { planVideoEditInPlaceGeneration } from '../../../videoEdit/inPlaceGeneration'
import { applyVideoEditTrim } from '../../../videoEdit/timelineTrims'
import { trimVideoEditClipCapability } from './videoEditApplicationCapabilities'
import { generateVideoEditInPlaceCapability } from './videoEditInPlaceGenerationCapabilities'

function fixture() {
  const document = createVideoEditDocument('说明与领域行为核对')
  const sequence = document.sequences[0]
  document.media = [{ id: 'media', name: '视频', path: 'D:/fixture.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 20 }]
  document.items = [{ id: 'item', name: '视频', kind: 'video', mediaId: 'media' }]
  const track = sequence.tracks.find(value => value.kind === 'video')!
  sequence.clips = [makeVideoEditItemClip(document, 'item', sequence.id, { frame: 150, track: track.index, duration: 60 })]
  return { document, sequence, track }
}

it('原地生成公开说明区分指定轨道填空隙与自动选轨默认规划，和正式规划器一致', () => {
  const { document, sequence, track } = fixture()
  expect(planVideoEditInPlaceGeneration(document, sequence.id, { action: 'generate_shot', frame: 60, trackIndex: track.index })).toMatchObject({ duration: 90, fill: true })
  for (const action of ['generate_shot', 'generate_audio'] as const) {
    expect(planVideoEditInPlaceGeneration(document, sequence.id, { action, frame: 60 })).toMatchObject({ duration: 150, fill: false })
  }
  expect(planVideoEditInPlaceGeneration(document, sequence.id, { action: 'extend_shot', clipId: sequence.clips[0].id })).toMatchObject({ duration: 150, fill: false })
  const projected = JSON.stringify(generateVideoEditInPlaceCapability.aiInputSchema)
  expect(projected).toContain('自动选轨或后面没有片段，用 5 秒规划')
  expect(projected).toContain('替换 clipRef 时沿用原片段长度，此字段不生效')
})

it('外滑正数遵循播放顺序，倒放时取素材更早部分；能力说明明确两种方向', () => {
  const { document, sequence } = fixture()
  const clip = sequence.clips[0]
  clip.sourceInUs = 5_000_000
  const forward = applyVideoEditTrim(document, sequence.id, { mode: 'slip', delta: 15, clipIds: [clip.id] })
  expect(forward.sequence.clips[0].sourceInUs).toBe(5_500_000)
  clip.reverse = true
  const reverse = applyVideoEditTrim(document, sequence.id, { mode: 'slip', delta: 15, clipIds: [clip.id] })
  expect(reverse.sequence.clips[0].sourceInUs).toBe(4_500_000)
  expect(trimVideoEditClipCapability.description).toContain('正放是素材里更晚，倒放是素材里更早')
})
