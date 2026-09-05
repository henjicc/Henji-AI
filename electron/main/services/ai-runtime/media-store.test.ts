import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ dataDir: '' }))

vi.mock('electron', () => ({ app: { getPath: () => mocks.dataDir } }))
vi.mock('../dataRoot', () => ({ getCustomDataRoot: () => mocks.dataDir }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))

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
    vi.useRealTimers()
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

  it('响应头成功但读取图片中途断流时重取完整图片，不落盘半张图', async () => {
    vi.useFakeTimers()
    const socketError = new TypeError('terminated', { cause: { code: 'UND_ERR_SOCKET' } })
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([137, 80]))
        controller.error(socketError)
      },
    })))
    const saved = saveMediaFromUrlTracked('https://media.example.test/result.png')
    await vi.runAllTimersAsync()
    const result = await saved

    expect(fetch).toHaveBeenCalledTimes(2)
    await expect(fs.readFile(result?.filePath ?? '')).resolves.toEqual(Buffer.from([137, 80, 78, 71, 1, 2, 3]))
    expect(await fs.readdir(path.join(mocks.dataDir, 'Media'))).toHaveLength(1)
  })

  it('下载连续断流只尝试三次，保留底层错误且不创建文件', async () => {
    vi.useFakeTimers()
    const socketError = new TypeError('terminated', { cause: { code: 'UND_ERR_SOCKET' } })
    vi.mocked(fetch).mockRejectedValue(socketError)
    const failure = expect(saveMediaFromUrlTracked('https://media.example.test/result.png'))
      .rejects.toMatchObject({ code: 'media_download_failed', cause: socketError })
    await vi.runAllTimersAsync()
    await failure
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(await fs.readdir(mocks.dataDir)).toEqual([])
  })

  it('临时 HTTP 503 可重试，永久 HTTP 404 直接失败', async () => {
    vi.useFakeTimers()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }))
    const saved = saveMediaFromUrlTracked('https://media.example.test/result.png')
    await vi.runAllTimersAsync()
    await expect(saved).resolves.toMatchObject({ created: true })
    expect(fetch).toHaveBeenCalledTimes(2)

    vi.mocked(fetch).mockClear().mockResolvedValue(new Response(null, { status: 404 }))
    await expect(saveMediaFromUrlTracked('https://media.example.test/missing.png'))
      .rejects.toMatchObject({ code: 'media_download_failed' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('取消不会重试或伪装成可重取结果的下载失败', async () => {
    const cancelled = new DOMException('cancelled', 'AbortError')
    vi.mocked(fetch).mockRejectedValue(cancelled)
    await expect(saveMediaFromUrlTracked('https://media.example.test/result.png')).rejects.toBe(cancelled)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
