/**
 * 故障：画面像信号出错一样断裂、错位、串色，三种方式共用一道取样工序（`features/videoEdit/engine/glitch.ts`）。
 * 块大小与溶解显影的“大小”同一把格子尺，色彩分离与投影的“距离”同一把距离尺，任何分辨率下看起来一样。
 */
import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParams } from './builtinEffects'
import { effectParam } from './effectIncludes'
import { dissolveCellSize } from './dissolveReveal'
import { dropShadowOffset } from './dropShadow'
import type { LayerEffectReference } from './layerEffectGeometry'

/** 数字故障的块宽是块高的几倍：横向长条才像扫描行出错。 */
export const GLITCH_BLOCK_ASPECT = 4
/** 错位块最多横移几个块宽。 */
export const GLITCH_MAX_BLOCK_SHIFT = 3
/** 条带错位在强度 100 时的最大偏移（画面高度的比例）。 */
export const GLITCH_MAX_BAR_SHIFT = 0.05

/** 块大小 → 块高（画面高度的比例）：0 约 0.2%，40 约 0.9%，100 约 8%。 */
export function glitchBlockHeight(value: number): number { return dissolveCellSize(value) }
/** 色彩分离 → 红蓝错开的距离（画面高度的比例）：40 约 2%，100 约 5%。 */
export function glitchSplitDistance(value: number): number { return dropShadowOffset(value) }
/** 变化频率 → 每种错法持续几帧；0 一段到底（返回 Infinity），60% 约 6 帧，100% 每帧都换。 */
export function glitchSegmentFrames(rhythm: number): number {
  const f = Math.min(1, Math.max(0, rhythm / 100))
  return f <= 0 ? Infinity : 1 + Math.round(30 * (1 - f) ** 2)
}

const n = (params: VideoEditBuiltinParams, key: string): number => Number(params[key] ?? 0)

/** 这一帧落在第几段错法；强度为 0 或变化频率为 0 时画面不随帧变，固定为 0。规划只读这个值，不直接读帧号。 */
export function glitchFrameSeed(params: VideoEditBuiltinParams, frame: number): number {
  const span = glitchSegmentFrames(n(params, 'rhythm'))
  return n(params, 'amount') <= 0 || !Number.isFinite(span) ? 0 : Math.floor(Math.max(0, frame) / span)
}
/** 块高（像素），至少 1 像素：外扩与着色器用同一个值，低分辨率下错开的碎片也不会被纹理边截掉。 */
export function glitchBlockPixels(blockSize: number, height: number): number { return Math.max(1, glitchBlockHeight(blockSize) * height) }

/** 外扩：错开后能飞出原位的最远距离；压缩失真不移动内容。再留 1 像素给偏移取整。 */
export function glitchBleed(params: VideoEditBuiltinParams, ref: LayerEffectReference): number {
  if (n(params, 'amount') <= 0 || params.mode === 'compression') return 0
  const h = ref.referenceSize.height * ref.rasterScale
  const shift = params.mode === 'bars' ? n(params, 'amount') / 100 * GLITCH_MAX_BAR_SHIFT : GLITCH_MAX_BLOCK_SHIFT * GLITCH_BLOCK_ASPECT * glitchBlockPixels(n(params, 'block_size'), h) / h
  return shift + glitchSplitDistance(n(params, 'rgb_split')) + 1 / h
}

const DESCRIPTION = '让画面像信号出错一样断裂、错位、串色。适合科技感标题、转场前后的一两下冲击；给“强度”打关键帧，做出一下一下的爆发。'
const { amount, percent, choice, angle } = effectParam

export const GLITCH_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  space: 'layer', frameSeed: glitchFrameSeed, author: { factory: 'glitch' }, bleed: glitchBleed, id: 'glitch', name: '故障', group: 'stylize', description: DESCRIPTION,
  aliases: ['数字故障', '条带错位', '压缩失真', '信号故障', '花屏', 'glitch', 'bar shift', 'datamosh', 'compression artifacts'],
  params: [
    amount('amount', 40, { name: '强度', text: '出错有多凶。0 没有故障；40（默认）几块明显错位；100 大半个画面碎掉。数字故障超过 60 时偶尔还有一块反色。' }),
    choice('mode', 'digital', [{ value: 'digital', label: '数字故障' }, { value: 'bars', label: '条带错位' }, { value: 'compression', label: '压缩失真' }], { name: '方式', text: '怎么出错。数字故障（默认）一块块横向错开、红蓝分离；条带错位把画面切成平行条带各自偏移；压缩失真像码率不够时的方块与串色。' }),
    percent('rhythm', 60, 0, { name: '变化频率', text: '多久换一种错法。0% 定住不变；60%（默认）约每 6 帧一变；100% 每帧都换。' }),
    { ...amount('rgb_split', 40, { name: '色彩分离', text: '红、蓝两色错开多远。0 不分色；40（默认）约为画面高度的 2%；100 约 5%。只出现在错开的块和条带上。' }), visibleWhen: { param: 'mode', notEquals: 'compression' } },
    { ...amount('block_size', 40, { group: '块', name: '块大小', text: '错位块或压缩方块有多大。10 约为画面高度的 0.3%，细碎；40（默认）约 0.9%；100 约 8%，大块碎片。数字故障的块是宽为高 4 倍的长条，还会混进 2 倍、4 倍大的块。' }), visibleWhen: { param: 'mode', notEquals: 'bars' } },
    { key: 'bars', type: 'number', unit: 'value', min: 2, max: 200, softMin: 2, softMax: 40, step: 1, default: 12, animatable: true, group: '块', name: '条带数', description: '画面切成几条。4 几条宽带；12（默认）；40 细碎的条纹。可以输入到 200。', visibleWhen: { param: 'mode', equals: 'bars' } },
    { ...angle('angle', 0, { group: '块', name: '角度', text: '条带的走向。0°（默认）水平条带，左右错开；90° 竖直条带，上下错开。' }), visibleWhen: { param: 'mode', equals: 'bars' } },
    { key: 'seed', type: 'number', unit: 'value', min: 0, max: 9999, step: 1, default: 0, animatable: false, group: '块', name: '随机种子', description: '换一个数，出错的位置和样子就换一种，强度和节奏不变。同一画面几处都用故障时各填不同的数。' },
  ],
}
