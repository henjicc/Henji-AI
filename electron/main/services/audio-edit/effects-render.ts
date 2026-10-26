import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { audioEditRealtimeEffects } from '../../../../src/core/audioEdit/effects'
import type { AudioEffectInstance } from '../../../../src/core/audio/effects/audioEffectChain'
import type { AudioEditProjectDocument } from '../../../../src/core/audioEdit/types'
import { audioEditCacheDirectory } from './media'
import { audioRenderKey, cachedAudioFile } from './render-cache'

/**
 * 导出、动态链接用的声音过一遍边播边算的那段效果（效果链末尾的实时效果 + 输出）：与试听同一份实现，在主进程工作线程里离线处理，
 * 按“输入文件 + 效果”缓存（输入本身已按内容命名），没改过效果就直接复用。没有效果时原样返回输入。
 */
export async function applyAudioEditRealtimeEffects(project: AudioEditProjectDocument, input: string, signal?: AbortSignal, onProgress?: (value: number) => void): Promise<string> {
  return applyAudioEffectInstancesToFile(project.id, input, audioEditRealtimeEffects(project), signal, onProgress)
}

/** 把一串实时效果离线跑过一个 32 位浮点 WAV（效果链里排在整段处理效果之前的实时效果也用它）。 */
export async function applyAudioEffectInstancesToFile(projectId: string, input: string, effects: readonly AudioEffectInstance[], signal?: AbortSignal, onProgress?: (value: number) => void): Promise<string> {
  if (!effects.length) return input
  const key = audioRenderKey(['effects-v1', path.basename(input), effects.map(({ builtin, amount }) => ({ builtin, amount }))])
  return cachedAudioFile(audioEditCacheDirectory(projectId), `fx-${key}`, 'wav', output => runEffectsWorker(input, output, effects, signal, onProgress), signal)
}

function runEffectsWorker(input: string, output: string, effects: readonly AudioEffectInstance[], signal?: AbortSignal, onProgress?: (value: number) => void): Promise<void> {
  signal?.throwIfAborted()
  const worker = new Worker(path.join(__dirname, 'audio-edit-effects-worker.cjs'), { workerData: { input, output, effects } })
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      void worker.terminate()
      if (error) reject(error); else resolve()
    }
    const abort = (): void => finish(signal?.reason ?? new Error('效果处理已取消'))
    signal?.addEventListener('abort', abort, { once: true })
    worker.on('message', (message: { type: 'progress'; value: number } | { type: 'done' } | { type: 'error'; message: string }) => {
      if (message.type === 'progress') onProgress?.(message.value)
      else if (message.type === 'done') finish()
      else finish(new Error(`效果处理失败：${message.message}`))
    })
    worker.once('error', error => finish(error))
    worker.once('exit', code => { if (code !== 0) finish(new Error(`效果处理未完成：${code}`)) })
  })
}
