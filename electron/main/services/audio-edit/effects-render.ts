import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { audioEditRealtimeEffects } from '../../../../src/core/audioEdit/effects'
import type { AudioEditProjectDocument } from '../../../../src/core/audioEdit/types'
import { audioEditCacheDirectory } from './media'
import { audioRenderKey, cachedAudioFile } from './render-cache'

/**
 * 导出、动态链接用的声音过一遍实时效果链（基本声音 + 效果组）：与试听同一份实现，在主进程工作线程里离线处理，
 * 按“输入文件 + 效果链”缓存（输入本身已按内容命名），没改过效果就直接复用。没有效果时原样返回输入。
 */
export async function applyAudioEditRealtimeEffects(project: AudioEditProjectDocument, input: string, signal?: AbortSignal, onProgress?: (value: number) => void): Promise<string> {
  const effects = audioEditRealtimeEffects(project)
  if (!effects.length) return input
  const key = audioRenderKey(['effects-v1', path.basename(input), effects.map(({ builtin, amount }) => ({ builtin, amount }))])
  return cachedAudioFile(audioEditCacheDirectory(project.id), `fx-${key}`, 'wav', output => runEffectsWorker(input, output, effects, signal, onProgress), signal)
}

function runEffectsWorker(input: string, output: string, effects: ReturnType<typeof audioEditRealtimeEffects>, signal?: AbortSignal, onProgress?: (value: number) => void): Promise<void> {
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
