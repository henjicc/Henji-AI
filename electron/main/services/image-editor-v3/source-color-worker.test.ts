import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { WorkerOptions } from 'node:worker_threads'
import { buildImageColorTestWorker } from './image-color-worker.test-support'
import { decodeStandardRgbInWorker } from './source-color-worker'

const state = vi.hoisted(() => ({ workerPath: '' }))
vi.mock('node:worker_threads', async () => {
  const actual = await vi.importActual<typeof import('node:worker_threads')>('node:worker_threads')
  return { ...actual, Worker: class extends actual.Worker {
    constructor(_file: string | URL, options?: WorkerOptions) { super(state.workerPath, options) }
  } }
})
vi.mock('../logging', () => ({ createMainLogger: () => ({ debug: vi.fn(), warn: vi.fn() }) }))
let cleanup: () => Promise<void>
beforeAll(async () => { const worker = await buildImageColorTestWorker(); state.workerPath = worker.path; cleanup = worker.cleanup })
afterAll(async () => { await cleanup() })

it('正式颜色 Worker 移交缓冲、保留 P3 负值/超白和 Alpha，取消后不返回像素', async () => {
  const input = Buffer.allocUnsafeSlow(8)
  input.writeUInt16LE(65535, 0); input.writeUInt16LE(0, 2); input.writeUInt16LE(0, 4); input.writeUInt16LE(32768, 6)
  const result = await decodeStandardRgbInWorker(input, 'display-p3', 32)
  expect(input.byteLength).toBe(0)
  expect(result.readFloatLE(0)).toBeGreaterThan(1.2)
  expect(result.readFloatLE(4)).toBeLessThan(-.04)
  expect(result.readFloatLE(12)).toBeCloseTo(32768 / 65535, 6)
  const controller = new AbortController()
  const cancelled = decodeStandardRgbInWorker(Buffer.allocUnsafeSlow(16 * 1024 * 1024), 'display-p3', 32, controller.signal)
  controller.abort()
  await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
})
