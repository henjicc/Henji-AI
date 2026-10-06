import { videoEditFft } from './fft'

export const VIDEO_EDIT_MULTICAM_SYNC_RATE = 1000
/** Positive offset means candidate starts later on the reference clock. Linear, zero-padded correlation. */
export function videoEditAudioOffset(reference: Float32Array, candidate: Float32Array, sampleRate = VIDEO_EDIT_MULTICAM_SYNC_RATE): { seconds: number; confidence: number } {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || Math.max(reference.length, candidate.length) > sampleRate * 1800) throw new Error('同步声音最长为30分钟。')
  const minimum = Math.max(8, Math.min(Math.round(sampleRate), Math.floor(Math.min(reference.length, candidate.length) / 4)))
  if (Math.min(reference.length, candidate.length) < Math.max(minimum, sampleRate / 2)) throw new Error('声音太短，无法同步，请使用入点或时间码。')
  let size = 1
  while (size < reference.length + candidate.length - 1) size *= 2
  const ar = new Float64Array(size); const ai = new Float64Array(size); const br = new Float64Array(size); const bi = new Float64Array(size)
  const energy = (input: Float32Array, real: Float64Array): Float64Array => {
    let mean = 0
    for (const value of input) { if (!Number.isFinite(value)) throw new Error('声音包含无效样本。'); mean += value }
    mean /= input.length
    const sums = new Float64Array(input.length + 1)
    for (let i = 0; i < input.length; i++) { real[i] = input[i] - mean; sums[i + 1] = sums[i] + real[i] ** 2 }
    return sums
  }
  const ae = energy(reference, ar); const be = energy(candidate, br)
  if (ae.at(-1)! < 1e-10 || be.at(-1)! < 1e-10) throw new Error('声音为静音，无法同步，请使用入点或时间码。')
  videoEditFft(ar, ai, -1); videoEditFft(br, bi, -1)
  for (let i = 0; i < size; i++) { const r = ar[i] * br[i] + ai[i] * bi[i]; ai[i] = ai[i] * br[i] - ar[i] * bi[i]; ar[i] = r }
  videoEditFft(ar, ai, 1)
  let best = -1; let offset = 0
  for (let lag = -candidate.length + minimum; lag <= reference.length - minimum; lag++) {
    const from = Math.max(0, lag); const to = Math.min(reference.length, candidate.length + lag)
    const norm = Math.sqrt((ae[to] - ae[from]) * (be[to - lag] - be[from - lag]))
    const score = norm > 1e-10 ? Math.abs(ar[(lag + size) % size] / size) / norm : 0
    if (score > best) { best = score; offset = lag }
  }
  if (best < .2) throw new Error('未找到可靠的共同声音，请使用入点或时间码同步。')
  if (best > .9) for (let lag = -candidate.length + minimum; lag <= reference.length - minimum; lag++) {
    if (Math.abs(lag - offset) < sampleRate / 15) continue
    const from = Math.max(0, lag); const to = Math.min(reference.length, candidate.length + lag)
    const norm = Math.sqrt((ae[to] - ae[from]) * (be[to - lag] - be[from - lag]))
    if (norm > 1e-10 && Math.abs(ar[(lag + size) % size] / size) / norm > best * .999) throw new Error('声音存在多个相同的同步位置，请使用入点或时间码。')
  }
  return { seconds: offset / sampleRate, confidence: Math.min(1, best) }
}

/** Box low-pass followed by decimation; 48k/44.1k inputs share an absolute 1k clock. */
export function videoEditMulticamDownsample(planes: readonly Float32Array[], rate: number): Float32Array {
  if (!planes.length || !Number.isFinite(rate) || rate < VIDEO_EDIT_MULTICAM_SYNC_RATE || planes.some(plane => plane.length !== planes[0].length)) throw new Error('同步声音采样格式无效。')
  const size = Math.floor(planes[0].length * VIDEO_EDIT_MULTICAM_SYNC_RATE / rate)
  const output = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    const from = Math.floor(i * rate / VIDEO_EDIT_MULTICAM_SYNC_RATE); const to = Math.floor((i + 1) * rate / VIDEO_EDIT_MULTICAM_SYNC_RATE)
    // Pick first channel to avoid anti-phase stereo cancellation.
    for (let j = from; j < to; j++) output[i] += planes[0][j] / (to - from)
  }
  return output
}
