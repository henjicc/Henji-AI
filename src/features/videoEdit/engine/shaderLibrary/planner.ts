import { shaderEffectDefinition, isShaderTransition } from '../../../../core/videoEdit/shaderLibrary/catalog'
import { normalizeVideoEditBuiltinParams, type VideoEditBuiltinParams } from '../../../../core/videoEdit/builtinEffects'
import { createDefaultDiffusionOperationParams } from '../../../../core/imageEdit/diffusionParams'
import { compileDiffusionRecipe } from '../../../../core/imageEdit/diffusionRecipe'
import type { VideoEditBuiltinPlan, VideoEditBuiltinTexture } from '../videoEditBuiltinEffectPasses'
import type { VideoEditBuiltinEffectEntry } from '../videoEditBuiltinEffectShaders'
import type { VideoEditBuiltinTransitionInput } from '../../../../core/videoEdit/transitions'

/** Render-only clock, never persisted in the effect instance or its parameter schema. */
export interface ShaderLibraryClock { shaderTimeSeconds?: number }
type V4 = readonly [number, number, number, number]
function color(value: unknown): [number, number, number] { return [1, 3, 5].map(index => parseInt(String(value).slice(index, index + 2), 16) / 255) as [number, number, number] }
function numeric(params: VideoEditBuiltinParams, key: string, fallback = 0): number { return typeof params[key] === 'number' ? params[key] as number : fallback }
function createPlan(width: number, height: number): VideoEditBuiltinPlan {
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('着色器需要有效的目标尺寸。')
  return { width, height, scratch: [], passes: [] }
}
function alloc(plan: VideoEditBuiltinPlan, width: number, height: number): number { plan.scratch.push({ width, height }); return plan.scratch.length - 1 }
function pass(plan: VideoEditBuiltinPlan, entry: VideoEditBuiltinEffectEntry, source: VideoEditBuiltinTexture, target: VideoEditBuiltinTexture, a: V4, b: V4 = [0, 0, 0, 0], c: V4 = [0, 0, 0, 0], original?: VideoEditBuiltinTexture): void {
  const from = typeof source === 'number' ? plan.scratch[source] : plan
  const to = typeof target === 'number' ? plan.scratch[target] : plan
  plan.passes.push({ entry, source, target, original, uniforms: new Float32Array([to.width, to.height, from.width, from.height, ...a, ...b, ...c]) })
}

export function planShaderLibraryEffect(instance: { id: string; params: VideoEditBuiltinParams } & ShaderLibraryClock, width: number, height: number): VideoEditBuiltinPlan | undefined {
  const definition = shaderEffectDefinition(instance.id)
  if (!definition) return undefined
  const params = normalizeVideoEditBuiltinParams(instance.id, instance.params)
  const plan = createPlan(width, height)
  const time = instance.shaderTimeSeconds ?? 0
  if (!Number.isFinite(time)) throw new Error('着色器时间需要有限的序列秒数。')
  const amount = numeric(params, 'strength') / 100
  if (amount === 0) { pass(plan, 'copy', 'input', 'output', [0, 0, 0, 0]); return plan }
  if (instance.id === 'shader_glow_pro') {
    const recipe = compileDiffusionRecipe({ ...createDefaultDiffusionOperationParams(), mode: 'glow', strength: amount, glowRange: numeric(params, 'range') / 100, highlightResponse: numeric(params, 'threshold') / 100, glowExposure: numeric(params, 'exposure') / 100, highlightRolloff: numeric(params, 'rolloff') / 100, glowCoreWhite: numeric(params, 'core_white') / 100 }, { width, height })
    const extract = alloc(plan, width, height)
    pass(plan, 'sl_glow_extract', 'input', extract, [recipe.source.thresholdEV, recipe.source.softKneeEV, recipe.source.highlightGain, 0])
    let previous = extract
    const levels = recipe.scatterLevels.map(level => {
      const target = alloc(plan, Math.max(1, Math.ceil(width / level.divisor)), Math.max(1, Math.ceil(height / level.divisor)))
      pass(plan, 'sl_glow_down', previous, target, [0, 0, 0, 0]); previous = target; return target
    })
    for (let index = levels.length - 2; index >= 0; index--) {
      const high = levels[index]; const size = plan.scratch[high]; const target = alloc(plan, size.width, size.height)
      const lowWeight = index === levels.length - 2 ? recipe.scatterLevels[index + 1].weight : [1, 1, 1] as const
      pass(plan, 'sl_glow_up', previous, target, [...recipe.scatterLevels[index].weight, 0], [...lowWeight, 0], [0, 0, 0, 0], high); previous = target
    }
    pass(plan, 'sl_glow_composite', previous, 'output', [recipe.glow.exposure, recipe.glow.shoulderKnee, recipe.glow.bleach, recipe.glow.tintCoreWhite], [recipe.source.thresholdEV, recipe.source.softKneeEV, recipe.source.highlightGain, recipe.glow.coreWeight], [...recipe.tone.scatterTint, recipe.tone.scatterDesaturation], 'input')
    return plan
  }
  // The expensive continuous backgrounds can run at half size; fixed deterministic resolution,
  // no FPS/wall-clock adaptive quality that would make export differ from the same preview frame.
  const half = ['shader_aurora', 'shader_fractal_noise', 'shader_marble', 'shader_worley_noise'].includes(instance.id) && height > 1080
  const target = half ? alloc(plan, Math.ceil(width / 2), Math.ceil(height / 2)) : 'output'
  pass(plan, definition.id as VideoEditBuiltinEffectEntry, 'input', target,
    [half ? 1 : amount, numeric(params, 'scale', 30), time * numeric(params, 'speed', 0), numeric(params, 'direction') * Math.PI / 180],
    [...(params.color_a ? color(params.color_a) : [0, 0, 0] as const), numeric(params, 'seed', 42)],
    [...(params.color_b ? color(params.color_b) : [1, 1, 1] as const), 0])
  if (half) pass(plan, 'tr_mix', target, 'output', [1 - amount, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], 'input')
  return plan
}

export function planShaderLibraryTransition(input: VideoEditBuiltinTransitionInput, width: number, height: number): VideoEditBuiltinPlan | undefined {
  if (!isShaderTransition(input.kind)) return undefined
  const plan = createPlan(width, height)
  pass(plan, input.kind, 'input', 'output', [numeric(input.params, 'strength') / 100, numeric(input.params, 'scale'), 0, numeric(input.params, 'direction') * Math.PI / 180],
    [numeric(input.params, 'feather'), 0, 0, numeric(input.params, 'seed')], [input.progress, input.emptyOutgoing ? 1 : 0, input.emptyIncoming ? 1 : 0, 0], 'second')
  return plan
}

/** Reuse mature existing blur paths, not a second implementation. */
export function shaderLibraryDelegatedEffect(instance: { id: string; params: VideoEditBuiltinParams }): { id: string; params: VideoEditBuiltinParams } | undefined {
  if (!['shader_zoom_blur', 'shader_linear_blur'].includes(instance.id)) return undefined
  const params = normalizeVideoEditBuiltinParams(instance.id, instance.params)
  if (instance.id === 'shader_zoom_blur') return { id: 'zoom_blur', params: { strength: numeric(params, 'strength'), center_x: 50, center_y: 50 } }
  if (instance.id === 'shader_linear_blur') return { id: 'directional_blur', params: { length: numeric(params, 'strength'), direction: numeric(params, 'direction') } }
  return undefined
}
