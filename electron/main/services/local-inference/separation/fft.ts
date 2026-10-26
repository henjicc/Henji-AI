/*
 * 混合基 FFT：MDX-Net 的 n_fft 是 7680（2^9·3·5）与 6144（2^11·3），仓库已有的 videoEditFft 只支持 2 的幂。
 *
 * - ComplexFft：Stockham 自排序（每级在两块缓冲间来回写，不需要位反转），基 4、2、3、5 专用蝶形，
 *   其他质因数走通用小 DFT；旋转因子按级预先算好。正变换 e^{-2πi·nk/N}，不缩放。
 * - RealFft：N 点实数序列用 N/2 点复数 FFT 加一次拆分完成；forward 与 torch.fft.rfft 一致，
 *   inverse 与 torch.fft.irfft 一致（除以 N，忽略 0 与 N/2 频点的虚部）。
 *
 * 全程双精度；实例自带工作缓冲，非线程安全（本地推理后台进程单线程使用）。
 */

function factorize(size: number): number[] {
  const radices: number[] = []
  let rest = size
  while (rest % 4 === 0) { radices.push(4); rest /= 4 }
  while (rest % 2 === 0) { radices.push(2); rest /= 2 }
  for (let factor = 3; rest > 1; factor += 2) {
    while (rest % factor === 0) { radices.push(factor); rest /= factor }
    if (factor * factor > rest && rest > 1) { radices.push(rest); rest = 1 }
  }
  return radices
}

interface Stage { radix: number; span: number; twiddles: Float64Array; dft?: Float64Array }

export class ComplexFft {
  private readonly stages: Stage[] = []
  private readonly bufferRe: Float64Array
  private readonly bufferIm: Float64Array
  private readonly loadRe: Float64Array
  private readonly loadIm: Float64Array

  constructor(readonly size: number) {
    if (!Number.isInteger(size) || size < 1) throw new Error('FFT 长度必须是正整数。')
    let span = 1
    let maxRadix = 1
    for (const radix of factorize(size)) {
      // 第 k 个子变换的第 r 路输入乘 e^{-2πi·r·k/(span·radix)}。
      const twiddles = new Float64Array(span * (radix - 1) * 2)
      for (let k = 0; k < span; k++) {
        for (let r = 1; r < radix; r++) {
          const angle = -2 * Math.PI * r * k / (span * radix)
          const at = (k * (radix - 1) + r - 1) * 2
          twiddles[at] = Math.cos(angle); twiddles[at + 1] = Math.sin(angle)
        }
      }
      let dft: Float64Array | undefined
      if (radix !== 2 && radix !== 3 && radix !== 4 && radix !== 5) {
        dft = new Float64Array(radix * 2)
        for (let index = 0; index < radix; index++) { dft[index * 2] = Math.cos(-2 * Math.PI * index / radix); dft[index * 2 + 1] = Math.sin(-2 * Math.PI * index / radix) }
      }
      this.stages.push({ radix, span, twiddles, dft })
      span *= radix
      maxRadix = Math.max(maxRadix, radix)
    }
    this.bufferRe = new Float64Array(size); this.bufferIm = new Float64Array(size)
    this.loadRe = new Float64Array(maxRadix); this.loadIm = new Float64Array(maxRadix)
  }

  /** 原地正变换（不缩放）。 */
  forward(re: Float64Array, im: Float64Array): void {
    if (re.length !== this.size || im.length !== this.size) throw new Error('FFT 输入长度不符。')
    let xr = re, xi = im, yr = this.bufferRe, yi = this.bufferIm
    for (const stage of this.stages) {
      this.pass(stage, xr, xi, yr, yi)
      const swapRe = xr; xr = yr; yr = swapRe
      const swapIm = xi; xi = yi; yi = swapIm
    }
    if (xr !== re) { re.set(xr); im.set(xi) }
  }

  private pass(stage: Stage, xr: Float64Array, xi: Float64Array, yr: Float64Array, yi: Float64Array): void {
    const { radix, span: ns, twiddles: tw } = stage
    const m = this.size / radix
    if (radix === 4) {
      for (let jb = 0; jb < m; jb += ns) {
        const out = jb * 4
        for (let k = 0; k < ns; k++) {
          const j = jb + k, t = k * 6
          const ar = xr[j], ai = xi[j]
          let vr = xr[j + m], vi = xi[j + m]
          const br = vr * tw[t] - vi * tw[t + 1], bi = vr * tw[t + 1] + vi * tw[t]
          vr = xr[j + 2 * m]; vi = xi[j + 2 * m]
          const cr = vr * tw[t + 2] - vi * tw[t + 3], ci = vr * tw[t + 3] + vi * tw[t + 2]
          vr = xr[j + 3 * m]; vi = xi[j + 3 * m]
          const dr = vr * tw[t + 4] - vi * tw[t + 5], di = vr * tw[t + 5] + vi * tw[t + 4]
          const t0r = ar + cr, t0i = ai + ci, t1r = ar - cr, t1i = ai - ci
          const t2r = br + dr, t2i = bi + di
          // (b − d)·(−i)
          const t3r = bi - di, t3i = dr - br
          const o = out + k
          yr[o] = t0r + t2r; yi[o] = t0i + t2i
          yr[o + ns] = t1r + t3r; yi[o + ns] = t1i + t3i
          yr[o + 2 * ns] = t0r - t2r; yi[o + 2 * ns] = t0i - t2i
          yr[o + 3 * ns] = t1r - t3r; yi[o + 3 * ns] = t1i - t3i
        }
      }
    } else if (radix === 2) {
      for (let jb = 0; jb < m; jb += ns) {
        const out = jb * 2
        for (let k = 0; k < ns; k++) {
          const j = jb + k, t = k * 2
          const ar = xr[j], ai = xi[j]
          const vr = xr[j + m], vi = xi[j + m]
          const br = vr * tw[t] - vi * tw[t + 1], bi = vr * tw[t + 1] + vi * tw[t]
          const o = out + k
          yr[o] = ar + br; yi[o] = ai + bi
          yr[o + ns] = ar - br; yi[o + ns] = ai - bi
        }
      }
    } else if (radix === 3) {
      const s = Math.sqrt(3) / 2
      for (let jb = 0; jb < m; jb += ns) {
        const out = jb * 3
        for (let k = 0; k < ns; k++) {
          const j = jb + k, t = k * 4
          const ar = xr[j], ai = xi[j]
          let vr = xr[j + m], vi = xi[j + m]
          const br = vr * tw[t] - vi * tw[t + 1], bi = vr * tw[t + 1] + vi * tw[t]
          vr = xr[j + 2 * m]; vi = xi[j + 2 * m]
          const cr = vr * tw[t + 2] - vi * tw[t + 3], ci = vr * tw[t + 3] + vi * tw[t + 2]
          const sr = br + cr, si = bi + ci
          const mr = ar - 0.5 * sr, mi = ai - 0.5 * si
          // −i·(√3/2)·(b − c)
          const qr = s * (bi - ci), qi = -s * (br - cr)
          const o = out + k
          yr[o] = ar + sr; yi[o] = ai + si
          yr[o + ns] = mr + qr; yi[o + ns] = mi + qi
          yr[o + 2 * ns] = mr - qr; yi[o + 2 * ns] = mi - qi
        }
      }
    } else if (radix === 5) {
      const c1 = Math.cos(2 * Math.PI / 5), c2 = Math.cos(4 * Math.PI / 5)
      const s1 = Math.sin(2 * Math.PI / 5), s2 = Math.sin(4 * Math.PI / 5)
      for (let jb = 0; jb < m; jb += ns) {
        const out = jb * 5
        for (let k = 0; k < ns; k++) {
          const j = jb + k, t = k * 8
          const ar = xr[j], ai = xi[j]
          let vr = xr[j + m], vi = xi[j + m]
          const v1r = vr * tw[t] - vi * tw[t + 1], v1i = vr * tw[t + 1] + vi * tw[t]
          vr = xr[j + 2 * m]; vi = xi[j + 2 * m]
          const v2r = vr * tw[t + 2] - vi * tw[t + 3], v2i = vr * tw[t + 3] + vi * tw[t + 2]
          vr = xr[j + 3 * m]; vi = xi[j + 3 * m]
          const v3r = vr * tw[t + 4] - vi * tw[t + 5], v3i = vr * tw[t + 5] + vi * tw[t + 4]
          vr = xr[j + 4 * m]; vi = xi[j + 4 * m]
          const v4r = vr * tw[t + 6] - vi * tw[t + 7], v4i = vr * tw[t + 7] + vi * tw[t + 6]
          const a1r = v1r + v4r, a1i = v1i + v4i, b1r = v1r - v4r, b1i = v1i - v4i
          const a2r = v2r + v3r, a2i = v2i + v3i, b2r = v2r - v3r, b2i = v2i - v3i
          const p1r = ar + c1 * a1r + c2 * a2r, p1i = ai + c1 * a1i + c2 * a2i
          const p2r = ar + c2 * a1r + c1 * a2r, p2i = ai + c2 * a1i + c1 * a2i
          // y1,4 = p1 ∓ i·(s1·b1 + s2·b2)；y2,3 = p2 ∓ i·(s2·b1 − s1·b2)
          const q1r = s1 * b1r + s2 * b2r, q1i = s1 * b1i + s2 * b2i
          const q2r = s2 * b1r - s1 * b2r, q2i = s2 * b1i - s1 * b2i
          const o = out + k
          yr[o] = ar + a1r + a2r; yi[o] = ai + a1i + a2i
          yr[o + ns] = p1r + q1i; yi[o + ns] = p1i - q1r
          yr[o + 4 * ns] = p1r - q1i; yi[o + 4 * ns] = p1i + q1r
          yr[o + 2 * ns] = p2r + q2i; yi[o + 2 * ns] = p2i - q2r
          yr[o + 3 * ns] = p2r - q2i; yi[o + 3 * ns] = p2i + q2r
        }
      }
    } else {
      const dft = stage.dft!
      const lr = this.loadRe, li = this.loadIm
      for (let jb = 0; jb < m; jb += ns) {
        const out = jb * radix
        for (let k = 0; k < ns; k++) {
          const j = jb + k
          lr[0] = xr[j]; li[0] = xi[j]
          for (let r = 1; r < radix; r++) {
            const t = (k * (radix - 1) + r - 1) * 2, vr = xr[j + r * m], vi = xi[j + r * m]
            lr[r] = vr * tw[t] - vi * tw[t + 1]; li[r] = vr * tw[t + 1] + vi * tw[t]
          }
          for (let q = 0; q < radix; q++) {
            let sumR = 0, sumI = 0
            for (let r = 0; r < radix; r++) {
              const w = (r * q % radix) * 2
              sumR += lr[r] * dft[w] - li[r] * dft[w + 1]; sumI += lr[r] * dft[w + 1] + li[r] * dft[w]
            }
            yr[out + k + q * ns] = sumR; yi[out + k + q * ns] = sumI
          }
        }
      }
    }
  }
}

export class RealFft {
  /** 单边频点数 N/2 + 1。 */
  readonly bins: number
  private readonly half: ComplexFft
  private readonly zr: Float64Array
  private readonly zi: Float64Array
  /** e^{-2πi·k/N}，k = 0..N/2。 */
  private readonly wr: Float64Array
  private readonly wi: Float64Array

  constructor(readonly size: number) {
    if (!Number.isInteger(size) || size < 2 || size % 2) throw new Error('实数 FFT 长度必须是正偶数。')
    const m = size / 2
    this.bins = m + 1
    this.half = new ComplexFft(m)
    this.zr = new Float64Array(m); this.zi = new Float64Array(m)
    this.wr = new Float64Array(m + 1); this.wi = new Float64Array(m + 1)
    for (let k = 0; k <= m; k++) { this.wr[k] = Math.cos(-2 * Math.PI * k / size); this.wi[k] = Math.sin(-2 * Math.PI * k / size) }
  }

  /** 实数序列（长度 N）→ 单边频谱（各 N/2 + 1）。 */
  forward(input: Float64Array, re: Float64Array, im: Float64Array): void {
    const m = this.size / 2, zr = this.zr, zi = this.zi, wr = this.wr, wi = this.wi
    for (let n = 0; n < m; n++) { zr[n] = input[2 * n]; zi[n] = input[2 * n + 1] }
    this.half.forward(zr, zi)
    re[0] = zr[0] + zi[0]; im[0] = 0
    re[m] = zr[0] - zi[0]; im[m] = 0
    for (let k = 1; k < m; k++) {
      // 偶数位频谱 E = (Z[k] + conj Z[m−k]) / 2，奇数位 O = (Z[k] − conj Z[m−k]) / 2i，X = E + W^k·O。
      const ar = zr[k], ai = zi[k], br = zr[m - k], bi = -zi[m - k]
      const er = 0.5 * (ar + br), ei = 0.5 * (ai + bi)
      const or = 0.5 * (ai - bi), oi = -0.5 * (ar - br)
      re[k] = er + wr[k] * or - wi[k] * oi
      im[k] = ei + wr[k] * oi + wi[k] * or
    }
  }

  /** 单边频谱（各 N/2 + 1）→ 实数序列（长度 N，已除以 N）。 */
  inverse(re: Float64Array, im: Float64Array, output: Float64Array): void {
    const m = this.size / 2, zr = this.zr, zi = this.zi, wr = this.wr, wi = this.wi
    for (let k = 0; k < m; k++) {
      // 0 与 N/2 频点只取实部（与 C2R 逆变换一致）。
      const ar = re[k], ai = k === 0 ? 0 : im[k]
      const br = re[m - k], bi = k === 0 ? 0 : -im[m - k]
      const er = 0.5 * (ar + br), ei = 0.5 * (ai + bi)
      const dr = 0.5 * (ar - br), di = 0.5 * (ai - bi)
      // O = D·W^{-k}；Z = E + i·O
      const or = dr * wr[k] + di * wi[k], oi = di * wr[k] - dr * wi[k]
      zr[k] = er - oi
      // 逆变换借正变换完成：conj → 正变换 → conj / m
      zi[k] = -(ei + or)
    }
    this.half.forward(zr, zi)
    const scale = 1 / m
    for (let n = 0; n < m; n++) { output[2 * n] = zr[n] * scale; output[2 * n + 1] = -zi[n] * scale }
  }
}
