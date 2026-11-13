import fs from 'node:fs/promises'
import { parentPort, workerData } from 'node:worker_threads'
import { countDocumentPagesFromBytes } from './services/document-text/pageCounter'

// 解析整份 PDF 是 CPU 重活，放在独立线程，不阻塞主进程。加密、损坏的文件返回 null。
const { file, extension } = workerData as { file: string; extension: string }
fs.readFile(file)
  .then(bytes => countDocumentPagesFromBytes(new Uint8Array(bytes), extension))
  .then(pages => parentPort?.postMessage({ pages }))
  .catch(() => parentPort?.postMessage({ pages: null }))
