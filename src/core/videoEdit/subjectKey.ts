/**
 * 主体抠像：按智能区域的人物分析把人物抠出来，背景变透明。实现在 `features/videoEdit/engine/subjectKey.ts`。
 * 同一份人物蒙版也是描边、发光的一种轮廓来源（参数 `contour` 选“主体”）。
 */
import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParam } from './builtinEffects'
import { effectParam, type EffectParamText } from './effectIncludes'

/** 收缩 / 扩展 → 蒙版边缘移动的距离（画面高度的比例）：±100 约 1%。 */
export function subjectChokeDistance(value: number): number { return Math.min(100, Math.abs(value)) / 100 * 0.01 }
/** 边缘柔化 → 蒙版高斯的标准差（画面高度的比例）。按 1.25 次方增长，低段细调：20 约 0.13%，60 约 0.53%，100 约 1%。 */
export function subjectFeatherSigma(value: number): number { return 0.01 * (Math.min(100, Math.max(0, value)) / 100) ** 1.25 }

/** 描边、发光的“轮廓来源”：主体按人物蒙版取轮廓，只用于片段，不进作者接口；不做动画，人物分析按整段片段请求。 */
export function subjectContourParam(words: EffectParamText): VideoEditBuiltinParam {
  return { ...effectParam.choice('contour', 'alpha', [{ value: 'alpha', label: '内容透明度' }, { value: 'subject', label: '主体' }], words), spaces: ['clip'], animatable: false }
}

const DESCRIPTION = '自动把人物从画面里抠出来，背景变透明，不用绿幕；发丝和半透明的边缘会去掉原背景的颜色，换到新背景上不出黑边、白边。用在视频和图片片段上，第一次加上时先在本机识别人物，识别完之前画面不变。'
const { signed, amount, toggle } = effectParam

export const SUBJECT_KEY_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  id: 'subject_key', name: '主体抠像', group: 'keying', description: DESCRIPTION,
  aliases: ['人物抠像', '人像抠图', '去背景', '去掉背景', '抠人', 'remove background', 'subject key', 'person matte'],
  subjectMatte: () => true,
  params: [
    signed('choke', 0, { name: '收缩 / 扩展', text: '边缘往里收还是往外放。0（默认）按识别的边缘；负数收进去，去掉边上残留的背景；正数放出来，保住头发。100 约为画面高度的 1%。' }),
    amount('feather', 20, { name: '边缘柔化', text: '边缘有多柔。0 最利落；20（默认）自然；60 适合头发多的画面；100 的过渡约为画面高度的 1%。' }),
    toggle('invert', false, { name: '去掉主体', text: '反过来去掉人物、只留背景。默认关闭。' }),
  ],
}
