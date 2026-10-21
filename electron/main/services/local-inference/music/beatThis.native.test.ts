import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { aggregateBeatThis, BEAT_THIS_CHUNK, BEAT_THIS_MELS, BEAT_THIS_SAMPLE_RATE, beatThisChunkStarts, beatThisMinimalPostprocess, beatThisSpectrogram, beatThisWindow } from '../../../../../src/core/audioAnalysis/music/beatThis'
import reference from '../../../../../tests/fixtures/music/beatThisReference.json'
import { LocalModelSessions, loadOnnxRuntime } from '../onnxRuntime'
import { executionProviderOrder } from '../providers'

/*
 * 需要真实模型文件：HENJI_BEAT_THIS_MODEL 指向含 beat_this.onnx 与 mel-filterbank.bin 的目录（本地模型 music_beats_beat_this 的下载目录）。
 * 参考拍点由官方 beat_this 1.1.0（final0 检查点，sha256 8c328b45…，dbn=False）对同一公式合成的 40 秒 128 BPM 鼓组生成。
 */
const dir = process.env.HENJI_BEAT_THIS_MODEL

/** 与 Python 参考脚本逐样本相同的合成：底鼓（下拍更响）、偶数拍军鼓噪声、半拍踩镲、A 小三和弦铺底。 */
function synthesize(seconds = 40, bpm = 128): Float32Array {
  const n = Math.floor(seconds * BEAT_THIS_SAMPLE_RATE), x = new Float64Array(n), beat = 60 / bpm
  const noise = new Float64Array(n)
  let seed = 12345n
  for (let i = 0; i < n; i++) { seed = (seed * 1103515245n + 12345n) % 2147483648n; noise[i] = Number(seed) / 2147483648 * 2 - 1 }
  for (let k = 0; k * beat < seconds; k++) {
    const s = Math.round(k * beat * BEAT_THIS_SAMPLE_RATE), length = Math.min(n - s, Math.floor(0.25 * BEAT_THIS_SAMPLE_RATE)), amp = k % 4 === 0 ? 1 : 0.6
    for (let i = 0; i < length; i++) { const t = i / BEAT_THIS_SAMPLE_RATE; x[s + i] += amp * Math.sin(2 * Math.PI * 55 * t) * Math.exp(-t * 18) }
    if (k % 2 === 1) { const snare = Math.min(n - s, Math.floor(0.12 * BEAT_THIS_SAMPLE_RATE)); for (let i = 0; i < snare; i++) x[s + i] += 0.35 * noise[s + i] * Math.exp(-i / BEAT_THIS_SAMPLE_RATE * 30) }
    const h = Math.round((k + 0.5) * beat * BEAT_THIS_SAMPLE_RATE), hat = Math.min(Math.max(0, n - h), Math.floor(0.04 * BEAT_THIS_SAMPLE_RATE))
    for (let i = 0; i < hat; i++) x[h + i] += 0.12 * noise[h + i] * Math.exp(-i / BEAT_THIS_SAMPLE_RATE * 90)
  }
  for (const frequency of [220, 277.18, 329.63]) for (let i = 0; i < n; i++) x[i] += 0.05 * Math.sin(2 * Math.PI * frequency * i / BEAT_THIS_SAMPLE_RATE)
  return Float32Array.from(x, value => value * 0.5)
}

describe.skipIf(!dir)('Beat This! 宿主前后处理与 onnxruntime-node 推理和官方实现一致', () => {
  it('合成鼓组的拍与下拍逐个相同', async () => {
    const bytes = fs.readFileSync(path.join(dir!, 'mel-filterbank.bin'))
    const spectrogram = beatThisSpectrogram(synthesize(), new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)))
    const pool = new LocalModelSessions(await loadOnnxRuntime(), () => undefined)
    try {
      const runner = await pool.open({ name: 'beat_this', path: path.join(dir!, 'beat_this.onnx') }, executionProviderOrder(process.platform), `1x${BEAT_THIS_CHUNK}x${BEAT_THIS_MELS}`)
      const starts = beatThisChunkStarts(spectrogram.frames)
      const predictions = []
      for (const start of starts) {
        const outputs = await runner.run({ spect: { type: 'float32', data: beatThisWindow(spectrogram, start), dims: [1, BEAT_THIS_CHUNK, BEAT_THIS_MELS] } })
        predictions.push({ beat: outputs.beat.data as Float32Array, downbeat: outputs.downbeat.data as Float32Array })
      }
      const aggregated = aggregateBeatThis(spectrogram.frames, starts, predictions)
      const result = beatThisMinimalPostprocess(aggregated.beat, aggregated.downbeat)
      expect(result.beats.map(value => Math.round(value * 1e4) / 1e4)).toEqual(reference.beats)
      expect(result.downbeats.map(value => Math.round(value * 1e4) / 1e4)).toEqual(reference.downbeats)
    } finally { await pool.dispose() }
  }, 180_000)
})
