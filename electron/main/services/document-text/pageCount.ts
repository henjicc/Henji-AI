import path from 'node:path'
import { Worker } from 'node:worker_threads'

// 只为估价服务：统计不出就按上限估，不能让识别等太久。
const PAGE_COUNT_TIMEOUT_MS = 20_000

/** 在独立线程里统计文档页数；超时、出错或线程异常退出都返回 null。 */
export function countDocumentPages(file: string, extension: string, script = path.join(__dirname, 'document-pages-worker.cjs')): Promise<number | null> {
  return new Promise(resolve => {
    const worker = new Worker(script, { workerData: { file, extension } })
    let settled = false
    const finish = (pages: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      resolve(pages)
    }
    const timer = setTimeout(() => finish(null), PAGE_COUNT_TIMEOUT_MS)
    worker.once('message', (message: { pages: number | null }) => finish(typeof message?.pages === 'number' ? message.pages : null))
    worker.once('error', () => finish(null))
    worker.once('exit', () => finish(null))
  })
}
