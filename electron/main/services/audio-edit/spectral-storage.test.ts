import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { spectralColumnCount } from '../../../../src/core/audioEdit/spectralPyramid'
import { readSpectralRange } from './spectral-storage'

let directory: string
const metadata = { sampleRate: 48000, channels: 2, durationFrames: 8192000, lowBins: 205, highBins: 1025 }
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-spectral-storage-')) })
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }) })
async function publish(available: number, done = false): Promise<void> {
  const counts = Array.from({ length: 16 }, (_, level) => level < 3 ? 0 : done ? spectralColumnCount(level, metadata.durationFrames) : level === 3 ? available : 0)
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ format: 'spectral-pyramid-v1', ...metadata, available: counts, coveredFrames: done ? metadata.durationFrames : available * 4096 - 256, done }))
  for (let channel = 0; channel < 2; channel++) {
    await fs.writeFile(path.join(directory, `level-3-channel-${channel}.rg`), new Uint8Array(counts[3] * 2460).fill(channel + 51))
  }
}
it('尚无清单返回零列；部分文件只读取已发布列，并保持声道平面', async () => {
  expect(await readSpectralRange(directory, 3, 0, metadata)).toMatchObject({ columnCount: 0, complete: false })
  await publish(1100)
  const full = await readSpectralRange(directory, 3, 0, metadata)
  expect(full).toMatchObject({ columnCount: 1024, complete: true })
  const partial = await readSpectralRange(directory, 3, 1, metadata)
  expect(partial).toMatchObject({ columnStart: 1024, columnCount: 76, complete: false })
  expect(partial.values).toBeInstanceOf(Uint8Array)
  expect(partial.values.slice(0, 76 * 2460).every(v => v === 51)).toBe(true)
  expect(partial.values.slice(76 * 2460).every(v => v === 52)).toBe(true)
  expect(await readSpectralRange(directory, 3, 3, metadata)).toMatchObject({ columnCount: 0, complete: true })
})
it('完成后返回完整尾块，截断数据明确失败', async () => {
  await publish(0, true)
  const result = await readSpectralRange(directory, 3, 1, metadata)
  expect(result).toMatchObject({ columnCount: spectralColumnCount(3, metadata.durationFrames) - 1024, complete: true })
  await fs.truncate(path.join(directory, 'level-3-channel-1.rg'), 20)
  await expect(readSpectralRange(directory, 3, 0, metadata)).rejects.toThrow('不完整')
})
it('显式性能专项：读取真实整文件产物的 1024 列', async () => {
  const target = process.env.HENJI_SPECTRAL_BENCH_DIR
  if (!target) return
  const input = { ...metadata, durationFrames: 28800000 }
  const times: number[] = []
  for (let i = 0; i < 11; i++) {
    const began = performance.now()
    const result = await readSpectralRange(target, 3, 2, input)
    times.push(performance.now() - began)
    expect(result.values.byteLength).toBe(5038080)
    expect(result.complete).toBe(true)
  }
  // eslint-disable-next-line no-console -- 显式性能专项输出实测数字。
  console.info('频谱持久层读取毫秒', JSON.stringify({ cold: times[0], warm: times.slice(1) }))
  expect(Math.max(...times.slice(1))).toBeLessThanOrEqual(10)
})
