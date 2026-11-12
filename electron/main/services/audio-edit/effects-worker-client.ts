import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type { AudioEffectInstance } from '../../../../src/core/audio/effects/audioEffectChain'
import type { AudioEditPcmJob } from './pcm-jobs'

/** 效果工作线程（effects-worker.ts）能做的活：离线跑实时效果链，或区间音量、成片拼接这类整段 PCM 处理。 */
export type AudioEditEffectsWorkerJob = { kind: 'effects'; input: string; output: string; effects: AudioEffectInstance[] } | AudioEditPcmJob

const WORKER_SCRIPT = 'audio-edit-effects-worker.cjs'

/**
 * 整段声音处理的唯一线程入口：主进程只派活、等结果。取消、出错或线程异常退出时等线程结束（文件句柄已关）再返回，
 * 缓存层随后才能删掉半成品。script 只给测试换成极小的真实线程脚本。
 */
export function runAudioEditEffectsWorker(job: AudioEditEffectsWorkerJob, signal?: AbortSignal, onProgress?: (value: number) => void, script = path.join(__dirname, WORKER_SCRIPT)): Promise<void> {
  signal?.throwIfAborted()
  const worker = new Worker(script, { workerData: job })
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      void worker.terminate().finally(() => { if (error) reject(error); else resolve() })
    }
    const abort = (): void => finish(signal?.reason ?? new Error('声音处理已取消'))
    signal?.addEventListener('abort', abort, { once: true })
    worker.on('message', (message: { type: 'progress'; value: number } | { type: 'done' } | { type: 'error'; message: string }) => {
      if (message.type === 'progress') onProgress?.(message.value)
      else if (message.type === 'done') finish()
      else finish(new Error(`声音处理失败：${message.message}`))
    })
    worker.once('error', error => finish(error))
    worker.once('exit', code => finish(code === 0 ? new Error('声音处理线程提前结束') : new Error(`声音处理未完成：${code}`)))
  })
}
