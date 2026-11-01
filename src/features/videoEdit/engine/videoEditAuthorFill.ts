import { CODE_AUTHOR_FILL_MIN_API_VERSION } from '@/core/videoEdit/codeAuthorVersions'
import { videoEditBuiltinEffect } from '@/core/videoEdit/builtinEffects'
import type { EffectDescriptor } from '@/core/videoEdit/authorEffects.generated'
import { WHITE_HEX } from '@/core/theme/colorTokens'
import type { AuthorLayer } from './videoEditAuthorModule'

/**
 * 画面来源用原生生成器（fill）：换成一层铺满 bounds 的不透明画面，生成器作为它效果链的第一项。
 * 生成器正常模式在内容 alpha 内直接换成生成的画面，所以结果就是 bounds 里的渐变，再接作者自己的 effects、pose、clip；
 * 精度、外扩、指纹与取帧观察都沿用图层效果的同一条路径。旧接口的同名字段属于作者数据，原样不动。
 */
/** 由 fill 换成的图层的宿主标记：作者代码拿不到这个 symbol，旧接口里同名的作者字段不会被误认。展开复制时随对象带走。 */
const ANALYTIC = Symbol('analytic')
/** 画面全由生成器在 GPU 里按坐标算出，按需要的倍数栅格即可（见 authorRasterScale）。 */
export function isAuthorAnalyticLayer(layer: AuthorLayer): boolean { return (layer as { [ANALYTIC]?: true })[ANALYTIC] === true }
export function authorFillLayer(layer: AuthorLayer, apiVersion: number, width: number, height: number): AuthorLayer {
  if (apiVersion < CODE_AUTHOR_FILL_MIN_API_VERSION || !layer || typeof layer !== 'object' || layer.fill === undefined) return layer
  if (layer.adjust !== undefined) throw new Error('adjust 与 draw、fill、effects 互斥。')
  if (typeof layer.fill !== 'function') throw new Error('fill 必须是函数，返回生成器描述，例如 fill: () => gradient({ ... })。')
  if (layer.draw !== undefined) throw new Error('fill 与 draw 二选一。')
  if (layer.effects !== undefined && typeof layer.effects !== 'function') throw new Error('effects 必须是函数。')
  const fill = layer.fill as (time: number) => unknown, effects = layer.effects
  const [x0, y0, x1, y1] = layer.bounds ?? [0, 0, width, height]
  return {
    ...layer, ...{ [ANALYTIC]: true }, fill: undefined, bounds: [x0, y0, x1, y1],
    draw: ctx => { ctx.fillStyle = WHITE_HEX; ctx.fillRect(x0, y0, x1 - x0, y1 - y0) },
    effects: time => [authorFillDescriptor(fill.call(layer, time)), ...(effects ? effects.call(layer, time) : [])],
  }
}
function authorFillDescriptor(value: unknown): EffectDescriptor {
  const id = value && typeof value === 'object' ? (value as { id?: unknown }).id : undefined
  const definition = typeof id === 'string' ? videoEditBuiltinEffect(id) : undefined
  if (definition?.stage !== 'generator' || definition.space !== 'layer') throw new Error(`fill 只接受原生生成器的描述（目前只有 gradient()），收到 ${typeof id === 'string' ? id : typeof value}。`)
  return value as EffectDescriptor
}
