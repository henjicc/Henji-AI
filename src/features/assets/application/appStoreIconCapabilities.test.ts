// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform'
import { harnessDocumentStore, installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { APP_STORE_ICON_CAPABILITIES } from '@/core/application-control/domains/asset/appStoreIconCapabilities'
import { APPLICATION_CAPABILITY_IDS } from '@/core/application-control/localHostContracts'
import { registerAppStoreIconHandlers } from './registerAppStoreIconHandlers'
import type { CapabilityHandler } from '@/features/application-control/capabilities/handlerTypes'
import { createLegacyTrackVideoEditProject, savedVideoEdit } from '@/features/videoEdit/application/videoEditDocumentTestKit'
import { closeVideoEditProject, listVideoEditInstances } from '@/features/videoEdit/application/videoEditService'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'

const current = vi.hoisted(() => ({ projectId: undefined as string | undefined }))
vi.mock('@/features/documents/currentDocumentContext', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/documents/currentDocumentContext')>(),
  currentDocumentContext: () => ({ projectId: current.projectId }),
}))

beforeEach(() => { installHarnessNativeStorage(); current.projectId = undefined })
afterEach(async () => {
  for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id)
  vi.restoreAllMocks(); uninstallHarnessNativeStorage()
})

const saved = { assetRef: { kind: 'asset' as const, id: 'icon-asset' }, projectId: 'project', name: '元宝', width: 1024, height: 1024, transparentCorners: true, verification: { verified: true, condition: 'PNG 与素材记录均已回读' } }

describe('App Store 能力同源发现与正式调用', () => {
  it('两个能力自动进入 Pi/MCP 公共名单，封闭参数、写目标和实际素材 Effect 对齐', () => {
    for (const definition of APP_STORE_ICON_CAPABILITIES) {
      expect(APPLICATION_CAPABILITY_IDS).toContain(definition.id)
      expect(definition.aiInputSchema.additionalProperties).toBe(false)
      expect(definition.aiInputSchema.properties).not.toHaveProperty('path')
    }
    const save = APP_STORE_ICON_CAPABILITIES[1]
    const input = save.inputSchema.parse({ appId: '6480446430', projectId: 'project' })
    expect(save.resolveOperationTargets?.(input)).toEqual([{ kind: 'documents.project', id: 'project' }])
    expect(save.resolveOperationWriteTargets?.(input, 'op')).toEqual([{ kind: 'asset', id: 'pending:op' }])
    expect(save.resolveObservedEffects?.(input, saved)).toMatchObject([{ effect: 'create', targetRefs: [saved.assetRef], count: 1, verified: true }])
    expect(() => save.inputSchema.parse({ appId: '6480446430', path: 'C:/bad' })).toThrow()
  })
  it('省略项目在等待前固定当前项目，显式项目优先', async () => {
    const handlers = new Map<string, CapabilityHandler>()
    registerAppStoreIconHandlers({ registerHandler: (id, handler) => handlers.set(id, handler) })
    current.projectId = 'project-a'
    const save = vi.spyOn(getPlatform().assetLibrary, 'saveAppStoreIcon').mockImplementation(async input => {
      current.projectId = 'project-b'
      return { ...saved, projectId: input.projectId! }
    })
    await handlers.get('save_app_store_icon')!({ appId: '6480446430' }, { signal: new AbortController().signal })
    expect(save.mock.calls[0][0].projectId).toBe('project-a')
    await handlers.get('save_app_store_icon')!({ appId: '6480446430', projectId: 'explicit' }, { signal: new AbortController().signal })
    expect(save.mock.calls[1][0].projectId).toBe('explicit')
  })
  it('公共入口查询和保存后，返回素材可直接引入剪辑并读回保存状态', async () => {
    const owner = await createLegacyTrackVideoEditProject()
    const container = harnessDocumentStore().stored(owner.document.id)!.meta.container
    if (container.kind !== 'project') throw new Error('测试剪辑必须在项目中')
    const projectId = container.projectId
    // 项目制作进度文件尚未创建；项目本身来自正式文档存储夹具。
    vi.spyOn(getPlatform().system.fs, 'exists').mockResolvedValue(false)
    const record: AssetRecord = { id: saved.assetRef.id, mediaType: 'image', displayName: '元宝', filePath: 'D:/project/素材/图标/元宝.png', displayUrl: '', source: 'imported', mimeType: 'image/png', sizeBytes: 4096, width: 1024, height: 1024, durationSeconds: null, thumbnailPath: null, thumbnailUrl: null, inspectionStatus: 'ready', inspectionError: null, fileModifiedAt: 1000, contentIdentity: 'a'.repeat(64), lastUsedAt: null, createdAt: 1, updatedAt: 1, tags: [], libraryIds: [] }
    vi.spyOn(getPlatform().assetLibrary, 'searchAppStoreIcons').mockResolvedValue({ country: 'cn', candidates: [{ appId: '6480446430', name: '元宝', developer: '腾讯', platform: 'iphone', category: '工具' }] })
    vi.spyOn(getPlatform().assetLibrary, 'saveAppStoreIcon').mockResolvedValue({ ...saved, projectId })
    vi.spyOn(getPlatform().assetLibrary, 'inspectAsset').mockResolvedValue(record)
    const app = createApplicationHarness()
    try {
      expect(await app.requireResult('search_app_store_icons', { query: '腾讯元宝' })).toMatchObject({ candidates: [{ appId: '6480446430' }] })
      const result = await app.requireResult('save_app_store_icon', { appId: '6480446430', projectId })
      expect(result.assetRef).toEqual(saved.assetRef)
      await app.requireResult('import_video_edit_asset', { documentRef: { kind: 'video_edit.document', id: owner.document.id }, assetRef: result.assetRef })
      expect(owner.document.media).toHaveLength(1)
      expect(savedVideoEdit(owner).media[0]).toMatchObject({ assetId: saved.assetRef.id, width: 1024, height: 1024 })
    } finally { app.dispose() }
  })
})
