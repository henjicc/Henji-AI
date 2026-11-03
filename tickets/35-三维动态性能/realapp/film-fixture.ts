import { createVideoEditDocument, createVideoEditSequence, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { addLegacyVideoEditTracks } from '@/core/videoEdit/testFixtures'
import { textStyleSchema } from '@/core/imaging/vectorContent/text'
// 小短片「星核」：背景 + 三维场景（由脚本经助手接口放入）+ 结尾标题卡（在三维空间里、景深拉到标题）。
const W = 1920, H = 1080, FPS = 30, LENGTH = 300
type Key = { time: number; value: number; interpolation: 'linear' | 'ease' | 'hold' }
const k = (time: number, value: number, interpolation: Key['interpolation'] = 'ease'): Key => ({ time, value, interpolation })
export function buildDocument(paths: string[]): import('@/core/videoEdit/document').VideoEditDocument {
  const document = createVideoEditDocument('星核'), sequence = createVideoEditSequence()
  sequence.id = 'main'; sequence.width = W; sequence.height = H; sequence.frameRate = { numerator: FPS, denominator: 1 }; sequence.motionBlur = true
  addLegacyVideoEditTracks(sequence)
  const template = sequence.tracks.find(track => track.index === 7)!
  sequence.tracks.push({ ...template, id: 'track-8', name: '视频 8', index: 8 })
  const base = { sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, rotation: 0, opacity: 1, volume: 0, text: '', start: 0, duration: LENGTH }
  const font = (size: number, weight = 700) => textStyleSchema.parse({ fontFamily: 'HarmonyOS Sans SC', fontWeight: weight, fontSize: size, fill: { enabled: true, color: '#F4F1EC' } })
  const text = (id: string, track: number, y: number, depth: number, content: string, size: number, weight: number, from: number): VideoEditClip => ({
    ...base, id, itemId: 'item-text', kind: 'text', name: id, track, x: 0, y, scale: 1, start: from, duration: LENGTH - from, text: content, textStyle: font(size, weight),
    spatial: { enabled: true }, curves: { depth: [k(0, depth + .25), k(40, depth, 'hold')], opacity: [k(0, 0, 'linear'), k(24, 1, 'hold')] } } as VideoEditClip)
  sequence.clips = [
    { ...base, id: 'background', itemId: 'item-background', kind: 'image', name: '背景', track: 1, x: 0, y: 0, scale: 1 } as VideoEditClip,
    text('title', 6, -.3, .35, '痕迹AI', 150, 700, 204),
    text('subtitle', 7, -.4, .3, '实时三维　发光　反射　景深', 40, 400, 216),
  ]
  sequence.spatialCamera = {
    bindings: { focus: [{ time: 0, value: { kind: 'distance', distance: 1.65 }, interpolation: 'hold' }] },
    curves: {
      perspective: [k(0, -1, 'hold')],
      offsetX: [k(0, -.08), k(LENGTH - 1, .1)],
      offsetY: [k(0, .02), k(LENGTH - 1, .06)],
      // 标题出现时景深拉开，背后的星核虚化。
      defocus: [k(0, 0, 'hold'), k(200, 0), k(245, 7, 'hold')],
      focusDistance: [k(0, 1.65, 'hold')],
    },
  }
  document.media = [{ id: 'm-background', name: '背景', path: paths[0], kind: 'image', width: W, height: H, durationSeconds: 0, hasAudio: false }]
  document.items = [{ id: 'item-text', kind: 'text', name: '文字' }, { id: 'item-background', kind: 'image', name: '背景', mediaId: 'm-background' }] as VideoEditComposition['items']
  document.sequences = [sequence]
  document.id = 't35-film'
  return document
}
