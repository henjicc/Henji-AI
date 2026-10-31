/**
 * 纸张：一张静态的纸面高度场（细纤维与颗粒按“粗糙度”混合），只在线性光里按高度微调明暗，再加一点点方向光，
 * 不做浮雕立体。边缘毛糙只挪透明度的取样位置：内容内部不动，轮廓被纸纹带得不齐。
 * 纹理锚在内容左上角、大小与溶解显影的“大小”同一把尺子。实现在 `features/videoEdit/engine/paper.ts`。
 */
import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParams } from './builtinEffects'
import { effectParam } from './effectIncludes'
import { dissolveCellSize } from './dissolveReveal'
import type { LayerEffectReference } from './layerEffectGeometry'

/** 边缘毛糙 100 时轮廓最多挪动半个纹理格子。 */
const EDGE_REACH = 0.5
const n = (params: VideoEditBuiltinParams, key: string): number => Number(params[key] ?? 0)
/** 纹理格子边长（画面高度的比例）：50 约 1.3%。 */
export function paperCellSize(params: VideoEditBuiltinParams): number { return dissolveCellSize(n(params, 'scale')) }
/** 轮廓最远挪动多少（画面高度的比例）。 */
export function paperEdgeReach(params: VideoEditBuiltinParams): number { return n(params, 'amount') > 0 ? n(params, 'edge') / 100 * EDGE_REACH * paperCellSize(params) : 0 }
function paperBleed(params: VideoEditBuiltinParams, ref: LayerEffectReference): number {
  const reach = paperEdgeReach(params)
  return reach > 0 ? reach + 1 / (ref.referenceSize.height * ref.rasterScale) : 0
}

const DESCRIPTION = '给画面加一层纸面的纤维和颗粒，只改表面、不做凹凸立体。适合卡片、手写感标题和静态背景；纹理跟着图层走。'
const { amount, percent } = effectParam

export const PAPER_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  space: 'layer', author: { factory: 'paper' }, bleed: paperBleed, id: 'paper', name: '纸张', group: 'texture', description: DESCRIPTION,
  aliases: ['纸纹', '纸张质感', '纸面', '水彩纸', 'paper', 'paper texture'],
  params: [
    amount('amount', 40, { name: '强度', text: '纸纹多明显。0 没有；40（默认）近看才看得出；80 像粗糙的水彩纸。深色处纸纹本来就淡。' }),
    amount('scale', 50, { name: '纹理大小', text: '纤维与颗粒有多粗。50（默认）约为画面高度的 1.3%；20 细密的打印纸；90 粗糙的手工纸。' }),
    percent('roughness', 50, 0, { group: '纸纹', name: '粗糙度', text: '偏细纤维还是偏颗粒。0% 顺滑的纤维；50%（默认）两者都有；100% 粗颗粒。' }),
    amount('edge', 10, { group: '纸纹', name: '边缘毛糙', text: '内容边缘被纸纹带得多不齐。10（默认）几乎看不出；60 像印在粗纸上的字边。只动轮廓，内容内部不变。' }),
    { key: 'seed', type: 'number', unit: 'value', min: 0, max: 9999, step: 1, default: 0, animatable: false, group: '纸纹', name: '随机种子', description: '换一个数，纤维和颗粒就换一种排法，粗细和明显程度不变。同一画面上几张卡片各填不同的数，纸纹不会一模一样。' },
  ],
}
