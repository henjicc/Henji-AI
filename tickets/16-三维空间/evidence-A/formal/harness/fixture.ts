import { createVideoEditDocument, createVideoEditSequence, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { addLegacyVideoEditTracks } from '@/core/videoEdit/testFixtures'
import { textStyleSchema } from '@/core/imaging/vectorContent/text'
const W=1920,H=1080,FPS=30
type Key={time:number;value:number;interpolation:'linear'|'ease'|'hold'}
const k=(time:number,value:number,interpolation:Key['interpolation']='ease'):Key=>({time,value,interpolation})
const unfold=(value:number):Key[]=>[k(0,0,'hold'),k(45,0),k(135,value,'hold'),k(195,value),k(225,0,'hold')]
export function buildDocument(paths: string[]): import('@/core/videoEdit/document').VideoEditDocument {
  const document = createVideoEditDocument('三维空间样片'), sequence = createVideoEditSequence()
  sequence.width = W; sequence.height = H; sequence.frameRate = { numerator: FPS, denominator: 1 }; sequence.motionBlur = true
  addLegacyVideoEditTracks(sequence)
  const template = sequence.tracks.find(track => track.index === 7)!
  sequence.tracks.push({ ...template, id: 'track-8', name: '视频 8', index: 8 })
  const base = { sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, rotation: 0, opacity: 1, volume: 0, text: '', start: 0, duration: 240 }
  const font = (size: number, weight = 700) => textStyleSchema.parse({ fontFamily: 'HarmonyOS Sans SC', fontWeight: weight, fontSize: size, fill: { enabled: true, color: '#F2F2F2' } })
  const card = (id: string, kind: 'text' | 'image', track: number, x: number, y: number, scale: number, curves: Record<string, Key[]>, extra: Partial<VideoEditClip> = {}): VideoEditClip => ({
    ...base, id, itemId: kind === 'text' ? 'text' : id, kind, name: id, track, x, y, scale, spatial: { enabled: true }, curves, ...extra } as VideoEditClip)
  sequence.clips = [
    { ...base, id: 'background', itemId: 'background', kind: 'image', name: '背景', track: 1, x: 0, y: 0, scale: 1 } as VideoEditClip,
    card('panel-a', 'image', 2, -.3, .16, .3, { depth: unfold(-.55), rotationY: unfold(32) }),
    card('panel-b', 'image', 3, 0, .2, .3, { depth: unfold(-.2), rotationX: unfold(-10) }),
    card('panel-c', 'image', 4, .3, .16, .3, { depth: unfold(-.55), rotationY: unfold(-32) }),
    card('label', 'text', 5, 0, .4, 1, { depth: unfold(.5) }, { text: '景深　视差　遮挡', textStyle: font(44, 400) }),
    card('subtitle', 'text', 6, 0, -.17, 1, { depth: unfold(.22) }, { text: '平面开场，一镜到底展开', textStyle: font(52, 400) }),
    card('title', 'text', 7, 0, -.29, 1, { depth: unfold(.35) }, { text: '痕迹AI 三维空间', textStyle: font(124) }),
    // 世界场景 1.5 秒出现，6.5 秒前淡出结束，压平段回到纯二维。
    { ...base, id: 'scene', itemId: 'scene', kind: 'code', name: '场景', track: 8, start: 45, duration: 150, x: 0, y: 0, scale: 1,
      curves: { opacity: [k(0, 0, 'linear'), k(30, 1, 'hold'), k(135, 1, 'linear'), k(149, 0, 'hold')] } } as VideoEditClip,
  ]
  sequence.spatialCamera = {
    // 平面段保持默认焦点（规范恒等）；景深开启前绑定显式对焦距离，压平后解除。
    bindings: { focus: [{ time: 0, value: null, interpolation: 'hold' }, { time: 128, value: { kind: 'distance', distance: 2.45 }, interpolation: 'hold' }, { time: 214, value: null, interpolation: 'hold' }] },
    curves: {
      perspective: [k(0, 0, 'hold'), k(45, 0), k(135, -1, 'hold'), k(195, -1), k(225, 0, 'hold')],
      offsetX: [k(0, 0, 'hold'), k(45, 0), k(135, .22), k(180, .3), k(225, 0, 'hold')],
      offsetY: [k(0, 0, 'hold'), k(45, 0), k(135, .07, 'hold'), k(195, .07), k(225, 0, 'hold')],
      defocus: [k(0, 0, 'hold'), k(132, 0), k(150, 10, 'hold'), k(186, 10), k(210, 0, 'hold')],
      // 先对焦后排面板，再拉到前景标题。
      focusDistance: [k(0, 2.45, 'hold'), k(150, 2.45), k(180, 1.65, 'hold')],
    },
  }
  document.media = [
    { id: 'm-background', name: '背景', path: '/samples/background.png', kind: 'image', width: W, height: H, durationSeconds: 0, hasAudio: false },
    ...['a', 'b', 'c'].map(id => ({ id: `m-${id}`, name: id, path: `/samples/${id}.png`, kind: 'image' as const, width: 720, height: 480, durationSeconds: 0, hasAudio: false })),
  ]
  document.items = [{ id: 'text', kind: 'text', name: '文字' }, { id: 'background', kind: 'image', name: '背景', mediaId: 'm-background' }, { id: 'scene', kind: 'code', name: '场景' },
    ...['a', 'b', 'c'].map(id => ({ id: `panel-${id}`, kind: 'image' as const, name: id, mediaId: `m-${id}` }))] as VideoEditComposition['items']
  document.sequences = [sequence]
  sequence.id = 'main'
  sequence.clips = sequence.clips.filter(clip => clip.id !== 'scene').map(clip => { const result = { ...clip }; delete result.curves; delete result.spatial; return result })
  delete sequence.spatialCamera
  document.items = document.items.filter(item => item.id !== 'scene')
  document.media.forEach((media, index) => { media.path = paths[index] })
  document.id = 't16-formal'
  document.items.forEach(item => { const id = item.id; item.id = `item-${id}`; sequence.clips.forEach(clip => { if (clip.itemId === id) clip.itemId = item.id }) })
  return document
}
