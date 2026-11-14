import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

import { upgradePersistenceContent, type PersistenceContract } from '../../persistence/migrations'
import { canvasDocumentKind } from './canvas'

const contract: PersistenceContract = {
  id: 'document.canvas', name: '画布', version: canvasDocumentKind.version, minReaderVersion: canvasDocumentKind.minReaderVersion,
  schema: canvasDocumentKind.contentSchema, migrations: canvasDocumentKind.migrations,
}
const fixture = (version: number) => JSON.parse(fs.readFileSync(`tests/fixtures/persistence/document.canvas/v${version}.json`, 'utf8')) as { content: unknown; kindVersion: number }
const node = (id: string, data: Record<string, unknown>) => ({ id, type: 'uploadNode', position: { x: 0, y: 0 }, data })
type Upgraded = { nodes: Array<{ id: string; data: Record<string, unknown> }>; imagePool?: string[] }

describe('画布文档 1 → 2：预览不再指向程序缩略图目录', () => {
  it('去掉素材库、本地导入与生成记录写进节点的缩略图路径，作品自带的预览与原媒体原样保留', () => {
    const upgraded = upgradePersistenceContent(contract, {
      nodes: [
        node('asset', { imageUrl: 'D:\\素材\\a.png', previewImageUrl: 'E:\\文档\\HenjiAI\\.system\\Thumbnails\\' + 'a'.repeat(64) + '.webp' }),
        node('import-image', { imageUrl: 'E:\\文档\\HenjiAI\\上传\\b.png', previewImageUrl: 'C:/Users/u/AppData/Roaming/Henji-AI/Thumbnails/image-' + 'b'.repeat(64) + '.jpg' }),
        node('import-video', { videoUrl: '/Users/u/c.mp4', previewImageUrl: '/Users/u/Library/Application Support/HenjiAI/.system/Thumbnails/video-' + 'c'.repeat(64) + '.jpg' }),
        node('history', { imageUrl: 'D:\\d.png', previewImageUrl: 'henji-media://local/E%3A%2F%E6%96%87%E6%A1%A3%2FThumbnails%2F540%2Fd-1234.webp' }),
        node('generated', { imageUrl: 'E:\\文档\\HenjiAI\\生成结果\\e.png', previewImageUrl: 'E:\\文档\\HenjiAI\\生成结果\\e-preview.jpg' }),
        node('pooled', { previewImageUrl: '__img_ref__:0', imageUrl: '__img_ref__:1' }),
        node('frames', { frames: [{ id: 'f1', imageUrl: 'D:\\f.png', previewImageUrl: 'D:\\HenjiAI\\Thumbnails\\image-f.jpg' }, { id: 'f2', imageUrl: 'D:\\g.png', previewImageUrl: 'D:\\g.png' }] }),
      ],
      edges: [],
      imagePool: ['E:\\HenjiAI\\.system\\Thumbnails\\x.webp', 'D:\\素材\\x.png'],
    }, 1) as Upgraded

    const data = Object.fromEntries(upgraded.nodes.map(entry => [entry.id, entry.data]))
    for (const id of ['asset', 'import-image', 'import-video', 'history', 'pooled']) expect(data[id]).not.toHaveProperty('previewImageUrl')
    expect(data.asset.imageUrl).toBe('D:\\素材\\a.png')
    expect(data['import-video'].videoUrl).toBe('/Users/u/c.mp4')
    expect(data.generated.previewImageUrl).toBe('E:\\文档\\HenjiAI\\生成结果\\e-preview.jpg')
    expect(data.pooled.imageUrl).toBe('__img_ref__:1')
    expect(upgraded.imagePool).toEqual(['E:\\HenjiAI\\.system\\Thumbnails\\x.webp', 'D:\\素材\\x.png'])
    expect(data.frames.frames).toEqual([{ id: 'f1', imageUrl: 'D:\\f.png' }, { id: 'f2', imageUrl: 'D:\\g.png', previewImageUrl: 'D:\\g.png' }])
  })

  it('已登记的旧样本升级后与当前样本都能按当前格式读取', () => {
    const v1 = fixture(1)
    expect((upgradePersistenceContent(contract, v1.content, v1.kindVersion) as Upgraded).nodes.map(entry => entry.id)).toEqual(['golden-node'])
    const v2 = fixture(2)
    const current = upgradePersistenceContent(contract, v2.content, v2.kindVersion) as Upgraded
    expect(current.nodes.find(entry => entry.id === 'golden-upload-image')?.data.previewImageUrl).toBeNull()
    expect(current.nodes.find(entry => entry.id === 'golden-export-image')?.data.previewImageUrl).toBe('/persistence-project/生成结果/result-preview.jpg')
  })
})
