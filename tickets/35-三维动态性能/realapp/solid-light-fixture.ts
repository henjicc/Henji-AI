import { createVideoEditDocument, createVideoEditSequence, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { addLegacyVideoEditTracks } from '@/core/videoEdit/testFixtures'
import { textStyleSchema } from '@/core/imaging/vectorContent/text'
// ticket 36 第 6 段验收：暗底 + 时间线标题（实体）+ 一盏时间线灯光片段（左前上方聚光、投影）+ 只有地面的场景（由脚本放入）。
const W = 1920, H = 1080, FPS = 30, LENGTH = 300
export function buildDocument(paths: string[]): import('@/core/videoEdit/document').VideoEditDocument {
  const document = createVideoEditDocument('立体标题'), sequence = createVideoEditSequence()
  sequence.id = 'main'; sequence.width = W; sequence.height = H; sequence.frameRate = { numerator: FPS, denominator: 1 }
  addLegacyVideoEditTracks(sequence)
  sequence.clips = [{ sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, rotation: 0, opacity: 1, volume: 0, text: '', start: 0, duration: LENGTH,
    id: 'background', itemId: 'item-background', kind: 'image', name: '背景', track: 1, x: 0, y: 0, scale: 1 } as VideoEditClip,
    { sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, rotation: 0, opacity: 1, volume: 0, start: 0, duration: LENGTH, id: 'title', itemId: 'item-text', kind: 'text', name: '标题', track: 3, x: 0, y: -.05, scale: 1,
      text: '立体标题', textStyle: textStyleSchema.parse({ fontFamily: 'HarmonyOS Sans SC', fontWeight: 700, fontSize: 200, fill: { enabled: true, color: '#E8B04A' } }), spatial: { enabled: true },
      rotationY: 26, rotationX: -14 } as VideoEditClip,
    { sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, rotation: 0, opacity: 1, volume: 0, text: '', start: 0, duration: LENGTH, id: 'key-light', itemId: 'item-light', kind: 'light', name: '主光', track: 4,
      x: -.35, y: -.45, scale: 1, depth: 1.2, rotationX: -35, rotationY: -20, spatial: { enabled: true }, lightKind: 'spot', lightIntensity: 1.5, lightCastShadow: true, lightAngle: 60, lightSoftness: .4 } as VideoEditClip]
  sequence.spatialCamera = { curves: { perspective: [{ time: 0, value: -1, interpolation: 'hold' }] } }
  document.media = [{ id: 'm-background', name: '背景', path: paths[0], kind: 'image', width: W, height: H, durationSeconds: 0, hasAudio: false }]
  document.items = [{ id: 'item-background', kind: 'image', name: '背景', mediaId: 'm-background' }, { id: 'item-text', kind: 'text', name: '文字' }, { id: 'item-light', kind: 'light', name: '灯光' }] as VideoEditComposition['items']
  document.sequences = [sequence]
  document.id = 't36-solid-light'
  return document
}
