import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { touchSpectralTile, trimSpectralTiles } from './spectral-tile-budget'

it('细层频谱块超过限额时按最近使用清到八成：读过的块留下，刚用过的与计算中的临时文件不动', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-spectral-tiles-'))
  try {
    const now = Date.parse('2026-10-27T00:00:00Z')
    const tile = (name: string) => path.join(directory, `${name.repeat(64)}.rg`)
    const write = async (file: string, minutesAgo: number): Promise<void> => {
      await fs.writeFile(file, new Uint8Array(100))
      const at = new Date(now - minutesAgo * 60_000)
      await fs.utimes(file, at, at)
    }
    await write(tile('a'), 50); await write(tile('b'), 40); await write(tile('c'), 30); await write(tile('d'), 0.5)
    await write(path.join(directory, '1b4e28ba-2fa1-11d2-883f-0016d3cca427.rg'), 60)
    await fs.mkdir(path.join(directory, 'pyramid')); await write(path.join(directory, 'pyramid', 'level-3-channel-0.rg'), 60)
    // 最旧的块刚被读过：刷新后排到后面。
    await touchSpectralTile(tile('a'), new Date(now - 20 * 60_000))

    const result = await trimSpectralTiles(directory, { budgetBytes: 300, nowMs: now })

    expect(result).toEqual({ removedFiles: 2, removedBytes: 200 })
    const left = await fs.readdir(directory)
    expect(left.sort()).toEqual([`${'a'.repeat(64)}.rg`, `${'d'.repeat(64)}.rg`, '1b4e28ba-2fa1-11d2-883f-0016d3cca427.rg', 'pyramid'].sort())
    expect(await trimSpectralTiles(directory, { budgetBytes: 300, nowMs: now })).toEqual({ removedFiles: 0, removedBytes: 0 })
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
