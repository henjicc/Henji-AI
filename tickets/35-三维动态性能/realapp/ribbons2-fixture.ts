import { createVideoEditDocument, createVideoEditSequence, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { addLegacyVideoEditTracks } from '@/core/videoEdit/testFixtures'
import { textStyleSchema } from '@/core/imaging/vectorContent/text'
// 样片「光从字里长出来」：暗底 + 时间线标题（发光强度从 0 烧到 1.5）+ 引用标题的光带场景（由脚本经助手接口放入并绑定）。
const W = 1920, H = 1080, FPS = 30, LENGTH = 300
export function buildDocument(paths: string[]): import('@/core/videoEdit/document').VideoEditDocument {
  const document = createVideoEditDocument('光从字里长出来'), sequence = createVideoEditSequence()
  sequence.id = 'main'; sequence.width = W; sequence.height = H; sequence.frameRate = { numerator: FPS, denominator: 1 }
  addLegacyVideoEditTracks(sequence)
  sequence.clips = [{ sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, rotation: 0, opacity: 1, volume: 0, text: '', start: 0, duration: LENGTH,
    id: 'background', itemId: 'item-background', kind: 'image', name: '背景', track: 1, x: 0, y: 0, scale: 1 } as VideoEditClip,
    { sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, rotation: 0, opacity: 1, volume: 0, start: 0, duration: LENGTH, id: 'title', itemId: 'item-text', kind: 'text', name: '标题', track: 3, x: 0, y: -.2, scale: 1,
      text: '痕迹创作', textStyle: textStyleSchema.parse({ fontFamily: 'HarmonyOS Sans SC', fontWeight: 700, fontSize: 130, fill: { enabled: true, color: '#FFF6E8' } }), spatial: { enabled: true },
      // 字从暗处烧亮：发光强度 0 → 1.5，透明度先淡入。
      curves: { spaceEmission: [{ time: 0, value: 0, interpolation: 'ease' }, { time: 30, value: 1.5, interpolation: 'hold' }], opacity: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 15, value: 1, interpolation: 'hold' }] } } as VideoEditClip]
  sequence.spatialCamera = { curves: { perspective: [{ time: 0, value: -1, interpolation: 'hold' }] } }
  document.media = [{ id: 'm-background', name: '背景', path: paths[0], kind: 'image', width: W, height: H, durationSeconds: 0, hasAudio: false }]
  document.items = [{ id: 'item-background', kind: 'image', name: '背景', mediaId: 'm-background' }, { id: 'item-text', kind: 'text', name: '文字' }] as VideoEditComposition['items']
  document.sequences = [sequence]
  document.id = 't36-ribbons'
  return document
}
