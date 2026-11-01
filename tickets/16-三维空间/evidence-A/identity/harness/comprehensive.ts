// P1：完整 VideoEditRenderer 恒等矩阵。同一份入口分别按改动前 main 与本分支的源码打包，在同一隔离 Chrome 里渲染后逐字节比较。
// variant=plain：不带任何空间字段；variant=zero：每个画面片段开启空间且四键为零、序列带零值相机（只在本分支打包里有意义）。
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition, type VideoEditClip, type VideoEditComposition, type VideoEditDocument } from '@/core/videoEdit/document'
import { textStyleSchema } from '@/core/imaging/vectorContent/text'
import { titleGraphic } from '@/core/videoEdit/titleGraphics'


const FPS = 30
type Key = { time: number; value: number; interpolation: 'ease' | 'linear' | 'hold' }
const k = (time: number, value: number, interpolation: Key['interpolation'] = 'ease'): Key => ({ time, value, interpolation })
const base = { sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, rotation: 0, opacity: 1, volume: 0, text: '', x: 0, y: 0, scale: 1 }
const font = (size: number, weight = 700) => textStyleSchema.parse({ fontFamily: 'HarmonyOS Sans SC', fontWeight: weight, fontSize: size, fill: { enabled: true, color: '#F2F2F2' } })
const builtin = (id: string, effect: string, params: Record<string, unknown>, amount = 1) => ({ id, name: effect, enabled: true, amount, builtin: { id: effect, params } })

function tracks(sequence: VideoEditDocument['sequences'][number], count: number): void {
  const audio = sequence.tracks.find(track => track.kind === 'audio')!
  audio.id = `${sequence.id}-a1`
  sequence.tracks = [audio, ...Array.from({ length: count }, (_, index) => ({ id: `${sequence.id}-v${index + 1}`, name: `视频 ${index + 1}`, index: index + 1, kind: 'video' as const, locked: false, enabled: true, muted: false, solo: false }))]
}

/** 综合文档：图片、运动模糊、内置效果链（镜头模糊、全能调色、发光）、过渡、文字、标题图形、字幕、嵌套序列。 */
export function mainDocument(par: boolean, simple: boolean): VideoEditDocument {
  const document = createVideoEditDocument('P1 恒等')
  document.id = 'p1-document'
  const inner = createVideoEditSequence('内层'); inner.id = 'inner'; tracks(inner, 2)
  inner.clips = [
    { ...base, id: 'inner-panel', itemId: 'panel-b', kind: 'image', name: 'b', track: 1, start: 0, duration: 120, scale: .5, rotation: -6 } as VideoEditClip,
    { ...base, id: 'inner-text', itemId: 'text', kind: 'text', name: '内层文字', track: 2, start: 0, duration: 120, y: -.3, text: '嵌套序列', textStyle: font(72) } as VideoEditClip,
  ]
  const outer = createVideoEditSequence('外层'); outer.id = 'outer'; tracks(outer, 7)
  if (par) { outer.width = 1440; outer.pixelAspectRatio = { numerator: 4, denominator: 3 } }
  outer.motionBlur = true
  const graphic = titleGraphic('lower_third', { text: '姓名', subtitle: '职务' }, outer.width, outer.height, 119 / FPS)
  // 标题图形的对象 id 随机生成；固定下来，两边打包的画面输入完全一致。
  graphic.objects.forEach((object, index) => {
    object.id = `graphic-${index}`
    for (const [key, points] of Object.entries(object.curves ?? {})) points.forEach((point, index) => { point.id = `${object.id}-${key}-${index}` })
  })
  outer.clips = [
    { ...base, id: 'background', itemId: 'background', kind: 'image', name: '背景', track: 1, start: 0, duration: 120 } as VideoEditClip,
    { ...base, id: 'panel-a', itemId: 'panel-a', kind: 'image', name: 'a', track: 2, start: 0, duration: 60, x: -.28, y: .12, scale: .42, rotation: 8, opacity: .92, anchorX: .3, anchorY: .6,
      curves: { x: [k(0, -.4, 'linear'), k(59, -.1, 'linear')], rotation: [k(0, 0), k(59, 24)] },
      effects: [builtin('fx-lens', 'blur', { mode: 'lens', amount: 18 }), builtin('fx-grade', 'color_grade', { exposure: .2, temperature_kelvin: 5200, tint: 6 })] } as VideoEditClip,
    { ...base, id: 'panel-c', itemId: 'panel-c', kind: 'image', name: 'c', track: 2, start: 60, duration: 60, x: -.2, y: .1, scale: .42 } as VideoEditClip,
    { ...base, id: 'panel-glow', itemId: 'panel-a', kind: 'image', name: '发光', track: 3, start: 0, duration: 120, x: .3, y: .18, scale: .3, effects: [builtin('fx-glow', 'glow', { strength: 60, radius: 30 })] } as VideoEditClip,
    { ...base, id: 'nested', itemId: 'inner-item', kind: 'sequence', name: '嵌套', track: 4, start: 0, duration: 120, x: .28, y: -.2, scale: .36 } as VideoEditClip,
    { ...base, id: 'title', itemId: 'text', kind: 'text', name: '标题', track: 5, start: 0, duration: 120, y: -.32, text: '痕迹AI 恒等核对', textStyle: font(110), curves: { opacity: [k(0, 0, 'linear'), k(12, 1, 'hold')] } } as VideoEditClip,
    { ...base, id: 'lower-third', itemId: 'graphic', kind: 'graphic', name: '人名条', track: 6, start: 0, duration: 120, graphic } as VideoEditClip,
  ]
  // 8 位路径：去掉会把合成升到半浮点的输入（内置效果输出、嵌套序列画面）。
  if (simple) outer.clips = outer.clips.filter(clip => clip.id !== 'panel-glow' && clip.id !== 'nested').map(clip => clip.effects ? { ...clip, effects: undefined } : clip)
  outer.transitions = [{ id: 'dissolve', kind: 'cross_dissolve', rightClipId: 'panel-c', durationFrames: 12 }]
  outer.captions = [{ id: 'caption', start: 0, duration: 120, text: '字幕：平面画面逐像素一致' }]
  document.media = [
    { id: 'm-background', name: '背景', path: '/p1/background.png', kind: 'image', width: 1920, height: 1080, durationSeconds: 0, hasAudio: false },
    ...['a', 'b', 'c'].map(id => ({ id: `m-${id}`, name: id, path: `/p1/panel-${id}.png`, kind: 'image' as const, width: 720, height: 480, durationSeconds: 0, hasAudio: false })),
  ] as VideoEditDocument['media']
  document.items = [
    { id: 'text', kind: 'text', name: '文字' }, { id: 'graphic', kind: 'graphic', name: '图形' }, { id: 'background', kind: 'image', name: '背景', mediaId: 'm-background' },
    ...['a', 'b', 'c'].map(id => ({ id: `panel-${id}`, kind: 'image' as const, name: id, mediaId: `m-${id}` })),
    { id: 'inner-item', kind: 'sequence', name: '内层', sequenceId: 'inner' },
  ] as VideoEditDocument['items']
  document.sequences = [outer, inner]
  return document
}
