/*! @license
 * Ported from Chromium's cc/animation/scroll_offset_animation_curve.cc and
 * scroll_offset_animation_curve_factory.cc.
 *
 * Copyright 2015 The Chromium Authors
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *    * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *    * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *    * Neither the name of Google LLC nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * Chromium's ease-in-out scroll animation curve (see the notice above), so scrolls the replay animates
 * itself move the way the browser would move them: same easing, same segment durations, and the same retargeting when a new scroll arrives while
 * one is running (the new segment starts at the current position and keeps the current velocity).
 * Times are milliseconds since the animation started; positions are [left, top] in CSS px.
 */

type Point = [number, number]

/** Duration rules of the curve's ease-in-out kinds that the replay uses. */
export type ScrollDuration = 'programmatic' | 'keyboard'

const FRAME_MS = 1000 / 60
// kConstantDuration (keyboard scrolls): 9 frames.
const CONSTANT_MS = 9 * FRAME_MS
// kDeltaBased (programmatic smooth scrolls): sqrt(distance) frames, at most features::kMaxAnimationDuration (12 frames).
const DELTA_BASED_MAX_FRAMES = 12
const EPSILON = 0.01

/** cubic-bezier(x1, y1, x2, y2) with x1, x2 in [0, 1], so x is monotonic and can be solved by bisection. */
export class CubicBezier {
  constructor(readonly x1: number, readonly y1: number, readonly x2: number, readonly y2: number) {}

  private static at(p1: number, p2: number, s: number): number { return 3 * p1 * s * (1 - s) ** 2 + 3 * p2 * s * s * (1 - s) + s ** 3 }
  private static derivative(p1: number, p2: number, s: number): number { return 3 * p1 * (1 - s) ** 2 + 6 * (p2 - p1) * s * (1 - s) + 3 * (1 - p2) * s * s }

  private solve(x: number): number {
    let lo = 0, hi = 1
    for (let k = 0; k < 40; k += 1) { const mid = (lo + hi) / 2; if (CubicBezier.at(this.x1, this.x2, mid) < x) lo = mid; else hi = mid }
    return (lo + hi) / 2
  }

  value(x: number): number {
    if (x <= 0) return 0
    if (x >= 1) return 1
    return CubicBezier.at(this.y1, this.y2, this.solve(x))
  }

  /** dy/dx at x. */
  slope(x: number): number {
    const s = this.solve(Math.min(1, Math.max(0, x)))
    const dx = CubicBezier.derivative(this.x1, this.x2, s)
    return dx === 0 ? 0 : CubicBezier.derivative(this.y1, this.y2, s) / dx
  }
}

const EASE_IN_OUT = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 }

/** The larger component of `delta`, with its sign (MaximumDimension). */
const major = ([x, y]: Point): number => (Math.abs(x) > Math.abs(y) ? x : y)

export class ScrollCurve {
  private timing = new CubicBezier(EASE_IN_OUT.x1, EASE_IN_OUT.y1, EASE_IN_OUT.x2, EASE_IN_OUT.y2)
  private lastRetarget = 0
  /** Total duration, ms since the start; grows when the target moves. */
  duration: number

  constructor(private initial: Point, public target: Point, readonly kind: ScrollDuration, durationMs?: number) {
    this.duration = durationMs ?? this.segmentDuration(this.delta(target, initial), 0)
  }

  private delta(to: Point, from: Point): Point { return [to[0] - from[0], to[1] - from[1]] }

  private segmentDuration(delta: Point, delayedBy: number): number {
    const ms = this.kind === 'keyboard' ? CONSTANT_MS : Math.min(Math.sqrt(Math.abs(major(delta))), DELTA_BASED_MAX_FRAMES) * FRAME_MS
    return Math.max(0, ms - delayedBy)
  }

  value(t: number): Point {
    const duration = this.duration - this.lastRetarget
    const local = t - this.lastRetarget
    if (duration === 0 || local >= duration) return [...this.target]
    if (local <= 0) return [...this.initial]
    const k = this.timing.value(local / duration)
    return [this.initial[0] + (this.target[0] - this.initial[0]) * k, this.initial[1] + (this.target[1] - this.initial[1]) * k]
  }

  /** px per ms along the major axis. */
  private velocity(t: number): number {
    const duration = this.duration - this.lastRetarget
    return this.timing.slope((t - this.lastRetarget) / duration) * (major(this.delta(this.target, this.initial)) / duration)
  }

  /** UpdateTarget: a new scroll arrived at `t` while this one runs. */
  updateTarget(t: number, next: Point): void {
    const delayedBy = Math.max(0, this.lastRetarget - t)
    t = Math.max(t, this.lastRetarget)
    if (Math.abs(major(this.delta(this.target, next))) < EPSILON) { this.target = next; return }
    const current = this.value(t)
    const delta = this.delta(next, current)
    if (Math.abs(major(delta)) < EPSILON) { this.lastRetarget = t; this.duration = t; this.target = next; return }
    if (this.duration - this.lastRetarget === 0) { this.duration = this.segmentDuration(delta, delayedBy); this.target = next; return }
    const velocity = this.velocity(t)
    // Velocity-based bound: how long reaching the new target takes at the present speed, with room for the ease-out.
    const bound = Math.abs(velocity) < EPSILON / 1000 ? Infinity : (major(delta) / velocity) * 2.5
    const duration = Math.min(this.segmentDuration(delta, delayedBy), bound < 0 ? Infinity : bound)
    if (duration < EPSILON * 1000) { this.target = next; this.duration = t; return }
    // Keep the old animation's speed: the new segment's first control point gets the matching slope.
    const slope = Math.min(1000, Math.max(-1000, velocity * (duration / major(delta))))
    this.timing = new CubicBezier(EASE_IN_OUT.x1, EASE_IN_OUT.x1 * slope, EASE_IN_OUT.x2, EASE_IN_OUT.y2)
    this.initial = current
    this.target = next
    this.duration = t + duration
    this.lastRetarget = t
  }
}
