import { expect, it, vi } from 'vitest'
import { AudioLoudnessSession } from './loudness'

const disk = vi.hoisted(() => ({ available: 1024 ** 3, bytes: 0, removed: vi.fn() }))
vi.mock('node:fs/promises', () => ({ default: {
  mkdtemp: async () => 'D:/temporary-loudness', writeFile: async () => {},
  statfs: async () => ({ bavail: disk.available, bsize: 1 }),
  appendFile: async (_path: string, bytes: Uint8Array) => { disk.bytes += bytes.length },
  rm: disk.removed,
} }))

it('超过30分钟仍分块落盘，块大小、磁盘不足和取消约束保留', async () => {
  const session = new AudioLoudnessSession(44100, 1)
  await session.initialize()
  try {
    const plane = new Float32Array(44100 * 2)
    for (let block = 0; block < 901; block++) await session.append([plane])
    expect(disk.bytes).toBe(44100 * 1802 * 4)
    await expect(session.append([new Float32Array(44100 * 2 + 1)])).rejects.toThrow('最多两秒')
    disk.available = 0
    await expect(session.append([plane])).rejects.toThrow('磁盘空间不足')
  } finally { await session.close() }
  await expect(session.append([new Float32Array(1)])).rejects.toThrow('关闭')
  expect(disk.removed).toHaveBeenCalled()
}, 30000)
