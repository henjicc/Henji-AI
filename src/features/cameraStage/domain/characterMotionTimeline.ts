/**
 * 角色动作时间线（纯函数，运行时编译产物，不进文件）。
 *
 * 状态关键帧里每张卡记着角色那一刻在做的动作（卡内动作），相邻两卡之间角色位置变了就是走跑。
 * 这里把它们排成一条按时间首尾相接的动作段：
 * - 走跑段的片段时间按走过的路程推进（距离匹配）：片段时间 = 起步相位 + 路程 ÷ 着地速度。原地走跑片段
 *   着地那只脚在模型里以着地速度往后扫，身体以同样的速度前进，脚就钉在地上；加减速、转弯都成立。
 *   有腾空的跑步片段只在着地段这样推进，腾空段按跑速缩短（见 runningCycle）。
 * - 原地转身用走路片段踩步，片段时间按转过的弧长推进。
 * - 其余段按时间推进；一次性动作做完后接 CHARACTER_CLIP_FOLLOW_UPS 里的后续动作，没有的停在最后一帧。
 * - 段与段之间交叉淡入淡出：新段在开头 CROSSFADE 秒内权重从 0 平滑升到 1，上一段继续推进并淡出。
 * 走跑段的朝向另编成一张表：沿实际轨迹的前进方向，起步和到达时平滑转向两端卡里的朝向。
 */

import {
  CAMERA_STAGE_DEFAULT_FPS,
  type StageCharacterHeadingEntry,
  type StageCharacterMotionSpan,
  type StageCharacterMotionTimeline,
  type StageSpatialMotion,
  type StageTrack,
} from './animationTypes'
import { getBodyVariant } from './bodyVariants'
import {
  CHARACTER_CLIP_FOLLOW_UPS,
  CHARACTER_JOG_MIN_SPEED,
  CHARACTER_MOVE_MIN_SPEED,
  characterClipFacts,
  isLocomotionClip,
  locomotionClipForSpeed,
  type StageCharacterAnimationClipName,
  type StageCharacterMotion,
} from './characterMotion'
import { sampleTrack } from './keyframeEngine'
import type { StageCharacterObject, StageVec3 } from './sceneTypes'
import { sampleSpatialMotion } from './spatialPath'
import type { StageStateKeyframeObjectState } from './stateKeyframeTypes'

/** 半帧（秒）：状态关键帧时刻按帧取整，判断动作做没做完时容差这么多 */
const FRAME_TOLERANCE = 0.5 / CAMERA_STAGE_DEFAULT_FPS
/** 动作之间交叉淡入淡出的时长（秒） */
export const CHARACTER_CROSSFADE_SECONDS = 0.3
/** 路程与朝向表的取样步长（秒） */
const GRID_STEP = 1 / 60
/** 前进方向取前后各这么多秒的位移，转弯处因此提前一点开始转身，也滤掉取样噪声 */
const HEADING_WINDOW = 0.2
/** 原地转身踩步：转过的角度（弧度）× 这个半径（米）当作走过的路程 */
const TURN_STEP_RADIUS = 0.25
/** 原地转身至少转这么多度才踩步 */
const TURN_STEP_MIN_DEGREES = 20
/** 走动的最短距离（米）；更短的位移按平移处理，不换走路动作 */
export const LOCOMOTION_MIN_DISTANCE = 0.05
/** 跑得最慢时腾空段至少保留片段原长的这么多（真实时间），腿不至于一闪而过 */
const FLIGHT_MIN_RATIO = 0.1

export interface CharacterMotionLayer {
  motion: StageCharacterMotion
  /** 片段内时间（秒）；姿态（pose）无意义 */
  clipTime: number
  weight: number
}

/** 一个角色在相邻两卡之间的过渡（编译器在写轨道时登记）。 */
export interface CharacterTransitionInterval {
  intervalIndex: number
  segStart: number
  segEnd: number
  fromState: StageStateKeyframeObjectState
  toState: StageStateKeyframeObjectState
  motionOverride?: StageCharacterMotion
}

interface BuildInput {
  character: StageCharacterObject
  keyframeTimes: number[]
  /** 每张卡里的卡内动作（缺快照的卡为 undefined） */
  keyframeMotions: Array<StageCharacterMotion | undefined>
  intervals: CharacterTransitionInterval[]
  tracks: StageTrack[]
  spatialMotions: StageSpatialMotion[]
}

function smoothStep(value: number): number {
  const x = Math.max(0, Math.min(1, value))
  return x * x * x * (10 + x * (-15 + 6 * x))
}

function normalizeAngle(angle: number): number {
  return ((angle + 180) % 360 + 360) % 360 - 180
}

function unwrapNear(angle: number, reference: number): number {
  return reference + normalizeAngle(angle - reference)
}

function sameMotion(a: StageCharacterMotion, b: StageCharacterMotion): boolean {
  return a.mode === b.mode && (a.mode === 'pose' || (b.mode === 'clip' && a.clipName === b.clipName && a.speed === b.speed))
}

/** 编译产物里某对象的位置：路径链优先，其余取轨道。 */
function positionSampler(objectId: string, base: StageVec3, tracks: StageTrack[], spatialMotions: StageSpatialMotion[]): (time: number) => StageVec3 {
  const motions = spatialMotions.filter((motion) => motion.objectId === objectId)
  const axisTracks = (['x', 'y', 'z'] as const).map((axis) => tracks.find((track) => track.objectId === objectId && track.propertyPath === `transform.position.${axis}`))
  return (time) => {
    for (const motion of motions) {
      const position = sampleSpatialMotion(motion, time)
      if (position) return position
    }
    const [x, y, z] = axisTracks.map((track, index) => {
      const value = track ? sampleTrack(track, time, 'scalar') : undefined
      return typeof value === 'number' ? value : [base.x, base.y, base.z][index]
    })
    return { x, y, z }
  }
}

function gridTimes(start: number, end: number): number[] {
  const count = Math.max(1, Math.ceil((end - start) / GRID_STEP))
  return Array.from({ length: count + 1 }, (_, index) => start + ((end - start) * index) / count)
}

function cumulative(values: number[]): number[] {
  const out = [0]
  for (let index = 1; index < values.length; index += 1) out.push(out[index - 1] + values[index])
  return out
}

/** 角色模型沿前进方向（局部 +Z）的总缩放：步幅跟着它放大缩小。 */
function forwardScale(character: StageCharacterObject, state: StageStateKeyframeObjectState): number {
  return Math.abs(getBodyVariant(character.variant).bodyScale.z * state.transform.scale.z) || 1
}

function locomotionClip(interval: CharacterTransitionInterval, averageSpeed: number): StageCharacterAnimationClipName {
  const override = interval.motionOverride
  if (override?.mode === 'clip' && isLocomotionClip(override.clipName)) return override.clipName
  return locomotionClipForSpeed(averageSpeed)
}

interface Built {
  spans: StageCharacterMotionSpan[]
  headings: StageCharacterHeadingEntry[]
}

/**
 * 有腾空的跑步片段一个周期里片段时间与路程的对应：等分取样点上的累计路程。
 * 着地时身体每片段秒前进 groundSpeed，脚钉在地上；腾空时每片段秒前进的路程按跑速定：
 * 真人跑慢时着地变长、腾空变短，步频变化不大。整段只按“路程 ÷ 着地速度”同比放慢的话，腾空也跟着拉长，
 * 动作库的慢跑（按约 5.9 米/秒制作、腾空约占周期三分之二）跑 3 米/秒时步频只剩每分钟约 65 步。
 * 腾空的真实时长从走跑交界的接近 0 线性长到原速时的片段原长；比原速还快时与着地段同比加快。
 */
function runningCycle(contact: readonly number[], duration: number, nativeGroundSpeed: number, groundSpeed: number, averageSpeed: number): { duration: number; distances: number[] } {
  const relative = averageSpeed / groundSpeed
  const transition = CHARACTER_JOG_MIN_SPEED / nativeGroundSpeed
  const flightRatio = Math.max(FLIGHT_MIN_RATIO, Math.min(1, (relative - transition) / (1 - transition)))
  const flightSpeed = Math.min(groundSpeed, averageSpeed * flightRatio)
  const step = duration / contact.length
  const distances = [0]
  for (let index = 0; index < contact.length; index += 1) {
    const weight = (contact[index] + contact[(index + 1) % contact.length]) / 2
    distances.push(distances[index] + step * (weight * groundSpeed + (1 - weight) * flightSpeed))
  }
  return { duration, distances }
}

type DistanceClock = Extract<StageCharacterMotionSpan['clock'], { kind: 'distance' }>

/** 跑步周期里片段时间（未取模）对应的累计路程。 */
function cycleDistanceAt(cycle: NonNullable<DistanceClock['cycle']>, clipTime: number): number {
  const total = cycle.distances[cycle.distances.length - 1]
  const laps = Math.floor(clipTime / cycle.duration)
  const position = ((clipTime - laps * cycle.duration) / cycle.duration) * (cycle.distances.length - 1)
  const index = Math.min(cycle.distances.length - 2, Math.floor(position))
  return laps * total + cycle.distances[index] + (cycle.distances[index + 1] - cycle.distances[index]) * (position - index)
}

/** 走跑段从起点走了 distance 米时的片段时间（未取模）。 */
function distanceClipTime(clock: DistanceClock, distance: number): number {
  const cycle = clock.cycle
  if (!cycle) return clock.startClipTime + distance / clock.groundSpeed
  const total = cycle.distances[cycle.distances.length - 1]
  const target = cycleDistanceAt(cycle, clock.startClipTime) + distance
  const laps = Math.floor(target / total)
  const remainder = target - laps * total
  let index = 0
  while (index < cycle.distances.length - 2 && cycle.distances[index + 1] <= remainder) index += 1
  const span = cycle.distances[index + 1] - cycle.distances[index]
  const fraction = span > 0 ? (remainder - cycle.distances[index]) / span : 0
  return laps * cycle.duration + ((index + fraction) / (cycle.distances.length - 1)) * cycle.duration
}

function distanceSpan(
  start: number,
  end: number,
  clipName: StageCharacterAnimationClipName,
  distances: number[],
  scale: number,
  kind: 'walk' | 'turn',
  pathLength: number,
): StageCharacterMotionSpan {
  const facts = characterClipFacts(clipName)!
  const groundSpeed = (facts.groundSpeed ?? 1) * scale
  const averageSpeed = end > start ? pathLength / (end - start) : 0
  const cycle = facts.groundContact && averageSpeed > 0
    ? runningCycle(facts.groundContact, facts.duration, facts.groundSpeed ?? 1, groundSpeed, averageSpeed)
    : undefined
  // 片段平均比原速快多少倍：一个周期的片段时长 ÷ 跑完这个周期路程的真实时间。
  const playbackRate = cycle ? (averageSpeed * cycle.duration) / cycle.distances[cycle.distances.length - 1] : averageSpeed / groundSpeed
  return {
    startTime: start,
    endTime: end,
    motion: { mode: 'clip', clipName, speed: 1 },
    clock: {
      kind: 'distance', startClipTime: (facts.leftStrikePhase ?? 0) * facts.duration, groundSpeed, gridStart: start,
      gridStep: (end - start) / Math.max(1, distances.length - 1), distances, ...(cycle ? { cycle } : {}),
    },
    locomotion: { kind, distance: pathLength, averageSpeed, playbackRate },
  }
}

/** 一次走跑的朝向表：沿前进方向，起步与到达时平滑转到两端卡里的朝向。 */
function headingTable(times: number[], positions: StageVec3[], fromYaw: number, toYaw: number): number[] {
  const window = Math.max(1, Math.round(HEADING_WINDOW / GRID_STEP))
  const raw: Array<number | null> = positions.map((_, index) => {
    const a = positions[Math.max(0, index - window)]
    const b = positions[Math.min(positions.length - 1, index + window)]
    const dx = b.x - a.x
    const dz = b.z - a.z
    return Math.hypot(dx, dz) < 1e-5 ? null : Math.atan2(dx, dz) * 180 / Math.PI
  })
  const firstValid = raw.find((value) => value !== null) ?? fromYaw
  const headings: number[] = []
  let previous = unwrapNear(firstValid, fromYaw)
  for (const value of raw) {
    previous = value === null ? previous : unwrapNear(value, previous)
    headings.push(previous)
  }
  const start = times[0]
  const end = times[times.length - 1]
  const startOffset = unwrapNear(fromYaw, headings[0]) - headings[0]
  const endOffset = unwrapNear(toYaw, headings[headings.length - 1]) - headings[headings.length - 1]
  // 转得越多转身越久：转 180° 约 0.9 秒，最多占这次走动的四成。
  const turnTime = (offset: number): number => Math.min(0.4 * (end - start), Math.max(0.2, (Math.abs(offset) / 180) * 0.9))
  const turnIn = turnTime(startOffset)
  const turnOut = turnTime(endOffset)
  return headings.map((heading, index) => {
    const time = times[index]
    return heading
      + startOffset * (1 - smoothStep((time - start) / turnIn))
      + endOffset * smoothStep((time - (end - turnOut)) / turnOut)
  })
}

/**
 * 一次性手势（挥手、出拳、拾取，做完会接后续动作）到 time 已经做完：同一张卡再记一次同样的手势就是再做一遍。
 * 还在做、循环动作、做完停在最后一帧的动作（倒地）都算接着做。
 */
function gestureFinishedBy(span: StageCharacterMotionSpan, time: number): boolean {
  const motion = span.motion
  if (motion.mode !== 'clip' || span.clock.kind !== 'time' || !CHARACTER_CLIP_FOLLOW_UPS[motion.clipName]) return false
  const facts = characterClipFacts(motion.clipName)
  // 卡的时刻按帧取整，片段时长量到毫秒，常比整帧略长（出拳 0.867 秒，26 帧是 0.8667）：差半帧以内算做完。
  return !!facts && !facts.loop && time >= span.clock.origin + facts.duration / Math.max(0.1, span.clock.rate) - FRAME_TOLERANCE
}

function buildSpans(input: BuildInput): Built {
  const { character, keyframeTimes, keyframeMotions, intervals } = input
  const fallback = character.motion
  const spans: StageCharacterMotionSpan[] = []
  const headings: StageCharacterHeadingEntry[] = []
  // 只有真的走动或转身时才去找这个角色的轨道与路径链（人群里大多数角色一直站着）。
  let sampler: ((time: number) => StageVec3) | null = null
  const position = (time: number): StageVec3 => {
    sampler ??= positionSampler(character.id, character.transform.position, input.tracks, input.spatialMotions)
    return sampler(time)
  }
  const yawTrackOf = (): StageTrack | undefined => input.tracks.find((track) => track.objectId === character.id && track.propertyPath === 'transform.rotation.y')

  /** 新段与上一段同一时刻开始时替换掉上一段：零长的段会在淡入淡出里冒一下。 */
  const push = (span: StageCharacterMotionSpan): void => {
    const last = spans[spans.length - 1]
    if (last && Math.abs(last.startTime - span.startTime) <= 1e-6) spans.pop()
    spans.push(span)
  }
  const pushHeld = (motion: StageCharacterMotion, start: number): void => {
    const last = spans[spans.length - 1]
    if (last && !last.locomotion && sameMotion(last.motion, motion) && !gestureFinishedBy(last, start)) return
    push({ startTime: start, endTime: Infinity, motion, clock: { kind: 'time', origin: start, rate: motion.mode === 'clip' ? motion.speed : 1 } })
  }
  /** 走到一张卡又接着走（途经卡）时不在卡上停：到达后的卡内动作等确认下一段不接着走再放。 */
  let arrival: { motion: StageCharacterMotion; time: number } | null = null
  const flushArrival = (): void => {
    if (arrival) pushHeld(arrival.motion, arrival.time)
    arrival = null
  }

  /** 这一段过渡里角色走跑或原地转身时的动作段（与朝向表）；不动时为 null。 */
  const movementSpan = (interval: CharacterTransitionInterval | undefined): StageCharacterMotionSpan | null => {
    if (!interval || !(interval.segEnd - interval.segStart > 1e-3)) return null
    const { segStart, segEnd, fromState, toState } = interval
    const moved = Math.hypot(toState.transform.position.x - fromState.transform.position.x, toState.transform.position.z - fromState.transform.position.z) > 1e-4
      || (interval.motionOverride !== undefined)
    const turned = Math.abs(normalizeAngle(toState.transform.rotation.y - fromState.transform.rotation.y)) >= TURN_STEP_MIN_DEGREES
    // 两端位置相同、没怎么转的过渡不取样（路径也可能绕一圈回原地，所以有路径链时照样取样）。
    if (!moved && !turned && !input.spatialMotions.some((motion) => motion.objectId === character.id && motion.segments.some((segment) => segment.startTime < segEnd && segment.endTime > segStart))) return null
    const times = gridTimes(segStart, segEnd)
    const positions = times.map(position)
    const steps = positions.map((point, step) => (step === 0 ? 0 : Math.hypot(point.x - positions[step - 1].x, point.z - positions[step - 1].z)))
    const distances = cumulative(steps)
    const pathLength = distances[distances.length - 1]
    const scale = forwardScale(character, fromState)
    const override = interval.motionOverride
    if (pathLength >= LOCOMOTION_MIN_DISTANCE && pathLength / (segEnd - segStart) >= CHARACTER_MOVE_MIN_SPEED) {
      headings.push({ objectId: character.id, startTime: segStart, endTime: segEnd, gridStep: (segEnd - segStart) / (times.length - 1), yaws: headingTable(times, positions, fromState.transform.rotation.y, toState.transform.rotation.y) })
      return override && !(override.mode === 'clip' && isLocomotionClip(override.clipName))
        // 指定了非走跑动作（游泳、推、姿态）时照指定的播放，按时间推进。
        ? { startTime: segStart, endTime: segEnd, motion: override, clock: { kind: 'time', origin: segStart, rate: override.mode === 'clip' ? override.speed : 1 } }
        : distanceSpan(segStart, segEnd, locomotionClip(interval, pathLength / (segEnd - segStart)), distances, scale, 'walk', pathLength)
    }
    const yawTrack = !override && Math.abs(normalizeAngle(toState.transform.rotation.y - fromState.transform.rotation.y)) >= TURN_STEP_MIN_DEGREES ? yawTrackOf() : undefined
    if (yawTrack) {
      const yaws = times.map((time) => Number(sampleTrack(yawTrack, time, 'scalar') ?? fromState.transform.rotation.y))
      const arcs = cumulative(yaws.map((yaw, step) => (step === 0 ? 0 : Math.abs(yaw - yaws[step - 1]) * Math.PI / 180 * TURN_STEP_RADIUS)))
      return distanceSpan(segStart, segEnd, 'Walk_Loop', arcs, scale, 'turn', arcs[arcs.length - 1])
    }
    return null
  }

  pushHeld(keyframeMotions[0] ?? fallback, 0)
  for (let index = 0; index < keyframeTimes.length; index += 1) {
    const interval = intervals.find((item) => item.intervalIndex === index)
    let span = movementSpan(interval)
    const pending = arrival as { motion: StageCharacterMotion; time: number } | null
    if (!(pending && span && Math.abs(span.startTime - pending.time) <= 1e-4)) {
      flushArrival()
      if (index > 0) pushHeld(keyframeMotions[index] ?? fallback, keyframeTimes[index])
    }
    arrival = null
    if (!span || !interval) continue
    // 紧接上一段同一个走跑片段（途经卡、走到后原地转身）：步伐相位接着走，不淡入淡出。
    const previous = spans[spans.length - 1]
    if (previous && previous.clock.kind === 'distance' && span.clock.kind === 'distance' && Math.abs(previous.endTime - span.startTime) <= 1e-4
      && previous.motion.mode === 'clip' && span.motion.mode === 'clip' && previous.motion.clipName === span.motion.clipName) {
      const clock = previous.clock
      span = { ...span, continuesPrevious: true, clock: { ...span.clock, startClipTime: distanceClipTime(clock, clock.distances[clock.distances.length - 1]) } }
    }
    push(span)
    arrival = { motion: interval.toState.motion ?? fallback, time: interval.segEnd }
  }
  flushArrival()

  for (let index = 0; index < spans.length; index += 1) spans[index].endTime = spans[index + 1]?.startTime ?? Infinity
  return { spans: expandFollowUps(spans), headings }
}

/** 一次性动作做完接后续动作：坐下之后坐着、挥手之后待机。接出来的动作与下一张卡记的相同时接着做，不重新开始。 */
function expandFollowUps(spans: StageCharacterMotionSpan[]): StageCharacterMotionSpan[] {
  const out: StageCharacterMotionSpan[] = []
  const pushSpan = (span: StageCharacterMotionSpan): void => {
    const last = out[out.length - 1]
    if (last && !last.locomotion && !span.locomotion && sameMotion(last.motion, span.motion) && !gestureFinishedBy(last, span.startTime)) {
      last.endTime = span.endTime
      return
    }
    out.push(span)
  }
  for (const span of spans) {
    // 卡上记的动作与刚接出来的后续动作相同（在后续动作中途插了卡）：并进去，按原来的起点接着往下接。
    const last = out[out.length - 1]
    const continuing = last && !last.locomotion && !span.locomotion && sameMotion(last.motion, span.motion) && !gestureFinishedBy(last, span.startTime)
    let current = continuing ? out.pop()! : span
    if (continuing) current = { ...current, endTime: span.endTime }
    for (let guard = 0; guard < 4; guard += 1) {
      const motion = current.motion
      if (motion.mode !== 'clip' || current.clock.kind !== 'time') break
      const facts = characterClipFacts(motion.clipName)
      const next = CHARACTER_CLIP_FOLLOW_UPS[motion.clipName]
      if (!facts || facts.loop || !next) break
      const doneAt = current.clock.origin + facts.duration / Math.max(0.1, current.clock.rate)
      if (!(doneAt < current.endTime - 1e-3)) break
      pushSpan({ ...current, endTime: doneAt })
      current = { startTime: doneAt, endTime: current.endTime, motion: { mode: 'clip', clipName: next, speed: 1 }, clock: { kind: 'time', origin: doneAt, rate: 1 } }
    }
    pushSpan(current)
  }
  return out
}

export function buildCharacterMotionTimeline(input: BuildInput): { timeline: StageCharacterMotionTimeline; headings: StageCharacterHeadingEntry[] } {
  const { spans, headings } = buildSpans(input)
  return { timeline: { objectId: input.character.id, spans }, headings }
}

function interpolateGrid(values: number[], start: number, step: number, time: number): number {
  if (values.length === 0) return 0
  if (!(step > 0)) return values[values.length - 1]
  const position = (time - start) / step
  if (position <= 0) return values[0]
  if (position >= values.length - 1) return values[values.length - 1]
  const index = Math.floor(position)
  const fraction = position - index
  return values[index] + (values[index + 1] - values[index]) * fraction
}

/** 段在 time 时刻的片段内时间：循环片段取模，一次性片段停在最后一帧。 */
export function spanClipTime(span: StageCharacterMotionSpan, time: number): number {
  const motion = span.motion
  if (motion.mode !== 'clip') return 0
  const facts = characterClipFacts(motion.clipName)
  const duration = facts?.duration ?? 1
  const raw = span.clock.kind === 'distance'
    ? distanceClipTime(span.clock, interpolateGrid(span.clock.distances, span.clock.gridStart, span.clock.gridStep, time))
    : Math.max(0, time - span.clock.origin) * span.clock.rate
  if (facts && !facts.loop) return Math.min(raw, Math.max(0, duration - 1e-4))
  return ((raw % duration) + duration) % duration
}

function findSpanIndex(spans: StageCharacterMotionSpan[], time: number): number {
  let index = 0
  while (index < spans.length - 1 && time >= spans[index + 1].startTime) index += 1
  return index
}

/**
 * time 时刻要播的动作层：当前段，以及在淡入期间仍在淡出的上一段。没有时间线（场景没有状态关键帧）时
 * 播放对象本身的动作。权重和为 1。
 */
export function resolveCharacterMotionLayers(
  timeline: StageCharacterMotionTimeline | undefined,
  time: number,
  fallback: StageCharacterMotion,
): CharacterMotionLayer[] {
  const spans = timeline?.spans.length ? timeline.spans : [{ startTime: 0, endTime: Infinity, motion: fallback, clock: { kind: 'time' as const, origin: 0, rate: fallback.mode === 'clip' ? fallback.speed : 1 } }]
  const index = findSpanIndex(spans, time)
  const current = spans[index]
  const layer = (span: StageCharacterMotionSpan, weight: number): CharacterMotionLayer => ({ motion: span.motion, clipTime: spanClipTime(span, time), weight })
  const previous = spans[index - 1]
  if (!previous || time < current.startTime || current.continuesPrevious) return [layer(current, 1)]
  const fade = Math.min(CHARACTER_CROSSFADE_SECONDS, Number.isFinite(current.endTime) ? current.endTime - current.startTime : CHARACTER_CROSSFADE_SECONDS)
  const weight = fade > 1e-4 ? smoothStep((time - current.startTime) / fade) : 1
  if (weight >= 1) return [layer(current, 1)]
  return [layer(current, weight), layer(previous, 1 - weight)]
}

/** 走跑期间按朝向表求朝向（度）；不在任何走跑段内返回 undefined。 */
export function sampleCharacterHeading(entries: readonly StageCharacterHeadingEntry[] | undefined, objectId: string, time: number): number | undefined {
  if (!entries) return undefined
  for (const entry of entries) {
    if (entry.objectId !== objectId || time < entry.startTime || time > entry.endTime) continue
    return interpolateGrid(entry.yaws, entry.startTime, entry.gridStep, time)
  }
  return undefined
}

/**
 * time 时刻角色“站着时在做的动作”，也就是在这一刻插一张状态关键帧应当记下的卡内动作：
 * 走跑或转身踩步时取走动前在做的动作。没有时间线时返回 undefined。
 */
export function heldCharacterMotionAt(timeline: StageCharacterMotionTimeline | undefined, time: number): StageCharacterMotion | undefined {
  if (!timeline?.spans.length) return undefined
  for (let index = findSpanIndex(timeline.spans, time); index >= 0; index -= 1) {
    const span = timeline.spans[index]
    if (!span.locomotion) return span.motion
  }
  return undefined
}

export function sameCharacterMotion(a: StageCharacterMotion, b: StageCharacterMotion): boolean {
  return sameMotion(a, b)
}

/** time 时刻在做哪一段（读回用）。 */
export function characterMotionSpanAt(timeline: StageCharacterMotionTimeline | undefined, time: number): StageCharacterMotionSpan | undefined {
  if (!timeline?.spans.length) return undefined
  return timeline.spans[findSpanIndex(timeline.spans, time)]
}
