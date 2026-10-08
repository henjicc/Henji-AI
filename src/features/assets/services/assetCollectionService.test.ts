import { describe, expect, it, vi } from 'vitest'
const create = vi.hoisted(() => vi.fn())
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
