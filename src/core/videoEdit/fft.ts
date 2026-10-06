/** 原地复数 FFT（基 2 迭代，`sign` 为 -1 正变换、1 逆变换，不缩放）。 */
export function videoEditFft(real: Float64Array, imaginary: Float64Array, sign: 1 | -1): void {
  const size = real.length
  for (let index = 1, swap = 0; index < size; index++) {
    let bit = size >> 1
    for (; swap & bit; bit >>= 1) swap ^= bit
    swap ^= bit
    if (index < swap) { [real[index], real[swap]] = [real[swap], real[index]]; [imaginary[index], imaginary[swap]] = [imaginary[swap], imaginary[index]] }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = sign * 2 * Math.PI / length; const stepReal = Math.cos(angle); const stepImaginary = Math.sin(angle)
    for (let start = 0; start < size; start += length) {
      let wReal = 1; let wImaginary = 0
      for (let offset = 0; offset < length / 2; offset++) {
        const even = start + offset; const odd = even + length / 2
        const tReal = real[odd] * wReal - imaginary[odd] * wImaginary; const tImaginary = real[odd] * wImaginary + imaginary[odd] * wReal
        real[odd] = real[even] - tReal; imaginary[odd] = imaginary[even] - tImaginary
        real[even] += tReal; imaginary[even] += tImaginary
        const nextReal = wReal * stepReal - wImaginary * stepImaginary; wImaginary = wReal * stepImaginary + wImaginary * stepReal; wReal = nextReal
      }
    }
  }
}
