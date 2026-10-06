import { expect, it } from 'vitest'
import { createVideoEditDocument, type VideoEditClip } from './document'
import { makeVideoEditItemClip } from './projectItems'
import { offsetVideoEditSource } from './time'
import { videoEditMatchFrameTarget, videoEditReverseMatchFrame } from './matchFrame'
import { addLegacyVideoEditTracks } from './testFixtures'

/** 30 fps 序列：V1 上片段 a[30,90) 用素材 2 秒起，V2 上片段 b[60,120) 用素材 10 秒起；A1 上 a 的声音。 */
function fixture() {
  const document = createVideoEditDocument('匹配帧'); addLegacyVideoEditTracks(document.sequences[0])
  document.media = [{ id: 'media', name: '原视频', path: 'D:/clip.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 20, hasAudio: true, frameRate: { numerator: 30, denominator: 1 } }]
  document.items = [{ id: 'item', name: '原视频', kind: 'video', mediaId: 'media' }, { id: 'title', name: '文字', kind: 'text' }]
  const sequence = document.sequences[0]
  const base = makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0, track: 1 })
  const at = (id: string, start: number, sourceFrames: number, track: number, extra: Partial<VideoEditClip> = {}): VideoEditClip => ({ ...base, id, start, duration: 60, track, ...offsetVideoEditSource({ sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } }, sourceFrames, sequence.frameRate), ...extra })
  sequence.clips = [at('a', 30, 60, 1), at('b', 60, 300, 2), at('a-sound', 30, 60, 0, { kind: 'audio', sourceComponent: 'audio' }), { ...at('t', 0, 0, 3), itemId: 'title', kind: 'text' }]
  return { document, sequence }
}

it('匹配帧取播放头处最上层的素材片段，定位到对应源帧并带出片段入出点', () => {
  const { document, sequence } = fixture()
  const target = videoEditMatchFrameTarget(document, sequence, { clipIds: [], frame: 70, targetTracks: [] })
  // b 在 V2 更靠上；播放头在 b 内第 10 帧 → 源 10 秒 + 10 帧，落在该帧中间
  expect(target).toEqual({ clipId: 'b', itemId: 'item', timeUs: Math.round((10 + 10 / 30 + 0.5 / 30) * 1e6), inUs: 10_000_000, outUs: 12_000_000 })
})
it('选中的片段压着播放头时优先用它；没有素材片段时给出原因', () => {
  const { document, sequence } = fixture()
  expect(videoEditMatchFrameTarget(document, sequence, { clipIds: ['a-sound'], frame: 70, targetTracks: [] })).toMatchObject({ clipId: 'a-sound', timeUs: Math.round((2 + 40 / 30) * 1e6) })
  expect(videoEditMatchFrameTarget(document, sequence, { clipIds: [], frame: 10, targetTracks: [] })).toEqual({ reason: '播放头处没有来自素材文件的片段。' })
})
it('反向匹配帧把源帧换回序列帧，目标轨道上的片段优先', () => {
  const { sequence } = fixture()
  // 源 2.5 秒只被 a（V1）与 a-sound（A1）用到：a 起点 30 + 15 帧
  expect(videoEditReverseMatchFrame(sequence, { itemId: 'item', timeUs: 2_500_000, frame: 0, targetTracks: [0] })).toEqual({ clipId: 'a-sound', frame: 45 })
  expect(videoEditReverseMatchFrame(sequence, { itemId: 'item', timeUs: 11_000_000, frame: 0, targetTracks: [] })).toEqual({ clipId: 'b', frame: 90 })
  expect(videoEditReverseMatchFrame(sequence, { itemId: 'item', timeUs: 19_000_000, frame: 0, targetTracks: [] })).toEqual({ reason: '当前序列没有用到源监视器里的这一帧。' })
})
