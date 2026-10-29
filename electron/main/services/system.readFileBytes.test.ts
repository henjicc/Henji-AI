import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, dialog: {}, shell: {} }))
vi.mock('./media-recycle/queue', () => ({ registerOwnedMedia: vi.fn() }))
import { readFileBytes } from './system'

it('读取超过十六 MiB 的文件，较大调用预算不成为预分配大小', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-file-read-'))
  try {
    const target = path.join(directory, 'source.bin')
    const content = Buffer.alloc(17 * 1024 ** 2, 85)
    await fs.writeFile(target, content)
    expect(Buffer.from(await readFileBytes(target, { maxBytes: 2 ** 40 })).equals(content)).toBe(true)
    await expect(readFileBytes(target, { maxBytes: content.length - 1 })).rejects.toThrow()
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
