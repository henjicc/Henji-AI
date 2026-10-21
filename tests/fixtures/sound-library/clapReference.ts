import { readFileSync } from 'node:fs'
import path from 'node:path'

/* CLAP 一致性测试的参考样本（scripts/generate-clap-reference.py 生成）与同一组合成信号。 */

const SR = 48_000
export interface ClapReference { signals: Array<{ kind: string; melStride: number; melSamples: number[]; melMean: number; embedding: number[] }>; texts: Array<{ prompt: string; ids: number[]; embedding: number[] }> }
export const CLAP_REFERENCE = JSON.parse(readFileSync(path.resolve('tests/fixtures/sound-library/clap-reference.json'), 'utf8')) as ClapReference

function lcg(seed: number, count: number): Float64Array {
  const out = new Float64Array(count); let state = seed
  for (let index = 0; index < count; index++) { state = (state * 1664525 + 1013904223) % 4294967296; out[index] = state / 4294967296 * 2 - 1 }
  return out
}
/** 与 scripts/generate-clap-reference.py 的 synthesize() 相同的合成信号。 */
export function synthesizeClapSignal(kind: string): Float32Array {
  if (kind === 'whoosh') {
    const n = Math.trunc(0.6 * SR), noise = lcg(7, n)
    return Float32Array.from({ length: n }, (_, i) => { const t = i / SR, env = Math.sin(Math.PI * t / 0.6) ** 2; return 0.5 * env * noise[i] + 0.2 * env * Math.sin(2 * Math.PI * (300 + 2500 * t) * t) })
  }
  if (kind === 'ding') return Float32Array.from({ length: 2 * SR }, (_, i) => { const t = i / SR; return 0.7 * Math.exp(-3 * t) * (Math.sin(2 * Math.PI * 1760 * t) + 0.3 * Math.sin(2 * Math.PI * 3520 * t)) })
  const n = 12 * SR, noise = lcg(11, n)
  return Float32Array.from({ length: n }, (_, i) => { const t = i / SR; return 0.4 * Math.sin(2 * Math.PI * 220 * t) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.5 * t)) + 0.05 * noise[i] })
}

