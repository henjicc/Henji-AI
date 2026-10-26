import { describe, expect, it } from 'vitest'
import { ComplexFft, RealFft } from './fft'

function random(seed: number): () => number {
  let state = seed >>> 0
  return () => { state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0; return state / 2 ** 32 - 0.5 }
}

function naiveDft(re: Float64Array, im: Float64Array): { re: Float64Array; im: Float64Array } {
  const size = re.length, outRe = new Float64Array(size), outIm = new Float64Array(size)
  for (let k = 0; k < size; k++) {
    let sumRe = 0, sumIm = 0
    for (let n = 0; n < size; n++) {
      const angle = -2 * Math.PI * ((k * n) % size) / size
      sumRe += re[n] * Math.cos(angle) - im[n] * Math.sin(angle); sumIm += re[n] * Math.sin(angle) + im[n] * Math.cos(angle)
    }
    outRe[k] = sumRe; outIm[k] = sumIm
  }
  return { re: outRe, im: outIm }
}

const maxAbs = (a: ArrayLike<number>, b: ArrayLike<number>): number => { let max = 0; for (let index = 0; index < a.length; index++) max = Math.max(max, Math.abs(a[index] - b[index])); return max }

describe('混合基 FFT', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 15, 16, 25, 49, 60, 120, 240, 3072, 3840])('%i 点复数变换与直接 DFT 一致', (size) => {
    const next = random(size)
    const re = Float64Array.from({ length: size }, next), im = Float64Array.from({ length: size }, next)
    const expected = naiveDft(re, im)
    new ComplexFft(size).forward(re, im)
    const tolerance = 1e-10 * size
    expect(maxAbs(re, expected.re)).toBeLessThan(tolerance)
    expect(maxAbs(im, expected.im)).toBeLessThan(tolerance)
  })

  it.each([2, 6, 30, 7680, 6144])('%i 点实数变换与直接 DFT 一致，逆变换还原原序列', (size) => {
    const next = random(size + 1)
    const input = Float64Array.from({ length: size }, next)
    const fft = new RealFft(size)
    const re = new Float64Array(fft.bins), im = new Float64Array(fft.bins)
    fft.forward(input, re, im)
    const expected = naiveDft(input, new Float64Array(size))
    expect(maxAbs(re, expected.re.subarray(0, fft.bins))).toBeLessThan(1e-9 * size)
    expect(maxAbs(im, expected.im.subarray(0, fft.bins))).toBeLessThan(1e-9 * size)
    const restored = new Float64Array(size)
    fft.inverse(re, im, restored)
    expect(maxAbs(restored, input)).toBeLessThan(1e-12 * size)
  })

  it('逆变换与 irfft 一样忽略 0 与 N/2 频点的虚部', () => {
    const fft = new RealFft(12)
    const re = Float64Array.from({ length: 7 }, (_, index) => index + 1), im = Float64Array.from({ length: 7 }, (_, index) => index * 0.5)
    const clean = im.slice(); clean[0] = 0; clean[6] = 0
    const a = new Float64Array(12), b = new Float64Array(12)
    im[0] = 3; im[6] = -2
    fft.inverse(re, im, a); fft.inverse(re, clean, b)
    expect(maxAbs(a, b)).toBeLessThan(1e-12)
  })
})
