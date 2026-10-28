import { describe, expect, it, vi } from 'vitest'
const create = vi.hoisted(() => vi.fn())
const logError = vi.hoisted(() => vi.fn())
vi.mock('@/core/logging', () => ({ createLogger: () => ({ info: vi.fn(), error: logError }) }))
vi.mock('@/commands/assetLibrary', () => ({ createAsset: create }))
import { addMediaReferenceToLibrary, resolveLocalAssetPath } from './assetCollectionService'

it('资产收录统一短名，不改媒体位置；工作区导出拼接长名也不越界', async () => {
  create.mockResolvedValue({ id: 'asset' })
  const filePath = 'D:/generated/result.png'
  await addMediaReferenceToLibrary({ filePath, mediaType: 'image', source: 'generated', displayName: '👨‍👩‍👧‍👦'.repeat(70) })
  expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ filePath, displayName: `${'👨‍👩‍👧‍👦'.repeat(7)}…` }))
  await addMediaReferenceToLibrary({ filePath, mediaType: 'video', source: 'video-edit', displayName: `工程${'帧'.repeat(240)}观察` })
  expect(create.mock.calls.at(-1)![0].displayName.length).toBeLessThanOrEqual(80)
})

describe('resolveLocalAssetPath', () => {
  it('解析 Electron 媒体协议中的 Windows 路径', () => {
    expect(resolveLocalAssetPath('henji-media://local/C%3A%5CMedia%5Cdemo.png'))
      .toBe('C:\\Media\\demo.png')
  })

  it('保留原始本地路径并拒绝远程或内存 URL', () => {
    expect(resolveLocalAssetPath('D:\\Videos\\demo.mp4')).toBe('D:\\Videos\\demo.mp4')
    expect(resolveLocalAssetPath('https://example.com/demo.png')).toBeNull()
    expect(resolveLocalAssetPath('blob:demo')).toBeNull()
  })
})

it('登记失败保留数据库错误码和取消身份，剥离输入路径', async () => {
  const filePath = 'D:/private/voice.wav'
  for (const [name, code] of [['SqliteError', 'SQLITE_BUSY'], ['AbortError', 'ABORT_ERR']]) {
    const original = Object.assign(new Error(`失败 '${filePath}'`), { name, code })
    original.stack = `Error: failed\n    at databaseWrite (${filePath}:9:2)`
    create.mockRejectedValueOnce(original)
    const error = await addMediaReferenceToLibrary({ filePath, mediaType: 'audio', source: 'imported' }).catch(value => value)
    expect(error).toMatchObject({ name, code, message: "失败 '[本地路径]'" })
    const logged = logError.mock.calls.at(-1)![1].error
    expect(logged).toBeInstanceOf(Error); expect(logged).toBe(error)
    expect(logged.stack).toContain('databaseWrite'); expect(logged.stack).not.toContain(filePath)
    expect(logError.mock.calls.at(-1)![1].context).not.toHaveProperty('error')
  }
})
