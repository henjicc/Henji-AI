import path from 'node:path'
import { Worker, type TransferListItem } from 'node:worker_threads'
/** Parse on a cancellable worker; the main process only coordinates import and immutable storage. */
export async function runImageColorWorker(workerData: unknown, transferList: TransferListItem[], signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted()
  const worker = new Worker(path.join(__dirname, 'image-color-lut-worker.cjs'), { workerData, transferList, name: 'henji-image-color' })
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const abort = (): void => { clean(); reject(signal?.reason ?? new Error('图片颜色处理已取消')) }
      const timer = setTimeout(() => { clean(); reject(new Error('图片颜色处理超时，请重试。')) }, 30_000)
      timer.unref()
      signal?.addEventListener('abort', abort, { once: true })
      const clean = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
      worker.once('message', (message: unknown) => {
        clean()
        if (message && typeof message === 'object' && 'ok' in message && message.ok === true) resolve(message)
        else reject(new Error(message && typeof message === 'object' && 'message' in message ? String(message.message) : '颜色查找表验证失败'))
      })
      worker.once('error', error => { clean(); reject(error) })
      worker.once('exit', code => { clean(); reject(new Error(`颜色查找表验证进程已退出（${code}）`)) })
      if (signal?.aborted) abort()
    })
  } finally { await worker.terminate() }
}

export async function validateImageColorLut(bytes: Uint8Array, signal: AbortSignal): Promise<void> {
  await runImageColorWorker(bytes, [], signal)
}
