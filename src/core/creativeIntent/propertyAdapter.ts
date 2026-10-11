import { fitScalarCurve } from './fitting'
import { checkCancelled, CreativeIntentError, type ComputationControl } from './sampling'

/** A confirmed take, already split at seek/revisit boundaries. Hard samples are events or pins. */
export interface PropertySample<T> { frame: number; value: T; hard?: boolean }

export function orderedPropertySamples<T>(samples: readonly PropertySample<T>[]): PropertySample<T>[] {
  if (!samples.length) throw new CreativeIntentError('empty-take', [], '没有可整理的参数示范')
  let direction = 0
  for (let i = 1; i < samples.length; i++) {
    const next = Math.sign(samples[i].frame - samples[i - 1].frame)
    if (next && direction && next !== direction) throw new CreativeIntentError('take-direction', [], '时间指针换向须先拆分并选择示范段')
    if (next) direction = next
  }
  const sorted = [...samples].sort((a, b) => a.frame - b.frame)
  for (let i = 0; i < sorted.length; i++) {
    if (!Number.isSafeInteger(sorted[i].frame) || sorted[i].frame < 0) throw new CreativeIntentError('sample-time', [], '示范需要有效的作品帧')
    if (i && sorted[i].frame === sorted[i - 1].frame) throw new CreativeIntentError('revisit', [], '同帧重访须先选择示范段，不能自动覆盖')
  }
  return sorted
}

/** Shared Schneider proposals, lowered to a common linear basis for compound native values.
 * Linear differences attain their extrema at sample knots; checking every knot proves the
 * entire piecewise-linear reference, not just the retained keys. No channel can drop a pin. */
export function fitPropertySamples(samples: readonly PropertySample<number[]>[], tolerances: readonly number[], control: ComputationControl = {}): number[] {
  checkCancelled(control)
  const selected = new Set<number>([samples[0].frame, samples.at(-1)!.frame])
  const available = new Set(samples.map(s => s.frame))
  for (const s of samples) if (s.hard) selected.add(s.frame)
  for (let channel = 0; channel < tolerances.length; channel++) {
    checkCancelled(control)
    const fitted = fitScalarCurve(samples.map(s => ({ time: s.frame, value: s.value[channel], hard: Boolean(s.hard) })), tolerances[channel], control)
    for (const p of fitted.points) if (available.has(p.time)) selected.add(p.time)
  }
  // Refine only violated spans; the stack is bounded by input size, with cancellable work.
  const anchors = samples.map((s, i) => selected.has(s.frame) ? i : -1).filter(i => i >= 0)
  const pending = anchors.slice(1).map((end, i): [number, number] => [anchors[i], end])
  while (pending.length) {
    checkCancelled(control)
    const [a, b] = pending.pop()!; let worst = 1; let split = -1
    for (let i = a + 1; i < b; i++) {
      if (i % 256 === 0) checkCancelled(control)
      const u = (samples[i].frame - samples[a].frame) / (samples[b].frame - samples[a].frame)
      for (let c = 0; c < tolerances.length; c++) {
        const error = Math.abs(samples[i].value[c] - (samples[a].value[c] * (1 - u) + samples[b].value[c] * u))
        const ratio = tolerances[c] === 0 ? error === 0 ? 0 : Infinity : error / tolerances[c]
        if (ratio > worst) { worst = ratio; split = i }
      }
    }
    if (split >= 0) { selected.add(samples[split].frame); pending.push([a, split], [split, b]) }
  }
  return [...selected].sort((a, b) => a - b)
}
