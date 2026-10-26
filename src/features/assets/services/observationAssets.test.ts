// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import type { AssetQueryInput, AssetRecord } from '@/platform/contracts/assetLibrary'

const state = vi.hoisted(() => ({ assets: new Map<string, AssetRecord>(), recycled: [] as string[][], created: null as AssetRecord | null }))
const tagsOf = (asset: AssetRecord): string[] => asset.tags
vi.mock('@/commands/assetLibrary', () => ({
  queryAssets: vi.fn(async (input: AssetQueryInput) => {
    const items = [...state.assets.values()].filter(asset => (!input.tag || tagsOf(asset).includes(input.tag)) && (!input.keyword || asset.displayName.includes(input.keyword)) && (!input.mediaType || asset.mediaType === input.mediaType))
      .sort((a, b) => b.createdAt - a.createdAt)
    const page = input.page ?? 1, size = input.pageSize ?? 50
    return { items: items.slice((page - 1) * size, page * size), total: items.length, page, pageSize: size }
  }),
  setAssetTags: vi.fn(async (id: string, tags: string[]) => { const asset = state.assets.get(id)!; asset.tags = tags; return asset }),
  deleteAsset: vi.fn(async (id: string) => { state.assets.delete(id) }),
  touchAsset: vi.fn(async (id: string) => { state.assets.get(id)!.lastUsedAt = Date.now() }),
}))
vi.mock('@/platform', () => ({ getPlatform: () => ({ media: { enqueueRecycle: vi.fn(async (paths: string[]) => { state.recycled.push(paths) }) } }) }))
vi.mock('./assetCollectionService', () => ({ addMediaReferenceToLibrary: vi.fn(async () => state.created!) }))

import { collectObservationImage, isLegacyObservation, OBSERVATION_ASSET_TAG, OBSERVATION_KEEP_COUNT, pruneObservationAssets } from './observationAssets'

const DAY = 86_400_000
const asset = (id: string, patch: Partial<AssetRecord> = {}): AssetRecord => ({
  id, mediaType: 'image', displayName: `元宝搜索 · 正片 · 帧 ${id} 观察`, filePath: `E:/文档/痕迹AI/上传素材/${id}.png`, displayUrl: '', source: 'video-edit', mimeType: 'image/png',
  sizeBytes: 1, width: 1, height: 1, durationSeconds: null, thumbnailPath: null, thumbnailUrl: null, inspectionStatus: 'ready', inspectionError: null, fileModifiedAt: null,
  lastUsedAt: null, createdAt: 0, updatedAt: 0, tags: [OBSERVATION_ASSET_TAG], libraryIds: [], ...patch,
})

beforeEach(() => { state.assets.clear(); state.recycled = []; localStorage.clear() })

it('新观察图打上“助手观察”标签；同内容复用的观察图只刷新使用时间', async () => {
  const now = Date.now()
  state.created = asset('new', { tags: [], createdAt: now }); state.assets.set('new', state.created)
  await collectObservationImage({ filePath: 'x', displayName: 'x', source: 'video-edit' })
  expect(state.assets.get('new')!.tags).toEqual([OBSERVATION_ASSET_TAG])
  state.created = { ...asset('old', { createdAt: now - 3 * DAY }), wasExisting: true }; state.assets.set('old', state.created)
  await collectObservationImage({ filePath: 'y', displayName: 'y', source: 'video-edit' })
  expect(state.assets.get('old')!.lastUsedAt).toBeGreaterThan(now - 1000)
})

it('只保留最近用过的一批且不超过 7 天；进了素材库或打了别的标签的留下，删掉的文件交给媒体回收', async () => {
  const now = Date.now()
  for (let index = 0; index < OBSERVATION_KEEP_COUNT + 5; index++) state.assets.set(`a${index}`, asset(`a${index}`, { createdAt: now - index * 1000 }))
  state.assets.set('old', asset('old', { createdAt: now - 8 * DAY }))
  state.assets.set('reused', asset('reused', { createdAt: now - 30 * DAY, lastUsedAt: now }))
  state.assets.set('kept-library', asset('kept-library', { createdAt: now - 30 * DAY, libraryIds: ['lib'] }))
  state.assets.set('kept-tag', asset('kept-tag', { createdAt: now - 30 * DAY, tags: [OBSERVATION_ASSET_TAG, '封面备选'] }))
  const removed = await pruneObservationAssets(now)
  expect(removed).toBe(6 + 1)
  expect(state.assets.has('reused')).toBe(true); expect(state.assets.has('old')).toBe(false)
  expect(state.assets.has('kept-library')).toBe(true); expect(state.assets.has('kept-tag')).toBe(true)
  expect([...state.assets.keys()].filter(id => id.startsWith('a'))).toHaveLength(OBSERVATION_KEEP_COUNT - 1)
  expect(state.recycled.flat()).toContain('E:/文档/痕迹AI/上传素材/old.png')
})

it('有标签之前的旧观察图按名称认出、补标签后按同一规则清理；用户自己的同名素材不动', async () => {
  const now = Date.now()
  state.assets.set('legacy', asset('legacy', { tags: [], createdAt: now - 10 * DAY }))
  state.assets.set('legacy-surface', asset('legacy-surface', { tags: [], source: 'generated', displayName: 'window-observation.png', createdAt: now - DAY }))
  state.assets.set('mine', asset('mine', { tags: [], source: 'imported', displayName: '我拍的观察', createdAt: now - 10 * DAY }))
  state.assets.set('mine-library', asset('mine-library', { tags: [], libraryIds: ['lib'], createdAt: now - 10 * DAY }))
  expect(isLegacyObservation(state.assets.get('mine')!)).toBe(false)
  await pruneObservationAssets(now)
  expect(state.assets.has('legacy')).toBe(false)
  expect(state.assets.get('legacy-surface')!.tags).toEqual([OBSERVATION_ASSET_TAG])
  expect(state.assets.has('mine')).toBe(true); expect(state.assets.has('mine-library')).toBe(true)
})
