import type { CodeParameterValue, CodeColor } from './codeMaterial/contract'

/** ease = cubic Bézier (1/3,0),(2/3,1): x=t, y=3t²−2t³. */
export function interpolateVideoEditKeyframe(left: CodeParameterValue, right: CodeParameterValue, fraction: number, interpolation: 'linear' | 'hold' | 'ease', easeRange: readonly [number, number] = [0, 1]): CodeParameterValue {
  if (interpolation === 'hold') return left
  const t = Math.max(0, Math.min(1, fraction))
  const smooth = (value: number): number => value * value * (3 - 2 * value)
  const [a, b] = easeRange
  const amount = interpolation === 'ease' ? (smooth(a + (b - a) * t) - smooth(a)) / (smooth(b) - smooth(a)) : t
  if (typeof left === 'number' && typeof right === 'number') return left + (right - left) * amount
  if (Array.isArray(left) && Array.isArray(right)) return left.map((channel, index) => channel + (right[index] - channel) * amount) as CodeColor
  if (typeof left === 'string' && typeof right === 'string' && /^#[0-9a-f]{6}$/i.test(left) && /^#[0-9a-f]{6}$/i.test(right)) {
    return '#' + [1, 3, 5].map(offset => {
      const a = parseInt(left.slice(offset, offset + 2), 16); const b = parseInt(right.slice(offset, offset + 2), 16)
      return Math.round(a + (b - a) * amount).toString(16).padStart(2, '0')
    }).join('')
  }
  return left
}
