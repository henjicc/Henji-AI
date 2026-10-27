import type { DirectorTarget } from '../../../../../src/core/webReplay/director'
import { easeValue, type DirectorPlan, type PlanOp, type PlanPoint } from '../../../../../src/core/webReplay/directorPlan'
import type { WebRecordingBehaviorEvent } from '../../../../../src/core/webReplay/schema'
import type { InputDispatcher } from './input'

type Point = { x: number; y: number }

function describeTarget(target: DirectorTarget): string {
  return [target.selector && `选择器 ${target.selector}`, target.text && `文字“${target.text}”`, target.index ? `第 ${target.index + 1} 个` : ''].filter(Boolean).join('、') || `坐标 ${target.x}, ${target.y}`
}

/**
 * Carries out a replay plan's input: recorded events (some moved to a director target), typed characters and rewritten
 * pointer paths. Targets are found in the page when first needed (and kept), a glide's ends when it starts (`pointer`:
 * where the pointer is then).
 */
export class DirectorInput {
  misses = 0
  private readonly anchors = new Map<number, Point>()
  private readonly glides = new Map<number, { from: Point; to: Point }>()
  private readonly missed = new Set<number>()

  constructor(
    private readonly plan: DirectorPlan,
    private readonly input: InputDispatcher,
    private readonly resolve: (target: DirectorTarget) => Promise<Point | null>,
    private readonly warn: (message: string, pageUs: number, step: string | undefined) => void,
  ) {}

  private async anchor(id: number, op: { pageUs: number; step?: string }): Promise<Point | null> {
    const known = this.anchors.get(id)
    if (known) return known
    const target = this.plan.anchors[id]
    const point = await this.resolve(target)
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) { this.anchors.set(id, point); return point }
    this.misses += 1
    if (!this.missed.has(id)) { this.missed.add(id); this.warn(`页面里没找到目标（${describeTarget(target)}），用到它的这一步没有执行`, op.pageUs, op.step) }
    return null
  }

  private async point(spec: PlanPoint, op: { pageUs: number; step?: string }): Promise<Point | null> {
    if ('x' in spec) return spec
    if ('anchor' in spec) return this.anchor(spec.anchor, op)
    let ends = this.glides.get(spec.glide)
    if (!ends) {
      const glide = this.plan.glides[spec.glide]
      const end = async (value: typeof glide.from): Promise<Point | null> => ('pointer' in value ? this.input.position : 'anchor' in value ? this.anchor(value.anchor, op) : value)
      const from = await end(glide.from), to = await end(glide.to)
      if (!from || !to) return null
      ends = { from, to }
      this.glides.set(spec.glide, ends)
    }
    const u = easeValue(this.plan.glides[spec.glide].easing, spec.u)
    return { x: ends.from.x + (ends.to.x - ends.from.x) * u, y: ends.from.y + (ends.to.y - ends.from.y) * u }
  }

  /**
   * Dispatches one input op. Returns where pointer input landed (null for other input), or undefined when the op was
   * skipped: an injected step whose target is not in the page. A recorded click moved to a missing target goes where
   * it was recorded.
   */
  async dispatch(op: Exclude<PlanOp, { kind: 'frame' | 'advance' }>): Promise<Point | null | undefined> {
    if (op.kind === 'text') { await this.input.insertText(op.text); return null }
    if (op.kind === 'move') {
      const point = await this.point(op.point, op)
      if (!point) return undefined
      await this.input.moveTo(point.x, point.y)
      return point
    }
    if (!op.point) return this.input.dispatch(op.event)
    const point = await this.point(op.point, op)
    if (!point) return op.injected ? undefined : this.input.dispatch(op.event)
    const event = op.event
    if (event.kind !== 'pointer' && event.kind !== 'wheel') return this.input.dispatch(event)
    const { target: _recorded, ...placed } = event
    return this.input.dispatch({ ...placed, x: point.x, y: point.y } as WebRecordingBehaviorEvent)
  }
}

/**
 * A take's own behavior track, on the output clock: what actually reached the page where it landed (rewritten paths,
 * moved clicks, typed characters). Input inside a cut is not in the take; where the pointer ended up there is, as a
 * move at the seam. The editor redraws the pointer and clicks from this, as from a recording's behavior track.
 */
export class TakeTrack {
  private readonly list: WebRecordingBehaviorEvent[] = []
  private seam = false

  constructor(private readonly input: InputDispatcher) {}

  private move(t: number, point: Point): void {
    this.list.push({ kind: 'pointer', t, type: 'move', x: point.x, y: point.y, button: -1, buttons: this.input.pressed, clickCount: 0, pointerType: 'mouse', mods: 0 })
  }

  private flushSeam(t: number): void {
    if (!this.seam) return
    this.seam = false
    this.move(t, this.input.position)
  }

  record(op: Exclude<PlanOp, { kind: 'frame' | 'advance' }>, landed: Point | null): void {
    const t = Math.max(0, Math.round(op.outUs))
    if (!op.visible) {
      if (op.kind === 'move' || (op.kind === 'event' && (op.event.kind === 'pointer' || op.event.kind === 'drop'))) this.seam = true
      // The picture's size changes at the seam: later positions scale by it.
      if (op.kind === 'event' && op.event.kind === 'resize') this.list.push({ ...op.event, t })
      return
    }
    this.flushSeam(t)
    if (op.kind === 'text') { this.list.push({ kind: 'text', t, data: op.text }); return }
    if (op.kind === 'move') { if (landed) this.move(t, landed); return }
    const event = op.event
    if ((event.kind === 'pointer' || event.kind === 'wheel' || event.kind === 'drop') && landed) {
      if (op.point) { const { target: _recorded, ...placed } = event; this.list.push({ ...placed, t, x: landed.x, y: landed.y } as WebRecordingBehaviorEvent); return }
      this.list.push({ ...event, t, x: landed.x, y: landed.y })
      return
    }
    this.list.push({ ...event, t })
  }

  /** A captured frame: the pointer's place after a cut shows from here. */
  frame(op: Extract<PlanOp, { kind: 'frame' }>): void { this.flushSeam(Math.max(0, Math.round(op.outUs))) }

  events(durationUs: number): WebRecordingBehaviorEvent[] {
    return this.list.filter(event => event.t <= durationUs)
  }
}
