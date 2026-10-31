/**
 * 划痕：画面按宽度 4% 分成竖条，每条在每个时间段里由哈希决定有没有划痕、在哪、多长、多粗。
 * 时间段按帧号与随机种子取，预览与导出同一帧结果相同；各竖条的时间段错开，不会所有划痕同时换。
 * 按整幅画面算（`space: 'frame'`），不进普通图层的效果链。实现在 `features/videoEdit/engine/scratches.ts`。
 */
import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParams } from './builtinEffects'
import { effectParam } from './effectIncludes'

/** 粗细 → 线宽（画面高度的比例）：20 约 0.07%，100 约 0.64%。 */
export function scratchWidth(value: number): number { return 0.0004 * 2 ** (Math.max(0, value) / 25) }
/** 停留 → 一条划痕停多少帧：0 每帧换，30 约 4 帧，80 约 50 帧；100 一直不动（返回 0）。 */
export function scratchHoldFrames(hold: number): number { return hold >= 100 ? 0 : Math.max(1, Math.round(2 ** (Math.max(0, hold) / 100 * 7))) }
/**
 * 这一帧用到的种子：竖条的时间段起点各自错开，几乎每帧都有竖条换段，所以直接用帧号；
 * 没有划痕（数量或不透明度为 0）或停留 100（一直不动）时画面与帧号无关，返回 0。规划只读这个值。
 */
export function scratchFrameSeed(params: VideoEditBuiltinParams, frame: number): number {
  const value = (key: string, fallback: number): number => typeof params[key] === 'number' ? params[key] as number : fallback
  return value('amount', 30) <= 0 || value('opacity', 50) <= 0 || value('hold', 30) >= 100 ? 0 : Math.max(0, Math.floor(frame))
}

const DESCRIPTION = '在画面上加老胶片那种一闪而过的竖向划痕。放在片段或代码调整层上，按整幅画面算。'
const { amount, percent, choice } = effectParam

export const SCRATCHES_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  stage: 'point', space: 'frame', frameSeed: scratchFrameSeed, author: { factory: 'scratches' }, id: 'scratches', name: '划痕', group: 'texture', description: DESCRIPTION,
  aliases: ['胶片划痕', '老胶片', '划伤', 'film scratches', 'scratches'],
  params: [
    amount('amount', 30, { name: '数量', text: '同时有多少条。0 没有；30（默认）偶尔几条；80 满屏划痕。' }),
    percent('opacity', 50, 0, { name: '不透明度', text: '划痕多显眼。50%（默认）清楚但不抢画面；100% 亮划痕接近纯白、暗划痕接近纯黑。' }),
    amount('width', 20, { group: '划痕', name: '粗细', text: '划痕多粗。20（默认）约为画面高度的 0.07%，发丝细；60 约 0.2%；100 约 0.6%，像粗的划伤。' }),
    percent('hold', 30, 0, { group: '划痕', name: '停留', text: '一条划痕停多久。0% 每帧换位置；30%（默认）约停 4 帧；80% 约 50 帧；100% 一直不动。' }),
    choice('tone', 'light', [{ value: 'light', label: '亮' }, { value: 'dark', label: '暗' }], { group: '划痕', name: '颜色', text: '亮（默认）是胶片上白色的划伤；暗是黑色的脏线。' }),
    { key: 'seed', type: 'number', unit: 'value', min: 0, max: 9999, step: 1, default: 0, animatable: false, group: '划痕', name: '随机种子', description: '换一个数，划痕出现的位置和先后就换一种排法，数量和节奏不变。' },
  ],
}
