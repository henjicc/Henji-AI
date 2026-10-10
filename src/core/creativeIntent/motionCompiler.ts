import { inverseAffine, mapAffine, type Affine } from '../imaging/transforms'
import { evaluateVideoEditKeyframes, videoEditClipAnimatedValueSchemas, videoEditKeyframesSchema, type VideoEditKeyframe } from '../videoEdit/keyframes'
import { type MotionProperty, type Pose } from './contracts'
import { cleanScalarSamples, fitScalarCurve, scalarCurveExtremaTimes, type ScalarSample } from './fitting'
import { checkCancelled, CreativeIntentError, type ComputationControl, type FramePose, type PreparedTake } from './sampling'
import { intentPose, type MotionIntent } from './recipe'

export type MotionCurveKey = 'x' | 'y' | 'scale' | 'rotation' | 'anchorX' | 'anchorY'
export interface MotionCompileContext {
  /** Exact host conversion from composition ratios to existing clip offset semantics. */
  positionToNative: Affine; pivotToNative: Affine; clipStart: number; scaleFactor: number; rotationOffsetDegrees: number
}
export interface CompiledMotion {
  takeId: string; curves: Partial<Record<MotionCurveKey, VideoEditKeyframe[]>>; range: [number, number]; keyCount: number; maxErrors: Partial<Record<MotionCurveKey, number>>
}
const propertyKeys: Record<MotionProperty, readonly MotionCurveKey[]> = { position: ['x', 'y'], rotationTurns: ['rotation'], scaleXY: ['scale'], pivot: ['anchorX', 'anchorY'] }

export function poseToNative(pose: Pose, context: MotionCompileContext): Record<MotionCurveKey, number> {
  if (Math.abs(pose.scaleXY[0] - pose.scaleXY[1]) > 1e-10) throw new CreativeIntentError('nonuniform-video-scale', [], '普通片段只支持统一缩放，请采用支持完整仿射的图片宿主')
  const p = mapAffine(context.positionToNative, pose.position); const pivot = mapAffine(context.pivotToNative, pose.pivot)
  return { x: p[0], y: p[1], scale: pose.scaleXY[0] * context.scaleFactor, rotation: pose.rotationTurns * 360 + context.rotationOffsetDegrees, anchorX: pivot[0], anchorY: pivot[1] }
}

export function compileMotionTake(take: PreparedTake, context: MotionCompileContext, options: { fidelity: number; intent?: MotionIntent; cleanup?: boolean }, control: ComputationControl = {}): CompiledMotion {
  checkCancelled(control)
  if (!Number.isSafeInteger(context.clipStart) || context.clipStart < 0 || !(context.scaleFactor > 0) || !Number.isFinite(context.rotationOffsetDegrees)) throw new CreativeIntentError('host-mapping', [take.takeId], '宿主转换无效')
  const source = take.points; const first = source[0]; const last = source[source.length - 1]
  if (!first || !last) throw new CreativeIntentError('empty-take', [take.takeId], '示范段没有姿态')
  if (first.frame < context.clipStart) throw new CreativeIntentError('clip-time', [take.takeId], '示范超出片段可编辑区间')
  if (options.intent && options.intent.kind !== 'follow_path' && first.frame === last.frame) throw new CreativeIntentError('zero-duration', [take.takeId], '同帧摆放不能推断动画时长')
  if (options.intent?.kind === 'spring_settle' && (last.frame - first.frame) / options.intent.cycles < 4) throw new CreativeIntentError('frequency', [take.takeId], '振荡超出当前正式帧网格可表示范围，请降低频率或延长时间')
  const keys = [...new Set(take.target.editable.flatMap(p => propertyKeys[p]))]
  if (options.intent && options.intent.kind !== 'follow_path') {
    const required: MotionProperty[] = options.intent.kind === 'scale_focus' ? ['position', 'scaleXY'] : options.intent.kind === 'dwell' ? take.target.editable : ['position']
    if (required.some(p => !take.target.editable.includes(p))) throw new CreativeIntentError('intent-property', [take.takeId], '动作所需属性不在目标可编辑域')
  }
  for (const point of source) {
    const native = poseToNative(point.pose, context)
    for (const key of keys) if (!videoEditClipAnimatedValueSchemas[key].safeParse(native[key]).success) throw new CreativeIntentError('native-range', [take.takeId, key], '原稿姿态超出正式宿主范围，不能用候选覆盖掩盖')
  }
  const tolerance: Record<MotionCurveKey, number> = { x: .00025, y: .00025, scale: .0005, rotation: .025, anchorX: .0001, anchorY: .0001 }
  // x conversion can use a non-square reference. Enforce 0.05% of short edge in native space.
  const [w, h] = take.target.compositionSize; const inv = inverseAffine(context.positionToNative); const short = Math.min(w, h)
  const sensitivity = Math.hypot(inv[0] * w / short, inv[1] * h / short) + Math.hypot(inv[2] * w / short, inv[3] * h / short)
  tolerance.x = tolerance.y = .00035 / sensitivity
  for (const key of keys) tolerance[key] *= 1 - .9 * options.fidelity
  const useIntent = options.intent && options.intent.kind !== 'follow_path'
  const points: FramePose[] = useIntent ? [] : source
  const hardFrames = new Set(source.filter(p => p.hard).map(p => p.frame))
  if (useIntent) for (let frame = first.frame; frame <= last.frame; frame++) {
    if (frame % 256 === 0) checkCancelled(control)
    const pose = intentPose(options.intent!, first.pose, (frame - first.frame) / (last.frame - first.frame))
    points.push({ frame, pose, sampleIds: [], hard: frame === first.frame || frame === last.frame || hardFrames.has(frame) })
  }
  const values = points.map(p => ({ p, native: poseToNative(p.pose, context) }))
  const curves: CompiledMotion['curves'] = {}; const maxErrors: CompiledMotion['maxErrors'] = {}
  for (const key of keys) {
    checkCancelled(control)
    let samples: ScalarSample[] = values.map(({ p, native }) => ({ time: p.frame - context.clipStart, value: native[key], hard: p.hard }))
    if (options.cleanup) samples = cleanScalarSamples(samples, options.fidelity)
    for (const s of samples) if (!videoEditClipAnimatedValueSchemas[key].safeParse(s.value).success) throw new CreativeIntentError('native-range', [take.takeId, key], `属性 ${key} 超出正式宿主范围，请调整动作`) 
    const intentValue = useIntent ? (time: number): number => poseToNative(intentPose(options.intent!, first.pose, (time + context.clipStart - first.frame) / (last.frame - first.frame)), context)[key] : undefined
    const fitted = options.fidelity === 1 && !useIntent ? { points: samples.map(s => ({ time: s.time, value: s.value, interpolation: 'linear' as const })), maxError: 0 } : fitScalarCurve(samples, tolerance[key], control, intentValue)
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
    const native = poseToNative(intentPose(options.intent!, first.pose, (frame - first.frame) / (last.frame - first.frame)), context)
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
