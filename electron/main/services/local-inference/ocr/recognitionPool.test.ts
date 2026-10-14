import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { OcrRecognitionPool } from './recognitionPool'
import type { PixelCrop } from './recognition'
const state = vi.hoisted(() => ({ delayed: false, workers: [] as Array<{ emit(name: string, value?: unknown): boolean; terminated: boolean }> }))
vi.mock('node:worker_threads', () => ({ Worker: class extends EventEmitter {
  terminated = false
  constructor() { super(); state.workers.push(this) }
  postMessage(message: { crops: PixelCrop[] }): void { if (!state.delayed) queueMicrotask(() => this.emit('message', { result: message.crops.map(c => ({ text: String(c.x), confidence: 1 })) })) }
  async terminate(): Promise<number> { this.terminated = true; this.emit('exit', 0); return 0 }
} }))
afterEach(() => { state.delayed = false; state.workers.length = 0 })
const crops = Array.from({ length: 18 }, (_, x) => ({ x, y: 0, width: 2, height: 48, tensorWidth: 1920 }))
it('并发批次按原行顺序返回，整帧只共享一次且不转移调用者的缓冲区', async () => {
  const pool = new OcrRecognitionPool('model', ['a'], 'rgb-half', 'worker', 3), rgb = new Uint8Array(200)
  const result = await pool.recognize(rgb, 20, crops, new AbortController().signal)
  expect(result.map(r => r.text)).toEqual(crops.map(c => String(c.x)))
  expect(rgb.byteLength).toBe(200); expect(state.workers).toHaveLength(3)
  await pool.dispose(); expect(state.workers.every(w => w.terminated)).toBe(true)
})
it('取消会结束正在运行的原生推理线程，拒绝迟到结果并释放整个池', async () => {
  state.delayed = true
  const pool = new OcrRecognitionPool('model', ['a'], 'rgb-half', 'worker', 3), controller = new AbortController()
  const result = pool.recognize(new Uint8Array(200), 20, crops, controller.signal)
  const rejected = expect(result).rejects.toThrow('停止')
  controller.abort(new Error('停止')); await rejected
  expect(state.workers.every(w => w.terminated)).toBe(true)
})
it('线程失败不能留下部分识别结果或挂起其他批次', async () => {
  state.delayed = true
  const pool = new OcrRecognitionPool('model', ['a'], 'rgb-half', 'worker', 3)
  const result = pool.recognize(new Uint8Array(200), 20, crops, new AbortController().signal)
  const rejected = expect(result).rejects.toThrow()
  state.workers[0].emit('error', new Error('ORT failed')); await rejected
  expect(state.workers.every(w => w.terminated)).toBe(true)
})
