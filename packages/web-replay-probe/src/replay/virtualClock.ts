/**
 * Lockstep page clock for replay. Page time (performance.now, Date, timers, idle callbacks, animation
 * frames, Web Animations, event timestamps) moves only when the engine advances it, so every captured frame shows
 * exactly the recorded moment however long capturing it takes, and the replay may run faster or slower
 * than the wall clock without any frame running ahead of its time.
 *
 * Built on two mature ideas rather than browser virtual time (which Electron cannot pair with
 * deterministic frames): the ordered fake timers of @sinonjs/fake-timers (the clock behind Playwright's
 * `page.clock`), with a real macrotask between timers so promise jobs run in order, and timeweb's way of
 * driving Web Animations (CSS animations and transitions included): native playback rate 0, seek the
 * current time on every frame, restore the rate and `finish()` at the end so the browser still fires
 * finish/animationend/transitionend.
 */

interface Timer { id: number; due: number; seq: number; handler: TimerHandler; args: unknown[]; interval: number | null; nesting: number }

/** Longest idle period browsers give an idle callback (the requestIdleCallback spec's 50 ms cap). */
const IDLE_PERIOD_MS = 50
/** What one timeRemaining() read costs an idle callback's budget while page time stands still. */
const IDLE_READ_COST_MS = 1

/** Earliest timer first; equal due times keep scheduling order. */
function earlier(a: Timer, b: Timer): boolean { return a.due < b.due || (a.due === b.due && a.seq < b.seq) }

/** Pure timer/frame bookkeeping; the page wiring lives in installVirtualClock. */
export class VirtualScheduler {
  private readonly timers = new Map<number, Timer>()
  private readonly frames = new Map<number, FrameRequestCallback>()
  private nextId = 1
  private seq = 0
  private nesting = 0
  constructor(public now: number, private readonly report: (error: unknown) => void = () => {}) {}

  setTimer(handler: TimerHandler, ms: unknown, args: unknown[], repeat: boolean): number {
    const id = this.nextId++
    const nesting = this.nesting + 1
    let delay = Math.max(0, Number(ms) || 0)
    // Chromium clamps timers nested 5 deep to 4 ms (DOMTimer kMaxTimerNestingLevel); repeating timers never spin at 0.
    if (nesting >= 5 && delay < 4) delay = 4
    if (repeat && delay < 1) delay = 1
    this.timers.set(id, { id, due: this.now + delay, seq: this.seq++, handler, args, interval: repeat ? delay : null, nesting })
    return id
  }

  clearTimer(id: unknown): void { this.timers.delete(Number(id)) }

  requestFrame(callback: FrameRequestCallback): number {
    const id = this.nextId++
    this.frames.set(id, callback)
    return id
  }

  cancelFrame(id: unknown): void { this.frames.delete(Number(id)) }

  /**
   * requestIdleCallback the way @sinonjs/fake-timers runs it: at once when no timer is waiting,
   * otherwise after the 50 ms idle period browsers cap a deadline at (sooner if `timeout` says so).
   * A `timeout` of 0 means none, as in the spec. The deadline is the time until the next timer, at
   * most 50 ms. Page time stands still while the callback runs, so each `timeRemaining()` read counts
   * as a millisecond of work: a loop that works until the time runs out ends after at most 50 reads,
   * the same way at every replay speed.
   */
  requestIdle(callback: IdleRequestCallback, timeout: number | undefined): number {
    const limit = Number(timeout) > 0 ? Number(timeout) : undefined
    const idle = this.timers.size > 0 ? IDLE_PERIOD_MS : 0
    const delay = limit === undefined ? idle : Math.min(limit, idle)
    const didTimeout = limit !== undefined && delay < idle
    return this.setTimer(() => {
      const start = this.now
      let budget = Math.min(IDLE_PERIOD_MS, Math.max(0, this.nextDue() - start))
      callback({
        didTimeout,
        timeRemaining: () => {
          const left = Math.max(0, budget - (this.now - start))
          budget -= IDLE_READ_COST_MS
          return left
        },
      })
    }, delay, [], false)
  }

  /** Due time of the next timer, or Infinity. */
  nextDue(): number {
    let best: Timer | null = null
    for (const timer of this.timers.values()) if (!best || earlier(timer, best)) best = timer
    return best ? best.due : Infinity
  }

  get pendingFrames(): number { return this.frames.size }

  /**
   * Runs every timer due at or before `target` in order, the clock reading each timer's own due time
   * while it runs; then the clock rests at `target`. `between` runs after each timer (a real macrotask,
   * so the timer's promise jobs and the work they start settle before the next one). Returns how many fired.
   */
  async advanceTo(target: number, between: () => Promise<void>): Promise<number> {
    let fired = 0
    for (;;) {
      let next: Timer | null = null
      for (const timer of this.timers.values()) if (timer.due <= target && (!next || earlier(timer, next))) next = timer
      if (!next) break
      if (next.due > this.now) this.now = next.due
      if (next.interval === null) this.timers.delete(next.id)
      else { next.due += next.interval; next.seq = this.seq++ }
      this.run(next)
      fired += 1
      await between()
    }
    if (target > this.now) this.now = target
    return fired
  }

  /** One animation frame at the current time: every callback requested before it, in request order. */
  async runFrame(between: () => Promise<void>): Promise<number> {
    const batch = [...this.frames.values()]
    this.frames.clear()
    const time = this.now
    for (const callback of batch) {
      try { callback(time) } catch (error) { this.report(error) }
      await between()
    }
    return batch.length
  }

  private run(timer: Timer): void {
    this.nesting = timer.nesting
    try {
      if (typeof timer.handler === 'function') (timer.handler as (...args: unknown[]) => unknown)(...timer.args)
      else (0, eval)(String(timer.handler))
    } catch (error) {
      this.report(error)
    } finally {
      this.nesting = 0
    }
  }
}

interface AnimationState { rate: number; current: number; last: number; ended: boolean }
type Accessor = { get: (this: Animation) => unknown; set: (this: Animation, value: unknown) => void }

/**
 * Drives every Web Animation (CSS animations and transitions, element.animate) on page time: the
 * browser keeps rate 0, the page sees its own rate, and each frame seeks the animation to where page
 * time puts it. Animations in shadow trees are found through the roots handed to `addRoot`.
 */
export class VirtualAnimations {
  private readonly states = new WeakMap<Animation, AnimationState>()
  private readonly live = new Set<Animation>()
  private readonly roots = new Set<DocumentOrShadowRoot & { host?: Element }>()
  private readonly rate: Accessor
  private readonly time: Accessor
  private readonly nativeFinish: Animation['finish']

  constructor(private readonly clock: () => number, root: DocumentOrShadowRoot) {
    const proto = Animation.prototype
    const describe = (name: 'playbackRate' | 'currentTime'): Accessor => {
      const descriptor = Object.getOwnPropertyDescriptor(proto, name)
      if (!descriptor?.get || !descriptor.set) throw new Error(`Animation.${name} is not an accessor`)
      return { get: descriptor.get, set: descriptor.set }
    }
    this.rate = describe('playbackRate')
    this.time = describe('currentTime')
    this.nativeFinish = proto.finish
    this.roots.add(root)
  }

  addRoot(root: DocumentOrShadowRoot & { host?: Element }): void { this.roots.add(root) }

  get running(): number { return this.live.size }

  /** Takes over animations the page started since the last scan; they rest where they are until the next frame. */
  scan(): number {
    let adopted = 0
    for (const root of this.roots) {
      if (root.host && !root.host.isConnected) continue
      for (const animation of root.getAnimations()) if (this.adopt(animation)) adopted += 1
    }
    return adopted
  }

  /** Seeks every running animation to the current page time; ends the ones that ran out. */
  advance(): number {
    const now = this.clock()
    for (const animation of this.live) {
      const state = this.states.get(animation)!
      const elapsed = now - state.last
      state.last = now
      if (state.ended || elapsed <= 0) continue
      if (animation.playState === 'idle') { this.live.delete(animation); continue }
      if (animation.playState === 'paused') continue
      this.moveBy(animation, state, elapsed)
    }
    return this.live.size
  }

  private moveBy(animation: Animation, state: AnimationState, elapsed: number): void {
    const end = Number(animation.effect?.getComputedTiming().endTime ?? Infinity)
    state.current += elapsed * state.rate
    if ((state.rate > 0 && state.current >= end) || (state.rate < 0 && state.current <= 0)) this.end(animation, state)
    else this.time.set.call(animation, state.current)
  }

  private end(animation: Animation, state: AnimationState): void {
    state.ended = true
    this.live.delete(animation)
    // Hand the animation back to the browser at its end, so it fires finish and the CSS end events itself.
    this.rate.set.call(animation, state.rate)
    try { this.nativeFinish.call(animation) } catch { /* an infinite or zero-rate animation cannot finish */ }
  }

  private adopt(animation: Animation): boolean {
    const existing = this.states.get(animation)
    if (existing && !existing.ended) return false
    // Scroll-driven animations follow scroll position, not time.
    if (animation.timeline && typeof DocumentTimeline !== 'undefined' && !(animation.timeline instanceof DocumentTimeline)) return false
    const nativeRate = Number(this.rate.get.call(animation))
    if (existing) {
      // Restarted after it finished (play() again): the browser runs it at its own rate until taken back.
      if (animation.playState === 'finished' || animation.playState === 'idle' || nativeRate === 0) return false
      existing.rate = nativeRate
    }
    const state = existing ?? { rate: nativeRate, current: 0, last: 0, ended: false }
    state.current = Number(this.time.get.call(animation) ?? 0) || 0
    state.last = this.clock()
    state.ended = false
    this.rate.set.call(animation, 0)
    if (!existing) this.instrument(animation, state)
    this.states.set(animation, state)
    this.live.add(animation)
    return true
  }

  /** The page keeps seeing its own rate and time; changes it makes go through page time. */
  private instrument(animation: Animation, state: AnimationState): void {
    const { rate, time, clock } = this
    Object.defineProperty(animation, 'playbackRate', {
      configurable: true,
      get() { return state.ended ? rate.get.call(animation) : state.rate },
      set(value: unknown) {
        if (state.ended) { rate.set.call(animation, value); return }
        state.rate = Number(value) || 0
      },
    })
    Object.defineProperty(animation, 'currentTime', {
      configurable: true,
      get() { return time.get.call(animation) },
      set(value: unknown) {
        time.set.call(animation, value)
        if (!state.ended) { state.current = Number(value) || 0; state.last = clock() }
      },
    })
    animation.updatePlaybackRate = (value: number) => { animation.playbackRate = value }
    animation.finish = () => { if (!state.ended) this.end(animation, state); else this.nativeFinish.call(animation) }
    animation.reverse = () => {
      if (state.ended) { Animation.prototype.reverse.call(animation); return }
      state.rate = -state.rate
      if (animation.playState === 'paused') animation.play()
    }
  }
}

export interface FrameReport {
  /** Page time the frame shows (ms). */
  now: number
  timers: number
  frameCallbacks: number
  animations: number
  /** Nothing could have changed the picture since the last rendered frame, so none was rendered. */
  quiet: boolean
}

/** What the engine drives through the replay control object. */
export interface VirtualClockControl {
  now(): number
  /** Timers up to `toMs` (no rendering); page time then rests at `toMs`. */
  advance(toMs: number): Promise<{ now: number; timers: number; nextDue: number }>
  /**
   * Advances to `toMs` and renders one frame there: animations seeked, animation-frame callbacks run
   * inside a real frame, `beforeCommit` (e.g. a capture token) in that same frame. Resolves after the
   * real frame's rendering update. With `allowQuiet`, a frame that nothing could have changed since the
   * last rendered one (no timer, frame callback, running animation, DOM change, input, load, scroll or
   * answered call) is not rendered: its picture is the previous one.
   */
  frame(toMs: number, beforeCommit?: () => void, allowQuiet?: boolean, tick?: boolean, render?: boolean): Promise<FrameReport>
  /** Resolves after the next real rendering update (delivers input the browser holds for the frame). */
  realFrame(): Promise<void>
  /** Page time holds still until `work` settles (recorded calls, storage). */
  hold<T>(work: Promise<T>): Promise<T>
  /** A timeout on the real clock (page timers wait for page time); returns its cancel. */
  wallTimeout(callback: () => void, ms: number): () => void
  addAnimationRoot(root: ShadowRoot): void
}

/**
 * Overrides the page's clocks with page time starting at `startMs`. Call before any page script.
 *
 * Known difference: page time stands still while the page loads, so the app shows up earlier in the
 * replay than in the recording (about 30 ms against 153 ms). Matching it would need the recording to
 * carry the load moments, a format change that would only buy back those first ~120 ms.
 */
export function installVirtualClock(startMs: number, report: (message: string) => void): VirtualClockControl {
  const realRaf = window.requestAnimationFrame.bind(window)
  const realSetTimeout = window.setTimeout.bind(window)
  const realClearTimeout = window.clearTimeout.bind(window)
  const channel = new MessageChannel()
  const macrotasks: Array<() => void> = []
  channel.port1.onmessage = () => macrotasks.shift()?.()
  const macrotask = (): Promise<void> => new Promise(resolve => { macrotasks.push(resolve); channel.port2.postMessage(0) })
  const reportError = (error: unknown): void => {
    // Same as an uncaught error in a real timer: the page's error handlers see it, the clock carries on.
    try { (globalThis as { reportError?: (e: unknown) => void }).reportError?.(error) } catch { /* ignore */ }
  }
  const scheduler = new VirtualScheduler(startMs, reportError)
  const now = (): number => scheduler.now

  // ---- clocks
  performance.now = now
  window.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => scheduler.setTimer(handler, ms, args, false)) as typeof window.setTimeout
  window.setInterval = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => scheduler.setTimer(handler, ms, args, true)) as typeof window.setInterval
  window.clearTimeout = ((id?: unknown) => scheduler.clearTimer(id)) as typeof window.clearTimeout
  window.clearInterval = ((id?: unknown) => scheduler.clearTimer(id)) as typeof window.clearInterval
  window.requestAnimationFrame = callback => scheduler.requestFrame(callback)
  window.cancelAnimationFrame = id => scheduler.cancelFrame(id)
  window.requestIdleCallback = (callback, options) => scheduler.requestIdle(callback, options?.timeout)
  window.cancelIdleCallback = id => scheduler.clearTimer(id)
  const stamps = new WeakMap<Event, number>()
  Object.defineProperty(Event.prototype, 'timeStamp', {
    configurable: true,
    get(this: Event) { let stamp = stamps.get(this); if (stamp === undefined) { stamp = scheduler.now; stamps.set(this, stamp) } return stamp },
  })
  if (typeof DocumentTimeline !== 'undefined') Object.defineProperty(DocumentTimeline.prototype, 'currentTime', { configurable: true, get: () => scheduler.now })

  // ---- activity since the last rendered frame
  let active = true
  const touch = (): void => { active = true }
  const observer = new MutationObserver(touch)
  const watch = (target: Node): void => observer.observe(target, { subtree: true, childList: true, attributes: true, characterData: true })
  watch(document)
  for (const type of ['load', 'error', 'scroll', 'resize', 'input', 'change', 'focusin', 'focusout', 'pointermove', 'pointerdown', 'pointerup', 'pointerover', 'pointerout', 'keydown', 'keyup', 'wheel', 'compositionupdate', 'dragover', 'drop', 'paste']) {
    addEventListener(type, touch, { capture: true, passive: true })
  }
  document.addEventListener('selectionchange', touch, { passive: true })
  document.fonts?.addEventListener('loadingdone', touch)

  // ---- animations, including those inside shadow trees
  const animations = new VirtualAnimations(now, document)
  const attachShadow = Element.prototype.attachShadow
  Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) {
    const root = attachShadow.call(this, init)
    animations.addRoot(root)
    watch(root)
    return root
  }

  // ---- boundary work holds page time
  let pending = 0
  const idleWaiters: Array<() => void> = []
  const hold = <T>(work: Promise<T>): Promise<T> => {
    pending += 1
    const done = (): void => { touch(); pending -= 1; if (pending === 0) idleWaiters.splice(0).forEach(wake => wake()) }
    work.then(done, done)
    return work
  }
  const HOLD_LIMIT_MS = 15_000
  const settle = async (): Promise<void> => {
    while (pending > 0) {
      const timedOut = await new Promise<boolean>(resolve => {
        const timer = realSetTimeout(() => resolve(true), HOLD_LIMIT_MS)
        idleWaiters.push(() => { realClearTimeout(timer); resolve(false) })
      })
      if (timedOut) { report(`页面等待录制数据超过 ${HOLD_LIMIT_MS / 1000} 秒，页面时间继续往前走`); break }
    }
    await macrotask()
  }
  const between = async (): Promise<void> => { await macrotask(); if (pending) await settle() }
  const microtask = (): Promise<void> => Promise.resolve()

  const realFrame = (): Promise<void> => new Promise(resolve => realRaf(() => resolve()))

  return {
    now,
    async advance(toMs) {
      await settle()
      const timers = await scheduler.advanceTo(toMs, between)
      return { now: scheduler.now, timers, nextDue: scheduler.nextDue() }
    },
    async frame(toMs, beforeCommit, allowQuiet = false, tick = true, render = true) {
      await settle()
      const timers = await scheduler.advanceTo(toMs, between)
      if (timers) touch()
      const animating = animations.running > 0
      animations.advance()
      if (allowQuiet && !active && !animating && scheduler.pendingFrames === 0) return { now: scheduler.now, timers, frameCallbacks: 0, animations: 0, quiet: true }
      let frameCallbacks = 0
      let live = 0
      // 补帧只推进页面逻辑，不等待显示器或复制像素；输入由宿主先交付，异步边界仍在每步之间结算。
      if (!render) {
        frameCallbacks = await scheduler.runFrame(microtask)
        animations.scan()
        await between()
        return { now: scheduler.now, timers, frameCallbacks, animations: animations.running, quiet: false }
      }
      await new Promise<void>((resolve, reject) => realRaf(() => {
        // Everything below lands in this real frame: callbacks, newly started animations, the token.
        (tick ? scheduler.runFrame(microtask) : Promise.resolve(0)).then(count => {
          frameCallbacks = count
          animations.scan()
          live = animations.running
          beforeCommit?.()
          // What happened so far is in this frame; whatever changes from here on marks the next one.
          observer.takeRecords()
          active = false
          resolve()
        }, reject)
      }))
      // After the rendering update the frame belongs to.
      await macrotask()
      return { now: scheduler.now, timers, frameCallbacks, animations: live, quiet: false }
    },
    realFrame,
    hold,
    wallTimeout(callback, ms) { const timer = realSetTimeout(callback, ms); return () => realClearTimeout(timer) },
    addAnimationRoot: root => animations.addRoot(root),
  }
}
