import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ dataDir: '' }))

vi.mock('electron', () => ({ app: { getPath: () => mocks.dataDir } }))
vi.mock('../dataRoot', () => ({ getCustomDataRoot: () => mocks.dataDir }))

import { saveMediaFromUrlTracked } from './media-store'
import {
  resetManagedMediaFileLeasesForTest,
} from '../image/managed-media-leases'
import { releaseManagedGenerationMediaPaths } from '../image/path-utils'

describe('AI Runtime 受管媒体所有权', () => {
  beforeEach(async () => {
    mocks.dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-ai-media-store-'))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
      { status: 200, headers: { 'content-type': 'image/png' } },
    )))
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    resetManagedMediaFileLeasesForTest()
    await fs.rm(mocks.dataDir, { recursive: true, force: true })
  })

  it('首次保存内容寻址媒体时报告本次创建的文件', async () => {
    const result = await saveMediaFromUrlTracked('https://media.example.test/result.png')

    expect(result).toMatchObject({ created: true })
    expect(result?.filePath).toMatch(/[/\\]Media[/\\]ai_[a-f0-9]{16}\.png$/)
    await expect(fs.readFile(result?.filePath ?? '')).resolves.toEqual(
      Buffer.from([137, 80, 78, 71, 1, 2, 3]),
    )
  })

  it('进程启动前已存在的相同内容不冒充本次调用的临时所有权', async () => {
    const first = await saveMediaFromUrlTracked('https://media.example.test/result.png')
    resetManagedMediaFileLeasesForTest()
    const second = await saveMediaFromUrlTracked('https://cdn.example.test/same.png')

    expect(first).toMatchObject({ created: true })
    expect(second).toEqual({ filePath: first?.filePath, created: false })
  })

  it('同进程两次相同输出各持有租约，交错释放时最后一份才删除', async () => {
    const [first, second] = await Promise.all([
      saveMediaFromUrlTracked('https://media.example.test/result.png'),
      saveMediaFromUrlTracked('https://cdn.example.test/same.png'),
    ])
    const filePath = first?.filePath ?? ''

    expect(first).toEqual({ filePath, created: true })
    expect(second).toEqual({ filePath, created: true })

    releaseManagedGenerationMediaPaths([filePath])
    await expect(fs.stat(filePath)).resolves.toBeDefined()

    releaseManagedGenerationMediaPaths([filePath])
    await expect(fs.stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
