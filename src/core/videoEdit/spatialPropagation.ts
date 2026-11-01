import type { VideoEditComposition } from './document'
import { composeVideoEditSequence } from './composition'
import { evaluateVideoEditClip, rescaleVideoEditCurves, mapVideoEditCurvesClock } from './keyframes'
import { spatialCameraSchema, spatialClipSchema } from './spatialSchema'
import { VIDEO_EDIT_MOTION_BLUR_MAX_SAMPLES, VIDEO_EDIT_MOTION_BLUR_PLAYBACK_SAMPLES } from './motionBlur'
import type { VideoEditKeyframes } from './keyframeSchema'
import type { SpatialCamera, SpatialCameraNumericKey, SpatialFact, SpatialFocus, SpatialPatch, SpatialPropagationRequest, SpatialSnapshot, SpatialTarget, SpatialVec3 } from './spatialTypes'

const bindings = ['framing', 'aim', 'focus'] as const
function mapTarget<T extends SpatialFocus | null>(target: T, ids: ReadonlyMap<string, string>): T {
  return target?.kind === 'clip' ? { ...target, clipId: ids.get(target.clipId) ?? target.clipId } : target
}
export function remapSpatialCameraReferences(camera: SpatialCamera, ids: ReadonlyMap<string, string>): SpatialCamera {
  return { ...camera,
    ...(camera.framing ? { framing: { ...camera.framing, target: mapTarget(camera.framing.target, ids) } } : {}),
    ...(camera.aim ? { aim: mapTarget(camera.aim, ids) } : {}), ...(camera.focus ? { focus: mapTarget(camera.focus, ids) } : {}),
    ...(camera.bindings ? { bindings: Object.fromEntries(bindings.filter(key => camera.bindings?.[key]).map(key => [key, camera.bindings![key]!.map(point => ({ ...point, value: mapTarget(point.value, ids) }))])) } : {}),
  }
}
/** 相机使用序列帧；数值通道直接复用普通关键帧的冲突归并规则。 */
export function retimeSpatialCamera(camera: SpatialCamera, convert: (time: number) => number): SpatialCamera {
  // 相机轨迹独立于片段尾部；空序列和后续扩展仍需保留范围外的镜头事件。
  const duration = Math.max(0, ...Object.values(camera.curves ?? {}).flatMap(points => points.map(point => convert(point.time))),
    ...Object.values(camera.bindings ?? {}).flatMap(points => points.map(point => convert(point.time)))) + 1
  const numeric = camera.curves && rescaleVideoEditCurves(camera.curves, convert, duration)
  return { ...camera, ...(numeric ? { curves: numeric } : {}), ...(camera.bindings ? { bindings: Object.fromEntries(bindings.filter(key => camera.bindings?.[key]).map(key => [key,
    [...new Map(camera.bindings![key]!.map(point => { const time = Math.max(0, Math.min(duration - 1, convert(point.time))); return [time, { ...point, time }] })).values()].sort((a, b) => a.time - b.time),
  ])) } : {}) }
}
export function splitSpatialCameraTarget(camera: SpatialCamera, from: string, right: string, at: number): SpatialCamera {
  const result = structuredClone(camera)
  for (const key of bindings) {
    const initial = key === 'framing' ? result.framing?.target : result[key]
    const original = result.bindings?.[key] ?? []
    const event = original.filter(point => point.time <= at).at(-1)
    const current = event ? event.value : initial
    const points = original.map(point => ({ ...point, value: point.time >= at ? mapTarget(point.value, new Map([[from, right]])) : point.value }))
    if (current?.kind === 'clip' && current.clipId === from && !points.some(point => point.time === at)) points.push({ time: at, interpolation: 'hold', value: { kind: 'clip', clipId: right } })
    if (points.length) result.bindings = { ...result.bindings, [key]: points.sort((a, b) => a.time - b.time) }
  }
  return result
}
export function applySpatialPatch(snapshot: SpatialSnapshot, patch: SpatialPatch): VideoEditComposition {
  if (snapshot.revision !== snapshot.composition.revision || patch.expectedRevision !== snapshot.revision || snapshot.sequenceId !== patch.sequenceId || snapshot.composition.id !== patch.sequenceId) throw new Error('空间计算所依据的序列已变化，请重新计算。')
  const edits = new Map(patch.clips.map(edit => [edit.clipId, edit]))
  if (edits.size !== patch.clips.length || patch.clips.some(edit => !snapshot.composition.clips.some(clip => clip.id === edit.clipId))) throw new Error('空间修改包含重复或不存在的片段。')
  const result = { ...snapshot.composition, clips: snapshot.composition.clips.map(clip => {
    const edit = edits.get(clip.id)
    if (!edit) return clip
    const { depth, rotationX, rotationY, anchorDepth, spatial } = edit.values
    spatialClipSchema.parse({ ...(depth !== undefined ? { depth } : {}), ...(rotationX !== undefined ? { rotationX } : {}), ...(rotationY !== undefined ? { rotationY } : {}), ...(anchorDepth !== undefined ? { anchorDepth } : {}), ...(spatial ? { spatial } : {}) })
    return { ...clip, ...edit.values, ...(edit.curves ? { curves: edit.curves } : {}) }
  }) }
  if (patch.camera) { if (patch.camera.value === null) delete result.spatialCamera; else result.spatialCamera = spatialCameraSchema.parse(patch.camera.value) }
  return result
}
function references(camera: SpatialCamera): string[] {
  return bindings.flatMap(key => [key === 'framing' ? camera.framing?.target : camera[key], ...(camera.bindings?.[key] ?? []).map(point => point.value)])
    .flatMap(target => target?.kind === 'clip' ? [target.clipId] : [])
}
export function mapSpatialCameraClock(camera: SpatialCamera, maps: SpatialPropagationRequest['sequenceTimeMap']): SpatialCamera {
  if (!maps.length) return camera
  const result = structuredClone(camera)
  if (camera.curves) result.curves = mapVideoEditCurvesClock(camera.curves, maps)
  if (camera.bindings) result.bindings = Object.fromEntries(bindings.filter(key => camera.bindings?.[key]).map(key => {
    const points = camera.bindings![key]!
    const moved = points.flatMap(point => {
      const map = maps.find(map => point.time >= map.sourceRange[0] && point.time < map.sourceRange[1])
      if (!map) return [point]
      if (!map.targetRange) return []
      return [{ ...point, time: Math.round(map.targetRange[0] + (point.time - map.sourceRange[0]) * (map.targetRange[1] - map.targetRange[0]) / (map.sourceRange[1] - map.sourceRange[0])) }]
    })
    for (const map of maps) if (map.targetRange) {
      const event = points.filter(point => point.time <= map.sourceRange[0]).at(-1)
      const target = event ? event.value : (key === 'framing' ? camera.framing?.target : camera[key]) ?? null
      if (!moved.some(point => point.time === map.targetRange![0])) moved.push({ time: map.targetRange[0], interpolation: 'hold', value: target })
    }
    return [key, [...new Map(moved.sort((a, b) => a.time - b.time).map(point => [point.time, point])).values()]]
  }))
  return result
}
/** 删除或跨序列搬移前，引用转成普通世界目标曲线，验证成功才返回整个变更。 */
export async function planSpatialPropagation(request: SpatialPropagationRequest): Promise<{ composition: VideoEditComposition; facts: readonly SpatialFact[] }> {
  request.signal.throwIfAborted()
  if (request.before.revision !== request.before.composition.revision || request.before.sequenceId !== request.before.composition.id) throw new Error('空间传播快照已失效。')
  const { evaluateSpatialFrame, evaluateSpatialCamera, spatialClipMatrix, spatialPolygonCenter, SpatialEvaluationError } = await import('./spatialEvaluation')
  const { spatialTransform } = await import('./spatialMatrices')
  let composition = request.proposed
  const facts: SpatialFact[] = []
  const originals = new Map((request.before.composition.sequences ?? []).map(sequence => [sequence.id, composeVideoEditSequence(request.before.composition, sequence)]))
  originals.set(request.before.composition.id, request.before.composition)
  const proposed = new Map((composition.sequences ?? []).map(sequence => [sequence.id, composeVideoEditSequence(composition, sequence)]))
  proposed.set(composition.id, composition)
  for (const [sequenceId, after] of proposed) {
    request.signal.throwIfAborted()
    let before = originals.get(sequenceId)
    if (!after.spatialCamera || !before) continue
    let camera: SpatialCamera = after.spatialCamera
    const maps = request.clipMap.filter(map => map.fromSequenceId === sequenceId)
    // 分割来源在编辑发生处按顺序记录，连切后删除的中间身份也能回到原始几何。
    const sources = new Map(before.clips.map(clip => [clip.id, clip]))
    for (const map of maps) {
      if (!map.toClipId || map.toSequenceId !== sequenceId || sources.has(map.toClipId)) continue
      const source = sources.get(map.fromClipId)
      if (source) sources.set(map.toClipId, { ...source, id: map.toClipId })
    }
    before = { ...before, clips: [...sources.values()] }
    const removed = new Set(references(camera).filter(id => !after.clips.some(clip => clip.id === id)))
    const localOutput = sequenceId === composition.id ? request.output : { ...request.output, displayWidth: after.width, displayHeight: after.height }
    if (removed.size) {
      if ([...removed].some(id => !before.clips.some(clip => clip.id === id))) throw new SpatialEvaluationError([{ code: 'missing-target', clipIds: [...removed], sequenceFrame: 0, message: '相机引用了不存在的片段，无法恢复世界轨迹。', values: {} }])
      const baked = structuredClone(camera); const channels: Partial<Record<SpatialCameraNumericKey, VideoEditKeyframes>> = { ...baked.curves }
      const duration = Math.max(before.clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), 1),
        ...Object.values(camera.curves ?? {}).flatMap(points => points.map(point => point.time + 1)),
        ...Object.values(camera.bindings ?? {}).flatMap(points => points.map(point => point.time + 1)))
      for (const key of bindings) {
        const affected = (target: SpatialFocus | null | undefined): boolean => target?.kind === 'clip' && removed.has(target.clipId)
        if (![key === 'framing' ? camera.framing?.target : camera[key], ...(camera.bindings?.[key] ?? []).map(point => point.value)].some(affected)) continue
        for (const channel of Object.keys(channels) as SpatialCameraNumericKey[]) {
          if (channel.startsWith(key) && channel !== 'framingHeightFraction') delete channels[channel]
        }
        const events: Array<{ time: number; interpolation: 'hold'; value: SpatialFocus | null }> = []
        const resolveTarget = (frame: number, bindingFrame = frame): SpatialFocus | null => {
          const limited = { ...camera, bindings: { ...camera.bindings, [key]: camera.bindings?.[key]?.filter(point => point.time <= bindingFrame) } }
          const resolved = evaluateSpatialCamera(limited, frame)
          const target = (key === 'framing' ? resolved.framing?.target : resolved[key]) ?? null
          if (!affected(target)) return target
          const clip = before.clips.find(clip => clip.id === (target as Extract<SpatialTarget, { kind: 'clip' }>).clipId)!
          const matrix = spatialClipMatrix(before, evaluateVideoEditClip(clip, frame), localOutput)
          const quad = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]].map(point => spatialTransform(matrix, point as unknown as SpatialVec3))
          return key === 'framing' ? { kind: 'bounds', bounds: { min: [0, 1, 2].map(axis => Math.min(...quad.map(point => point[axis]))) as unknown as SpatialVec3, max: [0, 1, 2].map(axis => Math.max(...quad.map(point => point[axis]))) as unknown as SpatialVec3 } } : { kind: 'point', point: spatialPolygonCenter(quad) }
        }
        const values = (target: SpatialFocus | null): Partial<Record<SpatialCameraNumericKey, number>> => {
          const result: Partial<Record<SpatialCameraNumericKey, number>> = {}
          if (target?.kind === 'distance') result.focusDistance = target.distance
          if (target?.kind === 'point' || target?.kind === 'bounds') {
            for (const [suffix, vector] of target.kind === 'bounds' ? [['Min', target.bounds.min], ['Max', target.bounds.max]] as const : [['', target.point]] as const) {
              vector.forEach((value, axis) => { result[`${key}${suffix}${['X', 'Y', 'Z'][axis]}` as SpatialCameraNumericKey] = value })
            }
          }
          return result
        }
        const samples: Array<{ current: ReturnType<typeof values>; end: ReturnType<typeof values> }> = []
        let previous = ''
        for (let frame = 0; frame < duration; frame++) {
          if (frame % 256 === 0) { request.signal.throwIfAborted(); await Promise.resolve() }
          const target = resolveTarget(frame)
          samples.push({ current: values(target), end: values(resolveTarget(frame + 1, frame)) })
          const identity = target?.kind === 'clip' ? `clip:${target.clipId}` : target?.kind ?? 'null'
          if (identity !== previous) { events.push({ time: frame, interpolation: 'hold', value: target }); previous = identity }
        }
        const used = new Set(samples.flatMap(sample => Object.keys(sample.current) as SpatialCameraNumericKey[]))
        for (const channel of used) channels[channel] = [...samples.map((sample, time) => {
          const value = sample.current[channel] ?? (channel === 'focusDistance' ? 1 : 0)
          // 独立原值锚点保留切点左极限，绑定切换不会反向污染上一帧内的轨迹。
          return { time, value, interpolation: 'bezier' as const, bezier: [1 / 3, 1 / 3, 2 / 3, 2 / 3] as [number, number, number, number], easeRange: [0, 1] as [number, number], easeValues: [value, sample.end[channel] ?? value] as [number, number] }
        }), { time: duration, value: samples.at(-1)!.end[channel] ?? samples.at(-1)!.current[channel] ?? (channel === 'focusDistance' ? 1 : 0), interpolation: 'hold' }]
        baked.bindings = { ...baked.bindings, [key]: events }
        if (key === 'framing') delete baked.framing
        else delete baked[key]
      }
      baked.curves = channels
      // framing 的占高与目标绑定分离，烘焙只替换目标，静态占高仍需保留。
      if (camera.framing && !baked.framing) baked.framing = { target: { kind: 'point', point: [0, 0, 0] }, heightFraction: camera.framing.heightFraction }
      const sampleCount = request.quality === 'interactive' ? VIDEO_EDIT_MOTION_BLUR_PLAYBACK_SAMPLES : VIDEO_EDIT_MOTION_BLUR_MAX_SAMPLES
      const sampleOffsets = [0, ...Array.from({ length: sampleCount }, (_, index) => -.25 + (index + .5) / sampleCount * .5)]
      for (let frame = 0; frame < duration; frame++) for (const subframe of sampleOffsets) {
        request.signal.throwIfAborted()
        if (frame + subframe < 0) continue
        const source = evaluateSpatialFrame({ ...before, spatialCamera: camera }, frame + subframe, localOutput, request.quality)
        const candidate = evaluateSpatialFrame({ ...before, spatialCamera: baked }, frame + subframe, localOutput, request.quality)
        const error = Math.max(0, ...source.cards.flatMap(card => {
          const next = candidate.cards.find(value => value.clipId === card.clipId)
          return next ? [Math.abs(card.cocRadiusPx - next.cocRadiusPx), ...card.originalQuad.map(point => {
            const a = spatialTransform(source.camera.projectionWebGpu, spatialTransform(source.camera.view, point)); const b = spatialTransform(candidate.camera.projectionWebGpu, spatialTransform(candidate.camera.view, point))
            return Math.hypot((a[0] - b[0]) * localOutput.width / 2, (a[1] - b[1]) * localOutput.height / 2)
          })] : []
        }))
        if (error > .25) throw new SpatialEvaluationError([{ code: 'projection-residual', clipIds: [...removed], sequenceFrame: frame + subframe, message: '无法在普通世界目标曲线中保持当前取景或焦点；请保留目标或先解除对应相机绑定。', values: { maxProjectionOrCocErrorPx: error } }])
      }
      camera = baked
    }
    camera = mapSpatialCameraClock(camera, request.sequenceTimeMap.filter(map => map.sequenceId === sequenceId))
    spatialCameraSchema.parse(camera)
    if (sequenceId === composition.id) composition = { ...composition, spatialCamera: camera }
    if (composition.sequences?.some(sequence => sequence.id === sequenceId)) composition = { ...composition, sequences: composition.sequences.map(sequence => sequence.id === sequenceId ? { ...sequence, spatialCamera: camera } : sequence) }
  }
  request.signal.throwIfAborted()
  return { composition, facts }
}
