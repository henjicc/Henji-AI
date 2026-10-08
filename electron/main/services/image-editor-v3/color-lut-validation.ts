import path from 'node:path'
import { Worker } from 'node:worker_threads'
/** Parse on a cancellable worker; the main process only coordinates import and immutable storage. */
export async function validateImageColorLut(bytes: Uint8Array, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const worker = new Worker(path.join(__dirname, 'image-color-lut-worker.cjs'), { workerData: bytes, name: 'henji-image-color-lut' })
  try {
    await new Promise<void>((resolve, reject) => {
      const abort = (): void => reject(signal.reason ?? new Error('颜色查找表导入已取消'))
      signal.addEventListener('abort', abort, { once: true })
      const clean = (): void => { signal.removeEventListener('abort', abort) }
      worker.once('message', (message: unknown) => {
        clean()
        if (message && typeof message === 'object' && 'ok' in message && message.ok === true) resolve()
        else reject(new Error(message && typeof message === 'object' && 'message' in message ? String(message.message) : '颜色查找表验证失败'))
      })
      worker.once('error', error => { clean(); reject(error) })
      worker.once('exit', code => { clean(); reject(new Error(`颜色查找表验证进程已退出（${code}）`)) })
      if (signal.aborted) abort()
    })
  } finally { await worker.terminate() }
}
