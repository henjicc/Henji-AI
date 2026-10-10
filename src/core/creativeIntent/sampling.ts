import { clockEventIssue, refKey, sampleSchema, type MotionDraft, type MotionSample, type MotionPin, type MotionTarget, type Pose } from './contracts'

export class CreativeIntentError extends Error {
  constructor(public readonly code: string, public readonly refs: readonly string[], message: string) { super(message); this.name = 'CreativeIntentError' }
}
export interface ComputationControl { cancelled?: () => boolean; checkpoint?: () => Promise<void> }
export function checkCancelled(control: ComputationControl): void {
  if (control.cancelled?.()) throw new CreativeIntentError('cancelled', [], '计算已取消，原稿保留')
}
export interface FramePose { frame: number; pose: Pose; sampleIds: string[]; hard: boolean }
export interface PreparedTake { takeId: string; target: MotionTarget; points: FramePose[]; pins: { pin: MotionPin; point: FramePose }[] }

/** Input stays in wall order; only a selected monotonic demonstration is sorted for compilation. */
export function prepareMotionTakes(draft: MotionDraft, raw: readonly MotionSample[], selectedTakeIds?: readonly string[], control: ComputationControl = {}): PreparedTake[] {
  const takes = new Map(draft.takes.map(t => [t.id, t])); const targets = new Map(draft.targets.map(t => [refKey(t.ref), t]))
  const clocks = new Map(draft.clockSegments.map(s => [s.id, s]))
  const brokenTakes = new Set(draft.takes.filter(t => draft.clockSegments.some(c => c.mode === 'gap' && c.monoSpanUs[0] < t.monoSpanUs[1] && c.monoSpanUs[1] > t.monoSpanUs[0] || c.mode === 'seek' && c.monoSpanUs[0] > t.monoSpanUs[0] && c.monoSpanUs[0] < t.monoSpanUs[1])).map(t => t.id))
  const selected = selectedTakeIds && new Set(selectedTakeIds)
  if (selected?.size !== selectedTakeIds?.length || selected && [...selected].some(id => !takes.has(id))) throw new CreativeIntentError('take-selection', selectedTakeIds ?? [], '采用的示范段不存在或重复')
  const bySample = new Map<string, MotionSample>(); const groups = new Map<string, MotionSample[]>()
  let lastSeq = -1; let lastMono = -1
  for (let i = 0; i < raw.length; i++) {
    if (i % 256 === 0) checkCancelled(control)
    const s = sampleSchema.parse(raw[i]); const t = takes.get(s.takeRef); const target = targets.get(refKey(s.targetRef))
    if (!t || !target || bySample.has(s.sampleId) || s.seq <= lastSeq || s.monoUs < lastMono) throw new CreativeIntentError('sample-order-or-ref', [s.sampleId], '原稿乱序、身份重复或引用无效')
    lastSeq = s.seq; lastMono = s.monoUs; bySample.set(s.sampleId, s)
    const clockIssue = clockEventIssue(s, clocks)
    if (clockIssue) throw new CreativeIntentError('sample-clock', [s.sampleId, s.clockSegmentRef], clockIssue)
    if (s.monoUs < t.monoSpanUs[0] || s.monoUs > t.monoSpanUs[1]) throw new CreativeIntentError('take-clock', [s.sampleId, t.id], '采样不属于示范墙钟区间')
    if (draft.mode === 'static' && s.timeline !== null) throw new CreativeIntentError('static-timeline', [s.sampleId], '图片没有时间轴')
    if (s.timeline && (s.timeline.visitRef !== t.visitRef || !t.timelineRange || s.timeline.frame < Math.min(...t.timelineRange) || s.timeline.frame > Math.max(...t.timelineRange))) throw new CreativeIntentError('take-visit', [s.sampleId, t.id], '访问身份或时间轴超出示范段')
    if (t.intent !== 'demonstrate' || selected && !selected.has(t.id) || !s.confirmed) continue
    if (brokenTakes.has(t.id)) throw new CreativeIntentError('take-gap', [t.id], '采集缺口或跳转须拆示范段，不补造路径')
    if (s.quality !== 'presented' || s.timeline === null) throw new CreativeIntentError('missing-presentation', [s.sampleId], '动画必须采用实际呈现帧，不能按墙钟推算')
    if (s.gestureKind === 'path' && !t.pathDemonstration) throw new CreativeIntentError('unconfirmed-path', [s.sampleId], '纯指针比划须先确认路径示范')
    const key = JSON.stringify([t.id, refKey(s.targetRef)]); const group = groups.get(key) ?? []; group.push(s); groups.set(key, group)
  }
  for (const pin of draft.pins) {
    const s = bySample.get(pin.sampleId)
    if (!s || refKey(s.targetRef) !== refKey(pin.targetRef)) throw new CreativeIntentError('pin-ref', [pin.id, pin.sampleId], '钉住点必须关联原稿采样和目标')
    const target = targets.get(refKey(pin.targetRef))
    if (!target || pin.properties.some(p => !target.editable.includes(p))) throw new CreativeIntentError('pin-property', [pin.id], '钉住属性不在目标可编辑域')
  }
  const output: PreparedTake[] = []
  const pinGroups = new Map<string, MotionPin[]>()
  for (const pin of draft.pins) {
    const sample = bySample.get(pin.sampleId)!
    const key = JSON.stringify([sample.takeRef, refKey(pin.targetRef)]); const list = pinGroups.get(key) ?? []; list.push(pin); pinGroups.set(key, list)
  }
  for (const samples of groups.values()) {
    const t = takes.get(samples[0].takeRef)!; const target = targets.get(refKey(samples[0].targetRef))!
    const frames = new Map<number, FramePose>(); let lastFrame: number | undefined
    const pins = pinGroups.get(JSON.stringify([t.id, refKey(target.ref)])) ?? []
    for (const s of samples) {
      const f = s.timeline!.frame
      if (lastFrame !== undefined && (t.direction === 0 && f !== lastFrame || t.direction === 1 && f < lastFrame || t.direction === -1 && f > lastFrame)) throw new CreativeIntentError('take-direction', [t.id, s.sampleId], '跳转或方向变化须拆成示范段')
      lastFrame = f
      const previous = frames.get(f)
      if (previous) { previous.pose = structuredClone(s.pose); previous.sampleIds.push(s.sampleId); previous.hard ||= s.event !== 'sample' }
      else frames.set(f, { frame: f, pose: structuredClone(s.pose), sampleIds: [s.sampleId], hard: s.event !== 'sample' })
    }
    // Required equalities are resolved before fitting; ordinary same-frame confirmations never override pins.
    const locked = new Map<string, { value: string; pinId: string }>()
    for (const pin of pins) {
      const s = bySample.get(pin.sampleId)!; const point = frames.get(s.timeline!.frame)!
      if (pin.valueLocked) for (const property of pin.properties) {
        const key = JSON.stringify([point.frame, property]); const value = JSON.stringify(s.pose[property]); const old = locked.get(key)
        if (old && old.value !== value) throw new CreativeIntentError('pin-conflict', [old.pinId, pin.id], '同帧硬姿态冲突；请解钉或修改时间')
        locked.set(key, { value, pinId: pin.id })
        Object.assign(point.pose, { [property]: structuredClone(s.pose[property]) })
      }
      point.hard = true
    }
    const points = [...frames.values()].sort((a, b) => a.frame - b.frame)
    // A gap is not a path. Caller supplies separate sealed takes; sparse placed poses are legal.
    let dwellStart = -1
    points.forEach((p, i) => {
      const stationary = i > 0 && JSON.stringify(p.pose) === JSON.stringify(points[i - 1].pose)
      if (stationary && dwellStart < 0) dwellStart = i - 1
      if (dwellStart >= 0 && (!stationary || i === points.length - 1)) {
        points[dwellStart].hard = true; points[stationary ? i : i - 1].hard = true; dwellStart = -1
      }
    })
    if (points.length) { points[0].hard = true; points[points.length - 1].hard = true }
    output.push({ takeId: t.id, target, points, pins: pins.map(pin => ({ pin, point: frames.get(bySample.get(pin.sampleId)!.timeline!.frame)! })) })
  }
  // Even with explicit take selection, all hard pins remain binding. No silent unpinning.
  for (const pin of draft.pins) if (!output.some(t => t.pins.some(p => p.pin.id === pin.id))) throw new CreativeIntentError('excluded-pin', [pin.id], '选择示范段排除了钉住点，请确认解钉或采用该段')
  const previousByTarget = new Map<string, PreparedTake>()
  for (const a of [...output].sort((a, b) => a.points[0].frame - b.points[0].frame)) {
    const key = refKey(a.target.ref); const b = previousByTarget.get(key)
    if (b && a.points[0].frame <= b.points[b.points.length - 1].frame) throw new CreativeIntentError('revisit', [b.takeId, a.takeId], '重访示范区间重叠；请选择采用哪次示范')
    previousByTarget.set(key, a)
  }
  return output
}

/** Wrapped acquisition angles are explicit; unwrapped turns never lose intentional complete rotations. */
export function unwrapRotationTurns(values: readonly number[], previousTurns?: number): number[] {
  if (!values.every(v => Number.isFinite(v) && v >= -.5 && v <= .5) || previousTurns !== undefined && !Number.isFinite(previousTurns)) throw new CreativeIntentError('rotation', [], '传感器角度须在半圈域；完整展开角不可再次 unwrap')
  const result: number[] = []
  values.forEach((v, i) => { const previous = i === 0 ? previousTurns : result[i - 1]; result.push(previous === undefined ? v : v + Math.round(previous - v)) })
  return result
}
