import { Worker } from 'node:worker_threads'

export interface WebFileHash { relative: string; size: number; sha256: string }

// 散列在 Worker 流式计算；主进程只传递路径，文件数与文件大小不受人为上限限制。
const SOURCE = `
const { parentPort, workerData } = require('node:worker_threads')
const { createReadStream } = require('node:fs')
const { createHash } = require('node:crypto')
;(async () => {
  const files = [], content = createHash('sha256')
  for (const item of workerData) {
    const hash = createHash('sha256'); let size = 0
    for await (const chunk of createReadStream(item.file)) { hash.update(chunk); size += chunk.length }
    const sha256 = hash.digest('hex')
    files.push({ relative: item.relative, size, sha256 })
    content.update(item.relative + '\\0' + sha256 + '\\n')
  }
  parentPort.postMessage({ files, contentHash: content.digest('hex') })
})().catch(error => { throw error })
`

export async function hashWebSourceFiles(files: readonly { relative: string; file: string }[], signal?: AbortSignal): Promise<{ files: WebFileHash[]; contentHash: string }> {
  signal?.throwIfAborted()
  const worker = new Worker(SOURCE, { eval: true, workerData: files, name: 'henji-web-source-hash' })
  let abort: (() => void) | undefined
  try {
    return await new Promise((resolve, reject) => {
      abort = () => reject(signal?.reason ?? new Error('网页散列已取消'))
      signal?.addEventListener('abort', abort, { once: true })
      worker.once('message', resolve)
      worker.once('error', reject)
      worker.once('exit', code => reject(new Error(`网页散列 Worker 未返回结果（${code}）`)))
    })
  } finally {
    if (abort) signal?.removeEventListener('abort', abort)
    await worker.terminate()
  }
}
