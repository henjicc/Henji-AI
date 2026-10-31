/**
 * 蓝噪声阈值表：void-and-cluster（Ulichney 1993，与 Christoph Peters 公开的 CC0 纹理同法），环绕平铺。
 * 随机数、初始种子与并列的取法都固定，同一份代码每次生成逐位相同；产物由 `scripts/generate-author-effects.ts` 写出并检查。
 */

/** mulberry32：固定种子的 32 位伪随机数。 */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 返回 size×size 的排名（0..size²−1），按行存放。 */
export function generateBlueNoiseRanks(size = 64, sigma = 1.5, seed = 0x48454e4a): Uint16Array {
  const count = size * size
  const kernel = new Float64Array(count)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = Math.min(x, size - x), dy = Math.min(y, size - y)
    kernel[y * size + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma))
  }
  const energy = new Float64Array(count)
  const on = new Uint8Array(count)
  const toggle = (index: number, sign: number): void => {
    const px = index % size, py = Math.floor(index / size)
    for (let y = 0; y < size; y++) {
      const ky = ((y - py + size) % size) * size
      for (let x = 0; x < size; x++) energy[y * size + x] += sign * kernel[ky + (x - px + size) % size]
    }
  }
  // 能量相同时取下标最小者，保证可复现。
  const pick = (wanted: number, largest: boolean): number => {
    let best = -1
    for (let index = 0; index < count; index++) {
      if (on[index] !== wanted) continue
      if (best < 0 || (largest ? energy[index] > energy[best] : energy[index] < energy[best])) best = index
    }
    return best
  }
  const next = random(seed)
  const initial = Math.round(count * 0.1)
  for (let placed = 0; placed < initial;) {
    const index = Math.floor(next() * count)
    if (on[index]) continue
    on[index] = 1; toggle(index, 1); placed++
  }
  // 把初始点调匀：最挤的点挪到最空的地方，直到挪回原处（迭代次数有上限，结果仍确定）。
  for (let round = 0; round < count; round++) {
    const cluster = pick(1, true)
    on[cluster] = 0; toggle(cluster, -1)
    const voidIndex = pick(0, false)
    on[voidIndex] = 1; toggle(voidIndex, 1)
    if (voidIndex === cluster) break
  }
  const ranks = new Uint16Array(count)
  const pattern = on.slice(), patternEnergy = energy.slice()
  for (let rank = initial - 1; rank >= 0; rank--) {
    const cluster = pick(1, true)
    on[cluster] = 0; toggle(cluster, -1); ranks[cluster] = rank
  }
  on.set(pattern); energy.set(patternEnergy)
  for (let rank = initial; rank < count; rank++) {
    const voidIndex = pick(0, false)
    on[voidIndex] = 1; toggle(voidIndex, 1); ranks[voidIndex] = rank
  }
  return ranks
}
