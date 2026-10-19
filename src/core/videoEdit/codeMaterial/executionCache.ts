import { CODE_V3_LIMITS, codeBinaryCost, codeBuiltinCost } from './contract'
import { CODE_MATH_COSTS } from './expressions'
import { CODE_EASE_NAMES } from './motion'
import { CODE_PARAMETER_FUNCTION_COSTS } from './parameterSampling'
import type { CodeExpression, CodeMaterialContext, CodeMaterialProgram, CodeTextMeasurer, CodeMatrix, CodeDrawCommand } from './contract'
import type { CodeHeavyStructure } from './performance'
import type { CodeMotionClock, CodeMotionSamplingBudget, CodeMotionSettings, CodeMotionPose } from './motionSampling'
import type { VideoEditFrameOffset } from '../time'

export interface CodeExecutionFrame {
  context: CodeMaterialContext
  parameters: Readonly<Record<string, unknown>>
  bindings: unknown[]
  locals: Map<number, unknown>
  indices: number[]
  draws: number
  characters: number
  operations: number
  prepaid: boolean
  charge(cost?: number): void
  measure(fields: Record<string, unknown>): ReturnType<CodeTextMeasurer>
  profile?: Map<string, CodeHeavyStructure>
  /** Per-evaluation slots; never retained in the cross-frame expression cache. */
  profileEntries?: CodeHeavyStructure[]
  profileCached?: boolean
  bindingsReady: boolean
  cache: ExecutionCache
  epoch: number
  cullInvisible?: boolean
  lazyDrawBindings?: boolean
  parentMatrix?: CodeMatrix
  placementCullBlocked?: boolean
  culledGroups?: number
  motion?: { clock: CodeMotionClock; budget: CodeMotionSamplingBudget; hasExposure(command: CodeDrawCommand): boolean; evaluate<T>(offset: VideoEditFrameOffset, caller: CodeExecutionFrame, run: (frame: CodeExecutionFrame) => T): T | null; register(command: Extract<CodeDrawCommand, { kind: 'group' }>, settings: CodeMotionSettings, poseAt: (offset: VideoEditFrameOffset) => CodeMotionPose | null): void }
}
export interface CodeExecutionPlan {
  run(frame: CodeExecutionFrame, depth: number): unknown
  height: number
  locals: number[]
  frameDependent: boolean
  cacheable: boolean
  uses: number
  cost?: number
}
interface CachedValue { value: unknown; cost: number; epoch: number }
interface ExecutionCache {
  key: string
  epoch: number
  size: number
  values: Array<Map<number, CachedValue> | undefined>
}
const caches = new WeakMap<CodeMaterialProgram, ExecutionCache>()
const bindingDependencies = new WeakMap<CodeExecutionPlan, readonly number[]>()
/** Scalars and small numeric tuples: at most 32768 scalar slots per loaded program.
 * Programs are weakly held, parameter/seed/size changes release all old entries.
 * Audio and host text measurement are deliberately never memoized. */
export function codeExecutionCache(program: CodeMaterialProgram, parameters: Readonly<Record<string, unknown>>, context: CodeMaterialContext): ExecutionCache {
  const key = JSON.stringify([parameters, context.seed ?? program.seed, context.width, context.height], (_key, value: unknown) => Object.is(value, -0) ? { negativeZero: true } : value)
  let cache = caches.get(program)
  if (!cache || cache.key !== key) {
    cache = { key, epoch: 0, size: 0, values: [] }
    caches.set(program, cache)
  }
  cache.epoch++
  return cache
}

export function memoizeCodeExecution(expression: CodeExpression, children: CodeExecutionPlan[], numeric: { cost: number; height: number; locals: number[]; frameDependent: boolean } | null, run: CodeExecutionPlan['run'], allocateSlot: () => number): CodeExecutionPlan {
  const plan: CodeExecutionPlan = {
    run, height: numeric?.height ?? 1 + Math.max(0, ...children.map(child => child.height)),
    locals: numeric?.locals ?? [...new Set(children.flatMap(child => child.locals))],
    frameDependent: numeric?.frameDependent ?? children.some(child => child.frameDependent),
    cacheable: children.every(child => child.cacheable), uses: 1,
    cost: numeric?.cost ?? fixedCost(expression, children),
  }
  const bindings = expression.kind === 'binding' ? [expression.slot] : [...new Set(children.flatMap(child => bindingDependencies.get(child) ?? []))]
  bindingDependencies.set(plan, bindings)
  const ready = (frame: CodeExecutionFrame): boolean => frame.bindingsReady && !frame.lazyDrawBindings || bindings.every(slot => slot in frame.bindings)
  if (expression.kind === 'local') plan.locals = [expression.slot]
  if (expression.kind === 'context') plan.frameDependent = !['width', 'height'].includes(expression.key)
  if (expression.kind === 'draw' || expression.kind === 'repeat' || expression.kind === 'textAnimation' || expression.kind === 'color'
    || expression.kind === 'v3call' && (expression.op.startsWith('audio.') || expression.op === 'measureText')) plan.cacheable = false
  if (plan.cost !== undefined && plan.cost > 1 && !numeric) {
    const cost = plan.cost; const metered = run
    run = (frame, depth) => {
      if (frame.prepaid || !ready(frame) || frame.profile && !frame.profileCached || depth + plan.height > CODE_V3_LIMITS.depth || frame.operations + cost > CODE_V3_LIMITS.cpuOperations) return metered(frame, depth)
      frame.operations += cost
      frame.prepaid = true
      try { return metered(frame, depth) } finally { frame.prepaid = false }
    }
    plan.run = run
  }
  // Helper coordinate tuples can recur through several index expressions in the
  // same frame. Never reuse a mutable tuple across frames or cache draw objects.
  const tuple = expression.kind === 'array' && expression.values.length <= 16 && expression.values.every(value => value.type === 'number' || value.type === 'boolean')
  const weight = tuple && expression.kind === 'array' ? expression.values.length + 1 : 1
  // References are cheap and must retain their lazy binding semantics.
  if (!plan.cacheable || plan.locals.length > 1 || plan.height < 3 || !tuple && !['number', 'boolean'].includes(expression.type)
    || expression.kind === 'binding' || !plan.locals.length && (plan.frameDependent || numeric)) return plan
  const slot = plan.locals[0]
  const cacheSlot = allocateSlot()
  plan.run = (frame, depth) => {
    // Profiling executes every closure so its attribution remains inclusive.
    // Near the ceiling replay individual charges to keep the exact error span,
    // charge amount and first failing operation, including short-circuit paths.
    if (frame.profile && !frame.profileCached || !ready(frame) || (tuple || plan.frameDependent) && plan.uses < 2 || depth + plan.height > CODE_V3_LIMITS.depth) return run(frame, depth)
    const index = slot === undefined ? 0 : frame.locals.get(slot)
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= 4096) return run(frame, depth)
    const cache = frame.cache
    let entries = cache.values[cacheSlot]
    const hit = entries?.get(index)
    if (hit && (!tuple && !plan.frameDependent || hit.epoch === frame.epoch) && frame.operations + hit.cost <= CODE_V3_LIMITS.cpuOperations) {
      if (!frame.prepaid) frame.operations += hit.cost
      return hit.value
    }
    const before = frame.operations
    const value = run(frame, depth)
    if (!tuple && typeof value !== 'number' && typeof value !== 'boolean') return value
    if (!hit && cache.size + weight > 32768) return value
    if (!entries) { entries = new Map(); cache.values[cacheSlot] = entries }
    if (!hit) cache.size += weight
    const cost = frame.prepaid ? plan.cost! : frame.operations - before
    if (hit) { hit.value = value; hit.cost = cost; hit.epoch = frame.epoch }
    else entries.set(index, { value, cost, epoch: frame.epoch })
    return value
  }
  return plan
}

/** Batch only fixed-cost subtrees. Variable text work, lazy conditionals and
 * literal-color warmup retain ordered charges. Binding reads are fixed only
 * after the frame's binding pass; near the ceiling always replay every charge. */
function fixedCost(expression: CodeExpression, children: CodeExecutionPlan[]): number | undefined {
  if (expression.kind === 'binding') return 1
  if (children.some(child => child.cost === undefined)) return undefined
  const childCost = children.reduce((sum, child) => sum + child.cost!, 0)
  switch (expression.kind) {
    case 'literal': case 'parameter': case 'local': case 'context': return 1
    case 'array': case 'object': case 'index': case 'field': case 'component': case 'unary': return 1 + childCost
    case 'binary': return expression.op === '&&' || expression.op === '||' || expression.type === 'string' ? undefined : codeBinaryCost(expression.op) + childCost
    case 'call': return 1 + codeBuiltinCost(expression.op, expression.type).cpu + childCost
    case 'v3call': {
      const op = expression.op
      if (op in CODE_MATH_COSTS) return 1 + CODE_MATH_COSTS[op as keyof typeof CODE_MATH_COSTS] + childCost
      if (op in CODE_PARAMETER_FUNCTION_COSTS) return 1 + CODE_PARAMETER_FUNCTION_COSTS[op as keyof typeof CODE_PARAMETER_FUNCTION_COSTS] + childCost
      if (CODE_EASE_NAMES.includes(op) || ['noise', 'tween', 'cubicBezier'].includes(op)) return 65 + childCost
      if (['progress', 'stagger', 'linearGradient', 'radialGradient', 'conicGradient', 'hsv', 'hsl', 'toHsv', 'toHsl', 'luma', 'saturate', 'contrast'].includes(op)) return 1 + childCost
      return undefined
    }
    default: return undefined
  }
}
