import { useLayoutEffect, useRef, useState } from 'react'
import { UI_DURATION } from '@/components/ui/motion'
import type { MultiAngleOrientation } from './multiAngleOrbitGeometry'

// The registered UI ease-out curve: cubic-bezier(0, 0, 0.2, 1).
function easeOut(progress: number): number {
  if (progress === 0) return 0
  let low = 0; let high = 1
  for (let step = 0; step < 12; step++) {
    const t = (low + high) / 2
    if (0.6 * t * t + 0.4 * t * t * t < progress) low = t
    else high = t
  }
  const t = (low + high) / 2
  return 3 * t * t - 2 * t * t * t
}

/** Local, finite pose tween; no canvas store writes or idle animation callbacks. */
export function useMultiAngleTransition(target: MultiAngleOrientation, enabled: boolean): MultiAngleOrientation {
  const current = useRef(target)
  const [displayed, setDisplayed] = useState(target)
  useLayoutEffect(() => {
    const destination = { azimuth: target.azimuth, elevation: target.elevation }
    const from = current.current
    const yawDelta = ((destination.azimuth - from.azimuth + 540) % 360) - 180
    const pitchDelta = destination.elevation - from.elevation
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let frame: number | null = null
    const apply = (pose: MultiAngleOrientation): void => {
      current.current = pose
      setDisplayed(previous => previous.azimuth === pose.azimuth && previous.elevation === pose.elevation ? previous : pose)
    }
    const finish = (): void => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      motion?.removeEventListener('change', stopForPreference)
      document.removeEventListener('visibilitychange', stopWhenHidden)
      apply(destination)
    }
    if (!enabled) {
      // Pointer movement already renders its target; remember it without a second render.
      current.current = destination
      return
    }
    if (motion?.matches || document.hidden || (Math.abs(yawDelta) < 0.00001 && Math.abs(pitchDelta) < 0.00001)) {
      apply(destination)
      return
    }
    // Restore the last direct-drag pose before the next frame, so releasing cannot flash an older pose.
    apply(from)
    let start: number | null = null
    const tick = (now: number): void => {
      start ??= now
      const progress = Math.min(1, Math.max(0, (now - start) / UI_DURATION.slow))
      if (progress === 1) { finish(); return }
      const eased = easeOut(progress)
      apply({ azimuth: from.azimuth + yawDelta * eased, elevation: from.elevation + pitchDelta * eased })
      frame = requestAnimationFrame(tick)
    }
    const stopForPreference = (): void => { if (motion?.matches) finish() }
    const stopWhenHidden = (): void => { if (document.hidden) finish() }
    motion?.addEventListener('change', stopForPreference)
    document.addEventListener('visibilitychange', stopWhenHidden)
    frame = requestAnimationFrame(tick)
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      motion?.removeEventListener('change', stopForPreference)
      document.removeEventListener('visibilitychange', stopWhenHidden)
    }
  }, [enabled, target.azimuth, target.elevation])
  return enabled ? displayed : target
}
