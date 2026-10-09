import fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }))
vi.mock('../logging', () => ({ createMainLogger: () => mocks }))
vi.mock('../keystore', () => ({ getAiProviderApiKey: vi.fn(), getLlmProviderApiKey: vi.fn(), getKey: vi.fn() }))
vi.mock('../../../../src/core/modelCatalog/applicationModelProfile', () => ({ createHenjiAIClient: vi.fn(() => ({})) }))
vi.mock('./network-transport', () => ({ createDiagnosticTransport: vi.fn() }))

import { electronMediaReader } from './sdk-runtime'

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

describe('Electron SDK media reader', () => {
  it('本地 reader 异步读取并保持公共 DTO 的字节、MIME 和文件名', async () => {
    const bytes = Buffer.from([0, 255, 128, 1])
    const read = vi.spyOn(fs.promises, 'readFile').mockResolvedValue(bytes)
    const result = await electronMediaReader.read(' /media/input.png ')
    expect(result).toEqual({ bytes, mimeType: 'image/png', filename: 'input.png' })
    expect(result.bytes).toBe(bytes)
    expect(read).toHaveBeenCalledWith('/media/input.png')
  })

  it('内嵌媒体保持 DTO，且不读取文件系统', async () => {
    const read = vi.spyOn(fs.promises, 'readFile')
    const bytes = Buffer.from([0, 255, 128, 1])
    const result = await electronMediaReader.read(`data:image/png;base64,${bytes.toString('base64')}`)
    expect(result.bytes).toEqual(Uint8Array.from(bytes))
    expect(result.mimeType).toBe('image/png')
    expect(result.filename).toMatch(/^file_\d+\.png$/)
    expect(read).not.toHaveBeenCalled()
  })

  it('读取失败保留原始错误并进入既有日志入口', async () => {
    const error = Object.assign(new Error('not found'), { code: 'ENOENT' })
    vi.spyOn(fs.promises, 'readFile').mockRejectedValue(error)
    await expect(electronMediaReader.read('/media/missing.png')).rejects.toBe(error)
    expect(mocks.error).toHaveBeenCalledWith('读取 SDK 本地媒体失败', { event: 'sdk.media.read.failed', error })
  })
})
