import fs from 'node:fs/promises'
import { Tokenizer } from '@huggingface/tokenizers'
import { analyzeSoundPcm, SOUND_ANALYSIS_SAMPLE_RATE } from '../../../../../src/core/soundLibrary/soundFeatures'
import { CLAP_FRAMES, CLAP_MEL_BINS, clapLogMel, clapWindow, normalizeEmbedding } from '../../../../../src/core/soundLibrary/clapFeatures'
import type { LocalModelRunner } from '../analysis'
import type { LocalInferenceModelFile } from '../protocol'
import type { LocalExecutionProvider, LocalInferenceLog } from '../providers'
import { decodeSound, SoundDecodeError } from './decode'
import type { SoundAnalysisFileResult, SoundAnalysisJob, SoundAnalysisResult, SoundClapModels, SoundTextEmbeddingJob, SoundTextEmbeddingResult } from './protocol'

/*
 * 后台进程里的音效分析：最多 DECODE_CONCURRENCY 个 FFmpeg 同时解码，DSP 测量随解码完成即算；
 * CLAP 推理按批串行（显卡是独占负载），与后续文件的解码重叠。
 */

const DECODE_CONCURRENCY = 4
const CLAP_BATCH = 8
const CLAP_EMBEDDING_SIZE = 512

/** 推理失败（模型或显卡）让整批失败，不当作单个文件损坏。 */
class SoundInferenceError extends Error {
  constructor(cause: unknown) { super(cause instanceof Error ? cause.message : String(cause), { cause }); this.name = 'SoundInferenceError' }
}
/** RoBERTa 的位置上限（含首尾特殊符号）。 */
const TEXT_MAX_TOKENS = 77

export interface SoundAnalysisDependencies {
  openModel(model: LocalInferenceModelFile, providers: readonly LocalExecutionProvider[], shape: string): Promise<LocalModelRunner>
  signal: AbortSignal
  progress(done: number, total: number): void
  log: LocalInferenceLog
}

function embeddingOf(outputs: Record<string, { data: unknown }>, name: string): Float32Array {
  const data = outputs[name]?.data
  if (!(data instanceof Float32Array)) throw new Error(`模型输出 ${name} 不是 float32。`)
  return normalizeEmbedding(data)
}

export async function runSoundAnalysis(job: SoundAnalysisJob, deps: SoundAnalysisDependencies): Promise<SoundAnalysisResult> {
  const audio = job.clap ? await deps.openModel({ name: 'clap_audio', path: job.clap.audioModelPath }, job.providers, `${CLAP_FRAMES}x${CLAP_MEL_BINS}`) : undefined
  const results: SoundAnalysisFileResult[] = new Array(job.files.length)
  let decodeMs = 0, inferenceMs = 0, done = 0, next = 0, queuedBatches = 0
  let chain = Promise.resolve()
  let batch: Array<{ index: number; features: Float32Array }> = []
  // 显卡上一次算 8 条比逐条快近一倍（RTX 4090 DirectML 实测 54 对 96 毫秒/条）；批次之间串行排队。
  const flush = (): Promise<void> => {
    const items = batch; batch = []
    if (!items.length) return chain
    queuedBatches++
    chain = chain.then(async () => {
      deps.signal.throwIfAborted()
      const input = new Float32Array(items.length * CLAP_FRAMES * CLAP_MEL_BINS)
      items.forEach((item, offset) => input.set(item.features, offset * CLAP_FRAMES * CLAP_MEL_BINS))
      const started = performance.now()
      try {
        const output = (await audio!.run({ input_features: { type: 'float32', data: input, dims: [items.length, 1, CLAP_FRAMES, CLAP_MEL_BINS] } })).audio_embeds?.data
        if (!(output instanceof Float32Array) || output.length !== items.length * CLAP_EMBEDDING_SIZE) throw new Error('模型输出 audio_embeds 形状不符。')
        items.forEach((item, offset) => {
          const result = results[item.index]
          if (result?.ok) result.embedding = Array.from(normalizeEmbedding(output.subarray(offset * CLAP_EMBEDDING_SIZE, (offset + 1) * CLAP_EMBEDDING_SIZE)))
        })
      } catch (error) { throw new SoundInferenceError(error) }
      finally { queuedBatches-- }
      inferenceMs += performance.now() - started
    })
    return chain
  }
  const worker = async (): Promise<void> => {
    for (let index = next++; index < job.files.length; index = next++) {
      deps.signal.throwIfAborted()
      const file = job.files[index].path
      const started = performance.now()
      try {
        const decoded = await decodeSound(job.ffmpegPath, file, deps.signal)
        decodeMs += performance.now() - started
        const features = { ...analyzeSoundPcm(decoded.channels), durationSeconds: decoded.durationSeconds }
        results[index] = { path: file, ok: true, features }
        // 梅尔谱随解码即算，只留谱不留 PCM；凑满一批交给推理，排队超过两批时先等推理追上。
        if (audio && features.peakDbfs !== null) {
          const mono = decoded.channels.length === 1 ? decoded.channels[0] : Float32Array.from(decoded.channels[0], (left, i) => (left + decoded.channels[1][i]) / 2)
          batch.push({ index, features: clapLogMel(clapWindow(mono, Math.round(features.hitSeconds * SOUND_ANALYSIS_SAMPLE_RATE))) })
          if (batch.length >= CLAP_BATCH) { const queued = flush(); queued.catch(() => undefined); if (queuedBatches > 2) await queued }
        }
      } catch (error) {
        if (deps.signal.aborted || error instanceof SoundInferenceError) throw error
        results[index] = { path: file, ok: false, reason: error instanceof SoundDecodeError ? error.message : '无法分析这个文件' }
        if (!(error instanceof SoundDecodeError)) deps.log('warn', '音效分析失败', 'sound_library.analysis.file_failed', { reason: error instanceof Error ? error.message.slice(0, 300) : String(error) })
      }
      deps.progress(++done, job.files.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(DECODE_CONCURRENCY, job.files.length) }, worker))
  await flush()
  return { files: results, provider: audio?.provider ?? null, decodeMs: Math.round(decodeMs), inferenceMs: Math.round(inferenceMs) }
}

let tokenizer: { path: string; value: Promise<Tokenizer> } | undefined
async function loadTokenizer(clap: SoundClapModels): Promise<Tokenizer> {
  if (tokenizer?.path !== clap.tokenizerPath) {
    tokenizer = { path: clap.tokenizerPath, value: Promise.all([fs.readFile(clap.tokenizerPath, 'utf8'), fs.readFile(clap.tokenizerConfigPath, 'utf8')]).then(([json, config]) => new Tokenizer(JSON.parse(json) as object, JSON.parse(config) as object)) }
    tokenizer.value.catch(() => { tokenizer = undefined })
  }
  return tokenizer.value
}

/** 与 transformers RobertaTokenizer 相同的编码（首尾 <s> </s>，不补齐，模型没有 attention_mask 输入）。 */
export async function clapTokenIds(clap: SoundClapModels, text: string): Promise<number[]> {
  const ids = (await loadTokenizer(clap)).encode(text).ids
  return ids.length <= TEXT_MAX_TOKENS ? ids : [...ids.slice(0, TEXT_MAX_TOKENS - 1), ids[ids.length - 1]]
}

export async function runSoundTextEmbedding(job: SoundTextEmbeddingJob, deps: Omit<SoundAnalysisDependencies, 'progress'>): Promise<SoundTextEmbeddingResult> {
  const model = await deps.openModel({ name: 'clap_text', path: job.clap.textModelPath }, job.providers, 'dynamic')
  const embeddings: number[][] = []
  for (const text of job.texts) {
    deps.signal.throwIfAborted()
    const ids = await clapTokenIds(job.clap, text)
    const outputs = await model.run({ input_ids: { type: 'int64', data: BigInt64Array.from(ids, BigInt), dims: [1, ids.length] } })
    embeddings.push(Array.from(embeddingOf(outputs, 'text_embeds')))
  }
  return { embeddings }
}
