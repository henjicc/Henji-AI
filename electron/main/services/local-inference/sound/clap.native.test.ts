import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLAP_FRAMES, CLAP_MEL_BINS, clapLogMel, clapWindow, cosineSimilarity, normalizeEmbedding } from '../../../../../src/core/soundLibrary/clapFeatures'
import { CLAP_REFERENCE, synthesizeClapSignal } from '../../../../../tests/fixtures/sound-library/clapReference'
import { LocalModelSessions, loadOnnxRuntime } from '../onnxRuntime'
import { executionProviderOrder } from '../providers'
import { clapTokenIds, runSoundTextEmbedding } from './analyze'

/*
 * 需要真实模型文件：HENJI_CLAP_MODELS 指向含 larger_clap_general_{audio,text}_fp16.onnx 与 tokenizer(_config).json 的目录
 * （即本地模型 audio_understanding_clap 的下载目录）。参考向量由 transformers ClapProcessor + 同一 fp16 模型生成。
 */
const dir = process.env.HENJI_CLAP_MODELS
const clap = dir ? { audioModelPath: path.join(dir, 'larger_clap_general_audio_fp16.onnx'), textModelPath: path.join(dir, 'larger_clap_general_text_fp16.onnx'), tokenizerPath: path.join(dir, 'tokenizer.json'), tokenizerConfigPath: path.join(dir, 'tokenizer_config.json') } : undefined

describe.skipIf(!clap)('CLAP 预处理、分词与 onnxruntime-node 推理和 Python 参考一致', () => {
  it.each(CLAP_REFERENCE.texts.map(text => [text.prompt, text] as const))('分词与文本向量：%s', async (_prompt, reference) => {
    expect(await clapTokenIds(clap!, reference.prompt)).toEqual(reference.ids)
    const pool = new LocalModelSessions(await loadOnnxRuntime(), () => undefined)
    try {
      const { embeddings } = await runSoundTextEmbedding({ id: 't', clap: clap!, texts: [reference.prompt], providers: executionProviderOrder(process.platform) }, { openModel: (model, providers, shape) => pool.open(model, providers, shape), signal: new AbortController().signal, log: () => undefined })
      expect(cosineSimilarity(embeddings[0], reference.embedding)).toBeGreaterThanOrEqual(0.999)
    } finally { await pool.dispose() }
  }, 120_000)

  it('音频向量：短、中、长（确定性窗口）三段合成声音', async () => {
    const pool = new LocalModelSessions(await loadOnnxRuntime(), () => undefined)
    try {
      const runner = await pool.open({ name: 'clap_audio', path: clap!.audioModelPath }, executionProviderOrder(process.platform), `${CLAP_FRAMES}x${CLAP_MEL_BINS}`)
      for (const reference of CLAP_REFERENCE.signals) {
        const features = clapLogMel(clapWindow(synthesizeClapSignal(reference.kind), 7 * 48_000))
        const outputs = await runner.run({ input_features: { type: 'float32', data: features, dims: [1, 1, CLAP_FRAMES, CLAP_MEL_BINS] } })
        const similarity = cosineSimilarity(normalizeEmbedding(outputs.audio_embeds.data as Float32Array), reference.embedding)
        expect(similarity, reference.kind).toBeGreaterThanOrEqual(0.999)
      }
      // 整理时按批推理：同一批三段声音的向量与逐条参考一致。
      const size = CLAP_FRAMES * CLAP_MEL_BINS, batch = new Float32Array(size * CLAP_REFERENCE.signals.length)
      CLAP_REFERENCE.signals.forEach((reference, index) => batch.set(clapLogMel(clapWindow(synthesizeClapSignal(reference.kind), 7 * 48_000)), index * size))
      const batched = (await runner.run({ input_features: { type: 'float32', data: batch, dims: [CLAP_REFERENCE.signals.length, 1, CLAP_FRAMES, CLAP_MEL_BINS] } })).audio_embeds.data as Float32Array
      CLAP_REFERENCE.signals.forEach((reference, index) => expect(cosineSimilarity(normalizeEmbedding(batched.subarray(index * 512, (index + 1) * 512)), reference.embedding), `${reference.kind} batch`).toBeGreaterThanOrEqual(0.999))
    } finally { await pool.dispose() }
  }, 120_000)
})
