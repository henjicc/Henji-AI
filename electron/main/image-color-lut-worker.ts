import { parentPort, workerData } from 'node:worker_threads'
import { parseCubeLut } from '../../src/core/imaging/lut/cube'
try {
  if (!(workerData instanceof Uint8Array)) throw new Error('颜色查找表内容不可用')
  parseCubeLut(new TextDecoder().decode(workerData))
  parentPort?.postMessage({ ok: true })
} catch (error) {
  parentPort?.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) })
}
