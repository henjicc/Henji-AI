import type { DirectorEasing, DirectorTarget, WebReplayDirector } from './director'
import { DirectorTimeline, type TimelineHold } from './directorTimeline'
import type { WebRecordingBehaviorEvent } from './schema'

/**
 * 把录制的行为轨与导演稿排成一条按输出时间先后的执行清单：录制事件、逐字输入、改写的鼠标移动、注入的操作、
 * 不出画面的页面帧，以及要出画面的帧。重演引擎只按清单逐条执行。
 *
 * 排序键（页面时间、类别、输出时间、登记顺序）：页面时间只增不减（剪掉的区间输出时间不动、
 * 页面时间前进；停住打字时录制时间不动、两者前进），同一刻先派发输入、再推进页面、最后出帧。
 */

/**
 * 页面帧的节奏（页面时间）。页面的帧回调、浏览器攒着的鼠标移动与滚轮都按渲染的次数走：画布的平滑、惯性与
 * 滚轮缩放按帧数计算，渲染次数随倍速变化，结果就随倍速变化。所以页面总按这个节奏渲染，与倍速、输出帧率无关；
 * 两个输出帧之间页面走过的每一格补一个不出画面的页面帧（advance），剪掉的区间也一样。
 * 只有恰好落在格点上的输出帧才执行页面回调，其他输出帧只采集画面，避免变速与剪辑接缝改变动画步长。
 */
export const PAGE_FRAME_US = 1e6 / 60
/** typewriter.at 与文字输入的录制时刻最多差这么多。 */
export const TYPEWRITER_MATCH_US = 300_000
/** clicks.at 与录制的按下时刻最多差这么多。 */
export const CLICK_MATCH_US = 500_000
/** 注入的点击按住多久。 */
const CLICK_PRESS_US = 80_000
/** 注入的滚动每步最多滚这么多（一格滚轮）。 */
const WHEEL_STEP_PX = 100

/** 鼠标位置：固定坐标、页面里解析的目标（anchor 序号），或一段滑动（glide 序号）上的进度 u。 */
export type PlanPoint = { x: number; y: number } | { anchor: number } | { glide: number; u: number }
export type GlideEnd = { x: number; y: number } | { anchor: number } | { pointer: true }
/** 一段滑动：两端在第一次用到时确定（pointer 是那时鼠标所在的位置），中间按缓动插值。 */
export interface PlanGlide { from: GlideEnd; to: GlideEnd; easing: DirectorEasing }

interface OpBase {
  outUs: number
  pageUs: number
  recUs: number
  /** false：在剪掉的区间里（照样执行，但不出现在版本里）。 */
  visible: boolean
  /** 导演稿里的哪一步，如 actions[2]（点击）；录制原样的操作没有。 */
  step?: string
}
export type PlanOp =
  /** point：改到这里发（不按录制的元素）；injected：导演稿注入的操作（目标找不到时跳过，不照录制发）。 */
  | (OpBase & { kind: 'event'; event: WebRecordingBehaviorEvent; point?: PlanPoint; injected?: boolean })
  | (OpBase & { kind: 'text'; text: string })
  | (OpBase & { kind: 'move'; point: PlanPoint })
  | (OpBase & { kind: 'advance' })
  | (OpBase & { kind: 'frame'; index: number; tick: boolean })

export interface DirectorPlan {
  timeline: DirectorTimeline
  ops: PlanOp[]
  anchors: DirectorTarget[]
  glides: PlanGlide[]
  /** 计划时发现的问题（没对上的打字、落在剪掉区间里的步骤等），重演结果里作为提醒。 */
  notes: string[]
  /** 导演稿每一步的说明，按 typewriter / pointer / clicks / actions 顺序。 */
  steps: string[]
}

export interface PlanInput {
  director?: WebReplayDirector | null
  events: readonly WebRecordingBehaviorEvent[]
  /** 录制长度加结尾留白（µs）。 */
  totalRecUs: number
  fps: number
  viewport: { width: number; height: number }
}

const us = (seconds: number): number => Math.round(seconds * 1e6)
const sec = (value: number): string => `${(value / 1e6).toFixed(1)} 秒`

export function easeValue(easing: DirectorEasing, u: number): number {
  const t = Math.min(1, Math.max(0, u))
  if (easing === 'ease-in') return t * t * t
  if (easing === 'ease-out') return 1 - (1 - t) ** 3
  if (easing === 'ease-in-out') return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
  return t
}

/** 确定的伪随机（打字节奏），同一份导演稿每次一样。 */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PAUSE_AFTER = /[，。！？、；：,.!?;:…]/
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * 一段文字拆成逐字输入：每个字（按字素，表情与组合字不拆开）的输出时刻，及打完后停住的总时长。
 * 字间隔 1 / charsPerSecond 秒，按 jitter 随机浮动；标点后停得久一点，换行更久。
 */
export function typewriterSchedule(text: string, charsPerSecond: number, jitter: number, seed: number): { chars: string[]; offsetsUs: number[]; durationUs: number } {
  const chars = Array.from(graphemeSegmenter.segment(text), part => part.segment)
  const random = seeded(seed)
  const base = 1e6 / charsPerSecond
  const offsetsUs: number[] = []
  let at = 0
  for (const char of chars) {
    offsetsUs.push(Math.round(at))
    const pause = char === '\n' ? 2.5 : PAUSE_AFTER.test(char) ? 2.2 : 1
    at += base * pause * (1 + jitter * (2 * random() - 1))
  }
  return { chars, offsetsUs, durationUs: Math.round(at) }
}

type Pointer = Extract<WebRecordingBehaviorEvent, { kind: 'pointer' }>
type Typed = Extract<WebRecordingBehaviorEvent, { kind: 'text' | 'paste' }>
const typedText = (event: Typed): string => (event.kind === 'text' ? event.data : event.files.length ? '' : event.text ?? '')

/** 鼠标改写：覆盖一段录制时间，期间录制的移动不发，改为每个页面帧按 at() 的位置移动。优先级高的盖过低的。 */
interface Override { fromUs: number; toUs: number; priority: number; order: number; step: string; at(recUs: number): PlanPoint }

export function planWebReplay(input: PlanInput): DirectorPlan {
  const director = input.director ?? null
  const events = input.events.map((event, index) => ({ event, index })).sort((a, b) => a.event.t - b.event.t || a.index - b.index).map(entry => entry.event)
  const notes: string[] = []
  const steps: string[] = []
  const anchors: DirectorTarget[] = []
  const glides: PlanGlide[] = []
  const point = (target: DirectorTarget): PlanPoint | { x: number; y: number } => {
    if (!target.selector && !target.text && target.x !== undefined && target.y !== undefined) return { x: target.x, y: target.y }
    anchors.push(target)
    return { anchor: anchors.length - 1 }
  }
  const glide = (from: GlideEnd, to: GlideEnd, easing: DirectorEasing): number => { glides.push({ from, to, easing }); return glides.length - 1 }

  // 录制的鼠标位置（某一刻之前最后一次），没有时用画面中心
  const pointers = events.filter((event): event is Pointer => event.kind === 'pointer')
  const recordedAt = (recUs: number): { x: number; y: number } => {
    let lo = 0, hi = pointers.length - 1, found = -1
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (pointers[mid].t <= recUs) { found = mid; lo = mid + 1 } else hi = mid - 1 }
    const event = pointers[found] ?? pointers[0]
    return event ? { x: event.x, y: event.y } : { x: input.viewport.width / 2, y: input.viewport.height / 2 }
  }

  // ---- 打字机：哪些文字输入拆成逐字
  const typing = new Map<Typed, { chars: string[]; offsetsUs: number[]; durationUs: number; step: string }>()
  director?.typewriter?.forEach((rule, k) => {
    const candidates = events.filter((event): event is Typed => (event.kind === 'text' || event.kind === 'paste') && typedText(event).length > 0 && !typing.has(event))
    const matched = rule.at === undefined ? candidates : candidates.filter(event => Math.abs(event.t - us(rule.at!)) <= TYPEWRITER_MATCH_US).sort((a, b) => Math.abs(a.t - us(rule.at!)) - Math.abs(b.t - us(rule.at!))).slice(0, 1)
    const step = `typewriter[${k}]（逐字打字）`
    steps.push(step)
    if (!matched.length) { notes.push(rule.at === undefined ? `${step}：录制里没有可以拆开的文字输入` : `${step}：${rule.at} 秒前后 0.3 秒内没有文字输入（带文件的粘贴不拆）`); return }
    for (const event of matched) typing.set(event, { ...typewriterSchedule(typedText(event), rule.charsPerSecond, rule.jitter, event.t ^ (k * 2654435761)), step })
  })

  // ---- 时间线
  const totalRecUs = Math.max(1, Math.round(input.totalRecUs))
  const holds: TimelineHold[] = [...typing].map(([event, plan]) => ({ recUs: event.t, durationUs: plan.durationUs, label: plan.step }))
  const { timeline, dropped } = DirectorTimeline.build({
    totalRecUs, fps: input.fps, rampUs: us(director?.timeline?.ramp ?? 0), holds,
    segments: director?.timeline?.segments.map(s => ({ fromUs: us(s.from), toUs: us(s.to), speed: s.speed })),
  })
  for (const hold of dropped) {
    for (const [event, plan] of typing) if (event.t === hold.recUs && plan.step === hold.label) typing.delete(event)
    notes.push(`${hold.label}：${sec(hold.recUs)}的文字输入不在留下的区间里，照原样一次输入`)
  }

  // ---- 鼠标改写与注入的操作
  const overrides: Override[] = []
  const injected: Array<{ event: WebRecordingBehaviorEvent; point: PlanPoint; step: string }> = []
  const retargets = new Map<Pointer, { point: PlanPoint; step: string }>()
  const toEnd = (value: PlanPoint): GlideEnd => ('glide' in value ? { pointer: true } : value)
  /**
   * 动作前从当前位置滑到 arrive、动作后从 leave 滑回录制轨迹：覆盖 [arriveUs - approach, leaveUs + approach] 的位置函数；
   * 动作期间（arriveUs 到 leaveUs）的位置由 during 给，默认停在 arrive。
   */
  const visit = (arrive: PlanPoint, leave: PlanPoint, arriveUs: number, leaveUs: number, approachUs: number, during?: (recUs: number) => PlanPoint): (recUs: number) => PlanPoint => {
    const toTarget = glide({ pointer: true }, toEnd(arrive), 'ease-in-out')
    const back = recordedAt(leaveUs + approachUs)
    const fromTarget = glide(toEnd(leave), back, 'ease-in-out')
    return recUs => {
      if (recUs < arriveUs) return approachUs > 0 ? { glide: toTarget, u: easeU(recUs, arriveUs - approachUs, arriveUs) } : arrive
      if (recUs < leaveUs) return during?.(recUs) ?? arrive
      if (recUs === leaveUs) return leave
      return approachUs > 0 ? { glide: fromTarget, u: easeU(recUs, leaveUs, leaveUs + approachUs) } : back
    }
  }

  director?.pointer?.forEach((range, k) => {
    const fromUs = us(range.from), toUs = us(range.to)
    const step = `pointer[${k}]（${range.mode === 'smooth' ? '平滑鼠标轨迹' : '按关键点移动鼠标'}）`
    steps.push(step)
    if (range.mode === 'smooth') {
      const keys = smoothKeyframes(pointers, fromUs, toUs, us(range.every), recordedAt)
      overrides.push({ fromUs, toUs, priority: 1, order: overrides.length, step, at: recUs => hermite(keys, recUs) })
      return
    }
    const points: Array<{ atUs: number; end: GlideEnd }> = [{ atUs: fromUs, end: recordedAt(fromUs) }]
    for (const p of range.points) points.push({ atUs: us(p.at), end: p.target ? toEnd(point(p.target)) : { x: p.x!, y: p.y! } })
    if (points.at(-1)!.atUs < toUs) points.push({ atUs: toUs, end: recordedAt(toUs) })
    const legs = points.slice(1).map((p, i) => ({ fromUs: points[i].atUs, toUs: p.atUs, glide: glide(points[i].end, p.end, range.easing) }))
    overrides.push({
      fromUs, toUs, priority: 1, order: overrides.length, step,
      at: recUs => {
        const leg = legs.find(l => recUs <= l.toUs) ?? legs.at(-1)!
        return { glide: leg.glide, u: leg.toUs > leg.fromUs ? (recUs - leg.fromUs) / (leg.toUs - leg.fromUs) : 1 }
      },
    })
  })

  director?.clicks?.forEach((click, k) => {
    const step = `clicks[${k}]（改点击位置）`
    steps.push(step)
    const atUs = us(click.at)
    const down = pointers.filter(e => e.type === 'down' && !retargets.has(e) && Math.abs(e.t - atUs) <= CLICK_MATCH_US).sort((a, b) => Math.abs(a.t - atUs) - Math.abs(b.t - atUs))[0]
    if (!down) { notes.push(`${step}：${click.at} 秒前后 0.5 秒内没有点击`); return }
    const up = pointers.find(e => e.type === 'up' && e.t >= down.t && e.button === down.button)
    const target = point(click.target)
    retargets.set(down, { point: target, step })
    if (up) retargets.set(up, { point: target, step })
    const approachUs = us(click.approach)
    const leaveUs = up?.t ?? down.t
    overrides.push({ fromUs: down.t - approachUs, toUs: leaveUs + approachUs, priority: 2, order: overrides.length, step, at: visit(target, target, down.t, leaveUs, approachUs) })
  })

  const pointerEvent = (t: number, type: 'down' | 'up' | 'move', button: number, buttons: number): Pointer => ({ kind: 'pointer', t: Math.round(t), type, x: 0, y: 0, button, buttons, clickCount: type === 'move' ? 0 : 1, pointerType: 'mouse', mods: 0 })
  const ACTION_NAMES = { click: '点击', hover: '悬停', scroll: '滚动', drag: '拖动', zoom: '缩放' } as const
  director?.actions?.forEach((action, k) => {
    const step = `actions[${k}]（${ACTION_NAMES[action.kind]}）`
    steps.push(step)
    const atUs = us(action.at)
    const approachUs = us(action.approach)
    const target = point(action.target)
    let leaveUs = atUs
    let leave = target
    let during: ((recUs: number) => PlanPoint) | undefined
    if (action.kind === 'click') {
      const button = action.button === 'right' ? 2 : 0
      injected.push({ event: pointerEvent(atUs, 'down', button, button === 2 ? 2 : 1), point: target, step }, { event: pointerEvent(atUs + CLICK_PRESS_US, 'up', button, 0), point: target, step })
      leaveUs = atUs + CLICK_PRESS_US
    } else if (action.kind === 'hover') {
      leaveUs = atUs + us(action.duration)
    } else if (action.kind === 'scroll' || action.kind === 'zoom') {
      const durationUs = us(action.duration)
      const count = action.kind === 'zoom' ? Math.abs(action.steps) : Math.max(1, Math.ceil(Math.max(Math.abs(action.dy), Math.abs(action.dx)) / WHEEL_STEP_PX))
      for (let i = 0; i < count; i += 1) {
        const t = atUs + (count > 1 ? durationUs * i / (count - 1) : 0)
        const wheel: WebRecordingBehaviorEvent = action.kind === 'zoom'
          ? { kind: 'wheel', t: Math.round(t), x: 0, y: 0, dx: 0, dy: action.steps > 0 ? -WHEEL_STEP_PX : WHEEL_STEP_PX, mods: 2 }
          : { kind: 'wheel', t: Math.round(t), x: 0, y: 0, dx: action.dx / count, dy: action.dy / count, mods: 0 }
        injected.push({ event: wheel, point: target, step })
      }
      leaveUs = atUs + durationUs
    } else {
      const durationUs = us(action.duration)
      const end = point(action.to)
      const drag = glide(toEnd(target), toEnd(end), 'ease-in-out')
      injected.push({ event: pointerEvent(atUs, 'down', 0, 1), point: target, step }, { event: pointerEvent(atUs + durationUs, 'up', 0, 0), point: end, step })
      leaveUs = atUs + durationUs
      leave = end
      during = recUs => ({ glide: drag, u: (recUs - atUs) / durationUs })
    }
    overrides.push({ fromUs: atUs - approachUs, toUs: leaveUs + approachUs, priority: 2, order: overrides.length, step, at: visit(target, leave, atUs, leaveUs, approachUs, during) })
    noteOverlaps(step, atUs - approachUs, leaveUs + approachUs)
  })
  function noteOverlaps(step: string, fromUs: number, toUs: number): void {
    const pressed = pointers.find(e => e.type !== 'move' && e.t >= fromUs && e.t <= toUs)
    if (pressed) notes.push(`${step}：与录制里 ${sec(pressed.t)}的点击重叠，那次点击照原样发出`)
    if (!timeline.placeRec(Math.max(0, fromUs)).visible && !timeline.placeRec(toUs).visible) notes.push(`${step}：落在剪掉的区间里，照样执行但版本里看不到`)
  }

  const overrideAt = (recUs: number): Override | null => {
    let best: Override | null = null
    for (const o of overrides) if (recUs >= o.fromUs && recUs <= o.toUs && (!best || o.priority > best.priority || (o.priority === best.priority && o.order > best.order))) best = o
    return best
  }

  // ---- 排出执行清单
  type Keyed = { op: PlanOp; phase: number; seq: number }
  const list: Keyed[] = []
  let seq = 0
  const push = (op: PlanOp, phase: number): void => { list.push({ op, phase, seq: seq++ }) }
  const placeEvent = (event: WebRecordingBehaviorEvent, extra: { point?: PlanPoint; step?: string; injected?: boolean }): void => {
    const place = timeline.placeRec(event.t)
    if (place.after) return
    push({ kind: 'event', event, outUs: place.outUs, pageUs: timeline.pageOfRec(event.t), recUs: event.t, visible: place.visible, ...extra }, 0)
  }

  for (const event of events) {
    const typed = (event.kind === 'text' || event.kind === 'paste') ? typing.get(event) : undefined
    if (typed) {
      const hold = timeline.pieces.find(p => p.kind === 'hold' && p.label === typed.step && p.recStartUs === event.t)
      if (hold) {
        typed.chars.forEach((char, i) => push({ kind: 'text', text: char, outUs: hold.outStartUs + typed.offsetsUs[i], pageUs: hold.pageStartUs + typed.offsetsUs[i], recUs: event.t, visible: true, step: typed.step }, 0))
        continue
      }
    }
    if (event.kind === 'pointer') {
      const retarget = retargets.get(event)
      if (retarget) { placeEvent(event, retarget); continue }
      if (event.type === 'move' && overrideAt(event.t)) continue
    }
    placeEvent(event, {})
  }
  for (const entry of injected) placeEvent(entry.event, { point: entry.point, step: entry.step, injected: true })

  // 每个页面帧（出画面的帧与不出画面的 advance）：改写的鼠标先移到这一刻的位置，再渲染
  let lastMove = ''
  for (const at of pageFrames(timeline)) {
    const override = at.tick ? overrideAt(at.recUs) : null
    if (override) {
      const position = override.at(at.recUs)
      const key = JSON.stringify(position)
      if (key !== lastMove) { push({ kind: 'move', point: position, outUs: at.outUs, pageUs: at.pageUs, recUs: at.recUs, visible: at.visible, step: override.step }, 0); lastMove = key }
    } else if (at.tick) lastMove = ''
    if (at.index === undefined) push({ kind: 'advance', outUs: at.outUs, pageUs: at.pageUs, recUs: at.recUs, visible: at.visible }, 1)
    else push({ kind: 'frame', index: at.index, tick: at.tick, outUs: at.outUs, pageUs: at.pageUs, recUs: at.recUs, visible: true }, 2)
  }
  // 改写区间的终点正好落在两帧之间时，补一步到终点
  for (const o of overrides) {
    const place = timeline.placeRec(o.toUs)
    if (!place.visible) continue
    push({ kind: 'move', point: o.at(o.toUs), outUs: place.outUs, pageUs: timeline.pageOfRec(o.toUs), recUs: o.toUs, visible: true, step: o.step }, 0)
  }

  // 格点与输出帧的浮点换算不同；先按录制精度的页面时刻排序，同刻输入始终在帧回调之前。
  list.sort((a, b) => a.op.pageUs - b.op.pageUs || a.phase - b.phase || a.op.outUs - b.op.outUs || a.seq - b.seq)
  return { timeline, ops: list.map(entry => entry.op), anchors, glides, notes, steps }
}

interface PageFrame { outUs: number; pageUs: number; recUs: number; visible: boolean; tick: boolean; /** 出画面的帧的序号；不出画面的页面帧没有。 */ index?: number }

/**
 * 页面回调只在固定格点执行；输出帧只在微秒取整后重合时才合并，避免输出采样改变页面的演进。
 * 页面时间与录制时间取整到微秒（与录制的时刻同一精度）：同一个页面时刻在各倍速下由不同的浮点算式得出，
 * 取整后才是同一个值，鼠标改写等按时刻判断的结果才不随倍速变。
 */
function pageFrames(timeline: DirectorTimeline): PageFrame[] {
  const frames: PageFrame[] = Array.from({ length: timeline.frames }, (_, index) => {
    const outUs = timeline.frameOutUs(index)
    const { recUs, pageUs } = timeline.at(outUs)
    return { index, outUs, recUs: Math.round(recUs), pageUs: Math.round(pageUs), visible: true, tick: false }
  })
  const list: PageFrame[] = []
  let next = 0
  // 最后一个输出帧之后的页面帧不影响版本，不排
  for (let n = 0; ; n += 1) {
    const gridUs = n * PAGE_FRAME_US
    const rounded = Math.round(gridUs)
    while (next < frames.length && frames[next].pageUs < rounded) list.push(frames[next++])
    if (next === frames.length) return list
    if (frames[next].pageUs === rounded) { list.push({ ...frames[next++], tick: true }); continue }
    // 输出位置按未取整的格点算，与输出帧（按帧序号算）一样，同一刻的事件在各倍速下排在它同一侧
    const place = timeline.placePage(gridUs)
    list.push({ outUs: place.outUs, pageUs: rounded, recUs: Math.round(timeline.recOfPage(gridUs)), visible: place.visible, tick: true })
  }
}

function easeU(recUs: number, fromUs: number, toUs: number): number {
  return toUs > fromUs ? Math.min(1, Math.max(0, (recUs - fromUs) / (toUs - fromUs))) : 1
}

interface Key { t: number; x: number; y: number }

/** 平滑轨迹的关键点：起止两端、每隔 every 取一次录制位置，再加上每次按下与松开（点击位置与时刻不变）。 */
function smoothKeyframes(pointers: readonly Pointer[], fromUs: number, toUs: number, everyUs: number, recordedAt: (recUs: number) => { x: number; y: number }): Key[] {
  const presses: Key[] = pointers.filter(e => e.type !== 'move' && e.t > fromUs && e.t < toUs).map(e => ({ t: e.t, x: e.x, y: e.y }))
  const samples: Key[] = []
  for (let t = fromUs; t < toUs; t += everyUs) samples.push({ t, ...recordedAt(t) })
  samples.push({ t: toUs, ...recordedAt(toUs) })
  // 紧挨着按下或松开的取样点让位给它，曲线在点击处不打折
  const near = (t: number): boolean => presses.some(p => Math.abs(p.t - t) < everyUs / 3)
  const keys = [...samples.filter((s, i) => i === 0 || i === samples.length - 1 || !near(s.t)), ...presses].sort((a, b) => a.t - b.t)
  return keys.filter((key, i) => i === 0 || key.t > keys[i - 1].t)
}

/** 按时间的三次 Hermite 曲线（切线取前后关键点的差分），穿过每个关键点。 */
function hermite(keys: readonly Key[], t: number): { x: number; y: number } {
  if (t <= keys[0].t) return { x: keys[0].x, y: keys[0].y }
  const last = keys.at(-1)!
  if (t >= last.t) return { x: last.x, y: last.y }
  let i = 0
  while (i < keys.length - 2 && keys[i + 1].t <= t) i += 1
  const a = keys[i], b = keys[i + 1]
  const before = keys[i - 1] ?? a, after = keys[i + 2] ?? b
  const h = b.t - a.t
  const s = (t - a.t) / h
  const tangent = (p: Key, q: Key, axis: 'x' | 'y'): number => (q.t > p.t ? (q[axis] - p[axis]) / (q.t - p.t) : 0)
  const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2
  const value = (axis: 'x' | 'y'): number => h00 * a[axis] + h10 * h * tangent(before, b, axis) + h01 * b[axis] + h11 * h * tangent(a, after, axis)
  return { x: Math.round(value('x') * 100) / 100, y: Math.round(value('y') * 100) / 100 }
}
