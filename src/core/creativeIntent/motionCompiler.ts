import { inverseAffine, mapAffine, type Affine } from '../imaging/transforms'
import { evaluateVideoEditKeyframes, videoEditClipAnimatedValueSchemas, videoEditKeyframesSchema, type VideoEditKeyframe } from '../videoEdit/keyframes'
import { refKey, type MotionProperty, type Pose } from './contracts'
import { cleanScalarSamples, fitScalarCurve, scalarCurveExtremaTimes, type ScalarSample, type FittedScalar } from './fitting'
import { checkCancelled, CreativeIntentError, type ComputationControl, type FramePose, type PreparedTake } from './sampling'
import { intentPose, intentEventProgress, motionIntentSchema, type MotionIntent } from './recipe'
import { z } from 'zod'

export type MotionCurveKey = 'x' | 'y' | 'scale' | 'rotation' | 'anchorX' | 'anchorY'
export interface MotionCompileContext {
  /** Exact host conversion from composition ratios to existing clip offset semantics. */
  positionToNative: Affine; pivotToNative: Affine; clipStart: number; scaleFactor: number; rotationOffsetDegrees: number
}
export interface CompiledMotion {
  takeId: string; curves: Partial<Record<MotionCurveKey, VideoEditKeyframe[]>>; range: [number, number]; keyCount: number; maxErrors: Partial<Record<MotionCurveKey, number>>
}
const propertyKeys: Record<MotionProperty, readonly MotionCurveKey[]> = { position: ['x', 'y'], rotationTurns: ['rotation'], scaleXY: ['scale'], pivot: ['anchorX', 'anchorY'] }
export const motionRecipeSchema = z.object({ actions: z.array(z.object({
  target: z.string().min(1), spanF: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]), intent: motionIntentSchema,
}).strict()).min(1) }).strict()

/** Validates every target/range before any curve is returned. No runtime recipe or implicit composition. */
export function compileMotionRecipe(recipe: z.infer<typeof motionRecipeSchema>, takes: readonly PreparedTake[], mappings: Record<string, MotionCompileContext>, fidelity: number, control: ComputationControl = {}): CompiledMotion[] {
  const parsed = motionRecipeSchema.parse(recipe); const occupied = new Map<string, number>()
  const actions = [...parsed.actions].sort((a, b) => a.spanF[0] - b.spanF[0])
  const selected = actions.map(action => {
    const take = takes.find(t => t.takeId === action.target)
    if (!take || !mappings[action.target]) throw new CreativeIntentError('recipe-target', [action.target], '动作目标不属于本次可编辑示范')
    const [start, end] = action.spanF
    if (end <= start || start < take.points[0].frame || end > take.points.at(-1)!.frame) throw new CreativeIntentError('recipe-range', [action.target], '动作区间超出示范或没有持续时间')
    const primitive = action.intent.kind === 'cycle' ? action.intent.template : action.intent
    const properties: MotionProperty[] = primitive.kind === 'spin' || primitive.kind === 'swing' ? ['rotationTurns', 'pivot'] : primitive.kind === 'pulse' ? ['scaleXY'] : primitive.kind === 'scale_focus' ? ['position', 'scaleXY'] : primitive.kind === 'dwell' || primitive.kind === 'follow_path' ? take.target.editable : ['position']
    if (properties.some(property => !take.target.editable.includes(property))) throw new CreativeIntentError('intent-property', [action.target], '动作所需属性不在目标可编辑域')
    for (const property of properties) {
      const key = refKey(take.target.ref) + ':' + property
      if ((occupied.get(key) ?? -1) >= start) throw new CreativeIntentError('recipe-overlap', [action.target, property], '同一属性动作区间重叠，请分段确认')
      occupied.set(key, end)
    }
    const points = take.points.filter(p => p.frame >= start && p.frame <= end)
    if (points[0]?.frame !== start || points.at(-1)?.frame !== end) throw new CreativeIntentError('recipe-anchor', [action.target], '动作边界缺少已确认姿态')
    return { ...take, target: { ...take.target, editable: properties }, points, pins: take.pins.filter(p => p.point.frame >= start && p.point.frame <= end) }
  })
  return selected.map((take, i) => compileMotionTake(take, mappings[take.takeId], { fidelity, intent: actions[i].intent }, control))
}

export function poseToNative(pose: Pose, context: MotionCompileContext): Record<MotionCurveKey, number> {
  if (Math.abs(pose.scaleXY[0] - pose.scaleXY[1]) > 1e-10) throw new CreativeIntentError('nonuniform-video-scale', [], '普通片段只支持统一缩放，请采用支持完整仿射的图片宿主')
  const p = mapAffine(context.positionToNative, pose.position); const pivot = mapAffine(context.pivotToNative, pose.pivot)
  return { x: p[0], y: p[1], scale: pose.scaleXY[0] * context.scaleFactor, rotation: pose.rotationTurns * 360 + context.rotationOffsetDegrees, anchorX: pivot[0], anchorY: pivot[1] }
}

export function compileMotionTake(take: PreparedTake, context: MotionCompileContext, options: { fidelity: number; intent?: MotionIntent; cleanup?: boolean; evaluatePose?: (frame: number) => Pose; hardFrames?: readonly number[] }, control: ComputationControl = {}): CompiledMotion {
  checkCancelled(control)
  if (options.intent) options = { ...options, intent: motionIntentSchema.parse(options.intent) }
  if (!Number.isSafeInteger(context.clipStart) || context.clipStart < 0 || !(context.scaleFactor > 0) || !Number.isFinite(context.rotationOffsetDegrees)) throw new CreativeIntentError('host-mapping', [take.takeId], '宿主转换无效')
  const source = take.points; const first = source[0]; const last = source[source.length - 1]
  if (!first || !last) throw new CreativeIntentError('empty-take', [take.takeId], '示范段没有姿态')
  const duration = last.frame - first.frame
  const primitive = options.intent?.kind === 'cycle' ? options.intent.template : options.intent
  const frequency = primitive && ('cycles' in primitive ? primitive.cycles : 'count' in primitive ? primitive.count : primitive.kind === 'orbit' ? Math.abs(primitive.sweepTurns) : 0)
  const primitiveDuration = options.intent?.kind === 'cycle' ? options.intent.periodFrames / (options.intent.mode === 'pingpong' ? 2 : 1) : duration
  // Each leg / apex / quadrant needs its own integer anchor. Finer curvature is
  // still checked by the native evaluator, rather than a blanket duration limit.
  const framesPerPeriod = primitive?.kind === 'zigzag' ? 1 : primitive?.kind === 'bounce' || primitive?.kind === 'pulse' ? 2 : 4
  if (frequency && primitiveDuration / frequency < framesPerPeriod) throw new CreativeIntentError('frequency', [take.takeId], '峰谷无法分开落在当前帧网格，请降低频率或延长时间')
  if (options.intent?.kind === 'cycle') {
    const cycle = options.intent
    if (cycle.periodFrames < 2 || cycle.mode === 'pingpong' && cycle.periodFrames % 2 !== 0) throw new CreativeIntentError('cycle-grid', [take.takeId], '循环周期和转向须能落在当前整数帧网格')
    if (duration % cycle.periodFrames !== 0) throw new CreativeIntentError('cycle-tail', [take.takeId], '循环尾部被截断，请确认完整周期后再应用')
    if (cycle.mode === 'loop') {
      const a = poseToNative(intentPose(cycle.template, first.pose, 0), context)
      const b = poseToNative(intentPose(cycle.template, first.pose, 1), context)
      const epsilon = 1e-5
      const c = poseToNative(intentPose(cycle.template, first.pose, epsilon), context)
      const d = poseToNative(intentPose(cycle.template, first.pose, 1 - epsilon), context)
      if (Object.keys(a).some(k => { const key = k as MotionCurveKey; return Math.abs(a[key] - b[key]) > 1e-8 || Math.abs((c[key] - a[key] - (b[key] - d[key])) / epsilon) > 1e-3 })) throw new CreativeIntentError('cycle-seam', [take.takeId], '循环接缝的姿态或速度不连续，请改用往返或闭合动作')
    }
  }
  if (first.frame < context.clipStart) throw new CreativeIntentError('clip-time', [take.takeId], '示范超出片段可编辑区间')
  if (options.intent && options.intent.kind !== 'follow_path' && first.frame === last.frame) throw new CreativeIntentError('zero-duration', [take.takeId], '同帧摆放不能推断动画时长')
  const keys = [...new Set(take.target.editable.flatMap(p => propertyKeys[p]))]
  if (options.intent && options.intent.kind !== 'follow_path') {
    const required: MotionProperty[] = primitive?.kind === 'scale_focus' ? ['position', 'scaleXY'] : primitive?.kind === 'pulse' ? ['scaleXY'] : primitive?.kind === 'spin' || primitive?.kind === 'swing' ? ['rotationTurns', 'pivot'] : primitive?.kind === 'dwell' ? take.target.editable : ['position']
    if (required.some(p => !take.target.editable.includes(p))) throw new CreativeIntentError('intent-property', [take.takeId], '动作所需属性不在目标可编辑域')
  }
  for (const point of source) {
    const native = poseToNative(point.pose, context)
    for (const key of keys) if (!videoEditClipAnimatedValueSchemas[key].safeParse(native[key]).success) throw new CreativeIntentError('native-range', [take.takeId, key], '原稿姿态超出正式宿主范围，不能用候选覆盖掩盖')
  }
  const tolerance: Record<MotionCurveKey, number> = { x: .00025, y: .00025, scale: .0005, rotation: .025, anchorX: .0001, anchorY: .0001 }
  // x conversion can use a non-square reference. Enforce 0.05% of short edge in native space.
  const [w, h] = take.target.compositionSize; const inv = inverseAffine(context.positionToNative); const short = Math.min(w, h)
  // Allocate the geometry budget to each column of the actual inverse mapping.
  // The sum of both worst-case vector errors stays below 0.05% of the short edge.
  tolerance.x = .00025 / Math.hypot(inv[0] * w / short, inv[1] * h / short)
  tolerance.y = .00025 / Math.hypot(inv[2] * w / short, inv[3] * h / short)
  for (const key of keys) tolerance[key] *= 1 - .9 * options.fidelity
  const useIntent = Boolean(options.evaluatePose || options.intent && options.intent.kind !== 'follow_path')
  const evaluatedPose = (frame: number): Pose => options.evaluatePose ? options.evaluatePose(frame) : intentPose(options.intent!, first.pose, (frame - first.frame) / duration, duration)
  const points: FramePose[] = useIntent ? [] : source
  const hardFrames = new Set(source.filter(p => p.hard).map(p => p.frame))
  for (const frame of options.hardFrames ?? []) hardFrames.add(frame)
  if (primitive && primitive.kind !== 'follow_path') {
    const repeat = options.intent?.kind === 'cycle' ? options.intent : undefined
    const period = repeat?.periodFrames ?? duration
    for (let start = 0; start < duration; start += period || 1) {
      checkCancelled(control)
      for (const u of intentEventProgress(primitive)) {
        const times = repeat?.mode === 'pingpong' ? [start + u * period / 2, start + period - u * period / 2] : [start + u * period]
        for (const t of times) { hardFrames.add(first.frame + Math.floor(t)); hardFrames.add(first.frame + Math.ceil(t)) }
      }
    }
  }
  if (options.intent?.kind === 'cycle') for (let frame = first.frame; frame <= last.frame; frame += options.intent.periodFrames / (options.intent.mode === 'pingpong' ? 2 : 1)) {
    for (const offset of [-1, 0, 1]) if (frame + offset >= first.frame && frame + offset <= last.frame) hardFrames.add(frame + offset)
  }
  if (useIntent) for (let frame = first.frame; frame <= last.frame; frame++) {
    if (frame % 256 === 0) checkCancelled(control)
    const pose = evaluatedPose(frame)
    points.push({ frame, pose, sampleIds: [], hard: frame === first.frame || frame === last.frame || hardFrames.has(frame) })
  }
  const values = points.map(p => ({ p, native: poseToNative(p.pose, context) }))
  const curves: CompiledMotion['curves'] = {}; const maxErrors: CompiledMotion['maxErrors'] = {}
  for (const key of keys) {
    checkCancelled(control)
    let samples: ScalarSample[] = values.map(({ p, native }) => ({ time: p.frame - context.clipStart, value: native[key], hard: p.hard }))
    if (options.cleanup) samples = cleanScalarSamples(samples, options.fidelity)
    for (const s of samples) if (!videoEditClipAnimatedValueSchemas[key].safeParse(s.value).success) throw new CreativeIntentError('native-range', [take.takeId, key], `属性 ${key} 超出正式宿主范围，请调整动作`) 
    const intentValue = useIntent ? (time: number): number => poseToNative(evaluatedPose(time + context.clipStart), context)[key] : undefined
    const fitted: FittedScalar = options.fidelity === 1 && !useIntent ? { points: samples.map(s => ({ time: s.time, value: s.value, interpolation: 'linear' as const })), maxError: 0 } : fitScalarCurve(samples, tolerance[key], control, intentValue)
    if (options.intent?.kind === 'cycle') {
      const cycle = options.intent; const times = new Set<number>([first.frame - context.clipStart, last.frame - context.clipStart])
      for (let frame = first.frame; frame <= last.frame; frame += cycle.periodFrames) {
        times.add(frame - context.clipStart)
        if (cycle.mode === 'pingpong' && frame + cycle.periodFrames / 2 < last.frame) times.add(frame + cycle.periodFrames / 2 - context.clipStart)
      }
      const epsilon = 1e-6
      const a = poseToNative(intentPose(cycle.template, first.pose, 0), context)[key]
      const b = poseToNative(intentPose(cycle.template, first.pose, epsilon), context)[key]
      const slope = cycle.mode === 'pingpong' ? 0 : (b - a) / epsilon / cycle.periodFrames
      // Eliminate the seam tangent equality in the native basis, then recheck the entire interval.
      for (let i = 0; i < fitted.points.length - 1; i++) {
        const left = fitted.points[i]; const right = fitted.points[i + 1]
        const dv = Number(right.value) - Number(left.value); const dt = right.time - left.time
        if (Math.abs(dv) < 1e-12 || left.interpolation === 'hold' || !times.has(left.time) && !times.has(right.time)) continue
        const bezier = left.bezier ? [...left.bezier] as [number, number, number, number] : [1 / 3, 1 / 3, 2 / 3, 2 / 3] as [number, number, number, number]
        if (times.has(left.time)) bezier[1] = slope * dt / dv * bezier[0]
        if (times.has(right.time)) bezier[3] = 1 - slope * dt / dv * (1 - bezier[2])
        left.interpolation = 'bezier'; left.bezier = bezier
      }
    }
    curves[key] = fitted.points; maxErrors[key] = fitted.maxError
    // Endpoints, pins and all returned controls are checked in the formal value domain, never clamped.
    for (const p of fitted.points) if (!videoEditClipAnimatedValueSchemas[key].safeParse(p.value).success) throw new CreativeIntentError('native-range', [take.takeId, key], '拟合值超出宿主范围')
    for (const time of scalarCurveExtremaTimes(fitted.points)) {
      const value = evaluateVideoEditKeyframes(fitted.points, time, samples[0].value)
      if (!videoEditClipAnimatedValueSchemas[key].safeParse(value).success) throw new CreativeIntentError('native-range', [take.takeId, key], '曲线极值超出正式宿主范围')
    }
    for (let frame = first.frame; frame <= last.frame; frame += .25) {
      if (Number.isInteger(frame) && frame % 256 === 0) checkCancelled(control)
      const value = evaluateVideoEditKeyframes(fitted.points, frame - context.clipStart, samples[0].value)
      if (!videoEditClipAnimatedValueSchemas[key].safeParse(value).success) throw new CreativeIntentError('native-range', [take.takeId, key], '曲线段内部极值超出正式宿主范围')
    }
  }
  for (const { pin, point } of take.pins) if (pin.valueLocked) {
    const native = poseToNative(point.pose, context)
    for (const property of pin.properties) for (const key of propertyKeys[property]) {
      const value = evaluateVideoEditKeyframes(curves[key], point.frame - context.clipStart, native[key])
      if (value !== native[key]) throw new CreativeIntentError('intent-pin-conflict', [pin.id, key], '所选动作与钉住姿态冲突，请调整动作或确认解钉')
    }
  }
  // Analytic intent checked at 4 subdivisions/frame, independently of fit-curve's tolerance.
  if (useIntent) for (let frame = first.frame; frame <= last.frame; frame += .25) {
    if (Number.isInteger(frame) && frame % 256 === 0) checkCancelled(control)
    const native = poseToNative(evaluatedPose(frame), context)
    for (const key of keys) {
      if (!videoEditClipAnimatedValueSchemas[key].safeParse(native[key]).success) throw new CreativeIntentError('native-range', [take.takeId, key], '动作极值超出宿主范围')
      const error = Math.abs(evaluateVideoEditKeyframes(curves[key], frame - context.clipStart, native[key]) - native[key])
      maxErrors[key] = Math.max(maxErrors[key] ?? 0, error)
      if (error > tolerance[key] * 1.5) throw new CreativeIntentError('unrepresentable-intent', [take.takeId, key], '当前整数帧曲线不能达到动作误差预算，请减小幅度或延长时间')
    }
  }
  Object.values(curves).forEach(c => videoEditKeyframesSchema.parse(c))
  const keyCount = new Set(Object.values(curves).flatMap(c => c.map(p => p.time))).size
  return { takeId: take.takeId, curves, range: [first.frame - context.clipStart, last.frame - context.clipStart], keyCount, maxErrors }
}
