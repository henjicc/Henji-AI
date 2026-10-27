import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestEnvironment, listFiles, silentLogger, type TestEnvironment } from '../documents/documents.test-support'
import type { AssetDto } from '../asset-library/types'
import { AppStoreIconService, type AppStoreIconDependencies } from './service'

let env: TestEnvironment | undefined
afterEach(async () => { await env?.cleanup(); env = undefined })
const app = { trackId: 6480446430, trackName: '元宝', artistName: '腾讯', kind: 'software', artworkUrl512: 'https://is1-ssl.mzstatic.com/image/thumb/a/512x512bb.jpg' }

async function setup(opaque = false, grayscale = false): Promise<{ service: AppStoreIconService; deps: AppStoreIconDependencies; project: { id: string; path: string }; rows: Map<string, AssetDto> }> {
  env = createTestEnvironment()
  const project = await env.services.service.createProject({ name: '图标测试' })
  const image = sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 100, g: 50, b: 10, alpha: opaque ? 1 : 0 } } })
  const png = await (grayscale ? image.toColourspace('b-w') : image).png().toBuffer()
  const rows = new Map<string, AssetDto>()
  const deps: AppStoreIconDependencies = {
    logger: { ...silentLogger(), info: vi.fn(), error: vi.fn() }, tempRoot: env.outside,
    fetch: vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(async url => String(url).includes('itunes.apple.com') ? Response.json({ results: [app] }) : new Response(new Uint8Array(png))),
    requireProject: async id => { if (id !== project.id) throw new Error('项目不存在，请用 list_projects') },
    importFile: input => env!.services.service.importFile(input),
    createAsset: async input => {
      const row: AssetDto = { id: `asset-${rows.size + 1}`, filePath: input.filePath, mediaType: 'image', displayName: input.displayName!, source: 'imported', displayUrl: '', mimeType: 'image/png', sizeBytes: png.length, width: 1024, height: 1024, durationSeconds: null, thumbnailPath: null, thumbnailUrl: null, inspectionStatus: 'ready', inspectionError: null, fileModifiedAt: 0, lastUsedAt: null, createdAt: 0, updatedAt: 0, tags: [], libraryIds: [] }
      rows.set(row.id, row); return row
    },
    inspectAsset: async id => { const row = rows.get(id); if (!row) throw new Error('素材不存在'); return row },
    deleteAsset: id => { rows.delete(id) },
  }
  return { service: new AppStoreIconService(deps), deps, project, rows }
}

describe('App Store 服务与正式项目文件入库', () => {
  it('灰度透明 PNG 按 RGBA 核验；明确 appId 始终用 lookup，不退化为名称搜索', async () => {
    const { service, deps, project } = await setup(false, true)
    expect((await service.save({ appId: '6480446430', projectId: project.id })).transparentCorners).toBe(true)
    await expect(service.save({ appId: '123', projectId: project.id })).rejects.toThrow('编号 123')
    const urls = vi.mocked(deps.fetch!).mock.calls.map(call => String(call[0]))
    expect(urls.some(url => url.includes('/lookup?id=123&'))).toBe(true)
  })
  it('中文用 URLSearchParams 编码；链接地区优先且不向结果暴露图片地址', async () => {
    const { service, deps } = await setup()
    const result = await service.search({ query: '腾讯元宝' })
    const url = new URL(String(vi.mocked(deps.fetch!).mock.calls[0][0]))
    expect(url.searchParams.get('term')).toBe('腾讯元宝')
    expect(result.candidates[0]).toEqual({ appId: '6480446430', name: '元宝', developer: '腾讯', platform: 'iphone', category: '' })
    await service.search({ query: 'https://apps.apple.com/us/app/a/id6480446430', country: 'cn' })
    expect(String(vi.mocked(deps.fetch!).mock.calls[1][0])).toContain('country=us')
  })
  it('真实文件落入项目分类，同内容同名加序号，返回引用能回读素材与 PNG', async () => {
    const { service, project, rows } = await setup()
    const first = await service.save({ appId: '6480446430', projectId: project.id })
    const second = await service.save({ appId: '6480446430', projectId: project.id })
    expect(first).toMatchObject({ width: 1024, height: 1024, transparentCorners: true, verification: { verified: true } })
    expect(first.assetRef).not.toEqual(second.assetRef)
    expect(rows.get(first.assetRef.id)?.filePath).toBe(path.join(project.path, '素材', '图标', '元宝.png'))
    expect(rows.get(second.assetRef.id)?.filePath).toBe(path.join(project.path, '素材', '图标', '元宝 (2).png'))
    expect((await sharp(await fs.readFile(rows.get(first.assetRef.id)!.filePath)).metadata()).hasAlpha).toBe(true)
    expect(JSON.stringify(first)).not.toContain(project.path)
  })
  it('缺项目、错误平台、透明角失败均写入前拒绝；换方形后可以继续', async () => {
    const { service, project, rows } = await setup(true)
    await expect(service.save({ appId: '6480446430' })).rejects.toThrow('没有当前项目')
    await expect(service.save({ appId: '6480446430', projectId: project.id, platform: 'mac' })).rejects.toThrow('换平台')
    await expect(service.save({ appId: '6480446430', projectId: project.id })).rejects.toMatchObject({ name: 'DocumentLocationError', message: expect.stringContaining('四角不透明') })
    expect(rows.size).toBe(0)
    expect((await service.save({ appId: '6480446430', projectId: project.id, shape: 'square' })).transparentCorners).toBe(false)
  })
  it('登记后回读失败补偿文件和素材，保留已有文件，日志包含失败事件', async () => {
    const { service, deps, project, rows } = await setup()
    const first = await service.save({ appId: '6480446430', projectId: project.id })
    deps.inspectAsset = async () => { throw new Error('回读失败') }
    await expect(service.save({ appId: '6480446430', projectId: project.id })).rejects.toMatchObject({ name: 'DocumentLocationError' })
    expect(rows.size).toBe(1)
    expect(rows.has(first.assetRef.id)).toBe(true)
    expect(await listFiles(path.join(project.path, '素材'))).toEqual(['图标/元宝.png'])
    expect(deps.logger.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'app_store_icons.save.failed' }))
  })
  it('HTTP 失败给出已知状态，空结果给出改道；实际请求带超时信号', async () => {
    const { service, deps } = await setup()
    deps.fetch = vi.fn(async () => new Response('', { status: 429 }))
    await expect(service.search({ query: '元宝' })).rejects.toThrow('HTTP 429')
    expect(vi.mocked(deps.fetch).mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
    deps.fetch = async () => Response.json({ results: [] })
    await expect(service.search({ query: '元宝' })).rejects.toThrow('换地区、换平台或粘贴 App Store 链接')
  })
})
