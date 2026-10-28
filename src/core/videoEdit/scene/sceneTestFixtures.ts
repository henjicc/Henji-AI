import type { VideoEditScene } from './sceneSchema'

/** 黄金样本与测试共用的片子数据声明（作者代码里 scene 参数的 schema 原样写法）；不被正式代码导入。 */
export const GOLDEN_SCENE_DECLARATION = {
  id: 'golden.film', version: 1, title: '黄金片子',
  kinds: {
    segment: { title: '段落', role: 'segment', at: 'start', end: 'end', influence: 'span', lane: { style: 'bar', label: 'name' }, fields: { name: { type: 'text', title: '名字', maxLength: 80 }, start: { type: 'time' }, end: { type: 'time' } } },
    window: { title: '窗口', footage: 'media', fields: { name: { type: 'text', maxLength: 80 }, rect: { type: 'deskRect' }, media: { type: 'media', accept: ['video'] } } },
    shot: { title: '窗口内容', role: 'shot', parent: ['window'], at: 'at', influence: 'untilNext', footage: 'media', lane: { style: 'block' }, fields: { at: { type: 'time' }, media: { type: 'media', accept: ['video'] }, src: { type: 'sourceTime' }, rate: { type: 'number', min: 0, max: 16, default: 1 } } },
    focus: { title: '高亮', fields: { name: { type: 'text', maxLength: 80, optional: true } } },
    focusKey: {
      title: '镜头落点', parent: ['focus'], at: 'at', duration: 'dur', influence: 'neighbors', margin: { before: 0.3 }, footage: 'win', lane: { style: 'key' }, cues: { land: { at: 'at', title: '落定' } },
      fields: { at: { type: 'time', anchor: 'footage' }, dur: { type: 'duration', max: 10 }, win: { type: 'ref', to: ['window'] }, target: { type: 'windowRegion' }, pad: { type: 'number', min: 0, max: 1, default: 0.2 }, track: { type: 'uiTrack', optional: true } },
    },
    cut: { title: '剪切', role: 'cut', at: 'from', end: 'to', influence: 'span', lane: { style: 'cut' }, fields: { from: { type: 'time' }, to: { type: 'time' }, enabled: { type: 'boolean', default: true } } },
  },
}

/** 按上面的声明写成的一份片子数据：段落、窗口与内容时间表（停住）、高亮落点（按录屏秒定位、目标手调过）、可恢复的剪切。 */
export function goldenScene(screenMediaId: string): VideoEditScene {
  return {
    id: 'golden-scene', name: '黄金片子', schema: { id: GOLDEN_SCENE_DECLARATION.id, version: GOLDEN_SCENE_DECLARATION.version },
    records: [
      { id: 'seg-switch', kind: 'segment', values: { name: '交换机', start: 0.5, end: 2.5 } },
      { id: 'win-demo', kind: 'window', values: { name: '演示窗口', rect: { x: 120, y: 80, width: 1280, height: 800 }, media: screenMediaId } },
      { id: 'sh-1', kind: 'shot', parent: 'win-demo', values: { at: 0, media: screenMediaId, src: 0 } },
      { id: 'sh-2', kind: 'shot', parent: 'win-demo', values: { at: 1.5, media: screenMediaId, src: 1.2, rate: 0 } },
      { id: 'fo-1', kind: 'focus', values: { name: '搜索框' } },
      { id: 'fk-1', kind: 'focusKey', parent: 'fo-1', values: { at: { src: 0.8 }, dur: 0.5, win: 'win-demo', target: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }, pad: 0.3 }, tuned: ['target'] },
      { id: 'cut-1', kind: 'cut', values: { from: 2.6, to: 2.8, enabled: true } },
    ],
  }
}
